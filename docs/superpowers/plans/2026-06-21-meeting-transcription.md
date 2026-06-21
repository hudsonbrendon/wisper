# Meeting Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grava qualquer reunião (Meet/Zoom/Teams) capturando o microfone do usuário ("Eu") e o áudio de saída do sistema ("Eles") em paralelo, transcreve em lote ao parar, salva localmente e mostra a transcrição numa nova seção "Meetings", com um bubble flutuante indicando a gravação.

**Architecture:** Dois capturadores de áudio rodam concorrentemente. O mic usa o `audio::Recorder` existente; o áudio do sistema usa um novo `sysaudio::SystemAudioCapturer` (backend CATap no macOS 14.4+, ScreenCaptureKit no 13–14.3). Ao parar, cada buffer vira 16 kHz mono e é transcrito separadamente pelo Whisper com timestamps; os segmentos dos dois lados são mesclados por `start_ms` em uma transcrição única rotulada `me`/`them` e salva em `data_dir/meetings/<id>.json`.

**Tech Stack:** Rust + Tauri 2, `cpal` (mic), `whisper-rs` 0.16 (STT local), Core Audio / ScreenCaptureKit (captura de sistema, FFI), React + TypeScript + Tailwind (UI), serde_json (persistência JSONL/JSON).

## Global Constraints

- **Plataforma:** captura de áudio do sistema é **macOS apenas**. Em Windows/Linux a seção Meetings aparece desabilitada com aviso. Nunca quebrar o build dessas plataformas (gate com `#[cfg(target_os = "macos")]`).
- **Floor de versão:** feature exige **macOS 13+**. Backend CATap em **14.4+**, ScreenCaptureKit em **13.0–14.3**, desabilitado em < 13.
- **v1 = lote.** Sem transcrição ao vivo, sem resumo IA, sem diarização de múltiplos remotos, sem auto-detecção de app. Esses são v2.
- **Rótulo por fonte:** mic = `"me"`, sistema = `"them"`. Strings exatas.
- **Sem nova dependência de runtime se evitável.** ID da reunião = `started_ms` em decimal (sem crate `uuid`). Novas crates permitidas só onde indicado (`screencapturekit`, FFI Core Audio via `objc2`/`coreaudio-sys`).
- **Persistência best-effort:** falha ao salvar nunca pode travar o app; loga e segue (padrão de `history.rs`).
- **Identificador do app:** `chat.wisper`. Produto: `Wisper`.
- **Não alterar o caminho de ditado existente** (`transcribe()`, `Recorder`, máquina de estado de `state.rs`). Meeting é independente.

---

## File Structure

**Rust (novos):**
- `src-tauri/src/meetings.rs` — structs `Meeting`/`Segment`/`MeetingSummary`, CRUD em `meetings/<id>.json`, e `merge_segments()`. Puro/testável.
- `src-tauri/src/meeting.rs` — `MeetingRecorder`: orquestra mic + sistema, `stop()` transcreve+mescla+salva. macOS-gated.
- `src-tauri/src/sysaudio/mod.rs` — trait `SystemAudioCapturer`, `macos_version()`, `pick_backend()`, `start_system_capture()`.
- `src-tauri/src/sysaudio/screencapturekit.rs` — backend SCK (13–14.3). Nativo.
- `src-tauri/src/sysaudio/catap.rs` — backend Core Audio tap (14.4+). Nativo.
- `src-tauri/Info.plist` — usage descriptions de áudio/tela.

**Rust (modificados):**
- `src-tauri/src/stt.rs` — `SttSegment` + `transcribe_segments()`.
- `src-tauri/src/overlay.rs` — `top_center()` (posiciona o bubble).
- `src-tauri/src/commands.rs` — `AppState.meeting`, comandos de meeting/permissão.
- `src-tauri/src/lib.rs` — registra comandos, cria/posiciona a janela `meeting-bubble`, funções `start/stop/cancel_meeting`.
- `src-tauri/tauri.conf.json` — janela `meeting-bubble`.
- `src-tauri/Cargo.toml` — crate `screencapturekit` + deps Core Audio (macOS).
- `src-tauri/Entitlements.plist` — entitlement de captura.

**Frontend (novos):**
- `src/routes/Meetings.tsx` — lista + botão "Iniciar reunião".
- `src/routes/MeetingDetail.tsx` — transcrição, renomear, copiar, exportar, deletar.
- `src/routes/MeetingBubble.tsx` — janela bubble.

**Frontend (modificados):**
- `src/lib/api.ts` — wrappers + tipos.
- `src/components/Sidebar.tsx` (+ `Sidebar.test.tsx`) — item `meetings`.
- `src/routes/Dashboard.tsx` — view `meetings`.
- `src/App.tsx` — rota `meeting-bubble`.
- `src/lib/i18n.tsx` — strings PT/EN.

---

## Task 1: Meeting storage + types (`meetings.rs`)

Persistência pura, espelhando o estilo de `history.rs`. ID = `started_ms` decimal.

**Files:**
- Create: `src-tauri/src/meetings.rs`
- Modify: `src-tauri/src/lib.rs:1-14` (declarar `mod meetings;`)

**Interfaces:**
- Produces:
  - `struct Segment { speaker: String, start_ms: u64, end_ms: u64, text: String }` (serde, Clone, PartialEq, Debug)
  - `struct Meeting { id: String, title: String, started_ms: u64, duration_ms: u64, language: String, partial: bool, segments: Vec<Segment> }`
  - `struct MeetingSummary { id, title, started_ms, duration_ms, language, partial }` (sem `segments`)
  - `fn save(data_dir: &Path, m: &Meeting) -> std::io::Result<()>`
  - `fn list(data_dir: &Path) -> Vec<MeetingSummary>` (newest first)
  - `fn get(data_dir: &Path, id: &str) -> Option<Meeting>`
  - `fn delete(data_dir: &Path, id: &str) -> std::io::Result<()>` (missing = Ok)
  - `fn rename(data_dir: &Path, id: &str, title: &str) -> std::io::Result<()>`
  - `fn default_title(started_ms: u64) -> String`

- [ ] **Step 1: Declare the module**

Em `src-tauri/src/lib.rs`, na lista de `mod` no topo (após `mod history;`), adicione:

```rust
mod meeting;
mod meetings;
mod sysaudio;
```

(As três entram juntas; `meeting`/`sysaudio` ficam vazias até as próximas tasks — declare só `meetings` agora se preferir compilar a cada passo: `mod meetings;`. As outras serão adicionadas nas suas tasks.)

- [ ] **Step 2: Write the failing tests**

Crie `src-tauri/src/meetings.rs` com APENAS o bloco de testes primeiro (mais os `use`), para compilar e falhar:

```rust
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
            SttSegment { start_ms: 0, end_ms: 100, text: "morning".into() },
            SttSegment { start_ms: 400, end_ms: 500, text: "lets start".into() },
        ];
        let them = vec![SttSegment { start_ms: 200, end_ms: 300, text: "hi there".into() }];
        let merged = merge_segments(&me, &them);
        let pairs: Vec<_> = merged.iter().map(|s| (s.speaker.as_str(), s.text.as_str())).collect();
        assert_eq!(
            pairs,
            vec![("me", "morning"), ("them", "hi there"), ("me", "lets start")]
        );
    }

    #[test]
    fn default_title_is_nonempty() {
        assert!(!default_title(0).is_empty());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test meetings:: 2>&1 | head -30`
Expected: FAIL — `cannot find function 'save'/'list'/...` e `SttSegment` ainda não existe (será criado na Task 2). **Se `SttSegment` bloquear a compilação**, adicione temporariamente no topo de `stt.rs` o stub abaixo (a Task 2 o expande); senão pule para a Task 2 e volte. Stub mínimo:

```rust
// stt.rs (temporário; Task 2 adiciona o método que o produz)
#[derive(Debug, Clone, PartialEq)]
pub struct SttSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}
```

- [ ] **Step 4: Implement the storage + merge functions**

Adicione ACIMA do `#[cfg(test)]` em `meetings.rs`:

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test meetings:: 2>&1 | tail -20`
Expected: PASS (8 testes). Se `SttSegment` ainda for stub, ok.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/meetings.rs src-tauri/src/lib.rs src-tauri/src/stt.rs
git commit -m "feat(meetings): local meeting storage and segment merge"
```

---

## Task 2: Whisper segment timestamps (`stt.rs`)

Extende o transcritor para devolver segmentos com timestamps, sem tocar no `transcribe()` do ditado.

**Files:**
- Modify: `src-tauri/src/stt.rs`
- Test: `src-tauri/tests/stt_integration.rs`

