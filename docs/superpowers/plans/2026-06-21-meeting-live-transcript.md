# Live Meeting Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o transcript Você/Participantes rolando em tempo real durante a reunião, sem alterar o transcript salvo (que continua vindo do re-passe em lote no `stop()`).

**Architecture:** Um `LiveTranscriber` roda numa thread durante a reunião: a cada ~1s lê incrementalmente (não-destrutivo) os áudios de mic e sistema, roda `webrtc-vad` para achar segmentos de fala fechados, transcreve cada um com o Whisper já carregado e emite `meeting_live_segment`. A leitura incremental usa um cursor sobre os buffers existentes (mic, SCK) e um ring buffer lock-free para o CATap (callback real-time alloc-free), sempre preservando o take completo que o `stop()` em lote re-transcreve como canônico.

**Tech Stack:** Rust + Tauri 2, `whisper-rs` 0.16, `cpal`, Core Audio / ScreenCaptureKit, novas crates `webrtc-vad` e `ringbuf`, React + TypeScript.

## Global Constraints

- **Live é display efêmero:** os segmentos ao vivo são SÓ eventos pra UI; nada novo é persistido. O `Meeting` salvo continua vindo de `MeetingRecorder::stop` (re-passe em lote), inalterado.
- **Leitura incremental é não-destrutiva:** `read_new()` nunca pode remover dados que o `stop()` precisa — o take completo sempre sobrevive para o re-passe canônico.
- **Callback de áudio real-time alloc/lock-free:** o IO proc do CATap não pode fazer `Mutex` lock nem realloc de `Vec` — empurra num ring buffer lock-free; o consumidor (fora da thread RT) drena pra um acumulador.
- **Rótulos por fonte:** mic = `"me"`, sistema = `"them"`. Strings exatas.
- **macOS apenas** para a captura nativa; gate com `#[cfg(target_os = "macos")]`; nunca quebrar o build de outras plataformas nem o caminho de ditado.
- **Sem flicker:** só segmentos de fala FECHADOS (fim de fala detectado pelo VAD) são emitidos; segmento aberto não vai pra tela.
- **VAD:** `webrtc-vad` em frames de 16 kHz; sem ONNX.
- **CI gates formatação:** rodar `cargo fmt` e `pnpm format` (prettier) antes de cada commit, além de `cargo clippy`/testes.
- **Não alterar o caminho de ditado** nem a assinatura/semântica de `stop()` da v1.

---

## File Structure

**Rust (novos):**

- `src-tauri/src/meeting/live.rs` — `LiveTranscriber` (loop) + helpers puros `segment_closed_speech`, `to_i16`.

**Rust (modificados):**

- `src-tauri/src/audio.rs` — helper puro `read_new_from` + `Recorder::read_new` (cursor).
- `src-tauri/src/sysaudio/mod.rs` — trait `SystemAudioCapturer` ganha `read_new` + `format`.
- `src-tauri/src/sysaudio/screencapturekit.rs` — impl de `read_new`/`format` via cursor.
- `src-tauri/src/sysaudio/catap.rs` — refactor do callback RT para ring buffer lock-free + `read_new`/`format`.
- `src-tauri/src/meeting.rs` — `MeetingRecorder` segura o `LiveTranscriber`; `start`/`stop`/`cancel` gerenciam seu ciclo de vida. Atualmente `mod meeting;` é um arquivo único → vira `mod meeting;` com submódulo `live` (`meeting/mod.rs` + `meeting/live.rs`).
- `src-tauri/src/commands.rs` / `src-tauri/src/lib.rs` — passar o `AppHandle` ao recorder pra emitir eventos.
- `src-tauri/Cargo.toml` — `webrtc-vad`, `ringbuf`.

**Frontend (novos):**

- `src/routes/LiveMeeting.tsx` — transcript ao vivo rolando.

**Frontend (modificados):**

- `src/lib/api.ts` — tipo `MeetingLiveSegmentPayload`.
- `src/routes/Dashboard.tsx` — abre `LiveMeeting` enquanto grava; troca pro `MeetingDetail` ao salvar.
- `src/lib/i18n.tsx` — strings da tela ao vivo (PT/EN).

---

## Task 1: VAD segmentation helper (`meeting/live.rs`)

Função pura que transforma um stream de flags do VAD em segmentos de fala fechados. Núcleo testável da feature.

**Files:**

- Create: `src-tauri/src/meeting/mod.rs` (move o conteúdo atual de `meeting.rs` pra cá — ver Step 1), `src-tauri/src/meeting/live.rs`
- Delete: `src-tauri/src/meeting.rs` (vira `meeting/mod.rs`)

**Interfaces:**

- Produces:
  - `fn segment_closed_speech(flags: &[bool], frame_ms: u64, min_silence_frames: usize) -> Vec<(u64, u64)>` — pares (start_ms, end_ms) relativos ao início do slice, só de segmentos cujo fim de fala foi confirmado por `min_silence_frames` frames de silêncio. Segmento ainda aberto no fim do slice NÃO é retornado.

- [ ] **Step 1: Convert `meeting.rs` into a module dir**

`meeting.rs` precisa de um submódulo (`live`). Converta o arquivo único num diretório:

```bash
cd /Users/hudsonbrendon/Github/openwispr/src-tauri/src
mkdir -p meeting
git mv meeting.rs meeting/mod.rs
```

No topo de `meeting/mod.rs`, declare o submódulo (após o doc-comment do módulo, antes dos `use`):

```rust
mod live;
```

Confirme que ainda compila: `cd /Users/hudsonbrendon/Github/openwispr/src-tauri && cargo build 2>&1 | tail -3` (deve compilar; `live` ainda não existe → crie o arquivo vazio no Step 2).

- [ ] **Step 2: Write the failing test**

Crie `src-tauri/src/meeting/live.rs` com só os testes + o `use`:

