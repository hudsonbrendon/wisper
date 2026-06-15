//! Local transcription history.
//!
//! Every successful dictation is appended as one JSON line to
//! `history.jsonl` in the app data dir. JSON Lines (one record per line) lets
//! us append cheaply without rewriting the whole file, and the file stays
//! human-readable. Everything is local — nothing leaves the machine — which
//! keeps the app's local-first promise while still powering the Home history
//! list and the Insights charts.

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

/// One recorded dictation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    /// Unix epoch milliseconds when the transcription completed.
    pub ts_ms: u64,
    /// The transcribed text that was inserted.
    pub text: String,
    /// Word count of `text` (whitespace-split). Stored so the frontend never
    /// has to re-tokenize the whole history to total things up.
    pub words: usize,
    /// Length of the captured audio in milliseconds (drives words-per-minute).
    pub duration_ms: u64,
}

fn history_path(data_dir: &Path) -> PathBuf {
    data_dir.join("history.jsonl")
}

/// Append one entry. Best-effort: a failure here must never break dictation,
/// so callers log and move on rather than surfacing an error to the user.
pub fn append(data_dir: &Path, entry: &Entry) -> std::io::Result<()> {
    if let Some(parent) = history_path(data_dir).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(history_path(data_dir))?;
    file.write_all(line.as_bytes())
}

/// Read all entries, newest first. Skips any corrupt line rather than failing
/// the whole read, so one bad write can't hide the entire history.
pub fn read_all(data_dir: &Path) -> Vec<Entry> {
    let raw = match std::fs::read_to_string(history_path(data_dir)) {
        Ok(s) => s,
        Err(_) => return Vec::new(), // no history yet
    };
    let mut entries: Vec<Entry> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    entries.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
    entries
}

/// Delete the whole history file. Missing file is treated as success.
pub fn clear(data_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(history_path(data_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}
