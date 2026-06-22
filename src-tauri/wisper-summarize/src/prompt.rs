//! Pure prompt construction for the summary helper. No llama here.

pub const MAX_TRANSCRIPT_CHARS: usize = 24_000;

/// Truncate to `max_chars` on a char boundary, appending a notice when cut.
pub fn truncate_transcript(transcript: &str, max_chars: usize) -> String {
    if transcript.chars().count() <= max_chars {
        return transcript.to_string();
    }
    let cut: String = transcript.chars().take(max_chars).collect();
    format!("{cut}\n… [transcrição truncada]")
}

/// Build the structured-summary prompt in `language`, grounded only in the transcript.
pub fn build_prompt(transcript: &str, language: &str) -> String {
    let body = truncate_transcript(transcript, MAX_TRANSCRIPT_CHARS);
    format!(
        "Você é um assistente que resume reuniões. Resuma a transcrição abaixo \
         no idioma '{language}'. Use APENAS o que está na transcrição — não \
         invente fatos, nomes ou tarefas. Responda em markdown com EXATAMENTE \
         estas seções:\n\n\
         ## Resumo\n(2 a 3 frases)\n\n\
         ## Pontos-chave\n(itens com '-')\n\n\
         ## Decisões\n(itens com '-'; 'Nenhuma' se não houver)\n\n\
         ## Action items\n(itens '- [ ] tarefa — responsável'; 'Nenhum' se não houver)\n\n\
         Transcrição:\n\"\"\"\n{body}\n\"\"\"\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_keeps_short_transcript_intact() {
        let t = "linha 1\nlinha 2";
        assert_eq!(truncate_transcript(t, 100), t);
    }

    #[test]
    fn truncate_cuts_long_transcript_and_marks_it() {
        let t = "a".repeat(50);
        let out = truncate_transcript(&t, 10);
        assert!(out.starts_with("aaaaaaaaaa"));
        assert!(out.contains("…"));
    }

    #[test]
    fn prompt_contains_transcript_and_sections_and_language() {
        let p = build_prompt("Você: oi", "pt");
        assert!(p.contains("Você: oi"));
        assert!(p.contains("Resumo"));
        assert!(p.contains("Pontos-chave"));
        assert!(p.contains("Decisões"));
        assert!(p.contains("Action items"));
        assert!(p.contains("pt"));
    }

    #[test]
    fn prompt_truncates_long_transcript() {
        let long = "x".repeat(MAX_TRANSCRIPT_CHARS + 5_000);
        let p = build_prompt(&long, "pt");
        assert!(p.len() < long.len());
        assert!(p.contains("…"));
    }
}