**Interfaces:**
- Consumes: `WhisperState::get_segment(i)` → `Option<WhisperSegment>`; `WhisperSegment::to_str()`, `::start_timestamp()`, `::end_timestamp()` (i64, centésimos de segundo).
- Produces:
  - `struct SttSegment { start_ms: u64, end_ms: u64, text: String }` (Clone, PartialEq, Debug)
  - `fn Transcriber::transcribe_segments(&self, samples: &[f32], language: &str, prompt: &str) -> Result<Vec<SttSegment>, String>`

- [ ] **Step 1: Write the failing test**

Adicione a `src-tauri/tests/stt_integration.rs`:

```rust
#[test]
#[ignore]
fn transcribe_segments_have_timestamps_and_text() {
    use wisper_lib::stt::Transcriber;
    let model = "/tmp/ggml-base.en.bin";
    let wav_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/jfk.wav");
    let mut reader = hound::WavReader::open(wav_path).expect("open wav");
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.expect("sample") as f32 / 32768.0)
        .collect();

    let t = Transcriber::load(model).expect("load model");
    let segs = t.transcribe_segments(&samples, "en", "").expect("segments");
    assert!(!segs.is_empty(), "expected at least one segment");
    // Times are sane and ordered; full text mentions "country".
    assert!(segs[0].end_ms >= segs[0].start_ms);
    let joined = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ").to_lowercase();
    assert!(joined.contains("country"), "got: {joined}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --test stt_integration -- --ignored transcribe_segments 2>&1 | tail -20`
Expected: FAIL — `no method named 'transcribe_segments'`.

- [ ] **Step 3: Implement `SttSegment` + `transcribe_segments`**

Em `src-tauri/src/stt.rs`, substitua o stub de `SttSegment` (se você o adicionou na Task 1) — ou adicione — logo após os `use`:

```rust
/// One time-stamped chunk of recognized speech.
#[derive(Debug, Clone, PartialEq)]
pub struct SttSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}
```

E adicione este método dentro de `impl Transcriber`, ao lado de `transcribe`:

```rust
    /// Like `transcribe`, but returns per-segment text with start/end times.
    /// Whisper reports segment times in centiseconds (1/100 s); convert to ms.
    /// Used by meeting transcription to interleave the mic and system streams.
    pub fn transcribe_segments(
        &self,
        samples: &[f32],
        language: &str,
        prompt: &str,
    ) -> Result<Vec<SttSegment>, String> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("create whisper state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        if language != "auto" {
            params.set_language(Some(language));
        }
        if !prompt.is_empty() {
            params.set_initial_prompt(prompt);
        }
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);

        state
            .full(params, samples)
            .map_err(|e| format!("whisper full: {e}"))?;

        let num_segments = state.full_n_segments();
        let mut out = Vec::with_capacity(num_segments as usize);
        for i in 0..num_segments {
            let seg = state
                .get_segment(i)
                .ok_or_else(|| format!("segment {i} out of bounds"))?;
            let text = seg.to_str().map_err(|e| format!("segment text: {e}"))?;
            // start_timestamp()/end_timestamp() are i64 centiseconds.
            let t0 = seg.start_timestamp().max(0) as u64 * 10;
            let t1 = seg.end_timestamp().max(0) as u64 * 10;
            out.push(SttSegment {
                start_ms: t0,
                end_ms: t1,
                text: text.trim().to_string(),
            });
        }
        Ok(out)
    }
```

> Nota de API (whisper-rs 0.16): se `start_timestamp()`/`end_timestamp()` não existirem no `WhisperSegment` da sua versão, use no lugar `state.full_get_segment_t0(i)` / `state.full_get_segment_t1(i)` (também i64 centésimos) dentro do loop. Compile com `cargo build` para confirmar antes de seguir.

- [ ] **Step 4: Verify it compiles, then run the timestamp test**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: compila sem erro.