```rust
//! Live (during-meeting) transcription loop. Reads the mic and system audio
//! incrementally, runs VAD to find closed speech segments, transcribes each with
//! the loaded Whisper model, and emits `meeting_live_segment` events. Ephemeral:
//! nothing here is persisted — the saved transcript still comes from the batch
//! re-pass in `MeetingRecorder::stop`.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_segments_for_all_silence() {
        let flags = vec![false; 10];
        assert!(segment_closed_speech(&flags, 30, 2).is_empty());
    }

    #[test]
    fn single_closed_segment() {
        // frames: F S S S S F F  (S=speech). 30ms frames, need 2 silence frames
        // to close. Speech is frames 1..=4 → 30ms..150ms.
        let flags = vec![false, true, true, true, true, false, false];
        assert_eq!(segment_closed_speech(&flags, 30, 2), vec![(30, 150)]);
    }

    #[test]
    fn trailing_open_segment_is_not_emitted() {
        // Speech runs to the end with no closing silence → not closed → excluded.
        let flags = vec![false, true, true, true];
        assert!(segment_closed_speech(&flags, 30, 2).is_empty());
    }

    #[test]
    fn short_gap_below_min_silence_does_not_split() {
        // One false between speech, min_silence_frames=2 → stays one segment.
        // S S F S S then 2 silence to close. Speech 0..=4 → 0..150ms.
        let flags = vec![true, true, false, true, true, false, false];
        assert_eq!(segment_closed_speech(&flags, 30, 2), vec![(0, 150)]);
    }

    #[test]
    fn two_segments_split_by_long_silence() {
        // S S (3x F) S → first closes at 60ms, second open at end (excluded).
        let flags = vec![true, true, false, false, false, true];
        assert_eq!(segment_closed_speech(&flags, 30, 2), vec![(0, 60)]);
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd src-tauri && cargo test meeting::live 2>&1 | tail -15`
Expected: FAIL — `cannot find function 'segment_closed_speech'`.

- [ ] **Step 4: Implement the helper**

Adicione acima do `#[cfg(test)]` em `meeting/live.rs`:

```rust
/// Turn a per-frame VAD flag stream into closed speech segments. A segment opens
/// on the first speech frame and closes once `min_silence_frames` consecutive
/// non-speech frames are seen — short gaps below that threshold are bridged so a
/// brief pause doesn't split a sentence. A segment still open at the end of the
/// slice (speech ongoing, or trailing silence shorter than the threshold) is NOT
/// returned, so the caller never paints text that might still grow. Times are ms
/// relative to the start of `flags` (`frame_ms` per frame).
pub fn segment_closed_speech(
    flags: &[bool],
    frame_ms: u64,
    min_silence_frames: usize,
) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    let mut seg_start: Option<usize> = None; // frame index where current speech began
    let mut last_speech: usize = 0; // frame index of the last speech frame seen
    let mut silence_run: usize = 0;

    for (i, &is_speech) in flags.iter().enumerate() {
        if is_speech {
            if seg_start.is_none() {
                seg_start = Some(i);
            }
            last_speech = i;
            silence_run = 0;
        } else if seg_start.is_some() {
            silence_run += 1;
            if silence_run >= min_silence_frames {
                let start = seg_start.take().unwrap();
                // end = one frame past the last speech frame (exclusive bound).
                out.push((start as u64 * frame_ms, (last_speech as u64 + 1) * frame_ms));
                silence_run = 0;
            }
        }
    }
    out
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd src-tauri && cargo test meeting::live 2>&1 | tail -10`
Expected: PASS (5 testes).

