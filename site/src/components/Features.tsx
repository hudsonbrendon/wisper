const FEATURES = [
  {
    title: "On-device transcription",
    body: "Whisper runs locally. Your audio never leaves your machine — no accounts, no servers, no telemetry.",
  },
  {
    title: "Works in every app",
    body: "Dictated text is typed straight into the focused field — your editor, browser, chat, anywhere.",
  },
  {
    title: "Press-hold or double-tap",
    body: "Hold the hotkey to dictate a burst, or double-tap to toggle hands-free. The floating pill shows your levels.",
  },
  {
    title: "Custom vocabulary & snippets",
    body: "Teach it your names and jargon, and expand spoken triggers into canned text automatically.",
  },
  {
    title: "Your language",
    body: "Transcribe in 15+ languages, switchable on the fly from the pill or the tray.",
  },
  {
    title: "Free & open source",
    body: "MIT-licensed and built on Tauri. Audit it, fork it, ship it. Updates arrive automatically.",
  },
];

/// Feature grid summarizing the product's value points.
export default function Features() {
  return (
    <section className="bg-stone-950 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-stone-50">
          Built for fast, private dictation
        </h2>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-stone-800 bg-stone-900 p-6 transition hover:border-emerald-700/60 hover:bg-stone-800/60"
            >
              <h3 className="text-lg font-semibold text-stone-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