Run (só se o modelo estiver em `/tmp/ggml-base.en.bin`): `cd src-tauri && cargo test --test stt_integration -- --ignored transcribe_segments 2>&1 | tail -10`
Expected: PASS. (Se o modelo não estiver presente, o teste fica como verificação manual — registre que compila.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/stt.rs src-tauri/tests/stt_integration.rs
git commit -m "feat(stt): transcribe_segments with per-segment timestamps"
```

---

## Task 3: Bubble window geometry (`overlay.rs`)

Função pura para ancorar o bubble no topo-centro (a pill de ditado já fica embaixo).

**Files:**
- Modify: `src-tauri/src/overlay.rs`

**Interfaces:**
- Produces: `fn top_center(mon_pos: (i32,i32), mon_size: (u32,u32), win: (u32,u32), top_margin: i32) -> (i32, i32)`

- [ ] **Step 1: Write the failing test**

Adicione ao `mod tests` em `src-tauri/src/overlay.rs`:

```rust
    #[test]
    fn top_center_centers_horizontally_below_margin() {
        assert_eq!(
            top_center((0, 0), (1920, 1080), (320, 64), 24),
            ((1920 - 320) / 2, 24)
        );
    }

    #[test]
    fn top_center_respects_monitor_offset() {
        assert_eq!(
            top_center((1920, 0), (1280, 1024), (320, 64), 24),
            (1920 + (1280 - 320) / 2, 24)
        );
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test overlay::tests::top_center 2>&1 | tail -10`
Expected: FAIL — `cannot find function 'top_center'`.

- [ ] **Step 3: Implement `top_center`**

Adicione após `bottom_center` em `src-tauri/src/overlay.rs`:

```rust
/// Top-left position (physical px) to anchor a `win`-sized window at the
/// top-center of a monitor, `top_margin` px below the top edge (clear of the
/// menu bar / notch). Mirrors `bottom_center` for the meeting bubble, which sits
/// at the top so it never overlaps the dictation pill at the bottom.
pub fn top_center(
    mon_pos: (i32, i32),
    mon_size: (u32, u32),
    win: (u32, u32),
    top_margin: i32,
) -> (i32, i32) {
    let (mx, my) = mon_pos;
    let mw = mon_size.0 as i32;
    let ww = win.0 as i32;
    let x = mx + (mw - ww) / 2;
    let y = my + top_margin;
    (x, y)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test overlay::tests::top_center 2>&1 | tail -10`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/overlay.rs
git commit -m "feat(overlay): top_center geometry for the meeting bubble"
```

---

## Task 4: System-audio backend selection (`sysaudio/mod.rs`)

Trait + seleção de backend por versão do macOS. Lógica de seleção é pura/testável; os impls nativos chegam nas Tasks 5–6 (aqui ficam por trás de uma função que erra "não implementado" até lá).

**Files:**
- Create: `src-tauri/src/sysaudio/mod.rs`
- Modify: `src-tauri/src/lib.rs` (garantir `mod sysaudio;`)

**Interfaces:**
- Produces:
  - `trait SystemAudioCapturer: Send { fn level(&self) -> f32; fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16); }`
  - `enum Backend { Catap, ScreenCaptureKit, Unsupported }`
  - `fn pick_backend(version: (u32, u32)) -> Backend`
  - `fn macos_version() -> Option<(u32, u32)>`
  - `fn start_system_capture() -> Result<Box<dyn SystemAudioCapturer>, String>`

- [ ] **Step 1: Write the failing tests**

Crie `src-tauri/src/sysaudio/mod.rs`:

```rust
//! System (output) audio capture: the voices of the *other* meeting
//! participants coming out of the speakers. Two macOS backends behind one
//! trait — Core Audio process taps (CATap) on 14.4+ for the clean audio-only
//! permission prompt, ScreenCaptureKit on 13.0–14.3. Selected at runtime.

#[cfg(target_os = "macos")]
mod catap;
#[cfg(target_os = "macos")]
mod screencapturekit;

/// An active system-audio capture. Mirrors `audio::Recorder`: native samples
/// accumulate until `stop()` hands them back with their native rate/channels for
/// the caller to downmix + resample.
pub trait SystemAudioCapturer: Send {
    /// RMS of the most recent audio, for the bubble level meter.
    fn level(&self) -> f32;
    /// Stop and return (native f32 samples, sample_rate, channels).
    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Catap,
    ScreenCaptureKit,
    Unsupported,
}

/// Pick the capture backend for a (major, minor) macOS version.
/// 14.4+ → CATap; 13.0–14.3 → ScreenCaptureKit; below 13 → Unsupported.
pub fn pick_backend(version: (u32, u32)) -> Backend {
    match version {
        (major, _) if major >= 15 => Backend::Catap,
        (14, minor) if minor >= 4 => Backend::Catap,
        (14, _) => Backend::ScreenCaptureKit,
        (13, _) => Backend::ScreenCaptureKit,
        _ => Backend::Unsupported,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_selection_by_version() {
        assert_eq!(pick_backend((12, 7)), Backend::Unsupported);
        assert_eq!(pick_backend((13, 0)), Backend::ScreenCaptureKit);
        assert_eq!(pick_backend((14, 0)), Backend::ScreenCaptureKit);
        assert_eq!(pick_backend((14, 3)), Backend::ScreenCaptureKit);
        assert_eq!(pick_backend((14, 4)), Backend::Catap);
        assert_eq!(pick_backend((15, 1)), Backend::Catap);
    }
}
```

- [ ] **Step 2: Add the module declaration**

Em `src-tauri/src/lib.rs`, garanta `mod sysaudio;` na lista de módulos do topo. (Os submódulos `catap`/`screencapturekit` ainda não existem — crie-os como stubs no Step 3 para compilar.)

- [ ] **Step 3: Create native stubs so it compiles, plus the runtime entrypoint**

Crie `src-tauri/src/sysaudio/catap.rs`:

```rust
//! Core Audio process-tap capture (macOS 14.4+). Implemented in Task 6.
use super::SystemAudioCapturer;

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    Err("CATap capture not yet implemented".to_string())
}
```

Crie `src-tauri/src/sysaudio/screencapturekit.rs`:

```rust
//! ScreenCaptureKit capture (macOS 13.0–14.3). Implemented in Task 5.
use super::SystemAudioCapturer;

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    Err("ScreenCaptureKit capture not yet implemented".to_string())
}
```

Adicione ao `mod.rs` (acima de `#[cfg(test)]`), a versão do SO e o entrypoint:

```rust
/// Current macOS version as (major, minor), or None off macOS / on error.
#[cfg(target_os = "macos")]
pub fn macos_version() -> Option<(u32, u32)> {
    let out = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    let mut parts = s.trim().split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor))
}

#[cfg(not(target_os = "macos"))]
pub fn macos_version() -> Option<(u32, u32)> {
    None
}

/// Start capturing system audio with the right backend for this OS.
#[cfg(target_os = "macos")]
pub fn start_system_capture() -> Result<Box<dyn SystemAudioCapturer>, String> {
    let version = macos_version().ok_or("could not read macOS version")?;
    match pick_backend(version) {
        Backend::Catap => catap::start(),
        Backend::ScreenCaptureKit => screencapturekit::start(),
        Backend::Unsupported => {
            Err("meeting capture needs macOS 13 or later".to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn start_system_capture() -> Result<Box<dyn SystemAudioCapturer>, String> {
    Err("meeting capture is macOS only".to_string())
}
```

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test sysaudio:: 2>&1 | tail -10`
Expected: PASS (`backend_selection_by_version`).

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sysaudio/ src-tauri/src/lib.rs
git commit -m "feat(sysaudio): capture trait + runtime backend selection"
```

---

## Task 5: ScreenCaptureKit backend (`sysaudio/screencapturekit.rs`)

**Nativo — verificação manual.** Captura de áudio do sistema via ScreenCaptureKit (macOS 13–14.3). Não é unit-testável (precisa de áudio real do SO + permissão de Gravação de Tela). Implementa o trait com a crate `screencapturekit`.

**Files:**
- Modify: `src-tauri/Cargo.toml` (dependência macOS `screencapturekit`)
- Modify: `src-tauri/src/sysaudio/screencapturekit.rs`
- Create: `src-tauri/Info.plist`
- Modify: `src-tauri/Entitlements.plist`

**Interfaces:**
- Produces: `screencapturekit::start() -> Result<Box<dyn SystemAudioCapturer>, String>` (impl concreta de `SystemAudioCapturer`)

- [ ] **Step 1: Add the crate**

Em `src-tauri/Cargo.toml`, no bloco `[target."cfg(target_os = \"macos\")".dependencies]`, adicione:

```toml
screencapturekit = "0.3"
```

Run: `cd src-tauri && cargo fetch 2>&1 | tail -5` — confirme a versão disponível; se `0.3` não existir, rode `cargo add screencapturekit` e fixe a versão resolvida.

- [ ] **Step 2: Add the macOS usage descriptions**

Crie `src-tauri/Info.plist` (Tauri mescla este arquivo no bundle):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSMicrophoneUsageDescription</key>
    <string>Wisper uses your microphone to transcribe your dictation and your voice in meetings.</string>
    <key>NSScreenCaptureUsageDescription</key>
    <string>Wisper captures the audio from your meetings so it can transcribe what other participants say. No video is recorded.</string>
    <key>NSAudioCaptureUsageDescription</key>
    <string>Wisper captures meeting audio so it can transcribe what other participants say.</string>
</dict>
</plist>
```

Em `src-tauri/Entitlements.plist`, garanta (dentro do `<dict>`) o entitlement de captura de áudio:

```xml
    <key>com.apple.security.device.audio-input</key>
    <true/>
```

- [ ] **Step 3: Implement the SCK capturer**

Substitua `src-tauri/src/sysaudio/screencapturekit.rs` por uma impl que:
1. monta um `SCContentFilter` para o display principal (captura todo o mix de saída),
2. configura `SCStreamConfiguration` com `captures_audio = true` e exclui o próprio processo,
3. registra um handler de output de áudio que faz append das amostras f32 num `Arc<Mutex<Vec<f32>>>` (mesmo padrão de `audio.rs`),
4. expõe `level()`/`stop()` do trait.

Código de referência (ajuste nomes aos da versão resolvida da crate — a API de `screencapturekit` muda entre minors; valide com `cargo doc -p screencapturekit --open`):

```rust
//! ScreenCaptureKit capture (macOS 13.0–14.3).
use super::SystemAudioCapturer;
use crate::audio::rms_window;
use std::sync::{Arc, Mutex};

use screencapturekit::{
    output::sc_stream_output_trait::SCStreamOutputTrait,
    output::CMSampleBuffer,
    shareable_content::SCShareableContent,
    stream::{
        configuration::SCStreamConfiguration, content_filter::SCContentFilter,
        output_type::SCStreamOutputType, SCStream,
    },
};

const SR: u32 = 48_000;
const CH: u16 = 2;

struct AudioSink {
    buffer: Arc<Mutex<Vec<f32>>>,
}

impl SCStreamOutputTrait for AudioSink {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
        if !matches!(kind, SCStreamOutputType::Audio) {
            return;
        }
        // Pull interleaved f32 PCM out of the CMSampleBuffer. The exact accessor
        // depends on the crate version (e.g. `get_av_audio_buffer_list` /
        // `into_pcm`); copy every f32 into the shared buffer.
        if let Ok(pcm) = sample.get_audio_buffer_list() {
            if let Ok(mut b) = self.buffer.lock() {
                for frame in pcm.iter() {
                    b.extend_from_slice(frame.data_f32());
                }
            }
        }
    }
}

pub struct SckCapturer {
    stream: SCStream,
    buffer: Arc<Mutex<Vec<f32>>>,
}

// SCStream is retained on the main thread internally; we only touch the buffer
// across threads, which is already a Mutex. Capturer is moved into the recorder.
unsafe impl Send for SckCapturer {}

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    let content = SCShareableContent::get().map_err(|e| format!("shareable content: {e:?}"))?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or("no display to capture")?;
    let filter = SCContentFilter::new().with_display_excluding_windows(&display, &[]);

    let config = SCStreamConfiguration::new()
        .set_captures_audio(true)
        .map_err(|e| format!("config: {e:?}"))?
        .set_excludes_current_process_audio(true)
        .map_err(|e| format!("config: {e:?}"))?
        .set_width(2)
        .map_err(|e| format!("config: {e:?}"))?
        .set_height(2)
        .map_err(|e| format!("config: {e:?}"))?;

    let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(AudioSink { buffer: buffer.clone() }, SCStreamOutputType::Audio);
    stream.start_capture().map_err(|e| format!("start sck: {e:?}"))?;

    Ok(Box::new(SckCapturer { stream, buffer }))
}

impl SystemAudioCapturer for SckCapturer {
    fn level(&self) -> f32 {
        let window = (SR as usize) * (CH as usize) / 10;
        self.buffer.lock().map(|b| rms_window(&b, window)).unwrap_or(0.0)
    }

    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16) {
        let _ = self.stream.stop_capture();
        let raw = self.buffer.lock().map(|b| b.clone()).unwrap_or_default();
        (raw, SR, CH)
    }
}
```

> Este é o ponto de maior atrito de API. Se algum método não bater, abra `cargo doc -p screencapturekit` e ajuste — a forma (filter → config com `captures_audio` → handler que enche um buffer compartilhado → `stop`) é estável; só os nomes mudam. Mantenha `rms_window` (já é `pub` em `audio.rs`).

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: compila. Corrija nomes de API até compilar limpo.

- [ ] **Step 5: Manual verification (real audio)**

Este backend não tem unit test. Verificação completa só após o `MeetingRecorder` e a UI existirem (Tasks 7–9). Por ora, registre que compila. A verificação end-to-end acontece na Task 14 (checklist manual) numa máquina macOS 13–14.3 ou forçando `pick_backend` para `ScreenCaptureKit`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/Info.plist src-tauri/Entitlements.plist src-tauri/src/sysaudio/screencapturekit.rs
git commit -m "feat(sysaudio): ScreenCaptureKit system-audio backend (macOS 13-14.3)"
```

