use crate::{
    auth::{ApiError, ApiResult},
    imgproxy::Signer,
};
use axum::{
    Router,
    body::Body,
    extract::{OriginalUri, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Semaphore};

const MAX_RESPONSE: usize = 32 * 1024 * 1024;
const TTL: u64 = 30 * 86400;

pub struct ImageProxy {
    upstream: String,
    client: reqwest::Client,
    signer: Arc<Signer>,
    directory: PathBuf,
    max_bytes: u64,
    locks: Vec<Mutex<()>>,
    writers: Mutex<()>,
    requests: Semaphore,
}

#[derive(Serialize, Deserialize)]
struct Metadata {
    created: u64,
    content_type: String,
    etag: Option<String>,
}
struct Cached {
    metadata: Metadata,
    data: Vec<u8>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn key(path: &str, accept: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(path);
    hash.update([0]);
    hash.update(accept);
    hex::encode(hash.finalize())
}
fn failure() -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, "image processing unavailable")
}

impl ImageProxy {
    pub async fn new(
        upstream: String,
        signer: Arc<Signer>,
        directory: PathBuf,
        max_bytes: u64,
    ) -> anyhow::Result<Arc<Self>> {
        let url = reqwest::Url::parse(&upstream)?;
        anyhow::ensure!(
            matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none()
                && url.username().is_empty()
                && url.password().is_none(),
            "IMGPROXY_BASE_URL must be an HTTP origin without a path or credentials"
        );
        tokio::fs::create_dir_all(&directory).await?;
        let proxy = Arc::new(Self {
            upstream: upstream.trim_end_matches('/').into(),
            signer,
            directory,
            max_bytes,
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(120))
                .connect_timeout(Duration::from_secs(10))
                .build()?,
            locks: (0..128).map(|_| Mutex::new(())).collect(),
            writers: Mutex::new(()),
            requests: Semaphore::new(8),
        });
        proxy.evict(0).await?;
        Ok(proxy)
    }

    async fn read(&self, key: &str) -> Option<Cached> {
        let path = self.directory.join(format!("{key}.cache"));
        let length = tokio::fs::metadata(&path).await.ok()?.len();
        if length > MAX_RESPONSE as u64 + 4096 {
            return None;
        }
        let bytes = tokio::fs::read(path).await.ok()?;
        let split = bytes.iter().position(|c| *c == b'\n')?;
        if split > 4096 {
            return None;
        }
        let metadata: Metadata = serde_json::from_slice(&bytes[..split]).ok()?;
        Some(Cached {
            metadata,
            data: bytes[split + 1..].to_vec(),
        })
    }

    async fn evict(&self, incoming: u64) -> std::io::Result<()> {
        let mut files = tokio::fs::read_dir(&self.directory).await?;
        let mut entries = Vec::new();
        let mut total = 0;
        while let Some(file) = files.next_entry().await? {
            if file.path().extension().and_then(|s| s.to_str()) == Some("tmp") {
                // Startup or a cancelled write may leave an incomplete entry.
                // All writes/eviction are serialized within the sole cache owner.
                tokio::fs::remove_file(file.path()).await?;
                continue;
            }
            if file.path().extension().and_then(|s| s.to_str()) != Some("cache") {
                continue;
            }
            let metadata = file.metadata().await?;
            total += metadata.len();
            entries.push((
                metadata.modified().unwrap_or(UNIX_EPOCH),
                file.path(),
                metadata.len(),
            ));
        }
        entries.sort_by_key(|entry| entry.0);
        for (_, path, size) in entries {
            if total + incoming <= self.max_bytes {
                break;
            }
            tokio::fs::remove_file(path).await?;
            total = total.saturating_sub(size);
        }
        Ok(())
    }

    async fn write(&self, key: &str, cached: &Cached) -> anyhow::Result<()> {
        let mut bytes = serde_json::to_vec(&cached.metadata)?;
        bytes.push(b'\n');
        bytes.extend_from_slice(&cached.data);
        if bytes.len() as u64 > self.max_bytes {
            return Ok(());
        }
        let _guard = self.writers.lock().await;
        let destination = self.directory.join(format!("{key}.cache"));
        // Remove the prior expired entry before accounting for replacement bytes.
        match tokio::fs::remove_file(&destination).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.evict(bytes.len() as u64).await?;
        let temporary = self.directory.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        if let Err(error) = tokio::fs::write(&temporary, bytes).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error.into());
        }
        if let Err(error) = tokio::fs::rename(&temporary, &destination).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error.into());
        }
        Ok(())
    }

    async fn fetch(&self, path: &str, accept: &str) -> ApiResult<Cached> {
        let mut response = self
            .client
            .get(format!("{}{path}", self.upstream))
            .header(header::ACCEPT, accept)
            .send()
            .await
            .map_err(|_| failure())?;
        if response.status() != StatusCode::OK {
            return Err(ApiError(
                if response.status().is_client_error() {
                    response.status()
                } else {
                    StatusCode::BAD_GATEWAY
                },
                "image processing failed",
            ));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE as u64)
        {
            return Err(failure());
        }
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.starts_with("image/") && v.len() < 1024)
            .ok_or_else(failure)?
            .to_owned();
        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.len() < 1024)
            .map(str::to_owned);
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| failure())? {
            if data.len() + chunk.len() > MAX_RESPONSE {
                return Err(failure());
            }
            data.extend_from_slice(&chunk);
        }
        Ok(Cached {
            metadata: Metadata {
                created: now(),
                content_type,
                etag,
            },
            data,
        })
    }
}

