import type { MacArch, OS } from "../lib/os";
import DownloadButton from "./DownloadButton";

/// Above-the-fold hero: brand, value proposition, and the smart download CTA,
/// over a dark stone gradient with an emerald glow.
export default function Hero({ os, macArch }: { os: OS; macArch: MacArch }) {
  return (
    <header className="relative overflow-hidden bg-stone-950">
      {/* Emerald radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-10rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl"
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 pb-24 pt-20 text-center">
        <img
          src="/openwispr/logo.png"
          alt="OpenWispr"
          className="mb-8 h-20 w-20 rounded-2xl shadow-xl"
        />
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-stone-700 bg-stone-900 px-3 py-1 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          100% local · free &amp; open source
        </span>
        <h1 className="text-balance text-5xl font-bold tracking-tight text-stone-50 sm:text-6xl">
          Your voice, typed{" "}
          <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
            everywhere.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-stone-300">
          OpenWispr is a private voice dictation app. Press a hotkey, speak, and
          your words land in any app — transcribed on-device, never in the
          cloud.
        </p>
        <div className="mt-10">
          <DownloadButton os={os} macArch={macArch} />
        </div>
      </div>
    </header>
  );
}
