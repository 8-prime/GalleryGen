use anyhow::Result;
use gallerygen_backend::{auth, config::Config, db, router};
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
    let app = router(&config.frontend_path).merge(auth::routes().with_state(auth::AppState {
        pool: pool.clone(),
        jwt_secret: config.jwt_secret,
    }));
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    pool.close().await;
    Ok(())
}
