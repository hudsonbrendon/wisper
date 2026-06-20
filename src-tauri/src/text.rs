//! Pure text post-processing applied to every transcript.

use crate::config::Replacement;

/// Apply each replacement (case-insensitive `from` -> `to`) to `text`, in order.
/// Empty `from` entries are skipped. Matching is plain substring so multi-word
/// snippet triggers ("my email") work.
pub fn apply_replacements(text: &str, replacements: &[Replacement]) -> String {
    let mut out = text.to_string();
    for r in replacements {
        if r.from.is_empty() {
            continue;
        }
        out = replace_ci(&out, &r.from, &r.to);
    }
    out
}

/// Build the Whisper vocabulary prompt from dictionary entries (a comma-joined
/// list biases recognition toward those words). Empty if there are none.
pub fn dictionary_prompt(words: &[String]) -> String {
    let joined = words
        .iter()
        .map(|w| w.trim())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    joined
}

/// Case-insensitive replace of all non-overlapping occurrences of `from`.
fn replace_ci(haystack: &str, from: &str, to: &str) -> String {
    let hay: Vec<char> = haystack.chars().collect();
    let hay_lc: Vec<char> = haystack.to_lowercase().chars().collect();
    let from_lc: Vec<char> = from.to_lowercase().chars().collect();
    // If lowercasing changed the char count (rare, e.g. ß -> ss), fall back to a
    // plain case-sensitive replace to keep indices aligned and stay correct.
    if hay.len() != hay_lc.len() || from_lc.is_empty() {
        return haystack.replace(from, to);
    }
    let mut out = String::new();
    let mut i = 0;
    while i < hay.len() {
        if i + from_lc.len() <= hay.len() && hay_lc[i..i + from_lc.len()] == from_lc[..] {
            out.push_str(to);
            i += from_lc.len();
        } else {
            out.push(hay[i]);
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(from: &str, to: &str) -> Replacement {
        Replacement {
            from: from.to_string(),
            to: to.to_string(),
        }
    }

    #[test]
    fn replaces_case_insensitively() {
        let out = apply_replacements("Call WISPER now", &[r("wisper", "Wisper")]);
        assert_eq!(out, "Call Wisper now");
    }

    #[test]
    fn expands_multiword_snippet() {
        let out = apply_replacements("send my email please", &[r("my email", "me@x.com")]);
        assert_eq!(out, "send me@x.com please");
    }

    #[test]
    fn applies_in_order_and_skips_empty_from() {
        let out = apply_replacements("a b", &[r("a", "x"), r("", "ignored"), r("b", "y")]);
        assert_eq!(out, "x y");
    }

    #[test]
    fn leaves_text_without_matches_unchanged() {
        assert_eq!(apply_replacements("hello", &[r("zzz", "q")]), "hello");
        assert_eq!(apply_replacements("hello", &[]), "hello");
    }

    #[test]
    fn dictionary_prompt_joins_and_trims() {
        let words = vec!["  Wisper ".to_string(), "".to_string(), "Tauri".to_string()];
        assert_eq!(dictionary_prompt(&words), "Wisper, Tauri");
        assert_eq!(dictionary_prompt(&[]), "");
    }
}
