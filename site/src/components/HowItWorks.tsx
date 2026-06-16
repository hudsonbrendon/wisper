const STEPS = [
  {
    n: "1",
    title: "Press your hotkey",
    body: "A floating pill appears above your taskbar and starts listening.",
  },
  {
    n: "2",
    title: "Speak naturally",
    body: "Watch the live audio meter. Click to stop, or release the hotkey.",
  },
  {
    n: "3",
    title: "Text appears",
    body: "Your words are transcribed on-device and typed into the active app.",
  },
];

/// Three-step explanation strip.
export default function HowItWorks() {
  return (
    <section className="border-y border-stone-800 bg-stone-900 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-stone-50">
          How it works
        </h2>
        <div className="mt-14 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
                {s.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-stone-100">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
