use std::{env, path::PathBuf};

use anyhow::{Context, Result, bail};

pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub admin_email: Option<String>,
    pub admin_password: Option<String>,
    pub port: u16,
    pub frontend_path: PathBuf,
    pub storage_path: PathBuf,
    pub image_signer: Option<std::sync::Arc<crate::imgproxy::Signer>>,
    pub imgproxy_url: String,
    pub cache_path: PathBuf,
    pub cache_max_bytes: u64,
}

impl Config {
    pub fn load() -> Result<Self> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".into())
            .parse()
            .context("PORT must be a valid TCP port")?;
        if port == 0 {
            bail!("PORT must be greater than zero");
        }
        Ok(Self {
            imgproxy_url: env::var("IMGPROXY_BASE_URL")
                .unwrap_or_else(|_| "http://imgproxy:8080".into()),
            cache_path: env::var_os("IMAGE_CACHE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| "./data/cache".into()),
            cache_max_bytes: env::var("IMAGE_CACHE_MAX_BYTES")
                .unwrap_or_else(|_| "10737418240".into())
                .parse()
                .context("IMAGE_CACHE_MAX_BYTES must be a nonnegative integer")?,
            storage_path: env::var_os("STORAGE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| "./data/images".into()),
            image_signer: if env::var("IMGPROXY_ENABLED").as_deref() == Ok("true") {
                Some(std::sync::Arc::new(crate::imgproxy::Signer::new(
                    &env::var("IMGPROXY_KEY").context("IMGPROXY_KEY is required")?,
                    &env::var("IMGPROXY_SALT").context("IMGPROXY_SALT is required")?,
                )?))
            } else {
                None
            },
            database_url: env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            jwt_secret: env::var("JWT_SECRET")
                .ok()
                .filter(|value| !value.is_empty())
                .context("JWT_SECRET is required")?,
            admin_email: env::var("ADMIN_EMAIL")
                .ok()
                .filter(|value| !value.is_empty()),
            admin_password: env::var("ADMIN_PASSWORD")
                .ok()
                .filter(|value| !value.is_empty()),
            port,
            frontend_path: env::var_os("FRONTEND_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("../web/dist")),
        })
    }
}
