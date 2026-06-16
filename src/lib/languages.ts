/** Whisper language options. "auto" lets Whisper detect the spoken language.
 *  Codes are Whisper's ISO 639-1 language codes. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "auto", name: "Detect automatically" },
  { code: "pt", name: "Português" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "ru", name: "Русский" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "ar", name: "العربية" },
  { code: "hi", name: "हिन्दी" },
];

/** Short uppercase label for a language code, e.g. "pt" -> "PT", "auto" -> "AUTO". */
export const langLabel = (code: string): string => code.toUpperCase();