- [ ] **Step 6: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add -A src-tauri/src/meeting
git commit -m "feat(meeting/live): VAD closed-speech segmentation helper"
```

---

## Task 2: Mic incremental read cursor (`audio.rs`)

Leitura não-destrutiva do buffer do mic, via cursor. O helper de cursor é puro e testado; `Recorder::read_new` o usa sobre o buffer real.

**Files:**

- Modify: `src-tauri/src/audio.rs`

**Interfaces:**

- Produces:
  - `fn read_new_from(buffer: &[f32], cursor: usize) -> (Vec<f32>, usize)` — `(novas amostras a partir de cursor, novo cursor = buffer.len())`. Puro.
  - `fn Recorder::read_new(&self) -> Vec<f32>` — amostras nativas desde a última chamada.

- [ ] **Step 1: Write the failing test (pure helper)**

Adicione ao `mod tests` em `src-tauri/src/audio.rs`:

```rust
    #[test]
    fn read_new_from_returns_tail_and_advances() {
        let buf = vec![0.1, 0.2, 0.3, 0.4];
        let (new, cur) = read_new_from(&buf, 2);
        assert_eq!(new, vec![0.3, 0.4]);
        assert_eq!(cur, 4);
        // Reading again from the advanced cursor yields nothing.
        let (new2, cur2) = read_new_from(&buf, cur);
        assert!(new2.is_empty());
        assert_eq!(cur2, 4);
    }

    #[test]
    fn read_new_from_handles_cursor_past_end() {
        // Defensive: a cursor beyond len (shouldn't happen) returns empty.
        let buf = vec![1.0, 2.0];
        let (new, cur) = read_new_from(&buf, 5);
        assert!(new.is_empty());
        assert_eq!(cur, 2);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test audio::tests::read_new 2>&1 | tail -10`
Expected: FAIL — `cannot find function 'read_new_from'`.

- [ ] **Step 3: Implement the helper + the Recorder method**

Em `src-tauri/src/audio.rs`, adicione o helper puro (perto de `rms_window`):

```rust
/// New samples in `buffer` past `cursor`, plus the advanced cursor (= len).
/// The read is non-destructive — the buffer is never truncated, so a later
/// full read (e.g. `Recorder::stop`) still sees the entire take.
pub fn read_new_from(buffer: &[f32], cursor: usize) -> (Vec<f32>, usize) {
    let start = cursor.min(buffer.len());
    (buffer[start..].to_vec(), buffer.len())
}
```

Adicione um campo de cursor ao `Recorder`. No topo do arquivo garanta o import:

```rust
use std::sync::atomic::{AtomicUsize, Ordering};
```

No `struct Recorder { ... }` adicione:

```rust
    /// Read cursor for `read_new` (live transcription). Independent of `stop`,
    /// which always consumes the whole buffer.
    read_pos: Arc<AtomicUsize>,
```

Em `Recorder::start`, ao construir o `Recorder { ... }`, inicialize:

```rust
            read_pos: Arc::new(AtomicUsize::new(0)),
```

E adicione o método dentro de `impl Recorder`:

```rust
    /// Native-rate samples captured since the last `read_new` call. Non-
    /// destructive: `stop` still returns the full take.
    pub fn read_new(&self) -> Vec<f32> {
        let cursor = self.read_pos.load(Ordering::Relaxed);
        let guard = self.buffer.lock();
        let buf = match guard {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        let (new, advanced) = read_new_from(&buf, cursor);
        self.read_pos.store(advanced, Ordering::Relaxed);
        new
    }
```

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test audio:: 2>&1 | tail -10`
Expected: PASS (incluindo os 2 novos).
Run: `cd src-tauri && cargo build 2>&1 | tail -3`
Expected: compila.

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/audio.rs
git commit -m "feat(audio): non-destructive read_new cursor on Recorder"
```

---

## Task 3: Capturer trait `read_new`/`format` + SCK impl

Adiciona leitura incremental ao trait de captura de sistema e implementa no backend ScreenCaptureKit (cursor sobre o buffer existente). O CATap ganha uma impl interina aqui (cursor sobre o buffer atual) para compilar; o ring buffer real vem na Task 4.

**Files:**

- Modify: `src-tauri/src/sysaudio/mod.rs` (trait)
- Modify: `src-tauri/src/sysaudio/screencapturekit.rs`
- Modify: `src-tauri/src/sysaudio/catap.rs` (impl interina)

**Interfaces:**

- Consumes: `audio::read_new_from` (Task 2).
- Produces (no trait `SystemAudioCapturer`):
  - `fn read_new(&self) -> Vec<f32>`
  - `fn format(&self) -> (u32, u16)`

- [ ] **Step 1: Add the trait methods**

Em `src-tauri/src/sysaudio/mod.rs`, no `pub trait SystemAudioCapturer`, adicione após `stop`:

```rust
    /// Native samples captured since the last `read_new` call (non-destructive;
    /// `stop` still returns the full take). For the live transcription loop.
    fn read_new(&self) -> Vec<f32>;
    /// (sample_rate, channels) of the native stream.
    fn format(&self) -> (u32, u16);
```

- [ ] **Step 2: Build to see both backends fail to satisfy the trait**

Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: FAIL — `not all trait items implemented ... read_new, format` em `catap.rs` e `screencapturekit.rs`.

- [ ] **Step 3: Implement in the SCK backend**

Em `src-tauri/src/sysaudio/screencapturekit.rs`, adicione um campo de cursor ao `SckCapturer` e os métodos. No topo garanta:

```rust
use std::sync::atomic::{AtomicUsize, Ordering};
```

No `struct SckCapturer { ... }` adicione:

```rust
    read_pos: AtomicUsize,
```

Na função `start()`, ao construir `SckCapturer { ... }`, inicialize `read_pos: AtomicUsize::new(0)`.

No `impl SystemAudioCapturer for SckCapturer`, adicione:

```rust
    fn read_new(&self) -> Vec<f32> {
        let cursor = self.read_pos.load(Ordering::Relaxed);
        let buf = match self.buffer.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        let (new, advanced) = crate::audio::read_new_from(&buf, cursor);
        self.read_pos.store(advanced, Ordering::Relaxed);
        new
    }

    fn format(&self) -> (u32, u16) {
        (SR, CH)
    }
```

(`SR`/`CH` são as constantes já definidas no arquivo: 48000/2.)

- [ ] **Step 4: Implement an interim impl in the CATap backend**

Em `src-tauri/src/sysaudio/catap.rs`, adicione ao `impl SystemAudioCapturer for CatapCapturer` uma impl interina baseada no buffer/`Shared` atual (a Task 4 substitui pelo ring buffer). Use a estrutura `Shared` existente (`buffer: Mutex<Vec<f32>>`, `sample_rate`, `channels`) e um cursor:

```rust
    fn read_new(&self) -> Vec<f32> {
        let cursor = self.read_pos.load(std::sync::atomic::Ordering::Relaxed);
        let buf = match self.shared.buffer.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        let (new, advanced) = crate::audio::read_new_from(&buf, cursor);
        self.read_pos
            .store(advanced, std::sync::atomic::Ordering::Relaxed);
        new
    }

    fn format(&self) -> (u32, u16) {
        (
            *self.shared.sample_rate.lock().unwrap(),
            *self.shared.channels.lock().unwrap(),
        )
    }
```

Adicione o campo `read_pos: std::sync::atomic::AtomicUsize` ao `struct CatapCapturer` e inicialize `read_pos: std::sync::atomic::AtomicUsize::new(0)` em `start()`. (Se a estrutura real do `Shared`/`CatapCapturer` divergir, ajuste os acessos ao buffer/format aos campos reais — o objetivo é cursor não-destrutivo sobre o que já é acumulado.)

- [ ] **Step 5: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -10`
Expected: compila. Run: `cd src-tauri && cargo test 2>&1 | tail -5` — suíte verde (sem novos testes aqui; é fiação de trait).

- [ ] **Step 6: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/sysaudio
git commit -m "feat(sysaudio): read_new + format on capturer trait (SCK + interim CATap)"
```

---

## Task 4: CATap lock-free ring buffer

**Nativo — verificação manual.** Refatora o callback real-time do CATap para empurrar num ring buffer lock-free (`ringbuf`); um consumidor drena pra um acumulador `Vec` (take completo), com cursor para `read_new`. Remove o `Mutex` lock + realloc da thread de áudio. Não unit-testável (FFI + RT).

**Files:**

- Modify: `src-tauri/Cargo.toml` (dep `ringbuf` no bloco macOS)
- Modify: `src-tauri/src/sysaudio/catap.rs`

**Interfaces:**

- Produces: `CatapCapturer` com captura via ring buffer; `stop()`/`read_new()`/`level()`/`format()` inalterados em assinatura.

- [ ] **Step 1: Add the dep**

Em `src-tauri/Cargo.toml`, no bloco `[target."cfg(target_os = \"macos\")".dependencies]`, adicione:

```toml
ringbuf = "0.4"
```

Run: `cd src-tauri && cargo fetch 2>&1 | tail -3` — confirme a versão resolvida; se a API diferir de 0.4, ajuste os nomes nos passos abaixo (verifique com `cargo doc -p ringbuf`).

- [ ] **Step 2: Refactor the capture path to ring → accumulator**

Reescreva o `Shared`/IO-proc do CATap com o padrão produtor-RT / consumidor:

1. No `start()`, crie um SPSC ring com capacidade folgada (ex.: 4s a 48 kHz estéreo ≈ `48_000 * 2 * 4`): `let rb = ringbuf::HeapRb::<f32>::new(capacity); let (producer, consumer) = rb.split();`
2. O **IO proc** (thread RT) captura `producer` e faz só `producer.push_slice(frames)` (lock-free; em overflow, push_slice escreve o que cabe e descarta o resto — aceitável, é áudio em tempo real).
3. O **consumidor** vive num estado compartilhado fora da thread RT:
   ```rust
   struct Consumer {
       rx: ringbuf::HeapCons<f32>, // lado consumidor
       acc: Vec<f32>,              // take completo acumulado
       read_pos: usize,            // cursor do read_new
   }
   ```
   guardado como `Mutex<Consumer>` no `CatapCapturer` (o Mutex agora NUNCA é tocado pela thread RT).
4. Um helper `drain(&Mutex<Consumer>)` que faz `pop` de tudo disponível do ring pra `acc`:
   ```rust
   fn drain(c: &std::sync::Mutex<Consumer>) {
       if let Ok(mut c) = c.lock() {
           // pop_slice/pop em loop até esvaziar o ring para `c.acc`.
           let mut tmp = [0f32; 4096];
           loop {
               let n = c.rx.pop_slice(&mut tmp);
               if n == 0 { break; }
               c.acc.extend_from_slice(&tmp[..n]);
           }
       }
   }
   ```
5. `read_new`: `drain(...)`, depois `read_new_from(&c.acc, c.read_pos)` e avança `c.read_pos`.
6. `stop`: `drain(...)`, devolve `(c.acc.clone(), sample_rate, channels)` (lê sample_rate/channels do ASBD do tap, como hoje).
7. `level`: `drain(...)`, RMS da cauda de `c.acc`.

> A sequência de criação/teardown do tap + aggregate device + IO proc (da v1) permanece; só muda o que o callback faz com as amostras (push no ring em vez de lock+extend). Garanta que `producer` é `Send` e vive enquanto o IO proc roda; o teardown (`AudioDeviceStop` → destroy) já quiesce a thread RT antes de o ring ser destruído.

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -15`
Expected: compila. Ajuste nomes da API do `ringbuf`/Send do producer até compilar limpo.

- [ ] **Step 4: Manual verification (deferred to Task 8)**

Captura real do CATap só é verificável num Mac 14.4+ numa call (Task 8). Por ora registre que compila e que o callback RT não faz mais lock/alloc.

- [ ] **Step 5: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/sysaudio/catap.rs
git commit -m "perf(sysaudio): CATap capture via lock-free ring buffer"
```

---

## Task 5: `LiveTranscriber` loop (`meeting/live.rs`)

O loop que lê, segmenta com VAD e emite. Helper de conversão é puro/testado; a thread em si é verificada por compilação + manual.

**Files:**

- Modify: `src-tauri/Cargo.toml` (dep `webrtc-vad`)
- Modify: `src-tauri/src/meeting/live.rs`

**Interfaces:**

- Consumes: `segment_closed_speech` (Task 1), `audio::{to_mono, resample_to_16k, WHISPER_SAMPLE_RATE}`, `Recorder::read_new` (Task 2), `SystemAudioCapturer::{read_new, format}` (Task 3), `stt::Transcriber::transcribe_segments`.
- Produces:
  - `fn to_i16(samples: &[f32]) -> Vec<i16>` — puro.
  - `struct LiveTranscriber` + `fn start(app: tauri::AppHandle, started_ms: u64, mic: Arc<...>, system: Arc<...>, transcriber: Arc<...>) -> LiveTranscriber` (ver assinatura concreta abaixo) e `fn stop(self)`.

> **Decisão de compartilhamento:** o loop precisa ler dos mesmos `Recorder`/capturer que o `MeetingRecorder` segura, e do `Transcriber`. Para evitar refatorar o ownership da v1, a Task 6 passa referências compartilhadas. Aqui defina o `LiveTranscriber` recebendo closures de leitura, desacoplando-o dos tipos concretos e tornando-o testável/estável:

```rust
pub struct LiveSources {
    /// Lê novas amostras do mic (16 kHz mono já convertido) — a Task 6 fornece.
    pub read_me: Box<dyn FnMut() -> Vec<f32> + Send>,
    /// Lê novas amostras do sistema (16 kHz mono) — None se sem captura de sistema.
    pub read_them: Option<Box<dyn FnMut() -> Vec<f32> + Send>>,
}
```

- [ ] **Step 1: Add the dep**

Em `src-tauri/Cargo.toml`, em `[dependencies]` (webrtc-vad é cross-platform; o loop só roda em reuniões, que são macOS, mas a crate compila em qualquer SO):

```toml
webrtc-vad = "0.4"
```

Run: `cd src-tauri && cargo fetch 2>&1 | tail -3` — confirme a versão; a API esperada é `Vad::new()` / `Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, VadMode::Quality)` e `vad.is_voice_segment(&[i16]) -> Result<bool, ()>` para um frame de tamanho exato (16 kHz, 30 ms = 480 amostras). **Verifique os nomes reais com `cargo doc -p webrtc-vad`** e ajuste; se a crate não existir/compilar, reporte BLOCKED.

- [ ] **Step 2: Write the failing test (pure conversion)**

Adicione ao `mod tests` em `meeting/live.rs`:

```rust
    #[test]
    fn to_i16_scales_and_clamps() {
        assert_eq!(to_i16(&[0.0]), vec![0]);
        assert_eq!(to_i16(&[1.0]), vec![i16::MAX]);
        assert_eq!(to_i16(&[-1.0]), vec![i16::MIN]);
        // Out-of-range clamps instead of wrapping.
        assert_eq!(to_i16(&[2.0]), vec![i16::MAX]);
        assert_eq!(to_i16(&[-2.0]), vec![i16::MIN]);
    }
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd src-tauri && cargo test meeting::live::tests::to_i16 2>&1 | tail -10`
Expected: FAIL — `cannot find function 'to_i16'`.

- [ ] **Step 4: Implement `to_i16` + the loop**

Em `meeting/live.rs`, adicione o helper puro:

```rust
/// Convert 16 kHz mono f32 in [-1, 1] to i16 PCM (what webrtc-vad expects),
/// clamping out-of-range values instead of wrapping.
pub fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect()
}
```

E o `LiveTranscriber`:

```rust
use crate::meeting::live::segment_closed_speech as _seg; // se necessário p/ visibilidade
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Frame size for VAD at 16 kHz / 30 ms.
const VAD_FRAME: usize = 480;
const FRAME_MS: u64 = 30;
/// ~2 frames (~60 ms) of silence closes a segment.
const MIN_SILENCE_FRAMES: usize = 2;
/// How often the loop wakes to pull audio.
const TICK_MS: u64 = 1000;

