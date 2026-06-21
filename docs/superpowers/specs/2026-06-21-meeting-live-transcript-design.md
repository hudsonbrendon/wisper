# Transcrição ao vivo de reuniões — Design (v2, parte 1)

**Data:** 2026-06-21
**Status:** Aprovado para planejamento
**Branch:** `feat/meeting-live-transcript`
**Issue:** #30 (parte "texto ao vivo"; o "resumo IA" é um ciclo separado)
**Depende de:** transcrição de reuniões v1 (PR #28, na `main`)

## Objetivo

Mostrar o transcript Você/Participantes **rolando em tempo real durante a
reunião**. Ao parar, o re-passe em lote já existente (`MeetingRecorder::stop`)
continua gerando o transcript salvo (canônico). O texto ao vivo é **display
efêmero** — não é persistido; serve só pra dar feedback imediato.

## Contexto

Na v1, `MeetingRecorder` (`src-tauri/src/meeting.rs`) captura mic ("me") e áudio
do sistema ("them") acumulando em RAM e só transcreve no `stop()`. Esta feature
adiciona um loop de transcrição **incremental** durante a call, sem alterar o
caminho do salvo. Decisões do brainstorm:

1. **Dois passes.** Ao vivo = preview rápido durante a call; ao parar, o re-passe
   em lote atual gera o transcript salvo. O ao vivo NÃO é persistido.
2. **VAD dedicado: `webrtc-vad`** (energia/GMM, sem ONNX) para cortar segmentos
   de fala — menos alucinação que janela fixa.
3. **UI: página de detalhe ao vivo.** Ao iniciar, a seção Meetings abre a
   reunião ao vivo com o transcript rolando; o balão flutuante segue só como
   indicador (● + cronômetro + parar).

## Plataforma

- macOS apenas (mesma base de captura da v1; 13+).
- O texto ao vivo depende da captura nativa: CATap (14.4+) e ScreenCaptureKit
  (13–14.3). Sem captura de sistema, o ao vivo mostra só "Você".

## Arquitetura

```
captura (mic + sistema) ──► leitura NÃO-DESTRUTIVA (ring buffer / cursor)
        │                            │ a cada ~1s
        │                  LiveTranscriber (thread)
        │                    webrtc-vad → segmentos de fala FECHADOS
        │                    → Whisper por segmento
        │                    → emit "meeting_live_segment"
        ▼ (stop)
   stop() atual (v1): re-transcreve mic+sistema em lote → Meeting salvo (inalterado)
```

Os capturadores hoje só expõem `stop()` (consome tudo). Esta feature adiciona
**leitura incremental não-destrutiva** (lê só o que chegou desde a última
leitura) para o loop ao vivo, sem interferir no `stop()` final. Os segmentos ao
vivo são emitidos como eventos e renderizados pela UI; nada novo é salvo em
disco. O `stop()` em lote permanece a fonte canônica.

### Componentes — Rust

| Arquivo                                                       | Mudança                                                                                                                   | Responsabilidade                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/sysaudio/mod.rs` (trait `SystemAudioCapturer`) | + `fn read_new(&self) -> Vec<f32>`; + `fn format(&self) -> (u32, u16)`                                                    | Leitura incremental + formato nativo. `stop()` inalterado.                                                                         |
| `src-tauri/src/sysaudio/catap.rs`                             | Callback RT passa a escrever num **ring buffer lock-free** (`ringbuf`); `read_new()`/`stop()` consomem do lado consumidor | Remove o `Mutex` lock + realloc na thread de áudio real-time (ponto sinalizado na review final da v1) e habilita leitura contínua. |
| `src-tauri/src/sysaudio/screencapturekit.rs`                  | `read_new()` via cursor sobre o buffer existente; `format()` retorna `(48000, 2)`                                         | Leitura incremental no backend SCK.                                                                                                |
| `src-tauri/src/audio.rs` (`Recorder`)                         | + `fn read_new(&self) -> Vec<f32>` (cursor sobre o `Arc<Mutex<Vec<f32>>>` do mic)                                         | Leitura incremental do mic. `stop()` e `level()` inalterados.                                                                      |
| `src-tauri/src/meeting/live.rs` (novo)                        | `LiveTranscriber`                                                                                                         | Loop ~1s: drena mic+sistema, converte 16 kHz mono, roda VAD, transcreve segmentos fechados, emite eventos com timestamp absoluto.  |
| `src-tauri/src/meeting.rs`                                    | `start()` sobe o `LiveTranscriber`; `stop()`/`cancel()` o encerram antes do re-passe                                      | Orquestra o ciclo de vida do live junto com a reunião.                                                                             |
| `src-tauri/src/commands.rs` / `lib.rs`                        | Spawna/encerra a thread do live com a reunião; emite o evento novo                                                        | Fiação Tauri.                                                                                                                      |
| `src-tauri/Cargo.toml`                                        | + `webrtc-vad`, + `ringbuf` (macOS onde aplicável)                                                                        | Deps novas.                                                                                                                        |

### Interface de leitura incremental

```rust
// sysaudio/mod.rs — adições ao trait existente
pub trait SystemAudioCapturer: Send {
    fn level(&self) -> f32;                 // já existe
    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16); // já existe
    /// Amostras nativas capturadas desde a última chamada (não-destrutivo p/ stop()).
    fn read_new(&self) -> Vec<f32>;         // novo
    /// (sample_rate, channels) do stream nativo.
    fn format(&self) -> (u32, u16);         // novo
}
```

```rust
// audio.rs — adição ao Recorder existente
impl Recorder {
    /// Amostras nativas desde a última leitura (cursor interno). Não esvazia o
    /// buffer usado por stop(); apenas avança um índice de leitura do live.
    pub fn read_new(&self) -> Vec<f32>;
}
```

### `LiveTranscriber` (novo)

```rust
// meeting/live.rs
pub struct LiveTranscriber { /* handles de thread + sinal de parada */ }