---

## Task 6: Core Audio process-tap backend (`sysaudio/catap.rs`)

**Nativo — verificação manual.** Caminho principal em macOS 14.4+. FFI cru de Core Audio (`AudioHardwareCreateProcessTap` + aggregate device), portado da implementação de referência **insidegui/AudioCap** (https://github.com/insidegui/AudioCap) e do sample oficial da Apple (https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps). Não é unit-testável.

**Files:**
- Modify: `src-tauri/Cargo.toml` (deps Core Audio FFI no bloco macOS)
- Modify: `src-tauri/src/sysaudio/catap.rs`

**Interfaces:**
- Produces: `catap::start() -> Result<Box<dyn SystemAudioCapturer>, String>` (impl concreta de `SystemAudioCapturer`)

- [ ] **Step 1: Add Core Audio FFI deps**

Em `src-tauri/Cargo.toml`, no bloco macOS, adicione:

```toml
coreaudio-sys = "0.2"
core-foundation = "0.10"
```

Run: `cd src-tauri && cargo fetch 2>&1 | tail -5`.

- [ ] **Step 2: Implement the tap capturer**

Substitua `src-tauri/src/sysaudio/catap.rs`. A sequência (idêntica ao AudioCap) é:

1. Criar `CATapDescription` com lista de processos vazia → tapa o mix do sistema inteiro (`AudioHardwareCreateProcessTap` → `tap_object_id`).
2. Criar um aggregate device privado que inclui o tap (`AudioHardwareCreateAggregateDevice` com a chave `kAudioAggregateDeviceTapListKey`).
3. Instalar um IO proc (`AudioDeviceCreateIOProcIDWithBlock`) que copia cada frame f32 do `AudioBufferList` para um `Arc<Mutex<Vec<f32>>>`.
4. `AudioDeviceStart`; em `stop()`, `AudioDeviceStop` + destruir IO proc + aggregate + tap, e devolver o buffer com `sample_rate`/`channels` reais do device (lidos via `kAudioDevicePropertyNominalSampleRate` e o `AudioStreamBasicDescription` do tap).

Esqueleto (porte o corpo `unsafe` a partir do AudioCap — os nomes de símbolo abaixo são de `coreaudio-sys`):

```rust
//! Core Audio process-tap capture (macOS 14.4+).
//! Ported from insidegui/AudioCap (MIT) and Apple's "Capturing system audio
//! with Core Audio taps" sample. FFI is unsafe and OS-version-gated; verified
//! manually against a live meeting, not by unit tests.
#![allow(non_upper_case_globals, non_snake_case)]

use super::SystemAudioCapturer;
use crate::audio::rms_window;
use std::sync::{Arc, Mutex};

struct Shared {
    buffer: Mutex<Vec<f32>>,
    sample_rate: Mutex<u32>,
    channels: Mutex<u16>,
}

pub struct CatapCapturer {
    shared: Arc<Shared>,
    // Handles kept alive for the duration of the capture; dropped/destroyed in stop().
    tap_id: u32,           // AudioObjectID
    aggregate_id: u32,     // AudioObjectID
    io_proc: coreaudio_sys::AudioDeviceIOProcID,
}

unsafe impl Send for CatapCapturer {}

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    // 1. CATapDescription (empty process list = whole-system mix), then
    //    AudioHardwareCreateProcessTap(&desc, &mut tap_id).
    // 2. AudioHardwareCreateAggregateDevice(dict_with_tap, &mut aggregate_id).
    // 3. AudioDeviceCreateIOProcIDWithBlock(&mut io_proc, aggregate_id, queue,
    //    block that copies AudioBufferList f32 frames into shared.buffer).
    // 4. Read the tap's AudioStreamBasicDescription → store sample_rate/channels.
    // 5. AudioDeviceStart(aggregate_id, io_proc).
    // On ANY failure here, tear down whatever was created and return Err with a
    // message the UI can show (so the user can fall back / re-grant permission).
    Err("CATap capture: port the unsafe body from insidegui/AudioCap".to_string())
}

impl SystemAudioCapturer for CatapCapturer {
    fn level(&self) -> f32 {
        let (sr, ch) = (
            *self.shared.sample_rate.lock().unwrap(),
            *self.shared.channels.lock().unwrap(),
        );
        let window = (sr as usize) * (ch.max(1) as usize) / 10;
        self.shared
            .buffer
            .lock()
            .map(|b| rms_window(&b, window))
            .unwrap_or(0.0)
    }

    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16) {
        // AudioDeviceStop(aggregate_id, io_proc);
        // AudioDeviceDestroyIOProcID(aggregate_id, io_proc);
        // AudioHardwareDestroyAggregateDevice(aggregate_id);
        // AudioHardwareDestroyProcessTap(tap_id);
        let raw = self.shared.buffer.lock().map(|b| b.clone()).unwrap_or_default();
        let sr = *self.shared.sample_rate.lock().unwrap();
        let ch = *self.shared.channels.lock().unwrap();
        (raw, sr.max(16_000), ch.max(1))
    }
}
```

> O corpo `unsafe` de `start()`/`stop()` é o trabalho real desta task. Porte-o linha a linha do AudioCap (`AudioCap/ProcessTap.swift`) traduzindo as chamadas Swift para os símbolos C de `coreaudio-sys`. Constantes-chave: `kAudioAggregateDeviceTapListKey`, `kAudioAggregateDeviceUIDKey`, `kAudioAggregateDeviceIsPrivateKey`, `kAudioTapPropertyFormat`. Não invente assinaturas — confira cada símbolo com `cargo doc -p coreaudio-sys`.

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: compila (com `start()` ainda retornando `Err` se você implementar incrementalmente — mas o objetivo da task é o corpo real funcionando; só feche a task quando `start()` capturar de verdade na verificação manual).

- [ ] **Step 4: Manual verification**

macOS 14.4+: rode o app (após Tasks 7–9), inicie uma reunião com áudio tocando (ex.: vídeo no YouTube), pare e confirme que o lado "Eles" tem texto. Registre o resultado. Se o tap entregar buffers silenciosos com algum app específico (problema conhecido com Teams), anote — fallback é o backend SCK.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/sysaudio/catap.rs
git commit -m "feat(sysaudio): Core Audio process-tap backend (macOS 14.4+)"
```

---

## Task 7: Meeting recorder orchestration (`meeting.rs`)

Junta mic + sistema, e no `stop()` transcreve os dois, mescla e monta o `Meeting`. A parte de duração é pura/testável; a orquestração é verificada via a UI (Task 14).

**Files:**
- Create/replace: `src-tauri/src/meeting.rs`
- Modify: `src-tauri/src/lib.rs` (garantir `mod meeting;`)

**Interfaces:**
- Consumes: `audio::Recorder`, `audio::to_mono`, `audio::resample_to_16k`, `sysaudio::start_system_capture`, `sysaudio::SystemAudioCapturer`, `stt::Transcriber::transcribe_segments`, `meetings::{Meeting, merge_segments, default_title}`.
- Produces:
  - `struct MeetingRecorder`
  - `fn MeetingRecorder::start(mic_device: Option<&str>, started_ms: u64) -> Result<MeetingRecorder, String>`
  - `fn MeetingRecorder::level(&self) -> f32`
  - `fn MeetingRecorder::stop(self, transcriber: &Transcriber, language: &str, prompt: &str) -> Meeting`
  - `fn MeetingRecorder::cancel(self)`
  - pure helper `fn samples_to_ms(len: usize) -> u64`

- [ ] **Step 1: Write the failing test (pure helper)**

Crie `src-tauri/src/meeting.rs` com o teste primeiro:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_to_ms_uses_16khz() {
        assert_eq!(samples_to_ms(16_000), 1000);
        assert_eq!(samples_to_ms(8_000), 500);
        assert_eq!(samples_to_ms(0), 0);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test meeting::tests 2>&1 | tail -10`
Expected: FAIL — `cannot find function 'samples_to_ms'`.

- [ ] **Step 3: Implement the recorder**

Acima do `#[cfg(test)]`, adicione:

```rust
//! Orchestrates a meeting recording: the user's mic ("me") and the system
//! output ("them") captured in parallel, transcribed separately on stop and
//! merged into one time-ordered, speaker-labelled transcript.

use crate::audio::{self, Recorder};
use crate::meetings::{self, Meeting};
use crate::stt::Transcriber;
use crate::sysaudio::{self, SystemAudioCapturer};

/// Whisper input is 16 kHz mono, so 16 samples = 1 ms.
pub fn samples_to_ms(len: usize) -> u64 {
    (len as u64) * 1000 / audio::WHISPER_SAMPLE_RATE as u64
}

pub struct MeetingRecorder {
    mic: Recorder,
    system: Option<Box<dyn SystemAudioCapturer>>,
    started_ms: u64,
}

impl MeetingRecorder {
    /// Start both captures. The mic is required; if system capture fails we
    /// still record the mic and mark the meeting partial on stop.
    pub fn start(mic_device: Option<&str>, started_ms: u64) -> Result<MeetingRecorder, String> {
        let mic = Recorder::start(mic_device)?;
        let system = match sysaudio::start_system_capture() {
            Ok(cap) => Some(cap),
            Err(e) => {
                eprintln!("system audio capture unavailable: {e}");
                None
            }
        };
        Ok(MeetingRecorder { mic, system, started_ms })
    }

    /// Highest of the two live levels, for the bubble meter.
    pub fn level(&self) -> f32 {
        let mic = self.mic.level();
        let sys = self.system.as_ref().map(|s| s.level()).unwrap_or(0.0);
        mic.max(sys)
    }

    /// Stop both captures, transcribe each, merge, and build the Meeting.
    /// `partial` is true when system capture was unavailable or empty.
    pub fn stop(self, transcriber: &Transcriber, language: &str, prompt: &str) -> Meeting {
        let me_samples = self.mic.stop(); // already 16 kHz mono
        let (them_samples, had_system) = match self.system {
            Some(cap) => {
                let (raw, rate, channels) = cap.stop();
                let mono = audio::to_mono(&raw, channels);
                (audio::resample_to_16k(&mono, rate), !raw.is_empty())
            }
            None => (Vec::new(), false),
        };

        let me_segs = transcriber
            .transcribe_segments(&me_samples, language, prompt)
            .unwrap_or_default();
        let them_segs = if them_samples.len() >= 1600 {
            transcriber
                .transcribe_segments(&them_samples, language, prompt)
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let segments = meetings::merge_segments(&me_segs, &them_segs);
        let duration_ms = samples_to_ms(me_samples.len().max(them_samples.len()));
        let id = self.started_ms.to_string();

        Meeting {
            id: id.clone(),
            title: meetings::default_title(self.started_ms),
            started_ms: self.started_ms,
            duration_ms,
            language: language.to_string(),
            partial: !had_system,
            segments,
        }
    }

    /// Drop both captures without transcribing.
    pub fn cancel(self) {
        drop(self.mic);
        if let Some(cap) = self.system {
            let _ = cap.stop();
        }
    }
}
```

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test meeting::tests 2>&1 | tail -10`
Expected: PASS.

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/meeting.rs src-tauri/src/lib.rs
git commit -m "feat(meeting): MeetingRecorder orchestrates mic + system capture"
```

---

## Task 8: Backend commands + state wiring (`commands.rs`, `lib.rs`)

Expõe os comandos Tauri e o estado da reunião. Orquestração verificada via UI.

**Files:**
- Modify: `src-tauri/src/commands.rs` (campo em `AppState` + comandos)
- Modify: `src-tauri/src/lib.rs` (funções `start/stop/cancel_meeting`, registro no `invoke_handler`)

**Interfaces:**
- Consumes: `meeting::MeetingRecorder`, `meetings::{list, get, delete, rename, Meeting, MeetingSummary}`, `sysaudio::{macos_version, pick_backend, Backend}`.
- Produces (comandos): `start_meeting`, `stop_meeting`, `cancel_meeting`, `meeting_level`, `get_meeting_state`, `list_meetings`, `get_meeting`, `delete_meeting`, `rename_meeting`, `meeting_supported`, `check_system_audio_permission`, `request_system_audio_permission`, `open_system_audio_settings`.

- [ ] **Step 1: Add the recorder slot to `AppState`**

Em `src-tauri/src/commands.rs`, dentro de `pub struct AppState`, adicione (após `recorder`):

```rust
    /// Active meeting recording, independent of the dictation state machine so
    /// hotkey dictation keeps working alongside it.
    pub meeting: Mutex<Option<crate::meeting::MeetingRecorder>>,
```

Em `src-tauri/src/lib.rs`, no `app.manage(AppState { ... })`, adicione o campo:

```rust
                meeting: Mutex::new(None),
```

- [ ] **Step 2: Add the meeting lifecycle helpers in `lib.rs`**

Em `src-tauri/src/lib.rs`, adicione (perto de `cancel_recording`):

```rust
/// Start a meeting recording and show the bubble. Returns an error string the
/// frontend surfaces (no model, no permission, unsupported OS, device busy).
pub(crate) fn start_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    if st.transcriber.lock().unwrap().is_none() {
        return Err("no_model".to_string());
    }
    if st.meeting.lock().unwrap().is_some() {
        return Err("already_recording".to_string());
    }
    let mic_device = st.config.lock().unwrap().mic_device.clone();
    let started_ms = now_ms();
    let rec = crate::meeting::MeetingRecorder::start(mic_device.as_deref(), started_ms)?;
    *st.meeting.lock().unwrap() = Some(rec);

    place_and_show_meeting_bubble(app);
    let _ = app.emit("meeting_state", serde_json::json!({ "state": "recording" }));

    // Live level ticker for the bubble meter.
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let st = app2.state::<AppState>();
        let guard = st.meeting.lock().unwrap();
        match guard.as_ref() {
            Some(rec) => {
                let _ = app2.emit("meeting_level", serde_json::json!({ "level": rec.level() }));
            }
            None => break,
        }
    });
    Ok(())
}

/// Stop the meeting, transcribe + save off the UI thread, hide the bubble, and
/// emit `meeting_saved` with the new id when done.
pub(crate) fn stop_meeting(app: &tauri::AppHandle) {
    let rec = match app.state::<AppState>().meeting.lock().unwrap().take() {
        Some(r) => r,
        None => return,
    };
    if let Some(w) = app.get_webview_window("meeting-bubble") {
        let _ = w.hide();
    }
    let _ = app.emit("meeting_state", serde_json::json!({ "state": "transcribing" }));

    let app = app.clone();
    std::thread::spawn(move || {
        let (language, prompt, data_dir) = {
            let st = app.state::<AppState>();
            let c = st.config.lock().unwrap();
            (
                c.language.clone(),
                text::dictionary_prompt(&c.dictionary),
                st.data_dir.clone(),
            )
        };
        let meeting = {
            let st = app.state::<AppState>();
            let guard = st.transcriber.lock().unwrap();
            match guard.as_ref() {
                Some(t) => rec.stop(t, &language, &prompt),
                None => {
                    let _ = app.emit("error", serde_json::json!({ "message": "no_model" }));
                    let _ = app.emit("meeting_state", serde_json::json!({ "state": "idle" }));
                    return;
                }
            }
        };
        if let Err(e) = meetings::save(&data_dir, &meeting) {
            eprintln!("meeting save failed: {e}");
        }
        let _ = app.emit("meeting_state", serde_json::json!({ "state": "idle" }));
        let _ = app.emit("meeting_saved", serde_json::json!({ "id": meeting.id }));
    });
}

/// Discard the in-progress meeting without transcribing.
pub(crate) fn cancel_meeting(app: &tauri::AppHandle) {
    if let Some(rec) = app.state::<AppState>().meeting.lock().unwrap().take() {
        rec.cancel();
    }
    if let Some(w) = app.get_webview_window("meeting-bubble") {
        let _ = w.hide();
    }
    let _ = app.emit("meeting_state", serde_json::json!({ "state": "idle" }));
}

/// Epoch milliseconds now.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Place the meeting bubble at the top-center of the current monitor and show it.
fn place_and_show_meeting_bubble(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("meeting-bubble") {
        let monitor = win
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| win.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            let pos = mon.position();
            let size = mon.size();
            let w = win.outer_size().unwrap_or(tauri::PhysicalSize::new(280, 64));
            let (x, y) = overlay::top_center(
                (pos.x, pos.y),
                (size.width, size.height),
                (w.width, w.height),
                24,
            );
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
        let _ = win.show();
    }
}
```

> `text::dictionary_prompt` e `meetings::save` já existem (Tasks 1) e `text` já é módulo. `overlay::top_center` é da Task 3.

- [ ] **Step 3: Add the Tauri commands in `commands.rs`**

Adicione ao fim de `src-tauri/src/commands.rs`:

```rust
/// Start a meeting recording from the UI. Errors as a code string ("no_model",
/// "already_recording", or a capture error) the frontend maps to a message.
#[tauri::command]
pub fn start_meeting(app: AppHandle) -> Result<(), String> {
    crate::start_meeting(&app)
}

#[tauri::command]
pub fn stop_meeting(app: AppHandle) {
    crate::stop_meeting(&app);
}

#[tauri::command]
pub fn cancel_meeting(app: AppHandle) {
    crate::cancel_meeting(&app);
}

#[tauri::command]
pub fn meeting_level(state: tauri::State<AppState>) -> f32 {
    state
        .meeting
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.level())
        .unwrap_or(0.0)
}

#[tauri::command]
pub fn get_meeting_state(state: tauri::State<AppState>) -> String {
    let recording = state.meeting.lock().unwrap().is_some();
    if recording { "recording" } else { "idle" }.to_string()
}

#[tauri::command]
pub fn list_meetings(state: tauri::State<AppState>) -> Vec<crate::meetings::MeetingSummary> {
    crate::meetings::list(&state.data_dir)
}

#[tauri::command]
pub fn get_meeting(state: tauri::State<AppState>, id: String) -> Option<crate::meetings::Meeting> {
    crate::meetings::get(&state.data_dir, &id)
}

#[tauri::command]
pub fn delete_meeting(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    crate::meetings::delete(&state.data_dir, &id).map_err(|e| format!("delete meeting: {e}"))
}

#[tauri::command]
pub fn rename_meeting(
    state: tauri::State<AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    crate::meetings::rename(&state.data_dir, &id, &title).map_err(|e| format!("rename meeting: {e}"))
}

/// Whether this OS can capture system audio at all (macOS 13+).
#[tauri::command]
pub fn meeting_supported() -> bool {
    match crate::sysaudio::macos_version() {
        Some(v) => crate::sysaudio::pick_backend(v) != crate::sysaudio::Backend::Unsupported,
        None => false,
    }
}

/// Has the user granted the screen/audio capture permission? Best-effort probe:
/// we attempt a capture start and immediately stop it; success = granted.
#[tauri::command]
pub fn check_system_audio_permission() -> bool {
    match crate::sysaudio::start_system_capture() {
        Ok(cap) => {
            let _ = cap.stop();
            true
        }
        Err(_) => false,
    }
}

/// Trigger the OS permission prompt by attempting a capture (which makes
/// CoreAudio/ScreenCaptureKit hit the TCC gate), then stop it.
#[tauri::command]
pub fn request_system_audio_permission() {
    if let Ok(cap) = crate::sysaudio::start_system_capture() {
        let _ = cap.stop();
    }
}

/// Open the macOS privacy pane for screen recording (covers both SCK and the
/// audio-capture entitlement surfaces).
#[tauri::command]
pub fn open_system_audio_settings() {
    #[cfg(target_os = "macos")]
    {
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
}
```

- [ ] **Step 4: Register the commands**

Em `src-tauri/src/lib.rs`, dentro de `tauri::generate_handler![ ... ]` (antes de `set_ui_language,`), adicione:

```rust
            commands::start_meeting,
            commands::stop_meeting,
            commands::cancel_meeting,
            commands::meeting_level,
            commands::get_meeting_state,
            commands::list_meetings,
            commands::get_meeting,
            commands::delete_meeting,
            commands::rename_meeting,
            commands::meeting_supported,
            commands::check_system_audio_permission,
            commands::request_system_audio_permission,
            commands::open_system_audio_settings,
```

- [ ] **Step 5: Build + run existing tests**

Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: compila.

Run: `cd src-tauri && cargo test 2>&1 | tail -15`
Expected: todos os testes existentes + novos passam.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(meeting): tauri commands and meeting state wiring"
```

---

## Task 9: Meeting bubble window (`tauri.conf.json`, `App.tsx`, `MeetingBubble.tsx`)

Janela flutuante de gravação. Verificação manual (UI nativa).

**Files:**
- Modify: `src-tauri/tauri.conf.json` (janela `meeting-bubble`)
- Create: `src/routes/MeetingBubble.tsx`
- Modify: `src/App.tsx` (rota por label)

**Interfaces:**
- Consumes (eventos backend): `meeting_level` `{level:number}`, `meeting_state` `{state:string}`. Comandos: `stop_meeting`, `cancel_meeting`.

- [ ] **Step 1: Declare the bubble window**

Em `src-tauri/tauri.conf.json`, no array `app.windows`, adicione após o objeto `overlay`:

```json
      ,{
        "label": "meeting-bubble",
        "url": "index.html",
        "width": 280,
        "height": 64,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "shadow": false,
        "visible": false,
        "focus": false
      }
```

- [ ] **Step 2: Route the bubble window**

Em `src/App.tsx`, troque a linha de render condicional por:

```tsx
  return (
    <I18nProvider>
      {label === "overlay" ? (
        <Overlay />
      ) : label === "meeting-bubble" ? (
        <MeetingBubble />
      ) : (
        <Dashboard />
      )}
    </I18nProvider>
  );
```

E adicione o import no topo:

```tsx
import MeetingBubble from "./routes/MeetingBubble";
```

- [ ] **Step 3: Build the bubble component**

Crie `src/routes/MeetingBubble.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onEvent } from "../lib/api";
import { useI18n } from "../lib/i18n";

