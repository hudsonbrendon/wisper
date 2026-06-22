# Resumo de reunião com IA local — Design (v2, parte 2)

**Data:** 2026-06-22
**Status:** Aprovado para planejamento
**Branch:** `feat/meeting-ai-summary`
**Issue:** #30 (parte "resumo com IA"; o "texto ao vivo" já foi entregue em #31)
**Depende de:** transcrição de reuniões v1 (#28) + ao vivo (#31), ambos na `main`

## Objetivo

Botão **"Gerar resumo"** no detalhe da reunião que roda um LLM **local** sobre o
transcript salvo e produz um resumo **estruturado** em markdown (Resumo /
Pontos-chave / Decisões / Action items), salvo na própria reunião. 100% offline
— mantém a promessa local-first (o transcript nunca sai da máquina).

## Decisões travadas (do brainstorm)

1. **LLM local**, via `llama-cpp-2` (binding Rust do llama.cpp) com Metal no
   macOS. Sem nuvem, sem BYO key.
2. **Modelo:** Qwen2.5-7B-Instruct, quantização Q4_K_M GGUF (~4.5 GB). Bom em
   português e em estruturar o resumo; roda em alguns segundos no Apple Silicon.
3. **Sob demanda:** botão "Gerar resumo" (não automático ao parar). O usuário
   controla quando gastar o processamento.
4. **Estruturado:** seções Resumo + Pontos-chave + Decisões + Action items.
5. **Modelo residente:** carregado lazy no 1º uso e mantido em RAM (confirmado
   ok no Mac do usuário).
6. **Transcript muito longo:** truncado para caber no contexto do modelo (v1),
   em vez de chunk+merge.

## Plataforma

- macOS é o alvo (Metal). O módulo de resumo compila cross-platform (CPU fora do
  macOS), espelhando o setup do `whisper-rs` no `Cargo.toml`, para não quebrar o
  CI Linux.

## Arquitetura

```
Meeting JSON (segments Eu/Eles)
   │  botão "Gerar resumo"
   ▼
transcript_text() → flatten segmentos em texto rotulado
   │
build_prompt(transcript, lang) → prompt de resumo estruturado
   │
Summarizer (llama-cpp-2, Metal, GGUF 7B, off-thread)
   │
markdown → salva em Meeting.summary (JSON) → UI renderiza
```

O resumo roda sobre o transcript **salvo** (canônico, do re-passe em lote da
v1), não sobre o ao vivo. Tudo local.

### Componentes — Rust

| Arquivo                              | Mudança                                                                                                                                                                                                     | Responsabilidade                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src-tauri/src/summarizer.rs` (novo) | `Summarizer::load(path) -> Result<Summarizer, String>`, `summarize(&self, transcript: &str, language: &str) -> Result<String, String>`, e `build_prompt(transcript: &str, language: &str) -> String` (puro) | Carrega o GGUF via `llama-cpp-2` (Metal), roda o prompt, devolve markdown      |
| `src-tauri/src/meetings.rs`          | + `summary: Option<String>` no `Meeting` (`#[serde(default)]`); + `transcript_text(m: &Meeting) -> String` (puro)                                                                                           | Persiste o resumo (compatível com reuniões antigas); achata segmentos em texto |
| `src-tauri/src/model_manager.rs`     | + `llm_model_info() -> &'static ModelInfo` (Qwen2.5-7B-Instruct Q4_K_M GGUF, URL+sha256 fixos); reusa `download`/`is_downloaded`/`model_path`                                                               | Download/verify do LLM com a mesma infra do whisper                            |
| `src-tauri/src/commands.rs`          | `generate_summary`, `llm_model_downloaded`, `download_llm_model`; + `summarizer: Mutex<Option<Summarizer>>` no `AppState`                                                                                   | Comandos Tauri                                                                 |
| `src-tauri/src/lib.rs`               | registra comandos + inicializa `summarizer: Mutex::new(None)` no `AppState`                                                                                                                                 | Fiação                                                                         |
| `src-tauri/Cargo.toml`               | `llama-cpp-2` com feature `metal` no bloco macOS, sem feature no bloco não-macOS (espelha `whisper-rs`)                                                                                                     | Dep do LLM                                                                     |

### Interfaces — Rust

```rust
// summarizer.rs
pub struct Summarizer { /* contexto llama.cpp carregado */ }

impl Summarizer {
    /// Carrega o modelo GGUF do caminho. Erro como String (padrão do projeto).
    pub fn load(model_path: &str) -> Result<Summarizer, String>;
    /// Resume o transcript (texto já achatado). `language` é "pt"/"en"/"auto"
    /// para instruir o idioma de saída. Devolve markdown estruturado.
    pub fn summarize(&self, transcript: &str, language: &str) -> Result<String, String>;
}

/// Monta o prompt de resumo estruturado. Puro/testável. Instrui o modelo a
/// devolver as seções Resumo / Pontos-chave / Decisões / Action items em
/// markdown, no idioma pedido, sem inventar fora do transcript.
pub fn build_prompt(transcript: &str, language: &str) -> String;
```

```rust
// meetings.rs
pub struct Meeting {
    // ... campos existentes ...
    #[serde(default)]
    pub summary: Option<String>, // markdown do resumo, None até gerar
}

/// Achata os segmentos em texto rotulado para o prompt, p.ex.:
///   "Você: bom dia\nParticipantes: oi\n..."
pub fn transcript_text(m: &Meeting) -> String;
```

### Comandos Tauri

| Comando                | Assinatura                            | O quê                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generate_summary`     | `(app, id) -> Result<String, String>` | Carrega o `Meeting`, monta prompt, roda o LLM **off-thread**, salva `summary` no JSON, devolve o markdown. Lazy-load do `Summarizer` na 1ª vez. Erro `no_llm_model` se o modelo não estiver baixado; `empty_transcript` se sem fala. |
| `llm_model_downloaded` | `() -> bool`                          | O GGUF do LLM já está baixado?                                                                                                                                                                                                       |
| `download_llm_model`   | `(app) -> Result<(), String>`         | Baixa o GGUF emitindo `llm_download_progress` `{received,total}` (reusa `model_manager::download`)                                                                                                                                   |

**Truncamento:** `summarize` corta o transcript a um teto de caracteres
(constante, ex.: ~24k chars ≈ folga pro contexto do 7B) antes do prompt, com uma
linha de aviso no fim do trecho quando truncado.

### Componentes — Frontend

| Arquivo                        | Mudança                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/MeetingDetail.tsx` | Seção **Resumo**: se `meeting.summary` existe → renderiza o markdown; senão botão **Gerar resumo**. Se LLM não baixado → fluxo "Baixar modelo (~4.5GB)" com barra de progresso (`llm_download_progress`). Botão **Regerar**. Estado de loading enquanto gera. |
| `src/lib/api.ts`               | tipos + wrappers `generateSummary(id)`, `llmModelDownloaded()`, `downloadLlmModel()`, payload `LlmDownloadProgressPayload`; `summary?: string` no tipo `Meeting`                                                                                              |
| `src/lib/i18n.tsx`             | strings PT/EN: título da seção, gerar, regerar, baixar modelo, gerando…, sem fala, etc.                                                                                                                                                                       |
| markdown render                | renderer leve (headings/listas/checkbox) para o markdown do resumo — sem dependência pesada se possível                                                                                                                                                       |

## Fluxo de uso

1. Abrir o detalhe de uma reunião → seção **Resumo** com **Gerar resumo**.
2. 1ª vez sem o modelo LLM → botão vira **Baixar modelo de resumo (~4.5GB)** com
   progresso; ao concluir, habilita gerar.
3. **Gerar resumo** → estado "Gerando…" → roda o LLM local (alguns segundos) →
   mostra o resumo estruturado renderizado → salva no JSON. **Regerar** disponível.

## Tratamento de erros / bordas

- **Sem modelo LLM** → `generate_summary` retorna `no_llm_model`; a UI mostra o
  fluxo de download em vez de gerar.
- **Transcript vazio** (reunião sem fala / só silêncio) → `empty_transcript`; a
  UI avisa, não gera.
- **Transcript muito longo** → truncado ao teto antes do prompt (com aviso no
  trecho), para não estourar o contexto.
- **Falha de inferência/carregamento** → erro propagado como String, logado; o
  JSON da reunião não é corrompido (só salva em caso de sucesso).
- **Persistência best-effort** → falha ao salvar o `summary` loga e não trava;
  o markdown ainda é devolvido pra exibição.

## Estratégia de testes

**Unit / puro (TDD):**

- `transcript_text`: segmentos `me`/`them` → texto rotulado (Você/Participantes),
  ordem preservada, vazio quando sem segmentos.
- `build_prompt`: inclui o transcript, instrui idioma e as 4 seções, e a regra
  de não inventar fora do transcript.
- truncamento: transcript acima do teto é cortado + marcado; abaixo passa intacto.
- serialização do `Meeting.summary`: round-trip; **reunião antiga sem o campo**
  desserializa com `summary: None` (compat. via `#[serde(default)]`).

**Manual (device, não unit-testável):**

- Download do modelo (~4.5GB) com progresso.
- Geração real sobre uma reunião em PT: qualidade do resumo/seções, latência,
  persistência ao reabrir, **Regerar**.
- Confirmar que o ditado e a captura de reunião seguem funcionando (sem regressão
  de RAM/estado com o LLM residente).

## Fora de escopo (futuro)

- Backend de **nuvem** (BYO key Claude/OpenAI).
- Resumo **automático** ao parar a reunião.
- **Streaming** token-a-token do resumo na UI.
- Escolha de **modelo** na UI / múltiplos tamanhos.
- **Chunk+merge** de transcripts muito longos (v1 trunca).
- Resumo por **participante** / diarização de múltiplos remotos.