impl LiveTranscriber {
    /// Sobe a thread do loop ao vivo. `started_ms` ancora os timestamps
    /// absolutos; `app` é usado para emitir "meeting_live_segment".
    pub fn start(app: AppHandle, started_ms: u64) -> LiveTranscriber;
    /// Sinaliza parada e junta a thread.
    pub fn stop(self);
}

/// Acumulador por fonte: converte amostras nativas em 16 kHz mono, roda
/// webrtc-vad em frames de 10/20/30 ms, e emite cada segmento FECHADO de fala.
/// Pura o suficiente para testar a segmentação isoladamente:
fn segment_closed_speech(vad_flags: &[bool], frame_ms: u64) -> Vec<(u64, u64)>;
```

A thread, a cada ~1s: para cada fonte (mic, sistema) chama `read_new()`,
converte para 16 kHz mono (`audio::to_mono` + `resample_to_16k`), acumula num
buffer por-fonte, roda o VAD por frames, e para cada segmento **fechado** (fim de
fala detectado) transcreve com `Transcriber::transcribe_segments` e emite
`meeting_live_segment`. Mantém um offset de amostras por fonte para dar
`start_ms`/`end_ms` absolutos (relativos ao início da reunião). Segmento aberto
(fala ainda em curso) não é emitido — evita reescrita na tela.

### Evento novo

`meeting_live_segment` — payload `{ speaker: "me" | "them", start_ms: u64, end_ms: u64, text: String }`. Emitido quando um segmento de fala fecha e é transcrito. Sem evento de "parcial" no v1.

### Componentes — Frontend

| Arquivo                             | Mudança                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/LiveMeeting.tsx` (novo) | Escuta `meeting_live_segment`, acumula segmentos e rola o transcript Você/Participantes ao vivo (auto-scroll pro fim). Botão Parar (`stop_meeting`). |
| `src/routes/Dashboard.tsx`          | Quando uma reunião está gravando, abre `LiveMeeting` na seção Meetings; ao `meeting_saved`, troca pro `MeetingDetail` salvo.                         |
| `src/lib/api.ts`                    | + tipo `MeetingLiveSegmentPayload`.                                                                                                                  |
| `src/lib/i18n.tsx`                  | + strings da tela ao vivo (PT/EN).                                                                                                                   |
| Balão (`MeetingBubble.tsx`)         | **Inalterado.**                                                                                                                                      |

## Fluxo

1. **Iniciar reunião** → sobe captura (v1) **e** o `LiveTranscriber`. A seção
   Meetings abre o `LiveMeeting`.
2. Durante a call, a cada ~1s os segmentos fechados são transcritos e aparecem
   rolando, rotulados Você/Participantes.
3. **Parar** → encerra o `LiveTranscriber`, e o `stop()` em lote da v1
   re-transcreve tudo e salva o `Meeting` canônico. A UI troca pro detalhe salvo.

## Tratamento de erros / bordas

- Falha no live (VAD/transcrição) → loga e segue; **não afeta** o re-passe em
  lote do salvo.
- Modelo não acompanha o real-time → o loop **descarta janelas atrasadas** em vez
  de acumular atraso; o salvo (lote) garante completude.
- Sem captura de sistema (parcial) → live mostra só "Você", como o salvo.
- `read_new()` nunca pode esvaziar o buffer que `stop()` usa — é só um cursor de
  leitura; o `stop()` continua vendo o take inteiro.

## Estratégia de testes

**Unit / puro (TDD):**

- `segment_closed_speech`: dado um stream de flags do VAD, retorna os pares
  (start_ms, end_ms) dos segmentos fechados; cobre fala-no-fim-aberta (não
  emitida), múltiplos segmentos, silêncio total.
- Cursor `read_new` (mic e sistema): lê só o novo; não re-lê; `stop()` ainda vê
  tudo.
- Math do offset de timestamp absoluto.
- Comportamento do ring buffer (produtor/consumidor, sem perda silenciosa além
  do descarte intencional de overflow).

**Manual (device):**

- Live numa call real (macOS 14.6 → CATap): latência ~2–4s, sem flicker, rótulos
  corretos, e o salvo final continua íntegro.

## Fora de escopo (v2 futuro / outros ciclos)

- **Resumo/notas com IA** (issue #30, ciclo separado — exige decisão LLM
  local vs nuvem).
- Diarização de múltiplos participantes remotos.
- Gravação em disco por chunks para reuniões longas.
- Validação do backend ScreenCaptureKit (13–14.3) em hardware.
- Evento de texto "parcial" (palavra a palavra) — v1 do live só emite segmentos
  fechados.
