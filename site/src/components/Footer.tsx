import { REPO } from "../lib/releases";

/// Site footer with project links.
export default function Footer() {
  return (
    <footer className="bg-stone-950 py-12">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 text-center">
        <img
          src="/openwispr/logo.png"
          alt="OpenWispr"
          className="h-10 w-10 rounded-xl"
        />
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-stone-400">
          <a
            href={`https://github.com/${REPO}`}
            className="transition hover:text-emerald-400"
          >
            GitHub
          </a>
          <a
            href={`https://github.com/${REPO}/releases`}
            className="transition hover:text-emerald-400"
          >
            Releases
          </a>
          <a
            href={`https://github.com/${REPO}/blob/main/LICENSE`}
            className="transition hover:text-emerald-400"
          >
            License
          </a>
        </nav>
        <p className="text-xs text-stone-600">
          MIT-licensed · built with Tauri &amp; Whisper
        </p>
      </div>
    </footer>
  );
}
