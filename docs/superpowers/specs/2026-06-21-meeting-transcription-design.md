# Transcrição de Reuniões — Design (v1)

**Data:** 2026-06-21
**Status:** Aprovado para planejamento
**Branch:** `feat/meeting-transcription`

## Objetivo

Permitir que o usuário grave e transcreva qualquer reunião (Google Meet, Zoom,
Teams, etc.) capturando **dois** áudios em paralelo — o microfone dele ("Eu") e
o áudio dos outros participantes que sai pelos alto-falantes ("Eles") — e gere
uma transcrição local salva, com indicador visual flutuante enquanto grava e uma
nova seção "Meetings" na barra lateral.

## Por que / contexto

OpenWispr (marca atual: Wisper) já tem quase toda a base: captura de microfone
via `cpal` (`src-tauri/src/audio.rs`), transcrição local com `whisper_rs`
(`src-tauri/src/stt.rs`), histórico append-only em `.jsonl`
(`src-tauri/src/history.rs`), pill flutuante (`src-tauri/src/overlay.rs`) e
sidebar com enum `View` (`src/components/Sidebar.tsx`). A única peça realmente
nova é **capturar o áudio de saída do sistema** (a voz dos outros
participantes). Tudo o mais reaproveita a infraestrutura existente.

Modelo adotado: **"Granola"** — captura local no Mac, **sem bot** entrando na
reunião. Pesquisa de mercado confirmou que os players locais (Granola,
Superwhisper meeting mode, MacWhisper, Cluely) usam ScreenCaptureKit e/ou Core
Audio process taps; nenhum exige driver virtual (BlackHole) hoje.

## Plataforma

- **macOS apenas** nesta feature (captura de áudio do sistema é específica do SO).
  No Windows/Linux a seção Meetings fica desabilitada com aviso.
- Floor: **macOS 13+**. Em 14.4+ usa Core Audio tap (permissão de áudio limpa);
  em 13–14.3 usa ScreenCaptureKit (permissão de Gravação de Tela).

## Decisões travadas (do brainstorm)

1. **Escopo v1 faseado.** v1 = captura mic+sistema, transcrição **em lote ao
   parar**, salvar, seção Meetings, bubble indicador. **Fora de escopo (v2):**
   texto ao vivo durante a call, resumo/notas com IA.
2. **Dois backends de captura de sistema**, selecionados em runtime: **CATap**
   (Core Audio process tap, macOS 14.4+) e **ScreenCaptureKit** (13–14.3).
   Ordem de construção: **CATap primeiro** (caminho principal), **SCK como task
   separável depois**, ambos atrás da mesma interface. Se o tempo apertar, é
   possível lançar só CATap (14.4+).
3. **Rótulo de fala por fonte:** mic = "Eu", som do sistema = "Eles". Sem
   diarização acústica (não separa múltiplos remotos entre si no v1).
4. **Armazenamento novo e separado:** `data_dir/meetings/<id>.json`, um arquivo
   por reunião. Não mistura com `history.jsonl` (ditados).
5. **Start manual** por botão "Iniciar reunião" — sem auto-detecção de
   Zoom/Meet/Teams abertos no v1.

## Arquitetura

```
[ Mic (cpal, Recorder existente) ] ──► buffer "me"   ─┐
                                                       ├─ (stop) cada buffer →
[ Som do sistema (CATap | SCK) ]   ──► buffer "them"  ─┘   16kHz mono → Whisper
                                                           c/ timestamps →
                                                           merge por start_ms →
                                                           Meeting salvo em JSON
```

Os dois capturadores rodam concorrentemente enquanto a reunião está ativa,
acumulando amostras no formato nativo. Ao parar, cada buffer é convertido para
16 kHz mono (funções já existentes em `audio.rs`) e transcrito separadamente. O
Whisper devolve segmentos com timestamps; os segmentos dos dois lados são
mesclados numa lista única ordenada por `start_ms`, cada um rotulado `me` ou
`them`.

### Componentes — Rust (novos)

| Módulo                                       | Responsabilidade                                                                                                   | Depende de                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `src-tauri/src/sysaudio/mod.rs`              | Trait `SystemAudioCapturer` + função `start_system_capture()` que escolhe o backend pela versão do macOS           | sysaudio::catap, sysaudio::screencapturekit |
| `src-tauri/src/sysaudio/catap.rs`            | Captura via Core Audio process tap (macOS 14.4+), FFI cru sobre `AudioHardwareCreateProcessTap` + aggregate device | objc2/coreaudio FFI                         |
| `src-tauri/src/sysaudio/screencapturekit.rs` | Captura via ScreenCaptureKit (`capturesAudio=true`, `excludesCurrentProcessAudio=true`)                            | crate `screencapturekit`                    |
| `src-tauri/src/meeting.rs`                   | `MeetingRecorder`: inicia mic (`Recorder`) + sistema juntos; `level()`; `stop()` transcreve e mescla; `cancel()`   | audio, sysaudio, stt, meetings              |
| `src-tauri/src/meetings.rs`                  | Persistência: `Meeting`/`Segment` structs + CRUD em `meetings/<id>.json`                                           | serde                                       |

