//! Local meeting transcripts. Each meeting is one JSON file in
//! `data_dir/meetings/<id>.json`. One-file-per-meeting (not append-only like
//! history) because a meeting is a single large document the user opens, renames
//! and deletes as a unit. Everything stays local.

use crate::stt::SttSegment;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    /// "me" (mic) or "them" (system audio).
    pub speaker: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub started_ms: u64,
    pub duration_ms: u64,
    pub language: String,
    pub partial: bool,
    pub segments: Vec<Segment>,
    /// Markdown AI summary, None until generated. `serde(default)` keeps
    /// meetings saved before this field existed loadable.
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeetingSummary {
    pub id: String,
    pub title: String,
    pub started_ms: u64,
    pub duration_ms: u64,
    pub language: String,
    pub partial: bool,
}

fn meetings_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("meetings")
}

fn meeting_path(data_dir: &Path, id: &str) -> PathBuf {
    meetings_dir(data_dir).join(format!("{id}.json"))
}

/// Human title from the start time, e.g. "Meeting 1750000000000". The frontend
/// formats the timestamp for display; this is only the stored default the user
/// can rename. Kept timezone-free (epoch ms) so it never depends on locale here.
pub fn default_title(started_ms: u64) -> String {
    format!("Meeting {started_ms}")
}

/// Write the meeting as pretty JSON. Creates the meetings dir if missing.
/// Best-effort at the call site: callers log on failure, never crash.
pub fn save(data_dir: &Path, m: &Meeting) -> std::io::Result<()> {
    std::fs::create_dir_all(meetings_dir(data_dir))?;
    let json = serde_json::to_string_pretty(m)?;
    std::fs::write(meeting_path(data_dir, &m.id), json)
}

/// One full meeting by id, or None if missing/corrupt.
pub fn get(data_dir: &Path, id: &str) -> Option<Meeting> {
    let raw = std::fs::read_to_string(meeting_path(data_dir, id)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Summaries (no segment bodies), newest first. Skips corrupt files so one bad
/// write can't hide the whole list.
pub fn list(data_dir: &Path) -> Vec<MeetingSummary> {
    let entries = match std::fs::read_dir(meetings_dir(data_dir)) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<MeetingSummary> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|raw| serde_json::from_str::<Meeting>(&raw).ok())
        .map(|m| MeetingSummary {
            id: m.id,
            title: m.title,
            started_ms: m.started_ms,
            duration_ms: m.duration_ms,
            language: m.language,
            partial: m.partial,
        })
        .collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.started_ms));
    out
}

