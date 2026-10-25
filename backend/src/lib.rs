pub mod auth;
pub mod canvas;
pub mod config;
pub mod db;
pub mod image_proxy;
pub mod images;
pub mod imgproxy;
pub mod landing;
pub mod library;
pub mod portfolios;

use std::path::Path;

use axum::{Router, routing::get};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

pub fn router(frontend_path: &Path) -> Router {
    // SPA fallback is scoped to /app: unknown API URLs must remain 404s.
    let frontend =
        ServeDir::new(frontend_path).fallback(ServeFile::new(frontend_path.join("index.html")));
    landing::routes()
        .route("/health", get(|| async { "ok" }))
        .nest_service("/app", frontend)
        .layer(TraceLayer::new_for_http())
}

pub fn application(
    frontend_path: &Path,
    state: auth::AppState,
    proxy: Option<std::sync::Arc<image_proxy::ImageProxy>>,
) -> Router {
    let mut app = router(frontend_path).merge(
        auth::routes()
            .merge(canvas::routes())
            .merge(library::routes())
            .merge(images::routes())
            .merge(portfolios::routes())
            .with_state(state),
    );
    if let Some(proxy) = proxy {
        app = app.merge(image_proxy::routes(proxy));
    }
    app.layer(tower_http::timeout::TimeoutLayer::with_status_code(
        axum::http::StatusCode::GATEWAY_TIMEOUT,
        std::time::Duration::from_secs(120),
    ))
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
    async fn combined_routes_enforce_authentication() {
        let state = auth::AppState {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
                .unwrap(),
            jwt_secret: "secret".into(),
            storage_path: "/nonexistent".into(),
            image_signer: None,
        };
        let app = application(Path::new("/nonexistent"), state, None);
        for path in [
            "/api/images",
            "/api/images/",
            "/api/portfolios",
            "/api/portfolios/00000000-0000-0000-0000-000000000001/pages",
            "/api/portfolios/00000000-0000-0000-0000-000000000001/images",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
        }
    }

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
