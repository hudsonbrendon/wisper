/// Simple, original stylized marks used only to dress the onboarding practice
/// mock so it reads like "an AI chat" or "an email app". These are generic
/// geometric icons (a brand-evoking color + a plain shape), NOT reproductions
/// of any company's actual logo.

/// The Wisper app logo stacked over its wordmark — the speech-bubble mark
/// above the "Wisper" name. Used on the onboarding welcome/login steps and the
/// signed-out Account hero so they share one brand treatment.
export function WisperLogoStack({ className = "" }: { className?: string }) {
  return (
    <div className={"flex flex-col items-center " + className}>
      <img src="/logo.png" alt="" className="mb-3 h-20 w-20" />
      <span className="text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        Wisper
      </span>
    </div>
  );
}

// The Google "G", rendered in solid white for use on a dark CTA button.
export function GoogleG({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#fff" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
      <path fill="#fff" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
      <path fill="#fff" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
      <path fill="#fff" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
    </svg>
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
