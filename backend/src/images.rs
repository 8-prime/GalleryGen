use std::{
    collections::HashMap,
    io::Cursor,
    path::{Component, PathBuf},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get},
};
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::auth::{ApiError, ApiResult, AppState, UserId};

pub fn image_url(state: &AppState, id: Uuid, key: &str, thumbnail: bool) -> String {
    match &state.image_signer {
        Some(signer) => format!(
            "/img{}",
            signer.path(
                key,
                if thumbnail { 400 } else { 1600 },
                if thumbnail { 400 } else { 0 }
            )
        ),
        None => format!("/media/{id}"),
    }
}

fn response(state: &AppState, row: PgRow) -> Value {
    let id: Uuid = row.get("id");
    let key: String = row.get("storage_key");
    json!({"id":id, "filename":row.get::<String,_>("filename"), "mime_type":row.get::<String,_>("mime_type"),
        "width":row.get::<Option<i32>,_>("width").unwrap_or(0), "height":row.get::<Option<i32>,_>("height").unwrap_or(0),
        "folder_id":row.get::<Option<Uuid>,_>("folder_id"),"size_bytes":row.get::<Option<i64>,_>("size_bytes").unwrap_or(0), "created_at":row.get::<Option<String>,_>("created_at_text").unwrap_or_default(),
        "thumb_url":image_url(state,id,&key,true), "full_url":image_url(state,id,&key,false)})
}

// Never accept absolute or traversal paths, including paths already in the database.
fn storage_file(state: &AppState, key: &str) -> ApiResult<PathBuf> {
    if key.is_empty()
        || std::path::Path::new(key)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(ApiError(StatusCode::NOT_FOUND, "not found"));
    }
    Ok(state.storage_path.join(key))
}

fn io_error(error: std::io::Error) -> ApiError {
    tracing::error!(%error, "image storage operation failed");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "storage error")
}

async fn list(
    State(state): State<AppState>,
    UserId(user): UserId,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let (limit, offset) = pagination(&query);
    let search = query.get("search").map(|s| s.trim()).unwrap_or("");
    if search.len() > 500 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "search is too long"));
    }
    let pattern = format!(
        "%{}%",
        search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let folder = query.get("folder").map(String::as_str).unwrap_or("all");
    let folder_id = if folder == "all" || folder == "none" {
        None
    } else {
        Some(
            Uuid::parse_str(folder)
                .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid folder"))?,
        )
    };
    let unfiled = folder == "none";
    let filter = "user_id=$1 AND filename ILIKE $2 AND ($3::uuid IS NULL OR folder_id=$3) AND (NOT $4 OR folder_id IS NULL)";
    let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM images WHERE {filter}"))
        .bind(user)
        .bind(&pattern)
        .bind(folder_id)
        .bind(unfiled)
        .fetch_one(&state.pool)
        .await?;
    let order = match query.get("sort").map(String::as_str) {
        Some("oldest") => "created_at ASC,id",
        Some("name") => "lower(filename),id",
        _ => "created_at DESC,id",
    };
    let rows=sqlx::query(&format!("SELECT *,to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at_text FROM images WHERE {filter} ORDER BY {order} LIMIT $5 OFFSET $6"))
        .bind(user).bind(pattern).bind(folder_id).bind(unfiled).bind(limit).bind(offset).fetch_all(&state.pool).await?;
    Ok(Json(
        json!({"images":rows.into_iter().map(|row| response(&state,row)).collect::<Vec<_>>(), "total":total,"limit":limit,"offset":offset}),
    ))
}

fn pagination(query: &HashMap<String, String>) -> (i64, i64) {
    let limit = query
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| (1..=200).contains(n))
        .unwrap_or(50);
    let offset = query
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| *n >= 0)
        .unwrap_or(0);
    (limit, offset)
}

