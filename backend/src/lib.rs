pub mod config;
pub mod imgproxy;

use std::path::Path;

use axum::{Router, response::Redirect, routing::get};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

pub fn router(frontend_path: &Path) -> Router {
    // SPA fallback is scoped to /app: unknown API URLs must remain 404s.
    let frontend =
        ServeDir::new(frontend_path).fallback(ServeFile::new(frontend_path.join("index.html")));
    Router::new()
        .route("/", get(|| async { Redirect::temporary("/app/login") }))
        .route("/health", get(|| async { "ok" }))
        .nest_service("/app", frontend)
        .layer(TraceLayer::new_for_http())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn unknown_api_routes_do_not_return_the_spa() {
        let response = router(Path::new("../web/dist"))
            .oneshot(
                Request::builder()
                    .uri("/api/missing")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn health_is_available_without_frontend_files() {
        let response = router(Path::new("/nonexistent/gallerygen-frontend"))
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn frontend_routes_use_index_but_assets_keep_their_contents() {
        let dir = std::env::temp_dir().join(format!("gallerygen-spa-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "portfolio app").unwrap();
        std::fs::write(dir.join("asset.js"), "javascript asset").unwrap();
        for (path, expected) in [
            ("/app/login", "portfolio app"),
            ("/app/asset.js", "javascript asset"),
        ] {
            let response = router(&dir)
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let body = axum::body::to_bytes(response.into_body(), 1024)
                .await
                .unwrap();
            assert_eq!(body.as_ref(), expected.as_bytes());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
