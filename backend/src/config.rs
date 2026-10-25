use std::{env, path::PathBuf};

use anyhow::{Context, Result, bail};

pub struct Config {
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
            port,
            frontend_path: env::var_os("FRONTEND_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("../web/dist")),
        })
    }
}