async fn upload(
    State(state): State<AppState>,
    UserId(user): UserId,
    Query(query): Query<HashMap<String, String>>,
    mut multipart: Multipart,
) -> ApiResult<impl IntoResponse> {
    let folder = match query.get("folder") {
        Some(value) => Some(
            Uuid::parse_str(value)
                .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid folder"))?,
        ),
        None => None,
    };
    if let Some(folder) = folder {
        crate::library::own_folder(&state, user, folder).await?;
    }
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "failed to parse form"))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let filename = field
            .file_name()
            .unwrap_or("upload")
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("upload")
            .to_owned();
        let mime = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_owned();
        let data = field
            .bytes()
            .await
            .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "failed to parse form"))?;
        let size = data.len() as i64;
        let (data, dimensions) = tokio::task::spawn_blocking(move || {
            let dimensions = image::ImageReader::new(Cursor::new(&data))
                .with_guessed_format()
                .ok()
                .and_then(|reader| reader.into_dimensions().ok());
            (data, dimensions)
        })
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "upload failed"))?;
        let extension = std::path::Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .filter(|e| e.len() <= 16 && e.bytes().all(|c| c.is_ascii_alphanumeric()))
            .map(|e| format!(".{}", e.to_ascii_lowercase()))
            .unwrap_or_default();
        let key = format!("{user}/{}{extension}", Uuid::new_v4());
        let path = storage_file(&state, &key)?;
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .map_err(io_error)?;
        // Unique filenames are never reused, keeping cached URLs immutable.
        tokio::fs::write(&path, &data).await.map_err(io_error)?;
        let row = sqlx::query("INSERT INTO images (user_id,storage_key,filename,mime_type,width,height,size_bytes,folder_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at_text")
            .bind(user).bind(&key).bind(filename).bind(mime).bind(dimensions.and_then(|(w,_)| i32::try_from(w).ok())).bind(dimensions.and_then(|(_,h)| i32::try_from(h).ok())).bind(size).bind(folder).fetch_one(&state.pool).await;
        match row {
            Ok(row) => return Ok((StatusCode::CREATED, Json(response(&state, row)))),
            Err(error) => {
                let _ = tokio::fs::remove_file(path).await;
                return Err(error.into());
            }
        }
    }
    Err(ApiError(StatusCode::BAD_REQUEST, "file field required"))
}

async fn serve(state: AppState, id: &str, user: Option<Uuid>) -> ApiResult<Response> {
    let id = Uuid::parse_str(id).map_err(|_| ApiError(StatusCode::NOT_FOUND, "not found"))?;
    let row: Option<(String,String)> = sqlx::query_as("SELECT storage_key,mime_type FROM images WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)")
        .bind(id).bind(user).fetch_optional(&state.pool).await?;
    let (key, mime) = row.ok_or(ApiError(StatusCode::NOT_FOUND, "not found"))?;
    let file = tokio::fs::File::open(storage_file(&state, &key)?)
        .await
        .map_err(|_| ApiError(StatusCode::NOT_FOUND, "not found"))?;
    let content_type = mime
        .parse::<axum::http::HeaderValue>()
        .unwrap_or_else(|_| axum::http::HeaderValue::from_static("application/octet-stream"));
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (
                header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static(if user.is_some() {
                    "private, max-age=86400"
                } else {
                    "public, max-age=86400"
                }),
            ),
        ],
        Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}

async fn public(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    serve(state, &id, None).await
}
async fn raw(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    serve(state, &id, Some(user)).await
}
async fn remove(
    State(state): State<AppState>,
    UserId(user): UserId,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let id = Uuid::parse_str(&id)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "delete failed"))?;
    let key: Option<String> = sqlx::query_scalar(
        "DELETE FROM images WHERE id = $1 AND user_id = $2 RETURNING storage_key",
    )
    .bind(id)
    .bind(user)
    .fetch_optional(&state.pool)
    .await?;
    let key = key.ok_or(ApiError(StatusCode::INTERNAL_SERVER_ERROR, "delete failed"))?;
    if let Err(error) = tokio::fs::remove_file(storage_file(&state, &key)?).await {
        tracing::warn!(%error,"could not remove original image file");
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/images", get(list).post(upload))
        .route("/api/images/", get(list).post(upload))
        .route("/api/images/{id}", delete(remove))
        .route("/api/images/{id}/raw", get(raw))
        .route("/media/{id}", get(public))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pagination_preserves_legacy_defaults() {
        assert_eq!(pagination(&HashMap::new()), (50, 0));
        assert_eq!(
            pagination(&HashMap::from([
                ("limit".into(), "201".into()),
                ("offset".into(), "-1".into())
            ])),
            (50, 0)
        );
        assert_eq!(
            pagination(&HashMap::from([
                ("limit".into(), "200".into()),
                ("offset".into(), "100".into())
            ])),
            (200, 100)
        );
    }

    #[tokio::test]
    async fn storage_keys_cannot_escape_the_originals_directory() {
        let state = AppState {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
                .unwrap(),
            jwt_secret: "unused".into(),
            storage_path: "/tmp/gallerygen-images".into(),
            image_signer: None,
        };
        for key in ["../secret", "/etc/passwd", "user/../../secret", ""] {
            assert!(storage_file(&state, key).is_err());
        }
        assert_eq!(
            storage_file(&state, "user/photo.jpg").unwrap(),
            PathBuf::from("/tmp/gallerygen-images/user/photo.jpg")
        );
    }
}
