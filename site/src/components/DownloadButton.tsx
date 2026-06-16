import type { MacArch, OS } from "../lib/os";
import { allDownloads, pickPrimary } from "../lib/releases";

/// OS-aware download CTA. The primary button reflects the detected platform;
/// a static list below offers every platform for manual selection.
export default function DownloadButton({
  os,
  macArch,
}: {
  os: OS;
  macArch: MacArch;
}) {
  const primary = pickPrimary(os, macArch);
  const all = allDownloads();

  return (
    <div className="flex flex-col items-center gap-4">
      <a
        href={primary.url}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:bg-emerald-500"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {primary.label}
      </a>

      <details className="group text-center">
        <summary className="cursor-pointer list-none text-sm text-stone-400 underline-offset-4 hover:text-stone-200 hover:underline">
          All platforms &amp; versions
        </summary>
        <ul className="mt-3 flex flex-col items-center gap-1.5">
          {all.map((d) => (
            <li key={d.url}>
              <a
                href={d.url}
                className="text-sm text-stone-300 transition hover:text-emerald-400"
              >
                {d.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
