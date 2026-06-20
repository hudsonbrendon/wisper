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
    entries.sort_by_key(|e| std::cmp::Reverse(e.ts_ms));
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, empty temp dir unique to this test name.
    fn fresh_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wisper_history_test_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(ts_ms: u64, text: &str) -> Entry {
        Entry {
            ts_ms,
            text: text.to_string(),
            words: text.split_whitespace().count(),
            duration_ms: 1000,
        }
    }

    #[test]
    fn read_all_is_empty_when_no_file() {
        let dir = fresh_dir("no_file");
        assert!(read_all(&dir).is_empty());
    }

    #[test]
    fn append_creates_dir_and_persists() {
        // Use a nested, not-yet-existing data dir to exercise create_dir_all.
        let dir = fresh_dir("append").join("nested");
        append(&dir, &entry(1, "hello world")).unwrap();
        let all = read_all(&dir);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].text, "hello world");
        assert_eq!(all[0].words, 2);
    }

    #[test]
    fn read_all_returns_newest_first() {
        let dir = fresh_dir("order");
        append(&dir, &entry(10, "old")).unwrap();
        append(&dir, &entry(30, "newest")).unwrap();
        append(&dir, &entry(20, "middle")).unwrap();
        let texts: Vec<_> = read_all(&dir).into_iter().map(|e| e.text).collect();
        assert_eq!(texts, vec!["newest", "middle", "old"]);
    }

    #[test]
    fn read_all_skips_corrupt_and_blank_lines() {
        let dir = fresh_dir("corrupt");
        append(&dir, &entry(1, "good")).unwrap();
        // Inject a garbage line + a blank line directly into the file.
        let mut f = OpenOptions::new()
            .append(true)
            .open(history_path(&dir))
            .unwrap();
        f.write_all(b"not json at all\n\n").unwrap();
        append(&dir, &entry(2, "alsogood")).unwrap();
        let all = read_all(&dir);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn clear_removes_file_and_is_idempotent() {
        let dir = fresh_dir("clear");
        append(&dir, &entry(1, "x")).unwrap();
        assert_eq!(read_all(&dir).len(), 1);
        clear(&dir).unwrap();
        assert!(read_all(&dir).is_empty());
        // Clearing again (file already gone) must still succeed.
        clear(&dir).unwrap();
    }
}
