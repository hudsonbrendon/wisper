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
    // Multilingual models (tiny/base/small/medium/large) transcribe all 99
    // Whisper languages from a single file; the `.en` variants are English-only
    // but a bit faster/smaller. Bigger = more accurate and slower. Sizes are
    // approximate on-disk footprints.
    &[
        ModelInfo {
            id: "tiny", // ~75 MB, multilingual
            filename: "ggml-tiny.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
        },
        ModelInfo {
            id: "tiny.en", // ~75 MB, English-only
            filename: "ggml-tiny.en.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
            sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
        },
        ModelInfo {
            id: "base", // ~142 MB, multilingual
            filename: "ggml-base.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        },
        ModelInfo {
            id: "base.en", // ~142 MB, English-only
            filename: "ggml-base.en.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
            sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        },
        ModelInfo {
            id: "small", // ~466 MB, multilingual
            filename: "ggml-small.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        },
        ModelInfo {
            id: "small.en", // ~466 MB, English-only
            filename: "ggml-small.en.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
            sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        },
        ModelInfo {
            id: "medium", // ~1.5 GB, multilingual
            filename: "ggml-medium.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        },
        ModelInfo {
            id: "medium.en", // ~1.5 GB, English-only
            filename: "ggml-medium.en.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
            sha256: "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
        },
        ModelInfo {
            id: "large-v3-turbo", // ~1.6 GB, multilingual, near-large accuracy & fast
            filename: "ggml-large-v3-turbo.bin",
            url:
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
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
    let actual_hex = actual
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
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

/// Delete a model's file from the app-data dir. Succeeds (no-op) if the file is
/// already gone; also clears any leftover `.part` from an interrupted download.
pub fn remove(app_data_dir: &Path, info: &ModelInfo) -> Result<(), String> {
    let path = model_path(app_data_dir, info);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("remove model: {e}")),
    }
    let part = path.with_extension("bin.part");
    let _ = std::fs::remove_file(part);
    Ok(())
}

/// Returned by `download` when `on_progress` asks to stop. The caller treats
/// this as a user cancel rather than a hard error.
pub const CANCELLED: &str = "cancelled";

/// Download `info` into the app-data dir, invoking `on_progress(received, total)`
/// as bytes arrive, then verify the hash. Returns the final path.
///
/// `on_progress` returns `false` to cancel: the partial `.part` file is removed
/// and the call returns `Err(CANCELLED)`.
pub async fn download<F>(
    app_data_dir: &Path,
    info: &ModelInfo,
    mut on_progress: F,
) -> Result<PathBuf, String>
where
    F: FnMut(u64, u64) -> bool,
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
        if !on_progress(received, total) {
            drop(file);
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(CANCELLED.to_string());
        }
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
        assert!(!verify_sha256(
            b"hello",
            "0000000000000000000000000000000000000000000000000000000000000000"
        ));
    }

    #[test]
    fn catalog_ids_are_findable() {
        assert!(find("base.en").is_some());
        assert!(find("does-not-exist").is_none());
    }

    #[test]
    fn catalog_entries_are_unique_and_well_formed() {
        let models = catalog();
        assert!(models.len() >= 8);
        let mut ids: Vec<&str> = models.iter().map(|m| m.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), models.len(), "duplicate model ids");
        for m in models {
            assert!(m.url.starts_with("https://"), "{} url", m.id);
            assert!(m.filename.ends_with(".bin"), "{} filename", m.id);
            assert_eq!(m.sha256.len(), 64, "{} sha length", m.id);
        }
    }

    fn fresh_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wisper_model_test_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // "hello" -> this digest; lets us exercise the file-hash path without a model.
    const HELLO_SHA: &str = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    fn fake_model() -> ModelInfo {
        ModelInfo {
            id: "fake",
            filename: "fake.bin",
            url: "https://example.com/fake.bin",
            sha256: HELLO_SHA,
        }
    }

    #[test]
    fn model_path_is_under_models_dir() {
        let dir = fresh_dir("path");
        let p = model_path(&dir, &fake_model());
        assert_eq!(p, dir.join("models").join("fake.bin"));
    }

    #[test]
    fn is_downloaded_true_only_when_hash_matches() {
        let dir = fresh_dir("isdl");
        let info = fake_model();
        assert!(!is_downloaded(&dir, &info), "missing file");

        let path = model_path(&dir, &info);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"hello").unwrap();
        assert!(is_downloaded(&dir, &info), "matching bytes");

        std::fs::write(&path, b"tampered").unwrap();
        assert!(!is_downloaded(&dir, &info), "wrong bytes");
    }

    #[test]
    fn remove_deletes_model_and_part_and_is_idempotent() {
        let dir = fresh_dir("remove");
        let info = fake_model();
        let path = model_path(&dir, &info);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"hello").unwrap();
        std::fs::write(path.with_extension("bin.part"), b"partial").unwrap();

        remove(&dir, &info).unwrap();
        assert!(!path.exists());
        assert!(!path.with_extension("bin.part").exists());
        // Removing again (already gone) is a no-op success.
        remove(&dir, &info).unwrap();
    }
}
