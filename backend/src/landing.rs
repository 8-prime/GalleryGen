use axum::{
    Router,
    http::header,
    response::{Html, IntoResponse},
    routing::get,
};

fn asset(content_type: &'static str, bytes: &'static [u8]) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        bytes,
    )
}

/// Embed the public landing page so the binary and Docker deployment serve the
/// same page without a separate Caddy web root or a writable asset directory.
pub fn routes() -> Router {
    Router::new()
        .route(
            "/",
            get(|| async { Html(include_str!("../static/landing/index.html")) }),
        )
        .route(
            "/landing/style.css",
            get(|| async {
                asset(
                    "text/css; charset=utf-8",
                    include_bytes!("../static/landing/style.css"),
                )
            }),
        )
        .route(
            "/landing/gallery.js",
            get(|| async {
                asset(
                    "text/javascript; charset=utf-8",
                    include_bytes!("../static/landing/gallery.js"),
                )
            }),
        )
        .route(
            "/landing/favicon.svg",
            get(|| async {
                asset(
                    "image/svg+xml",
                    include_bytes!("../static/landing/favicon.svg"),
                )
            }),
        )
        .route(
            "/landing/lake.jpg",
            get(|| async { asset("image/jpeg", include_bytes!("../static/landing/lake.jpg")) }),
        )
        .route(
            "/landing/highlands.jpg",
            get(|| async {
                asset(
                    "image/jpeg",
                    include_bytes!("../static/landing/highlands.jpg"),
                )
            }),
        )
        .route(
            "/landing/mountain.jpg",
            get(|| async {
                asset(
                    "image/jpeg",
                    include_bytes!("../static/landing/mountain.jpg"),
                )
            }),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn root_serves_the_landing_page_without_redirecting_to_login() {
        let response = crate::router(std::path::Path::new("/nonexistent/frontend"))
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response.headers()[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with("text/html")
        );
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let html = std::str::from_utf8(&body).unwrap();
        assert!(html.contains("Your photographs."));
        assert!(html.contains("href=\"/app/login\""));
        assert!(html.contains("href=\"/app/register\""));
        assert!(!html.contains("Coming soon"));
    }

    #[tokio::test]
    async fn all_landing_assets_have_the_correct_content_types() {
        for (path, mime) in [
            ("style.css", "text/css"),
            ("gallery.js", "text/javascript"),
            ("favicon.svg", "image/svg+xml"),
            ("lake.jpg", "image/jpeg"),
            ("highlands.jpg", "image/jpeg"),
            ("mountain.jpg", "image/jpeg"),
        ] {
            let response = routes()
                .oneshot(
                    Request::builder()
                        .uri(format!("/landing/{path}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert!(
                response.headers()[header::CONTENT_TYPE]
                    .to_str()
                    .unwrap()
                    .starts_with(mime)
            );
            assert!(
                !to_bytes(response.into_body(), 1024 * 1024)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }
}