/// The floating recording indicator shown while a meeting is being captured.
/// A red dot, a running timer, a live level bar, and a Stop button. Lives in its
/// own always-on-top window (label "meeting-bubble").
export default function MeetingBubble() {
  const { t } = useI18n();
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const un = onEvent<{ level: number }>("meeting_level", (p) => setLevel(p.level));
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      un.then((f) => f());
      clearInterval(tick);
    };
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const barWidth = Math.min(100, Math.round(level * 600));

  return (
    <div className="flex h-screen w-screen items-center gap-3 rounded-full bg-stone-900/95 px-4 text-stone-100 shadow-lg">
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
      <span className="font-mono text-sm tabular-nums">{`${mm}:${ss}`}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-700">
        <div className="h-full bg-emerald-400 transition-[width] duration-100" style={{ width: `${barWidth}%` }} />
      </div>
      <button
        type="button"
        onClick={() => invoke("stop_meeting")}
        className="shrink-0 rounded-full bg-red-500 px-3 py-1 text-xs font-medium hover:bg-red-400"
      >
        {t("meetings.stop")}
      </button>
    </div>
  );
}
```

> As strings i18n (`meetings.stop`) entram na Task 13. Até lá `t()` devolve a chave — o build não quebra.

- [ ] **Step 4: Verify the frontend builds**

Run: `pnpm build 2>&1 | tail -15`
Expected: build de produção (tsc + vite) sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json src/App.tsx src/routes/MeetingBubble.tsx
git commit -m "feat(meeting): floating recording bubble window"
```

