//! Cached, frontend-pushed entitlements + the pure enforcement decisions used
//! by the dictation and meeting guards. The React webview owns Supabase and
//! pushes a snapshot here via `set_entitlements`; Rust enforces from it.

use crate::commands::AppState;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlements {
    pub logged_in: bool,
    pub pro: bool,
    pub remaining_words: i64,
    pub remaining_meetings: i64,
}

impl Default for Entitlements {
    /// Fail-open: until the frontend pushes the real snapshot (right after
    /// launch), do not block a real user.
    fn default() -> Self {
        Entitlements {
            logged_in: true,
            pro: true,
            remaining_words: i64::MAX,
            remaining_meetings: i64::MAX,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    BlockAuth,
    BlockQuota,
}

pub fn decide_dictation(e: &Entitlements) -> Decision {
    if !e.logged_in {
        Decision::BlockAuth
    } else if e.pro || e.remaining_words > 0 {
        Decision::Allow
    } else {
        Decision::BlockQuota
    }
}

pub fn decide_meeting(e: &Entitlements) -> Decision {
    if !e.logged_in {
        Decision::BlockAuth
    } else if e.pro || e.remaining_meetings > 0 {
        Decision::Allow
    } else {
        Decision::BlockQuota
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ent(logged_in: bool, pro: bool, words: i64, meetings: i64) -> Entitlements {
        Entitlements { logged_in, pro, remaining_words: words, remaining_meetings: meetings }
    }

    #[test]
    fn logged_out_blocks_with_auth() {
        assert_eq!(decide_dictation(&ent(false, false, 100, 100)), Decision::BlockAuth);
        assert_eq!(decide_meeting(&ent(false, false, 100, 100)), Decision::BlockAuth);
    }

    #[test]
    fn pro_always_allows() {
        assert_eq!(decide_dictation(&ent(true, true, 0, 0)), Decision::Allow);
        assert_eq!(decide_meeting(&ent(true, true, 0, 0)), Decision::Allow);
    }

    #[test]
    fn free_allows_while_remaining_positive_then_blocks() {
        // > 0 allows (the in-progress dictation finishes even if it crosses 0).
        assert_eq!(decide_dictation(&ent(true, false, 1, 1)), Decision::Allow);
        // <= 0 blocks the next one.
        assert_eq!(decide_dictation(&ent(true, false, 0, 1)), Decision::BlockQuota);
        assert_eq!(decide_meeting(&ent(true, false, 1, 0)), Decision::BlockQuota);
    }
}

/// Frontend pushes the latest snapshot here whenever plan/usage changes.
#[tauri::command]
pub fn set_entitlements(state: tauri::State<AppState>, ent: Entitlements) {
    *state.entitlements.lock().unwrap() = ent;
}
