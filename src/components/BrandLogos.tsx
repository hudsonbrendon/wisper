/// Simple, original stylized marks used only to dress the onboarding practice
/// mock so it reads like "an AI chat" or "an email app". These are generic
/// geometric icons (a brand-evoking color + a plain shape), NOT reproductions
/// of any company's actual logo.

/// The Wisper waveform mark — the same glyph shown at the top of the sidebar.
export function WisperMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="4" y1="14" x2="4" y2="10" />
      <line x1="9" y1="19" x2="9" y2="5" />
      <line x1="14" y1="16" x2="14" y2="8" />
      <line x1="19" y1="14" x2="19" y2="10" />
    </svg>
  );
}

/// The Wisper brand lockup (waveform mark + wordmark), matching the sidebar.
export function WisperBrand({
  markClassName = "h-8 w-8",
  textClassName = "text-2xl",
  className = "",
}: {
  markClassName?: string;
  textClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={
        "flex items-center gap-2.5 text-stone-900 dark:text-stone-100 " +
        className
      }
    >
      <WisperMark className={markClassName} />
      <span className={"font-semibold tracking-tight " + textClassName}>
        Wisper
      </span>
    </div>
  );
}

export function ChatGptMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#10A37F" />
      <g
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 9.5a3 3 0 0 1 5.2-2" />
        <path d="M16 14.5a3 3 0 0 1-5.2 2" />
        <path d="M9 12l3 1.7 3-1.7v-3.4L12 7 9 8.6z" />
      </g>
    </svg>
  );
}

export function ClaudeMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#D97757" />
      <g stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
        <line x1="12" y1="6" x2="12" y2="18" />
        <line x1="6.8" y1="9" x2="17.2" y2="15" />
        <line x1="6.8" y1="15" x2="17.2" y2="9" />
      </g>
    </svg>
  );
}

export function GmailMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#fff" stroke="#E8EAED" />
      <path
        d="M5 8.5v8h2.2v-5.3L12 14l4.8-3.8V16.5H19v-8L12 13.2z"
        fill="#EA4335"
      />
    </svg>
  );
}