---

## Task 10: Frontend API wrappers (`api.ts`)

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: tipos `MeetingSummary`, `Meeting`, `MeetingSegment` + funções `startMeeting`, `stopMeeting`, `cancelMeeting`, `getMeetingState`, `listMeetings`, `getMeeting`, `deleteMeeting`, `renameMeeting`, `meetingSupported`, `checkSystemAudioPermission`, `requestSystemAudioPermission`, `openSystemAudioSettings`.

- [ ] **Step 1: Add types and wrappers**

Adicione ao fim de `src/lib/api.ts` (antes do `onEvent` final, ou após — qualquer posição no top-level):

```typescript
export interface MeetingSegment {
  speaker: "me" | "them";
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Meeting {
  id: string;
  title: string;
  started_ms: number;
  duration_ms: number;
  language: string;
  partial: boolean;
  segments: MeetingSegment[];
}

export interface MeetingSummary {
  id: string;
  title: string;
  started_ms: number;
  duration_ms: number;
  language: string;
  partial: boolean;
}

export const startMeeting = () => invoke<void>("start_meeting");
export const stopMeeting = () => invoke<void>("stop_meeting");
export const cancelMeeting = () => invoke<void>("cancel_meeting");
export const getMeetingState = () => invoke<string>("get_meeting_state");
export const listMeetings = () => invoke<MeetingSummary[]>("list_meetings");
export const getMeeting = (id: string) => invoke<Meeting | null>("get_meeting", { id });
export const deleteMeeting = (id: string) => invoke<void>("delete_meeting", { id });
export const renameMeeting = (id: string, title: string) =>
  invoke<void>("rename_meeting", { id, title });
export const meetingSupported = () => invoke<boolean>("meeting_supported");
export const checkSystemAudioPermission = () =>
  invoke<boolean>("check_system_audio_permission");
export const requestSystemAudioPermission = () =>
  invoke<void>("request_system_audio_permission");
export const openSystemAudioSettings = () => invoke<void>("open_system_audio_settings");

export type MeetingStatePayload = { state: string };
export type MeetingSavedPayload = { id: string };
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm build 2>&1 | tail -10`
Expected: sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): meeting command wrappers and types"
```

---

## Task 11: Sidebar "Meetings" entry (`Sidebar.tsx`)

Tem teste (`Sidebar.test.tsx`) — TDD de verdade.

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: tipo `View` (estende para incluir `"meetings"`).
- Produces: `View = "home" | "insights" | "meetings" | "dictionary" | "snippets" | "settings"`.

- [ ] **Step 1: Read the existing test to match its style**

Run: `sed -n '1,60p' src/components/Sidebar.test.tsx`
Use o mesmo helper de render/i18n dos testes existentes ao escrever o novo caso.

- [ ] **Step 2: Write the failing test**

Adicione um caso a `src/components/Sidebar.test.tsx` (ajuste o `import`/render ao padrão do arquivo):

```tsx
  it("renders the Meetings nav item and navigates to it", async () => {
    const onNavigate = vi.fn();
    render(<Sidebar view="home" onNavigate={onNavigate} />);
    const btn = await screen.findByText("Meetings");
    fireEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith("meetings");
  });
