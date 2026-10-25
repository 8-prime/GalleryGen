use anyhow::Result;
use gallerygen_backend::{auth, config::Config, db, images, portfolios, router};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let config = Config::load()?;
    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    auth::bootstrap_admin(
        &pool,
        config.admin_email.as_deref(),
        config.admin_password.as_deref(),
    )
    .await?;
    let listener =
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, config.port)).await?;
    tracing::info!(port = config.port, "server starting");
    tokio::fs::create_dir_all(&config.storage_path).await?;
    let app = router(&config.frontend_path).merge(
        auth::routes()
            .merge(images::routes())
            .merge(portfolios::routes())
            .with_state(auth::AppState {
                pool: pool.clone(),
                jwt_secret: config.jwt_secret,
                storage_path: config.storage_path,
                image_signer: config.image_signer,
            }),
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    pool.close().await;
    Ok(())
}