pub struct LiveTranscriber {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl LiveTranscriber {
    /// Spawn the live loop. `started_ms` anchors absolute timestamps. `sources`
    /// supplies new 16 kHz mono samples per stream. `transcribe` turns a chunk of
    /// samples into segment texts (the caller wires it to the loaded model under
    /// its lock). `language`/`prompt` are passed through to it.
    pub fn start(
        app: AppHandle,
        mut sources: LiveSources,
        transcribe: Arc<dyn Fn(&[f32]) -> Vec<crate::stt::SttSegment> + Send + Sync>,
    ) -> LiveTranscriber {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop.clone();
        let handle = std::thread::spawn(move || {
            // Per-source accumulators of 16 kHz mono samples not yet segmented,
            // plus the running sample offset (for absolute timestamps).
            let mut me_buf: Vec<f32> = Vec::new();
            let mut me_off: usize = 0;
            let mut them_buf: Vec<f32> = Vec::new();
            let mut them_off: usize = 0;

            let mut vad = match webrtc_vad::Vad::new_with_rate_and_mode(
                webrtc_vad::SampleRate::Rate16kHz,
                webrtc_vad::VadMode::Quality,
            ) {
                v => v, // adjust to the real constructor returned type per the crate
            };

            while !stop_for_thread.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(TICK_MS));

                me_buf.extend((sources.read_me)());
                process_source(&app, "me", &mut me_buf, &mut me_off, &mut vad, &*transcribe);

                if let Some(read_them) = sources.read_them.as_mut() {
                    them_buf.extend(read_them());
                    process_source(&app, "them", &mut them_buf, &mut them_off, &mut vad, &*transcribe);
                }
            }
        });
        LiveTranscriber { stop, handle: Some(handle) }
    }

    /// Signal the loop to stop and join it.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Run VAD over the buffered samples, emit each closed segment's transcript, and