### Interface de captura de sistema

```rust
// sysaudio/mod.rs
pub trait SystemAudioCapturer: Send {
    /// RMS do ~100ms mais recente, para o medidor de nível do bubble.
    fn level(&self) -> f32;
    /// Para a captura e devolve (amostras nativas f32, sample_rate, channels).
    fn stop(self: Box<Self>) -> (Vec<f32>, u32, u16);
}

/// Escolhe CATap (14.4+) ou ScreenCaptureKit (13–14.3) em runtime.
/// Erro se macOS < 13 ou permissão ausente.
pub fn start_system_capture() -> Result<Box<dyn SystemAudioCapturer>, String>;

/// Versão do macOS (major, minor) para a seleção de backend. Pura/testável.
pub fn macos_version() -> Option<(u32, u32)>;
pub fn pick_backend(version: (u32, u32)) -> Backend; // enum { Catap, ScreenCaptureKit, Unsupported }
```

### Alterações em módulos existentes

- **`src-tauri/src/stt.rs`**: novo método
  `transcribe_segments(&self, samples, language, prompt) -> Result<Vec<SttSegment>, String>`
  onde `SttSegment { start_ms: u64, end_ms: u64, text: String }`, usando
  `full_get_segment_t0/t1` (centésimos de segundo → ms). O `transcribe()` atual
  permanece intacto (ditado por hotkey não muda).
- **`src-tauri/src/commands.rs` (`AppState`)**: novo campo
  `meeting: Mutex<Option<crate::meeting::MeetingRecorder>>`, independente da
  máquina de estado de ditado, para o ditado por hotkey continuar funcionando.
- **`src-tauri/src/lib.rs`**: registrar os comandos novos e a janela `meeting-bubble`.
- **`Info.plist` / entitlements**: `NSAudioCaptureUsageDescription` (CATap),
  `NSScreenCaptureUsageDescription` (SCK), e o entitlement de captura de áudio
  no hardened runtime.

### Comandos Tauri (novos, em `commands.rs`)

| Comando                           | Assinatura                                 | O quê                                               |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `start_meeting`                   | `(app) -> Result<(), String>`              | Cria `MeetingRecorder`, abre o bubble               |
| `stop_meeting`                    | `(app) -> Result<Meeting, String>`         | Transcreve, mescla, salva, fecha bubble             |
| `cancel_meeting`                  | `(app) -> ()`                              | Descarta a gravação em curso, fecha bubble          |
| `meeting_level`                   | `(state) -> f32`                           | RMS atual (mic+sistema) para o bubble               |
| `get_meeting_state`               | `(state) -> String`                        | "idle" \| "recording"                               |
| `list_meetings`                   | `(state) -> Vec<MeetingSummary>`           | Resumos (id, título, data, duração), novos primeiro |
| `get_meeting`                     | `(state, id) -> Option<Meeting>`           | Reunião completa com segmentos                      |
| `delete_meeting`                  | `(state, id) -> Result<(), String>`        | Apaga o arquivo                                     |
| `rename_meeting`                  | `(state, id, title) -> Result<(), String>` | Renomeia                                            |
| `check_system_audio_permission`   | `() -> bool`                               | TCC de áudio/tela concedido?                        |
| `request_system_audio_permission` | `() -> ()`                                 | Dispara o prompt do SO                              |
| `open_system_audio_settings`      | `() -> ()`                                 | Abre o painel de privacidade                        |

### Modelo de dados

```jsonc
// data_dir/meetings/<uuid>.json
{
  "id": "uuid-v4",
  "title": "Reunião 21 jun 14:30", // auto do timestamp, editável
  "started_ms": 1750000000000, // epoch ms do início
  "duration_ms": 1834000,
  "language": "pt",
  "partial": false, // true se a captura de sistema falhou no meio
  "segments": [
    {
      "speaker": "me",
      "start_ms": 0,
      "end_ms": 2400,
      "text": "Bom dia pessoal",
    },
    {
      "speaker": "them",
      "start_ms": 2500,
      "end_ms": 4100,
      "text": "Oi, tudo bem?",
    },
  ],
}
```