```

> Se o i18n de teste devolver a chave em vez de "Meetings", busque pela chave `nav.meetings`. Combine com como os outros casos buscam os labels.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/components/Sidebar.test.tsx 2>&1 | tail -20`
Expected: FAIL — não acha "Meetings".

- [ ] **Step 4: Implement the nav entry**

Em `src/components/Sidebar.tsx`:

(a) Estenda o tipo `View`:

```tsx
export type View = "home" | "insights" | "meetings" | "dictionary" | "snippets" | "settings";
```

(b) Adicione um ícone ao mapa `icons` (ex.: um balão de fala):

```tsx
  meetings: (
    <>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </>
  ),
```

(c) Adicione o `NavButton` na `<nav>` primária, após o de `insights`:

```tsx
        <NavButton
          icon="meetings"
          label={t("nav.meetings")}
          active={view === "meetings"}
          onClick={() => onNavigate("meetings")}
        />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/Sidebar.test.tsx 2>&1 | tail -20`
Expected: PASS. (Se buscar por `nav.meetings`, a string final entra na Task 13.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): Meetings navigation entry"
```

---

## Task 12: Meetings list page (`Meetings.tsx`, `Dashboard.tsx`)

Lista as reuniões salvas e inicia novas. Verificação por build + manual.

**Files:**
- Create: `src/routes/Meetings.tsx`
- Modify: `src/routes/Dashboard.tsx` (renderiza a view `meetings`)

**Interfaces:**
- Consumes: `listMeetings`, `startMeeting`, `meetingSupported`, `checkSystemAudioPermission`, `requestSystemAudioPermission`, `openSystemAudioSettings`, `onEvent("meeting_saved")`, `onEvent("meeting_state")`, tipo `MeetingSummary`.
- Produces: `<Meetings onOpen={(id: string) => void} />` (Dashboard passa um handler que abre o detalhe).

- [ ] **Step 1: Build the list page**

Crie `src/routes/Meetings.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  listMeetings,
  startMeeting,
  stopMeeting,
  meetingSupported,
  checkSystemAudioPermission,
  requestSystemAudioPermission,
  openSystemAudioSettings,
  getMeetingState,
  onEvent,
  type MeetingSummary,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Meetings({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<MeetingSummary[]>([]);
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listMeetings().then(setItems);

  useEffect(() => {
    meetingSupported().then(setSupported);
    getMeetingState().then((s) => setRecording(s === "recording"));
    refresh();
    const saved = onEvent<{ id: string }>("meeting_saved", () => refresh());
    const state = onEvent<{ state: string }>("meeting_state", (p) =>
      setRecording(p.state === "recording"),
    );
    return () => {
      saved.then((f) => f());
      state.then((f) => f());
    };
  }, []);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await checkSystemAudioPermission();
      if (!ok) {
        await requestSystemAudioPermission();
        openSystemAudioSettings();
        setError(t("meetings.permissionNeeded"));
        return;
      }
      await startMeeting();
    } catch (e) {
      const msg = String(e);
      setError(msg === "no_model" ? t("meetings.noModel") : msg);
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (ms: number) => new Date(ms).toLocaleString();
  const fmtDur = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("meetings.title")}</h1>
        {recording ? (
          <button
            type="button"
            onClick={() => stopMeeting()}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400"
          >
            {t("meetings.stop")}
          </button>
        ) : (
          <button
            type="button"
            disabled={!supported || busy}
            onClick={start}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
          >
            {t("meetings.start")}
          </button>
        )}
      </div>

      {!supported && (
        <p className="mb-4 rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900">
          {t("meetings.unsupported")}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900">{error}</p>
      )}
      <p className="mb-6 text-sm text-stone-500">{t("meetings.consentNote")}</p>

      {items.length === 0 ? (
        <p className="text-sm text-stone-500">{t("meetings.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onOpen(m.id)}
                className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-4 py-3 text-left hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="block text-xs text-stone-500">{fmtDate(m.started_ms)}</span>
                </span>
                <span className="ml-3 shrink-0 text-xs text-stone-500">
                  {fmtDur(m.duration_ms)}
                  {m.partial ? ` · ${t("meetings.partial")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Dashboard**

Em `src/routes/Dashboard.tsx`:

(a) importe e adicione estado para o detalhe:

```tsx
import Meetings from "./Meetings";
import MeetingDetail from "./MeetingDetail";
```

(b) adicione o estado do id aberto (perto do `useState<View>`):

```tsx
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);
```

(c) na área de render das views, adicione:

```tsx
          {view === "meetings" &&
            (openMeeting ? (
              <MeetingDetail id={openMeeting} onBack={() => setOpenMeeting(null)} />
            ) : (
              <Meetings
                onOpen={(id) => setOpenMeeting(id)}
              />
            ))}
```

(d) ao navegar para fora de meetings, limpe o detalhe — troque o `Sidebar` por:

```tsx
      <Sidebar
        view={view}
        onNavigate={(v) => {
          if (v !== "meetings") setOpenMeeting(null);
          setView(v);
        }}
      />
```

> `MeetingDetail` é criado na Task 13; o import já entra aqui para evitar reedição, mas se você executa em ordem estrita e quer compilar agora, crie um stub mínimo `export default function MeetingDetail(){return null}` e complete na Task 13.

- [ ] **Step 3: Verify it builds**

Run: `pnpm build 2>&1 | tail -15`
Expected: compila (com o stub de `MeetingDetail` se necessário).

- [ ] **Step 4: Commit**

```bash
git add src/routes/Meetings.tsx src/routes/Dashboard.tsx
git commit -m "feat(meetings): meetings list page wired into dashboard"
```

---

## Task 13: Meeting detail page + i18n strings

Detalhe da reunião: transcrição Eu/Eles, renomear, copiar, exportar, deletar. Mais todas as strings i18n.

**Files:**
- Create: `src/routes/MeetingDetail.tsx`
- Modify: `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: `getMeeting`, `renameMeeting`, `deleteMeeting`, tipo `Meeting`.
- Produces: `<MeetingDetail id={string} onBack={() => void} />`.

- [ ] **Step 1: Add i18n strings (PT + EN)**

Em `src/lib/i18n.tsx`, localize os mapas de tradução (procure a chave existente `nav.home`) e adicione, em **ambos** os idiomas, as chaves abaixo. Valores EN / PT:

```
nav.meetings                 "Meetings"                         / "Reuniões"
meetings.title               "Meetings"                         / "Reuniões"
meetings.start               "Start meeting"                    / "Iniciar reunião"
meetings.stop                "Stop"                             / "Parar"
meetings.empty               "No meetings yet."                 / "Nenhuma reunião ainda."
meetings.consentNote         "Let participants know you're recording. Audio stays on this Mac." / "Avise os participantes que está gravando. O áudio fica neste Mac."
meetings.unsupported         "Meeting capture needs macOS 13 or later." / "A captura de reuniões precisa do macOS 13 ou superior."
meetings.permissionNeeded    "Grant screen & audio recording permission, then try again." / "Conceda a permissão de gravação de tela e áudio e tente de novo."
meetings.noModel             "Download a transcription model in Settings first." / "Baixe um modelo de transcrição em Configurações primeiro."
meetings.partial             "partial"                          / "parcial"
meetings.you                 "You"                              / "Você"
meetings.them                "Participants"                     / "Participantes"
meetings.copy                "Copy"                             / "Copiar"
meetings.export              "Export"                           / "Exportar"
meetings.delete              "Delete"                           / "Excluir"
meetings.back                "Back"                             / "Voltar"
meetings.rename              "Rename"                           / "Renomear"
meetings.partialNote         "System audio wasn't captured for this meeting." / "O áudio do sistema não foi capturado nesta reunião."
```

> Mantenha o formato exato das entradas vizinhas no arquivo (mesma indentação/aspas). Adicione a mesma chave nos dois dicionários.

- [ ] **Step 2: Build the detail page**

Crie `src/routes/MeetingDetail.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getMeeting, renameMeeting, deleteMeeting, type Meeting } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function MeetingDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    getMeeting(id).then((m) => {
      setMeeting(m);
      setTitle(m?.title ?? "");
    });
  }, [id]);

  if (!meeting) return <p className="text-sm text-stone-500">…</p>;

  const speakerLabel = (s: "me" | "them") =>
    s === "me" ? t("meetings.you") : t("meetings.them");

  const asText = () =>
    meeting.segments.map((s) => `${speakerLabel(s.speaker)}: ${s.text}`).join("\n");

  const copy = () => navigator.clipboard.writeText(asText());

  const exportMd = () => {
    const md = `# ${meeting.title}\n\n` + asText();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meeting.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveTitle = () => {
    if (title.trim() && title !== meeting.title) {
      renameMeeting(id, title.trim());
      setMeeting({ ...meeting, title: title.trim() });
    }
  };

  const remove = async () => {
    await deleteMeeting(id);
    onBack();
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-sm text-stone-500 hover:text-stone-900">
          ← {t("meetings.back")}
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        className="mb-1 w-full bg-transparent text-2xl font-semibold outline-none"
      />
      <p className="mb-4 text-xs text-stone-500">{new Date(meeting.started_ms).toLocaleString()}</p>
      {meeting.partial && (
        <p className="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-900">
          {t("meetings.partialNote")}
        </p>
      )}

      <div className="mb-4 flex gap-2">
        <button type="button" onClick={copy} className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800">
          {t("meetings.copy")}
        </button>
        <button type="button" onClick={exportMd} className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800">
          {t("meetings.export")}
        </button>
        <button type="button" onClick={remove} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
          {t("meetings.delete")}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {meeting.segments.map((s, i) => (
          <div key={i} className="flex gap-3">
            <span
              className={
                "shrink-0 text-xs font-medium " +
                (s.speaker === "me" ? "text-emerald-600" : "text-sky-600")
              }
            >
              {speakerLabel(s.speaker)}
            </span>
            <p className="min-w-0 text-sm">{s.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm build 2>&1 | tail -15`
Expected: compila sem erro de tipo. Se você criou um stub de `MeetingDetail` na Task 12, este passo o substitui.

- [ ] **Step 4: Run the full frontend test suite**

Run: `pnpm test 2>&1 | tail -20`
Expected: todos passam (incluindo `Sidebar.test.tsx` agora que `nav.meetings` existe).

- [ ] **Step 5: Commit**

```bash
git add src/routes/MeetingDetail.tsx src/lib/i18n.tsx
git commit -m "feat(meetings): meeting detail page and i18n strings"
```

---

## Task 14: End-to-end manual verification + docs

Tudo compila e os testes puros passam. Esta task faz a verificação manual nativa (impossível em unit test) e documenta a feature.

**Files:**
- Modify: `README.md` (seção da feature)

- [ ] **Step 1: Full build + all automated tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -20 && cargo clippy 2>&1 | tail -10`
Expected: testes verdes, clippy limpo.

Run: `pnpm test 2>&1 | tail -10 && pnpm build 2>&1 | tail -5`
Expected: testes verdes, build de produção ok.

- [ ] **Step 2: Build + reinstall the app (per project memory workflow)**

Siga o workflow de rebuild/reinstall da memória do projeto (build, instalar em `/Applications`, conceder permissões). Conceda Microfone **e** a nova permissão de Gravação de Tela / Áudio quando solicitado.

- [ ] **Step 3: Manual end-to-end checklist**

Numa reunião ou vídeo real com áudio:
- Abrir **Meetings** → clicar **Iniciar reunião** → primeira vez pede permissão; conceder.
- Bubble aparece no topo-centro: ponto vermelho pulsando, cronômetro correndo, barra de nível reagindo ao áudio.
- Falar (lado "Você") enquanto outra voz toca pelos alto-falantes (lado "Participantes").
- Clicar **Parar** → bubble some → após a transcrição, o detalhe abre com segmentos rotulados **Você**/**Participantes** em ordem temporal.
- Verificar **Copiar**, **Exportar** (.md baixa), **Renomear** (persiste após reabrir), **Excluir** (some da lista).
- Confirmar que o ditado por hotkey ainda funciona normalmente (sem regressão).
- Em macOS 14.4+, confirmar que o backend CATap capturou "Participantes"; se silencioso, registrar e validar o fallback SCK.

- [ ] **Step 4: Document the feature**

Adicione ao `README.md` uma subseção curta "Meeting transcription" descrevendo: o que faz, requisito macOS 13+, permissão de gravação de tela/áudio, e que tudo fica local. Siga o tom/idioma das seções vizinhas.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document meeting transcription feature"
```

---

## Self-Review

**1. Spec coverage:**
- Captura mic+sistema → Tasks 5, 6, 7. ✓
- Dois backends por versão → Task 4 (seleção) + 5/6 (impls). ✓
- Eu vs Eles por fonte → `merge_segments` Task 1, rótulos UI Task 13. ✓
- Store separado `meetings/<id>.json` → Task 1. ✓
- Lote ao parar → Task 7 `stop()`. ✓
- Seção Meetings na sidebar → Task 11. ✓
- Lista + detalhe → Tasks 12, 13. ✓
- Bubble indicador → Tasks 3 (geometria), 8 (place/show), 9 (UI). ✓
- Permissões/Info.plist/entitlements → Tasks 5 (plist) + 8 (comandos). ✓
- Consentimento → nota na UI Task 12 + i18n Task 13. ✓
- Bordas (sem modelo, permissão negada, < macOS 13, captura parcial) → Tasks 8 (`start_meeting` checa modelo; `meeting_supported`), 7 (`partial`), 12 (UI de erro). ✓
- Não quebrar ditado → estado `meeting` independente (Task 8), `transcribe()` intacto. ✓

**2. Placeholder scan:** Os corpos `unsafe` nativos das Tasks 5/6 são deliberadamente ancorados em referências concretas (AudioCap, sample da Apple, docs da crate) com sequência de chamadas explícita e gate de verificação manual — não há "TODO genérico". Demais tasks têm código completo. ✓

**3. Type consistency:**
- `SttSegment { start_ms, end_ms, text }` — Task 2 define, Tasks 1/7 consomem. ✓
- `Segment { speaker, start_ms, end_ms, text }` / `Meeting` / `MeetingSummary` — Task 1 define, Tasks 7/8/10 consomem com os mesmos campos. ✓
- `SystemAudioCapturer::stop(self: Box<Self>) -> (Vec<f32>, u32, u16)` — Task 4 define, Tasks 5/6 implementam, Task 7 consome (`raw, rate, channels`). ✓
- `merge_segments(&[SttSegment], &[SttSegment]) -> Vec<Segment>` — Task 1, consumido na Task 7. ✓
- Comandos: nomes em snake_case batem entre `commands.rs` (Task 8), registro em `lib.rs` (Task 8) e wrappers `api.ts` (Task 10). ✓
- `View` com `"meetings"` — Task 11, usado na Task 12. ✓