/// drop the consumed prefix from the buffer (advancing the absolute offset).
fn process_source(
    app: &AppHandle,
    speaker: &str,
    buf: &mut Vec<f32>,
    offset_samples: &mut usize,
    vad: &mut webrtc_vad::Vad,
    transcribe: &dyn Fn(&[f32]) -> Vec<crate::stt::SttSegment>,
) {
    // Compute VAD flags per whole 480-sample frame; leftover (< one frame) stays.
    let n_frames = buf.len() / VAD_FRAME;
    if n_frames == 0 {
        return;
    }
    let mut flags = Vec::with_capacity(n_frames);
    for f in 0..n_frames {
        let frame = &buf[f * VAD_FRAME..(f + 1) * VAD_FRAME];
        let pcm = to_i16(frame);
        let voiced = vad.is_voice_segment(&pcm).unwrap_or(false);
        flags.push(voiced);
    }

    let segs = segment_closed_speech(&flags, FRAME_MS, MIN_SILENCE_FRAMES);
    if segs.is_empty() {
        return;
    }

    // Highest consumed frame across closed segments — everything up to it is done.
    let mut max_end_frame = 0usize;
    for (start_ms, end_ms) in &segs {
        let start_frame = (*start_ms / FRAME_MS) as usize;
        let end_frame = (*end_ms / FRAME_MS) as usize; // exclusive
        max_end_frame = max_end_frame.max(end_frame);

        let s = start_frame * VAD_FRAME;
        let e = (end_frame * VAD_FRAME).min(buf.len());
        let chunk = &buf[s..e];
        for seg in transcribe(chunk) {
            // Absolute ms from meeting start: offset + segment-local position.
            let base_ms = crate::meeting::samples_to_ms(*offset_samples + s);
            let _ = app.emit(
                "meeting_live_segment",
                serde_json::json!({
                    "speaker": speaker,
                    "start_ms": base_ms + seg.start_ms,
                    "end_ms": base_ms + seg.end_ms,
                    "text": seg.text,
                }),
            );
        }
    }

    // Drop the consumed prefix; keep the open tail for the next tick.
    let consumed = (max_end_frame * VAD_FRAME).min(buf.len());
    *offset_samples += consumed;
    buf.drain(..consumed);
}
```

> Ajuste os nomes do `webrtc-vad` (construtor, `SampleRate`, `VadMode`, `is_voice_segment`) aos da versão resolvida — confirme com `cargo doc -p webrtc-vad`. A forma (frame de 480 i16 → bool por frame → `segment_closed_speech`) é estável.

- [ ] **Step 5: Run tests + build**

Run: `cd src-tauri && cargo test meeting::live 2>&1 | tail -10`
Expected: PASS (segmentação da Task 1 + `to_i16`).
Run: `cd src-tauri && cargo build 2>&1 | tail -10`
Expected: compila (corrija a API do VAD até fechar).

- [ ] **Step 6: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/meeting/live.rs
git commit -m "feat(meeting/live): LiveTranscriber loop with webrtc-vad segmentation"
```

---

## Task 6: Wire the live loop into the meeting lifecycle

Conecta o `LiveTranscriber` ao `MeetingRecorder`/comandos: sobe no start, encerra no stop/cancel, alimentado pelas leituras incrementais e pelo transcriber sob lock.

**Files:**

- Modify: `src-tauri/src/meeting/mod.rs`
- Modify: `src-tauri/src/lib.rs` (`start_meeting`/`stop_meeting`/`cancel_meeting`)

**Interfaces:**