/// Delete one meeting. Missing file is success.
pub fn delete(data_dir: &Path, id: &str) -> std::io::Result<()> {
    match std::fs::remove_file(meeting_path(data_dir, id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Change only the title, leaving the transcript intact. No-op if missing.
pub fn rename(data_dir: &Path, id: &str, title: &str) -> std::io::Result<()> {
    if let Some(mut m) = get(data_dir, id) {
        m.title = title.to_string();
        return save(data_dir, &m);
    }
    Ok(())
}

/// Merge the two transcribed source streams into one speaker-labelled, time-
/// ordered transcript. `me` = mic, `them` = system audio. Stable sort keeps the
/// original within-stream order for ties.
pub fn merge_segments(me: &[SttSegment], them: &[SttSegment]) -> Vec<Segment> {
    let mut all: Vec<Segment> = Vec::with_capacity(me.len() + them.len());
    for s in me {
        all.push(Segment {
            speaker: "me".to_string(),
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text.clone(),
        });
    }
    for s in them {
        all.push(Segment {
            speaker: "them".to_string(),
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text.clone(),
        });
    }
    all.sort_by_key(|s| s.start_ms);
    all
}

/// Flatten the segments into speaker-labelled lines for the summary prompt.
/// "me" → "Você", anything else → "Participantes". One line per segment, in
/// order, joined by newlines. Empty when there are no segments.
pub fn transcript_text(m: &Meeting) -> String {
    m.segments
        .iter()
        .map(|s| {
            let who = if s.speaker == "me" {
                "Você"
            } else {
                "Participantes"
            };
            format!("{who}: {}", s.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wisper_meetings_test_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn meeting(id: &str, started_ms: u64, text: &str) -> Meeting {
        Meeting {
            id: id.to_string(),
            title: format!("m{id}"),
            started_ms,
            duration_ms: 1000,
            language: "en".to_string(),
            partial: false,
            summary: None,
            segments: vec![Segment {
                speaker: "me".to_string(),
                start_ms: 0,
                end_ms: 1000,
                text: text.to_string(),
            }],
        }
    }

    #[test]
    fn list_empty_when_no_dir() {
        let dir = fresh_dir("empty");
        assert!(list(&dir).is_empty());
    }

    #[test]
    fn save_then_get_roundtrips() {
        let dir = fresh_dir("roundtrip").join("nested");
        let m = meeting("100", 100, "hello");
        save(&dir, &m).unwrap();
        assert_eq!(get(&dir, "100"), Some(m));
        assert_eq!(get(&dir, "nope"), None);
    }

    #[test]
    fn list_is_newest_first_and_omits_segments() {
        let dir = fresh_dir("order");
        save(&dir, &meeting("10", 10, "old")).unwrap();
        save(&dir, &meeting("30", 30, "new")).unwrap();
        save(&dir, &meeting("20", 20, "mid")).unwrap();
        let ids: Vec<_> = list(&dir).into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["30", "20", "10"]);
    }

    #[test]
    fn delete_removes_and_is_idempotent() {
        let dir = fresh_dir("delete");
        save(&dir, &meeting("1", 1, "x")).unwrap();
        delete(&dir, "1").unwrap();
        assert_eq!(get(&dir, "1"), None);
        delete(&dir, "1").unwrap(); // already gone is OK
    }

    #[test]
    fn rename_changes_title_only() {
        let dir = fresh_dir("rename");
        save(&dir, &meeting("1", 1, "x")).unwrap();
        rename(&dir, "1", "Sprint planning").unwrap();
        let got = get(&dir, "1").unwrap();
        assert_eq!(got.title, "Sprint planning");
        assert_eq!(got.segments.len(), 1); // body untouched
    }

    #[test]
    fn list_skips_corrupt_files() {
        let dir = fresh_dir("corrupt");
        save(&dir, &meeting("1", 1, "good")).unwrap();
        std::fs::write(meetings_dir(&dir).join("2.json"), b"not json").unwrap();
        assert_eq!(list(&dir).len(), 1);
    }

    #[test]
    fn merge_orders_by_start_and_tags_speaker() {
        let me = vec![
            SttSegment {
                start_ms: 0,
                end_ms: 100,
                text: "morning".into(),
            },
            SttSegment {
                start_ms: 400,
                end_ms: 500,
                text: "lets start".into(),
            },
        ];
        let them = vec![SttSegment {
            start_ms: 200,
            end_ms: 300,
            text: "hi there".into(),
        }];
        let merged = merge_segments(&me, &them);
        let pairs: Vec<_> = merged
            .iter()
            .map(|s| (s.speaker.as_str(), s.text.as_str()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("me", "morning"),
                ("them", "hi there"),
                ("me", "lets start")
            ]
        );
    }

    #[test]
    fn default_title_is_nonempty() {
        assert!(!default_title(0).is_empty());
    }

    #[test]
    fn old_meeting_without_summary_deserializes_to_none() {
        // A JSON from before the summary field existed must still load.
        let json = r#"{
            "id":"1","title":"m","started_ms":0,"duration_ms":0,
            "language":"pt","partial":false,
            "segments":[{"speaker":"me","start_ms":0,"end_ms":1,"text":"oi"}]
        }"#;
        let m: Meeting = serde_json::from_str(json).unwrap();
        assert_eq!(m.summary, None);
    }

    #[test]
    fn summary_roundtrips() {
        let dir = fresh_dir("summary_roundtrip");
        let mut m = meeting("5", 5, "hello");
        m.summary = Some("## Resumo\nok".to_string());
        save(&dir, &m).unwrap();
        assert_eq!(
            get(&dir, "5").unwrap().summary,
            Some("## Resumo\nok".to_string())
        );
    }

    #[test]
    fn transcript_text_labels_by_speaker_in_order() {
        let m = Meeting {
            id: "1".into(),
            title: "m".into(),
            started_ms: 0,
            duration_ms: 0,
            language: "pt".into(),
            partial: false,
            summary: None,
            segments: vec![
                Segment {
                    speaker: "me".into(),
                    start_ms: 0,
                    end_ms: 1,
                    text: "bom dia".into(),
                },
                Segment {
                    speaker: "them".into(),
                    start_ms: 1,
                    end_ms: 2,
                    text: "oi".into(),
                },
                Segment {
                    speaker: "me".into(),
                    start_ms: 2,
                    end_ms: 3,
                    text: "vamos".into(),
                },
            ],
        };
        assert_eq!(
            transcript_text(&m),
            "Você: bom dia\nParticipantes: oi\nVocê: vamos"
        );
    }

    #[test]
    fn transcript_text_empty_when_no_segments() {
        let m = Meeting {
            id: "1".into(),
            title: "m".into(),
            started_ms: 0,
            duration_ms: 0,
            language: "pt".into(),
            partial: false,
            summary: None,
            segments: vec![],
        };
        assert_eq!(transcript_text(&m), "");
    }
}
