use std::{env, path::PathBuf};

use anyhow::{Context, Result, bail};

pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub admin_email: Option<String>,
    pub admin_password: Option<String>,
    pub port: u16,
    pub frontend_path: PathBuf,
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