- Consumes: `LiveTranscriber`, `LiveSources` (Task 5); `Recorder::read_new` (Task 2); `SystemAudioCapturer::{read_new, format}` (Task 3).
- Produces: `MeetingRecorder` que opcionalmente segura um `LiveTranscriber`.

> **Ownership:** hoje `MeetingRecorder` é `move`d inteiro pra dentro do `Mutex<Option<MeetingRecorder>>` do `AppState`, e `stop()`/`cancel()` consomem `self`. O loop ao vivo precisa ler do mic/system enquanto o recorder está guardado. Solução de menor risco: envolver mic e system em `Arc` dentro do `MeetingRecorder` para que o closure de leitura do `LiveTranscriber` os compartilhe sem mover ownership; o `stop()` final continua acessando-os via o `Arc`.

- [ ] **Step 1: Make mic/system shareable + hold the live handle**

Em `src-tauri/src/meeting/mod.rs`, ajuste o `MeetingRecorder`:

```rust
use crate::audio::{self, Recorder};
use crate::meetings::{self, Meeting};
use crate::stt::Transcriber;
use crate::sysaudio::{self, SystemAudioCapturer};
use std::sync::Arc;

pub struct MeetingRecorder {
    mic: Arc<Recorder>,
    system: Option<Arc<Box<dyn SystemAudioCapturer>>>,
    started_ms: u64,
    live: Option<crate::meeting::live::LiveTranscriber>,
}
```

> `Recorder` e `Box<dyn SystemAudioCapturer>` precisam ser `Sync` para ir em `Arc` compartilhado entre threads. `Recorder` contém `cpal::Stream` (não-`Sync`); para não lutar com isso, NÃO compartilhe o `Recorder` inteiro — compartilhe só os buffers de leitura. Refatore para extrair um handle de leitura:
>
> - Em `audio.rs`, exponha `pub fn reader(&self) -> ReaderHandle` onde `ReaderHandle { buffer: Arc<Mutex<Vec<f32>>>, read_pos: Arc<AtomicUsize>, sample_rate: u32, channels: u16 }` com um método `read_new_16k(&self) -> Vec<f32>` que lê o novo, faz `to_mono` + `resample_to_16k`. `ReaderHandle` é `Send + Sync` (só Arcs).
> - Analogamente, dê ao trait `SystemAudioCapturer` um `fn reader(&self) -> SysReaderHandle` (Arcs do buffer/ring-consumer + format) com `read_new_16k(&self) -> Vec<f32>`.
>
> Assim o `LiveTranscriber` recebe dois `ReaderHandle`/`SysReaderHandle` (Send+Sync) e o `MeetingRecorder` mantém o ownership original do `Recorder`/capturer (sem `Arc` no tipo não-`Sync`). Atualize o `struct` acima para:

```rust
pub struct MeetingRecorder {
    mic: Recorder,
    system: Option<Box<dyn SystemAudioCapturer>>,
    started_ms: u64,
    live: Option<crate::meeting::live::LiveTranscriber>,
}
```

- [ ] **Step 2: Add reader handles (audio.rs + trait)**

Em `audio.rs`:

```rust
/// Send+Sync read handle into a Recorder's buffer for the live loop. Holds only
/// Arcs, so it can move into the live thread while the Recorder stays put.
#[derive(Clone)]
pub struct ReaderHandle {
    buffer: Arc<Mutex<Vec<f32>>>,
    read_pos: Arc<AtomicUsize>,
    sample_rate: u32,
    channels: u16,
}

impl ReaderHandle {
    /// New samples since last call, converted to 16 kHz mono.
    pub fn read_new_16k(&self) -> Vec<f32> {
        let cursor = self.read_pos.load(Ordering::Relaxed);
        let raw = {
            let guard = match self.buffer.lock() {
                Ok(b) => b,
                Err(_) => return Vec::new(),
            };
            let (new, advanced) = read_new_from(&guard, cursor);
            self.read_pos.store(advanced, Ordering::Relaxed);
            new
        };
        let mono = to_mono(&raw, self.channels);
        resample_to_16k(&mono, self.sample_rate)
    }
}

impl Recorder {
    /// A shareable reader over this recorder's live buffer.
    pub fn reader(&self) -> ReaderHandle {
        ReaderHandle {
            buffer: self.buffer.clone(),
            read_pos: self.read_pos.clone(),
            sample_rate: self.sample_rate,
            channels: self.channels,
        }
    }
}
```

(Garanta que `Recorder.buffer` é `Arc<Mutex<Vec<f32>>>` e `read_pos` é `Arc<AtomicUsize>` — ajuste o `read_pos` da Task 2 para `Arc<AtomicUsize>` se ainda não estiver, para poder ser clonado aqui.)

No trait `SystemAudioCapturer` (`sysaudio/mod.rs`), substitua `read_new`/`format` por um único:

```rust
    /// A Send+Sync reader yielding new samples already converted to 16 kHz mono.
    fn reader(&self) -> crate::sysaudio::SysReader;
```

e defina em `sysaudio/mod.rs`:

```rust
/// Shareable reader over a system capturer's buffer for the live loop.
pub struct SysReader(pub Box<dyn FnMut() -> Vec<f32> + Send>);
```

> Cada backend constrói o `SysReader` capturando Arcs do seu buffer/consumer + cursor, fazendo `read_new_from` + `to_mono` + `resample_to_16k` internamente. (SCK: Arc do `Mutex<Vec<f32>>` + `AtomicUsize`. CATap: Arc do `Mutex<Consumer>` + cursor, drenando o ring antes.) Implemente `reader()` em ambos os backends devolvendo esse closure. Remova o `read_new`/`format` por-trait das Tasks 3 se o `reader()` os substitui — ou mantenha ambos; o que importa é o loop receber um `FnMut() -> Vec<f32>` 16 kHz mono por fonte.

- [ ] **Step 3: Spawn/stop the live loop in MeetingRecorder**

Em `meeting/mod.rs`, no `MeetingRecorder::start`, depois de montar mic/system, construa as fontes e suba o live — mas o `transcribe` precisa do modelo, que vive no `AppState`. Então o spawn do live acontece no `lib.rs` (que tem o `AppHandle`/transcriber), não aqui. Aqui só guarde um campo `live: Option<LiveTranscriber>` e exponha:

