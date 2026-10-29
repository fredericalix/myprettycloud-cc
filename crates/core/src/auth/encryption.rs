use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;

/// Encrypt `plaintext` with AES-256-GCM. Returns `(ciphertext, nonce)`.
pub fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> anyhow::Result<(Vec<u8>, [u8; 12])> {
    let cipher = Aes256Gcm::new_from_slice(key)?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("encryption failed: {e}"))?;
    Ok((ciphertext, nonce_bytes))
}

/// Decrypt AES-256-GCM `ciphertext` using the stored `nonce`.
pub fn decrypt(ciphertext: &[u8], nonce: &[u8], key: &[u8; 32]) -> anyhow::Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key)?;
    let nonce = Nonce::from_slice(nonce);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("decryption failed: {e}"))?;
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = [7u8; 32];
        let (ct, nonce) = encrypt(b"hello clever cloud", &key).unwrap();
        let pt = decrypt(&ct, &nonce, &key).unwrap();
        assert_eq!(pt, b"hello clever cloud");
    }

    #[test]
    fn wrong_key_fails() {
        let (ct, nonce) = encrypt(b"secret", &[1u8; 32]).unwrap();
        assert!(decrypt(&ct, &nonce, &[2u8; 32]).is_err());
    }
}
