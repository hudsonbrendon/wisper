//! `wisper-summarize` — runs the local LLM summary in its own process so its
//! llama.cpp ggml never clashes with the main app's whisper.cpp ggml. Reads the
//! transcript from stdin; `--model <path>` and `--language <lang>` from args;
//! writes the markdown summary to stdout. Non-zero exit + stderr on failure.
mod llm;
mod prompt;

use std::io::Read;

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let model = arg_value(&args, "--model").ok_or("missing --model")?;
    let language = arg_value(&args, "--language").unwrap_or_else(|| "auto".to_string());

    let mut transcript = String::new();
    std::io::stdin()
        .read_to_string(&mut transcript)
        .map_err(|e| format!("read stdin: {e}"))?;
    if transcript.trim().is_empty() {
        return Err("empty transcript".to_string());
    }

    let markdown = llm::summarize(&model, &transcript, &language)?;
    print!("{markdown}");
    Ok(())
}

/// Value following `flag` in `args`, if present.
fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
}
