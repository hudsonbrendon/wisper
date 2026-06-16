// Translations for the OpenWispr site. `en` is the source of truth and the
// fallback for any missing key. Add a language by appending to OPENWISPR_LANGS
// and adding its dictionary below.
window.OPENWISPR_LANGS = [
  { code: "en", native: "English", lang: "en" },
  { code: "pt", native: "Português", lang: "pt-BR" },
];

window.OPENWISPR_I18N = {
  en: {
    nav_features: "Features",
    nav_how: "How it works",
    nav_download: "Download",

    hero_eyebrow: "Open source · Local-first dictation",
    hero_title_a: "Your voice, typed",
    hero_title_b: "everywhere",
    hero_lede:
      "OpenWispr is a private voice dictation app. Press a hotkey, speak, and your words land in any app — transcribed on-device with Whisper, never in the cloud.",
    hero_cta: "Download",
    hero_cta2: "See what's inside",
    hero_meta1: "100% on-device",
    hero_meta2: "15+ languages",
    hero_meta3: "Latest release",
    demo_prompt: "How should I phrase the invite?",
    demo_text:
      "Let's grab coffee on Thursday and walk through the launch plan",
    demo_pill: "Capturing",

    sec_why: "WHY",
    feat_head: "Built for fast, private dictation.",
    feat1_t: "On-device transcription",
    feat1_d:
      "Whisper runs locally. Your audio never leaves your machine — no accounts, no servers, no telemetry.",
    feat2_t: "Works in every app",
    feat2_d:
      "Dictated text is typed straight into the focused field — your editor, browser, chat, anywhere.",
    feat3_t: "Press-hold or double-tap",
    feat3_d:
      "Hold the hotkey to dictate a burst, or double-tap to toggle hands-free. The floating pill shows your levels.",
    feat4_t: "Custom vocabulary & snippets",
    feat4_d:
      "Teach it your names and jargon, and expand spoken triggers into canned text automatically.",
    feat5_t: "Your language",
    feat5_d:
      "Transcribe in 15+ languages, switchable on the fly from the pill or the tray.",
    feat6_t: "Free & open source",
    feat6_d:
      "MIT-licensed and built on Tauri. Audit it, fork it, ship it. Updates arrive automatically.",

    sec_how: "HOW",
    how_head: "Three steps, no friction.",
    step1_t: "Press your hotkey",
    step1_d:
      "A floating pill appears above your taskbar and starts listening.",
    step2_t: "Speak naturally",
    step2_d: "Watch the live audio meter. Click to stop, or release the hotkey.",
    step3_t: "Text appears",
    step3_d:
      "Your words are transcribed on-device and typed into the active app.",

    sec_platforms: "PLATFORMS",
    plat_head: "One app, every desktop.",
    spec_platforms_k: "Platforms",
    spec_platforms_v: "macOS · Win · Linux",
    spec_engine_k: "Engine",
    spec_langs_k: "Languages",
    spec_price_k: "Price",
    spec_price_v: "Free",
    plat_note:
      "The same project ships native bundles for Apple Silicon and Intel Macs, Windows, and Linux (AppImage, deb, rpm). Installed apps update themselves over the air.",

    cta_title: "Ready when you are.",
    cta_body:
      "Download OpenWispr for your platform and start dictating in minutes. Free, open source, and entirely on-device.",
    cta_button: "Download",
    all_platforms: "All platforms & versions",

    dl_mac_apple: "Download for macOS (Apple Silicon)",
    dl_mac_intel: "Download for macOS (Intel)",
    dl_win: "Download for Windows",
    dl_linux: "Download for Linux",
    dl_generic: "Download OpenWispr",

    foot_releases: "Releases",
    foot_license: "License",
    foot_disclaimer: "MIT-licensed · built with Tauri & Whisper.",
  },

  pt: {
    nav_features: "Recursos",
    nav_how: "Como funciona",
    nav_download: "Baixar",

    hero_eyebrow: "Código aberto · Ditado local",
    hero_title_a: "Sua voz, digitada",
    hero_title_b: "em qualquer lugar",
    hero_lede:
      "O OpenWispr é um app de ditado por voz privado. Aperte um atalho, fale, e suas palavras aparecem em qualquer app — transcritas no seu dispositivo com o Whisper, nunca na nuvem.",
    hero_cta: "Baixar",
    hero_cta2: "Ver o que tem dentro",
    hero_meta1: "100% no dispositivo",
    hero_meta2: "15+ idiomas",
    hero_meta3: "Última versão",
    demo_prompt: "Como devo escrever o convite?",
    demo_text:
      "Vamos tomar um café na quinta e revisar o plano de lançamento",
    demo_pill: "Captando",

    sec_why: "POR QUÊ",
    feat_head: "Feito para ditado rápido e privado.",
    feat1_t: "Transcrição no dispositivo",
    feat1_d:
      "O Whisper roda localmente. Seu áudio nunca sai da sua máquina — sem contas, sem servidores, sem telemetria.",
    feat2_t: "Funciona em qualquer app",
    feat2_d:
      "O texto ditado é digitado direto no campo em foco — seu editor, navegador, chat, onde for.",
    feat3_t: "Segurar ou tocar duas vezes",
    feat3_d:
      "Segure o atalho para ditar um trecho, ou toque duas vezes para o modo mãos-livres. O balão flutuante mostra seus níveis.",
    feat4_t: "Vocabulário e snippets",
    feat4_d:
      "Ensine nomes e jargões, e expanda gatilhos falados em textos prontos automaticamente.",
    feat5_t: "Seu idioma",
    feat5_d:
      "Transcreva em 15+ idiomas, alternáveis na hora pelo balão ou pela bandeja.",
    feat6_t: "Grátis e código aberto",
    feat6_d:
      "Licença MIT, feito com Tauri. Audite, faça fork, publique. As atualizações chegam automaticamente.",

    sec_how: "COMO",
    how_head: "Três passos, sem atrito.",
    step1_t: "Aperte seu atalho",
    step1_d:
      "Um balão flutuante aparece acima da barra de tarefas e começa a ouvir.",
    step2_t: "Fale naturalmente",
    step2_d:
      "Veja o medidor de áudio ao vivo. Clique para parar, ou solte o atalho.",
    step3_t: "O texto aparece",
    step3_d:
      "Suas palavras são transcritas no dispositivo e digitadas no app ativo.",

    sec_platforms: "PLATAFORMAS",
    plat_head: "Um app, todos os desktops.",
    spec_platforms_k: "Plataformas",
    spec_platforms_v: "macOS · Win · Linux",
    spec_engine_k: "Motor",
    spec_langs_k: "Idiomas",
    spec_price_k: "Preço",
    spec_price_v: "Grátis",
    plat_note:
      "O mesmo projeto entrega bundles nativos para Macs Apple Silicon e Intel, Windows e Linux (AppImage, deb, rpm). Apps instalados se atualizam sozinhos pela rede.",

    cta_title: "Pronto quando você estiver.",
    cta_body:
      "Baixe o OpenWispr para a sua plataforma e comece a ditar em minutos. Grátis, código aberto e totalmente no seu dispositivo.",
    cta_button: "Baixar",
    all_platforms: "Todas as plataformas e versões",

    dl_mac_apple: "Baixar para macOS (Apple Silicon)",
    dl_mac_intel: "Baixar para macOS (Intel)",
    dl_win: "Baixar para Windows",
    dl_linux: "Baixar para Linux",
    dl_generic: "Baixar OpenWispr",

    foot_releases: "Versões",
    foot_license: "Licença",
    foot_disclaimer: "Licença MIT · feito com Tauri e Whisper.",
  },
};