```rust
impl MeetingRecorder {
    /// Reader handles for the live loop (mic always; system if present).
    pub fn readers(&self) -> (crate::audio::ReaderHandle, Option<crate::sysaudio::SysReader>) {
        (self.mic.reader(), self.system.as_ref().map(|s| s.reader()))
    }
    pub fn attach_live(&mut self, live: crate::meeting::live::LiveTranscriber) {
        self.live = Some(live);
    }
    pub fn started_ms(&self) -> u64 {
        self.started_ms
    }
}
```

E em `start()` inicialize `live: None`. Em `stop(self, ...)` e `cancel(self)`, no começo, encerre o live se houver: `if let Some(live) = self.live { live.stop(); }` (antes de consumir mic/system).

- [ ] **Step 4: Wire it in `lib.rs::start_meeting`**

Em `src-tauri/src/lib.rs`, em `start_meeting`, após inserir o recorder no `AppState` e antes/depois do level ticker, monte e insira o live. Como o `transcribe` precisa do modelo sob lock e do idioma/prompt:

```rust
    // Spawn the live transcription loop.
    {
        let st = app.state::<AppState>();
        let (language, prompt) = {
            let c = st.config.lock().unwrap();
            (c.language.clone(), text::dictionary_prompt(&c.dictionary))
        };
        let mut guard = st.meeting.lock().unwrap();
        if let Some(rec) = guard.as_mut() {
            let (mic_reader, sys_reader) = rec.readers();
            let app_for_live = app.clone();
            // The transcribe closure locks the model per call (serialized, same as
            // dictation/batch — intentional).
            let app_tx = app.clone();
            let transcribe: std::sync::Arc<
                dyn Fn(&[f32]) -> Vec<crate::stt::SttSegment> + Send + Sync,
            > = std::sync::Arc::new(move |chunk: &[f32]| {
                let st = app_tx.state::<AppState>();
                let guard = st.transcriber.lock().unwrap();
                match guard.as_ref() {
                    Some(t) => t
                        .transcribe_segments(chunk, &language, &prompt)
                        .unwrap_or_default(),
                    None => Vec::new(),
                }
            });
            let sources = crate::meeting::live::LiveSources {
                read_me: Box::new(move || mic_reader.read_new_16k()),
                read_them: sys_reader.map(|r| {
                    let mut r = r;
                    Box::new(move || (r.0)()) as Box<dyn FnMut() -> Vec<f32> + Send>
                }),
            };
            let live = crate::meeting::live::LiveTranscriber::start(app_for_live, sources, transcribe);
            rec.attach_live(live);
        }
    }
```

> Se a forma exata de `SysReader` (Step 2) divergir, ajuste o `read_them` para chamar o closure interno. O ponto: `read_me`/`read_them` devolvem `Vec<f32>` 16 kHz mono.

- [ ] **Step 5: Build + full suite**

Run: `cd src-tauri && cargo build 2>&1 | tail -15` — compila.
Run: `cd src-tauri && cargo test 2>&1 | tail -5` — verde.
Run: `cd src-tauri && cargo clippy 2>&1 | tail -8` — sem novos warnings.

- [ ] **Step 6: Format + commit**

```bash
cd src-tauri && cargo fmt
cd /Users/hudsonbrendon/Github/openwispr
git add src-tauri/src/meeting src-tauri/src/audio.rs src-tauri/src/sysaudio src-tauri/src/lib.rs
git commit -m "feat(meeting): run the live transcription loop during a meeting"
```

---

## Task 7: Frontend live view

Mostra os segmentos ao vivo rolando; abre automaticamente ao gravar e troca pro detalhe salvo ao terminar.

**Files:**

- Modify: `src/lib/api.ts`
- Create: `src/routes/LiveMeeting.tsx`
- Modify: `src/routes/Dashboard.tsx`
- Modify: `src/lib/i18n.tsx`

**Interfaces:**

- Consumes: evento `meeting_live_segment` `{ speaker, start_ms, end_ms, text }`, eventos existentes `meeting_state`/`meeting_saved`, comando `stop_meeting`.

- [ ] **Step 1: Add the payload type**

Em `src/lib/api.ts`, junto aos outros payloads de meeting:

```typescript
export type MeetingLiveSegmentPayload = {
  speaker: "me" | "them";
  start_ms: number;
  end_ms: number;
  text: string;
};
```

- [ ] **Step 2: Build the live view**

