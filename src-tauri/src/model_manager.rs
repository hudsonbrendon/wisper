use sha2::{Digest, Sha256};

/// A downloadable Whisper ggml model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    /// Lowercase hex SHA-256 of the downloaded file.
    pub sha256: &'static str,
}

/// The models we offer. SHA-256 values are the published hashes from the
/// ggml-org/whisper.cpp Hugging Face repo. Verify against the repo before
/// trusting a new entry.
pub fn catalog() -> &'static [ModelInfo] {
    &[
        ModelInfo {
            id: "base.en",
            filename: "ggml-base.en.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
            sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        },
    ]
}

/// Look up a model by id.
pub fn find(id: &str) -> Option<&'static ModelInfo> {
    catalog().iter().find(|m| m.id == id)
}

/// True if `bytes` hashes to `expected` (case-insensitive hex).
pub fn verify_sha256(bytes: &[u8], expected: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let actual = hasher.finalize();
    let actual_hex = actual.iter().map(|b| format!("{b:02x}")).collect::<String>();
    actual_hex.eq_ignore_ascii_case(expected)
}

use std::path::{Path, PathBuf};

/// Returns the on-disk path for a model inside the given app-data dir.
pub fn model_path(app_data_dir: &Path, info: &ModelInfo) -> PathBuf {
    app_data_dir.join("models").join(info.filename)
}

/// True if the model file exists and matches its expected hash.
pub fn is_downloaded(app_data_dir: &Path, info: &ModelInfo) -> bool {
    let path = model_path(app_data_dir, info);
    match std::fs::read(&path) {
        Ok(bytes) => verify_sha256(&bytes, info.sha256),
        Err(_) => false,
    }
}

/// Download `info` into the app-data dir, invoking `on_progress(received, total)`
/// as bytes arrive, then verify the hash. Returns the final path.
pub async fn download<F>(
    app_data_dir: &Path,
    info: &ModelInfo,
    mut on_progress: F,
) -> Result<PathBuf, String>
where
    F: FnMut(u64, u64),
{
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dir = app_data_dir.join("models");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create models dir: {e}"))?;
    let final_path = dir.join(info.filename);
    let tmp_path = dir.join(format!("{}.part", info.filename));

    let resp = reqwest::get(info.url)
        .await
        .map_err(|e| format!("request: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("create tmp: {e}"))?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download chunk: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write chunk: {e}"))?;
        received += chunk.len() as u64;
        on_progress(received, total);
    }
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    drop(file);

    let bytes = tokio::fs::read(&tmp_path)
        .await
        .map_err(|e| format!("read tmp for verify: {e}"))?;
    if !verify_sha256(&bytes, info.sha256) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("hash mismatch after download".to_string());
    }
    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("rename: {e}"))?;
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_matches_known_hash() {
        // SHA-256 of the bytes "hello" is well-known.
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_sha256(b"hello", expected));
    }

    #[test]
    fn verify_rejects_wrong_hash() {
        assert!(!verify_sha256(b"hello", "0000000000000000000000000000000000000000000000000000000000000000"));
    }

    #[test]
    fn catalog_ids_are_findable() {
        assert!(find("base.en").is_some());
        assert!(find("does-not-exist").is_none());
    }
}
