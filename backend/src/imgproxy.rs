use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// Produces the same paths as api/internal/images/imgproxy.go.
/// Presentation options belong in the signed path, not an unsigned query string.
pub struct Signer {
    key: Vec<u8>,
    salt: Vec<u8>,
}

impl Signer {
    pub fn new(key: &str, salt: &str) -> Result<Self> {
        let key = hex::decode(key).context("IMGPROXY_KEY must be hexadecimal")?;
        let salt = hex::decode(salt).context("IMGPROXY_SALT must be hexadecimal")?;
        if key.is_empty() || salt.is_empty() {
            bail!("imgproxy signing key and salt must not be empty");
        }
        Ok(Self { key, salt })
    }

    pub fn path(&self, storage_key: &str, width: u32, height: u32) -> String {
        let source = URL_SAFE_NO_PAD.encode(format!("local:///{storage_key}"));
        let path = format!("/rs:fit:{width}:{height}/g:sm/{source}");
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.key).expect("HMAC accepts any key length");
        mac.update(&self.salt);
        mac.update(path.as_bytes());
        let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        format!("/{signature}{path}")
    }

    pub fn verify(&self, path: &str) -> bool {
        let Some((signature, rest)) = path.strip_prefix('/').and_then(|path| path.split_once('/'))
        else {
            return false;
        };
        let Ok(signature) = URL_SAFE_NO_PAD.decode(signature) else {
            return false;
        };
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.key).expect("HMAC accepts any key length");
        mac.update(&self.salt);
        mac.update(b"/");
        mac.update(rest.as_bytes());
        mac.verify_slice(&signature).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_signing_configuration() {
        assert!(Signer::new("", "00").is_err());
        assert!(Signer::new("00", "not hex").is_err());
    }

    #[test]
    fn matches_existing_go_signing_contract() {
        let signer = Signer::new("00112233445566778899aabbccddeeff", "deadbeef").unwrap();
        assert_eq!(
            signer.path("user/photo.jpg", 1600, 0),
            include_str!("../tests/imgproxy-path.txt").trim()
        );
    }

    #[test]
    fn verification_rejects_tampering_and_key_rotation() {
        let signer = Signer::new("0011", "2233").unwrap();
        let path = signer.path("user/photo.jpg", 400, 400);
        assert!(signer.verify(&path));
        assert!(!signer.verify(&path.replace("400", "800")));
        assert!(!Signer::new("4455", "2233").unwrap().verify(&path));
    }
}