Crie `src/routes/LiveMeeting.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onEvent, type MeetingLiveSegmentPayload } from "../lib/api";
import { useI18n } from "../lib/i18n";

type Seg = MeetingLiveSegmentPayload;

/// Live transcript shown while a meeting is recording. Appends each closed
/// segment as it arrives and auto-scrolls. The saved transcript comes later from
/// the batch re-pass; this view is replaced by MeetingDetail on meeting_saved.
export default function LiveMeeting() {
  const { t } = useI18n();
  const [segments, setSegments] = useState<Seg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const un = onEvent<Seg>("meeting_live_segment", (p) =>
      setSegments((prev) => [...prev, p]),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments]);

  const label = (s: "me" | "them") =>
    s === "me" ? t("meetings.you") : t("meetings.them");

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          {t("meetings.live")}
        </h1>
        <button
          type="button"
          onClick={() => invoke("stop_meeting").catch(() => {})}
          className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400"
        >
          {t("meetings.stop")}
        </button>
      </div>

      {segments.length === 0 ? (
        <p className="text-sm text-stone-500">{t("meetings.liveWaiting")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {segments.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span
                className={
                  "shrink-0 text-xs font-medium " +
                  (s.speaker === "me" ? "text-emerald-600" : "text-sky-600")
                }
              >
                {label(s.speaker)}
              </span>
              <p className="min-w-0 text-sm">{s.text}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add i18n strings (PT + EN)**

Em `src/lib/i18n.tsx`, adicione em AMBOS os dicionários (grep antes pra não duplicar):

```
meetings.live          "Live meeting"          / "Reunião ao vivo"
meetings.liveWaiting   "Listening…"            / "Ouvindo…"
```

(`meetings.you`/`meetings.them`/`meetings.stop` já existem da v1 — não readicione.)

- [ ] **Step 4: Wire into Dashboard**

Em `src/routes/Dashboard.tsx`, importe `LiveMeeting` e mostre-o enquanto grava. Adicione estado e listener:

```tsx
import LiveMeeting from "./LiveMeeting";
```

Estado (perto dos outros `useState`):

```tsx
const [recording, setRecording] = useState(false);
```

No `useEffect` de listeners, adicione (e limpe):

```tsx
const mstate = onEvent<{ state: string }>("meeting_state", (p) =>
  setRecording(p.state === "recording"),
);
```

e no cleanup `mate.then((f) => f())` → use `mstate.then((f) => f())`.

No render da view `meetings`, mostre o live quando gravando:

```tsx
{
  view === "meetings" &&
    (recording ? (
      <LiveMeeting />
    ) : openMeeting ? (
      <MeetingDetail id={openMeeting} onBack={() => setOpenMeeting(null)} />
    ) : (
      <Meetings onOpen={(id) => setOpenMeeting(id)} />
    ));
}
```

> O `meeting_saved` já existente (na `Meetings.tsx`/refresh) cobre a transição; quando `recording` vira false e há um id salvo, o usuário cai na lista e abre o detalhe. Mantenha simples — não auto-navegue pro detalhe aqui.

- [ ] **Step 5: Build + tests**

Run: `pnpm build 2>&1 | tail -8` — compila (tsc + vite).
Run: `pnpm test 2>&1 | tail -5` — verde.

- [ ] **Step 6: Format + commit**

```bash
cd /Users/hudsonbrendon/Github/openwispr
pnpm format
git add src/lib/api.ts src/routes/LiveMeeting.tsx src/routes/Dashboard.tsx src/lib/i18n.tsx
git commit -m "feat(meetings): live transcript view during recording"
```

---

## Task 8: End-to-end manual verification + docs

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Full automated verification**

Run: `cd src-tauri && cargo fmt --check && cargo clippy 2>&1 | tail -8 && cargo test 2>&1 | tail -5`
Expected: fmt limpo, clippy sem novos warnings, testes verdes.
Run: `cd /Users/hudsonbrendon/Github/openwispr && pnpm lint && pnpm format:check && pnpm test 2>&1 | tail -5 && pnpm build 2>&1 | tail -3`
Expected: tudo verde (lembre: `format:check` cobre o repo inteiro, incluindo markdown).

- [ ] **Step 2: Build + reinstall (workflow do projeto)**

Build assinado com `APPLE_SIGNING_IDENTITY="OpenWispr Dev"` (ou, se já mergeado o fix, direto), reinstale em `/Applications` e conceda permissões, conforme o workflow de rebuild/reinstall do projeto.

- [ ] **Step 3: Manual end-to-end checklist (macOS 14.6 → CATap)**

Numa call/vídeo real com áudio:

- Iniciar reunião → a seção Meetings abre o **Live meeting** com ● vermelho.
- Falar (lado "Você") e ter outra voz tocando (lado "Participantes") → segmentos aparecem rolando em ~2–4s, rotulados, **sem reescrever** texto já mostrado.
- Conferir que não há glitch/estouro de áudio durante a captura (o ring buffer do CATap deve eliminar o ponto de alocação na thread RT).
- **Parar** → após o re-passe em lote, o transcript salvo abre no detalhe e está íntegro (igual qualidade da v1).
- Ditado por hotkey ainda funciona (sem regressão).

- [ ] **Step 4: Document**

Adicione ao `README.md` uma nota curta na descrição de reuniões: agora mostra transcrição **ao vivo** durante a call (preview), com o transcript salvo ainda vindo do passe em lote ao parar. Siga o tom/idioma das seções vizinhas.

- [ ] **Step 5: Format + commit**

```bash
cd /Users/hudsonbrendon/Github/openwispr
pnpm format
git add README.md
git commit -m "docs: document live meeting transcription"
```

---

## Self-Review

**1. Spec coverage:**

- Loop incremental ~1s + VAD + emit → Tasks 1, 5, 6. ✓
- Leitura não-destrutiva (cursor) preservando o take pro `stop()` → Tasks 2, 3, 6 (ReaderHandle). ✓
- Ring buffer lock-free no CATap → Task 4. ✓
- Dois passes (live efêmero; salvo = lote inalterado) → Task 6 (live separado; `stop()` da v1 intocado). ✓
- UI ao vivo + abre ao gravar + troca ao salvar → Task 7. ✓
- webrtc-vad → Task 5. ✓
- Rótulos me/them, sem flicker (só fechados), descarte de janelas atrasadas (drena buffer e segue) → Tasks 1, 5. ✓
- macOS-gating / não quebrar ditado / não mexer no `stop()` → mantido (live é aditivo). ✓
- Testes: segmentação, cursor, to_i16 (puros); nativo/thread manual → Tasks 1,2,5,8. ✓

**2. Placeholder scan:** As partes nativas (Task 4 ring) e de thread (Task 5 loop) trazem código concreto + verificação de API real (webrtc-vad/ringbuf, como na v1) e gate manual; sem TODO genérico. ✓

**3. Type consistency:**

- `read_new_from(&[f32], usize) -> (Vec<f32>, usize)` — Task 2, usado em 3/6. ✓
- `segment_closed_speech(&[bool], u64, usize) -> Vec<(u64,u64)>` — Task 1, usado em 5. ✓
- `to_i16(&[f32]) -> Vec<i16>` — Task 5. ✓
- `ReaderHandle::read_new_16k`/`SysReader` — Task 6, consumidos pelo `LiveSources` em 6. ✓
- Evento `meeting_live_segment {speaker,start_ms,end_ms,text}` — emitido em 5, tipado em 7 (`MeetingLiveSegmentPayload`). ✓
- `samples_to_ms` reusado de `meeting/mod.rs` (v1). ✓

> Nota de risco (para o executor): a Task 6 reconcilia ownership (`Recorder` não-`Sync` por causa de `cpal::Stream`) via `ReaderHandle`/`SysReader` (só Arcs). Se durante a execução o compartilhamento ficar mais simples movendo o transcriber pra `Arc<Transcriber>` no `AppState`, é aceitável — mas sem alterar a semântica serializada do ditado (decisão da v1).