`MeetingSummary` (lista) = todos os campos exceto `segments`.

### Componentes — Frontend (React)

| Arquivo                        | O quê                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `src/components/Sidebar.tsx`   | + `meetings` no enum `View` + ícone (inline SVG) + `NavButton`                       |
| `src/routes/Meetings.tsx`      | Lista de reuniões salvas + botão "Iniciar reunião" + nota de consentimento na 1ª vez |
| `src/routes/MeetingDetail.tsx` | Transcrição Eu/Eles, renomear, copiar, exportar (.txt/.md), deletar                  |
| `src/routes/MeetingBubble.tsx` | Janela bubble: `●` vermelho + cronômetro + medidor de nível + botão Parar            |
| `src/lib/api.ts`               | wrappers dos comandos novos                                                          |
| `src/App.tsx`                  | rotear `label === "meeting-bubble"` para `<MeetingBubble/>`                          |
| `src/routes/Dashboard.tsx`     | incluir `meetings` no switch de views                                                |
| i18n (`src/lib/i18n.tsx`)      | strings PT/EN das telas novas                                                        |

O bubble é uma segunda janela always-on-top (separada da `overlay` de ditado).
Reaproveita as funções puras de geometria de `overlay.rs` (`bottom_center`,
`point_in_band`); posicionada no **topo-centro** para não colidir com a pill de
ditado (bottom-center).

## Fluxo de uso

1. Usuário abre a seção **Meetings** e clica **Iniciar reunião**.
   - 1ª vez: pede permissão de áudio do sistema (CATap) ou tela (SCK) e mostra a
     nota de consentimento ("avise os participantes que está gravando").
   - Sem modelo Whisper baixado → bloqueia e encaminha para Settings.
2. `MeetingRecorder` inicia mic + sistema. A janela **bubble** aparece:
   `● Gravando 00:12` + medidor + Parar.
3. O usuário conduz a reunião normalmente. **Sem texto ao vivo no v1.**
4. **Parar** → transcreve os dois buffers em lote, mescla por timestamp, salva o
   JSON, fecha o bubble e abre o detalhe da reunião.

## Tratamento de erros / bordas

- **Sem modelo Whisper** → start bloqueado, encaminha para Settings (igual ditado).
- **Permissão de sistema negada** → bubble não inicia; abre o painel de permissão.
- **macOS < 13** → seção Meetings desabilitada com aviso de versão.
- **Captura de sistema falha no meio** → salva o que tem do mic, marca
  `partial: true`, transcrição mostra aviso.
- **Reunião longa (≈1h)** → v1 acumula em RAM. Aceitável; gravação em disco por
  chunks fica anotada como melhoria de v2.
- **Persistência best-effort** → falha ao salvar não pode travar o app; loga e
  informa o usuário sem crashar (padrão do `history.rs`).

## Estratégia de testes

**Unit / puro (TDD de verdade):**

- `meetings.rs`: serialização, save/list/get/delete/rename, lista ordenada
  newest-first, arquivo corrompido ignorado (espelha os testes de `history.rs`).
- `sysaudio::pick_backend`: seleção de backend por versão (13.0, 14.3, 14.4, 12.x).
- merge de segmentos `me`/`them` por `start_ms` (ordenação estável).
- `stt::transcribe_segments`: conversão de timestamps centésimos→ms (via fixture
  de áudio curto no teste de integração já existente em `tests/stt_integration.rs`).
- geometria do bubble (reaproveita testes de `overlay.rs`).

**Manual (nativo, não unit-testável):**

- Captura real CATap (14.4+) e SCK (13–14.3) — FFI de áudio do SO não roda em
  unit test. Verificação via build + reinstall em `/Applications` (workflow
  registrado na memória do projeto), numa call real de Meet/Zoom.

## Fora de escopo (v2+)

- Transcrição **ao vivo** (texto aparecendo durante a call, chunks ~1s + VAD).
- **Resumo/notas com IA** ao final (Granola-style) — exige LLM, nova dependência.
- **Diarização** de múltiplos participantes remotos.
- **Auto-detecção** de app de reunião aberto.
- Gravação em **disco por chunks** para reuniões muito longas.
- Suporte a Windows/Linux.

## Consentimento / legal

Leis de gravação variam (≈11 estados dos EUA exigem consentimento de todos os
participantes). Abordagem v1, alinhada aos players locais:

- Start **deliberado** (botão), nunca automático.
- Indicador **sempre visível** (bubble) enquanto grava.
- Nota de consentimento na primeira reunião.
- Armazenamento **100% local** + deleção fácil, reforçando a promessa local-first.