fn respond(cached: Cached, status: &'static str, headers: &HeaderMap) -> Response {
    let not_modified = cached.metadata.etag.as_deref().is_some_and(|etag| {
        headers
            .get(header::IF_NONE_MATCH)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| value == etag)
    });
    let mut response = if not_modified {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        Body::from(cached.data).into_response()
    };
    let target = response.headers_mut();
    target.insert(header::VARY, HeaderValue::from_static("Accept"));
    target.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );
    target.insert("x-cache-status", HeaderValue::from_static(status));
    if let Ok(value) = HeaderValue::from_str(&cached.metadata.content_type) {
        target.insert(header::CONTENT_TYPE, value);
    }
    if let Some(value) = cached
        .metadata
        .etag
        .and_then(|v| HeaderValue::from_str(&v).ok())
    {
        target.insert(header::ETAG, value);
    }
    response
}

async fn serve(
    State(proxy): State<Arc<ImageProxy>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let path = uri.path().strip_prefix("/img").ok_or_else(failure)?;
    // Check on every request, including disk hits, so key rotation invalidates old URLs.
    if uri.query().is_some() || !proxy.signer.verify(path) {
        return Err(ApiError(StatusCode::FORBIDDEN, "invalid image signature"));
    }
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/*");
    if accept.len() > 1024 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid Accept header"));
    }
    let cache_key = key(path, accept);
    let index = u8::from_str_radix(&cache_key[..2], 16).unwrap() as usize % proxy.locks.len();
    let _lock = proxy.locks[index].lock().await;
    let cached = proxy.read(&cache_key).await;
    if cached
        .as_ref()
        .is_some_and(|cached| now().saturating_sub(cached.metadata.created) < TTL)
    {
        return Ok(respond(cached.unwrap(), "HIT", &headers));
    }
    let _permit = proxy.requests.acquire().await.map_err(|_| failure())?;
    match proxy.fetch(path, accept).await {
        Ok(fresh) => {
            if let Err(error) = proxy.write(&cache_key, &fresh).await {
                tracing::warn!(%error,"image cache write failed");
            }
            Ok(respond(fresh, "MISS", &headers))
        }
        Err(error) if error.0.is_server_error() && cached.is_some() => {
            Ok(respond(cached.unwrap(), "STALE", &headers))
        }
        Err(error) => Err(error),
    }
}

pub fn routes(proxy: Arc<ImageProxy>) -> Router {
    Router::new()
        .route("/img/{*path}", get(serve))
        .with_state(proxy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn proxy_caches_revalidates_and_serves_stale_only_for_server_errors() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let hits = Arc::new(AtomicUsize::new(0));
        let upstream = Router::new().fallback({
            let hits = hits.clone();
            move || {
                let hits = hits.clone();
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    (
                        [
                            (header::CONTENT_TYPE, "image/jpeg"),
                            (header::ETAG, "\"fixture\""),
                        ],
                        "jpeg fixture",
                    )
                }
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let dir = std::env::temp_dir().join(format!("gallerygen-proxy-{}", uuid::Uuid::new_v4()));
        let signer = Arc::new(Signer::new("0011", "2233").unwrap());
        let signed = signer.path("user/photo.jpg", 400, 400);
        let proxy = ImageProxy::new(
            format!("http://{address}"),
            signer,
            dir.clone(),
            1024 * 1024,
        )
        .await
        .unwrap();
        let app = routes(proxy.clone());
        for expected in ["MISS", "HIT"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/img{signed}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-cache-status"], expected);
        }
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/img{signed}"))
                    .header(header::IF_NONE_MATCH, "\"fixture\"")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/img{}", signed.replace("400", "800")))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let cache_key = key(&signed, "image/*");
        let mut cached = proxy.read(&cache_key).await.unwrap();
        cached.metadata.created = 0;
        proxy.write(&cache_key, &cached).await.unwrap();
        task.abort();
        let _ = task.await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/img{signed}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["x-cache-status"], "STALE");
        tokio::fs::remove_dir_all(dir).await.unwrap();
    }
    #[test]
    fn output_formats_have_separate_cache_keys() {
        assert_ne!(
            key("/signed/image", "image/avif"),
            key("/signed/image", "image/webp")
        );
    }
    #[tokio::test]
    async fn disk_cache_is_bounded_and_survives_a_new_instance() {
        let dir = std::env::temp_dir().join(format!("gallerygen-cache-{}", uuid::Uuid::new_v4()));
        let signer = Arc::new(Signer::new("0011", "2233").unwrap());
        let proxy = ImageProxy::new(
            "http://127.0.0.1:1".into(),
            signer.clone(),
            dir.clone(),
            200,
        )
        .await
        .unwrap();
        let entry = Cached {
            metadata: Metadata {
                created: now(),
                content_type: "image/jpeg".into(),
                etag: None,
            },
            data: vec![1; 80],
        };
        proxy.write("first", &entry).await.unwrap();
        assert!(proxy.read("first").await.is_some());
        proxy.write("second", &entry).await.unwrap();
        assert!(proxy.read("first").await.is_none());
        drop(proxy);
        let proxy = ImageProxy::new("http://127.0.0.1:1".into(), signer, dir.clone(), 200)
            .await
            .unwrap();
        assert_eq!(proxy.read("second").await.unwrap().data, vec![1; 80]);
        tokio::fs::remove_dir_all(dir).await.unwrap();
    }
}
