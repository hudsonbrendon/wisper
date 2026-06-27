import { useEffect, useRef, useState } from "react";
import {
  getConfig,
  saveConfig,
  listModels,
  downloadModel,
  onEvent,
  type Config,
  type ModelMeta,
} from "../lib/api";
import { eventToAccelerator } from "../lib/hotkey";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/authContext";
import {
  ChatGptMark,
  ClaudeMark,
  GmailMark,
  WisperLogoStack,
  GoogleG,
} from "../components/BrandLogos";

type StepId = "welcome" | "login" | "hotkey" | "model" | "practice" | "done";
const STEPS: StepId[] = [
  "welcome",
  "login",
  "hotkey",
  "model",
  "practice",
  "done",
];

/// First-run tutorial. Shown over the dashboard until the user finishes (or
/// skips), which persists `onboarded: true`. Re-openable from Settings.
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { user, loading: authLoading, signIn } = useAuth();
  const [config, setConfig] = useState<Config | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  const finish = () => {
    if (config) void saveConfig({ ...config, onboarded: true });
    onDone();
  };

  const next = () => {
    if (stepIdx >= STEPS.length - 1) finish();
    else setStepIdx((i) => i + 1);
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-100/95 p-6 backdrop-blur">
      <div className="flex h-[560px] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xl">
        {/* Progress */}
        <div className="flex items-center justify-between px-8 pt-6">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={
                  "h-1.5 rounded-full transition-all " +
                  (i === stepIdx
                    ? "w-6 bg-stone-900 dark:bg-stone-100"
                    : i < stepIdx
                      ? "w-3 bg-stone-400 dark:bg-stone-600"
                      : "w-3 bg-stone-200 dark:bg-stone-700")
                }
              />
            ))}
          </div>
          {step !== "done" && step !== "login" && (
            <button
              type="button"
              onClick={finish}
              className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600"
            >
              {t("onboarding.skip")}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {step === "welcome" && <Welcome />}
          {step === "login" && (
            <LoginStep user={!!user} loading={authLoading} signIn={signIn} />
          )}
          {step === "hotkey" && config && (
            <HotkeyStep config={config} onChange={setConfig} />
          )}
          {step === "model" && <ModelStep />}
          {step === "practice" && config && (
            <PracticeStep hotkey={config.hotkey} />
          )}
          {step === "done" && <Done />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-100 dark:border-stone-800 px-8 py-4">
          <button
            type="button"
            onClick={back}
            disabled={stepIdx === 0}
            className="rounded-lg px-3 py-2 text-sm text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-0"
          >
            {t("onboarding.back")}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={step === "login" && !user}
            className="rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            {step === "done" ? t("onboarding.finish") : t("onboarding.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Welcome() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <WisperLogoStack className="mb-6" />
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {t("onboarding.welcome.title")}
      </h1>
      <p className="mt-3 max-w-md text-sm text-stone-500 dark:text-stone-400">
        {t("onboarding.welcome.body")}
      </p>
    </div>
  );
}

function HotkeyStep({
  config,
  onChange,
}: {
  config: Config;
  onChange: (c: Config) => void;
}) {
  const { t } = useI18n();
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      const accel = eventToAccelerator(e);
      if (accel) {
        setCapturing(false);
        const next = { ...config, hotkey: accel };
        onChange(next);
        void saveConfig(next).catch(() => {});
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing, config, onChange]);

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
        {t("onboarding.hotkey.title")}
      </h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        {t("onboarding.hotkey.body")}
      </p>

      <button
        type="button"
        onClick={() => setCapturing((c) => !c)}
        className={
          "mt-5 w-full rounded-xl border px-4 py-3 text-center font-mono text-sm transition-colors " +
          (capturing
            ? "border-stone-400 bg-stone-900 text-white ring-2 ring-stone-200 dark:bg-stone-100 dark:text-stone-900 dark:ring-stone-700"
            : "border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-50")
        }
      >
        {capturing ? t("onboarding.hotkey.press") : config.hotkey}
      </button>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-stone-50 dark:bg-stone-900 p-4">
          <div className="text-sm font-medium text-stone-800 dark:text-stone-200">
            {t("onboarding.hotkey.hold")}
          </div>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {t("onboarding.hotkey.holdBody")}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 dark:bg-stone-900 p-4">
          <div className="text-sm font-medium text-stone-800 dark:text-stone-200">
            {t("onboarding.hotkey.double")}
          </div>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {t("onboarding.hotkey.doubleBody")}
          </p>
        </div>
      </div>
    </div>
  );
}

function ModelStep() {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    listModels().then(setModels);
    const unProg = onEvent<{ id: string; received: number; total: number }>(
      "download_progress",
      (p) => setPct(p.total > 0 ? Math.round((p.received / p.total) * 100) : 0),
    );
    const unReady = onEvent<{ id: string }>("model_ready", () => {
      setPct(null);
      listModels().then(setModels);
    });
    return () => {
      unProg.then((f) => f());
      unReady.then((f) => f());
    };
  }, []);

  const hasModel = models.some((m) => m.downloaded);

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
        {t("onboarding.model.title")}
      </h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        {t("onboarding.model.body")}
      </p>

      {hasModel ? (
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          ✓ {t("onboarding.model.ready")}
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-stone-200 dark:border-stone-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-stone-800 dark:text-stone-200">
                base · {t("settings.multilingual")}
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                ~142 MB
              </div>
            </div>
            <button
              type="button"
              disabled={pct !== null}
              onClick={() => {
                setPct(0);
                downloadModel("base").catch(() => setPct(null));
              }}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 disabled:opacity-50"
            >
              {pct === null
                ? t("btn.download")
                : t("settings.downloading", { pct })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const PRACTICE_APPS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    Mark: ChatGptMark,
    placeholder: "Message ChatGPT…",
  },
  {
    id: "claude",
    name: "Claude",
    Mark: ClaudeMark,
    placeholder: "Reply to Claude…",
  },
  {
    id: "gmail",
    name: "Gmail",
    Mark: GmailMark,
    placeholder: "Compose an email…",
  },
] as const;

function PracticeStep({ hotkey }: { hotkey: string }) {
  const { t } = useI18n();
  const [app, setApp] =
    useState<(typeof PRACTICE_APPS)[number]["id"]>("chatgpt");
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const active = PRACTICE_APPS.find((a) => a.id === app)!;
  const done = text.trim().length > 0;

  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
        {t("onboarding.practice.title")}
      </h2>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        {t("onboarding.practice.body", { hotkey })}
      </p>

      {/* App tabs */}
      <div className="mt-5 flex gap-2">
        {PRACTICE_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setApp(a.id);
              setTimeout(() => taRef.current?.focus(), 0);
            }}
            className={
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors " +
              (app === a.id
                ? "border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100"
                : "border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-50")
            }
          >
            <a.Mark className="h-4 w-4" />
            {a.name}
          </button>
        ))}
      </div>

      {/* Mock app surface */}
      <div className="mt-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
          <active.Mark className="h-4 w-4" />
          {active.name}
        </div>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={active.placeholder}
          rows={4}
          className="w-full resize-none rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200"
        />
        <div className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          {t("onboarding.practice.suggest")}
        </div>
      </div>

      {done ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          ✓ {t("onboarding.practice.success")}
        </div>
      ) : (
        <p className="mt-4 text-xs text-stone-400 dark:text-stone-500">
          {t("onboarding.practice.hint")}
        </p>
      )}
    </div>
  );
}

function Done() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-900 text-3xl text-white dark:bg-stone-100 dark:text-stone-900">
        ✓
      </div>
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {t("onboarding.done.title")}
      </h1>
      <p className="mt-3 max-w-md text-sm text-stone-500 dark:text-stone-400">
        {t("onboarding.done.body")}
      </p>
    </div>
  );
}

function LoginStep({
  user,
  loading,
  signIn,
}: {
  user: boolean;
  loading: boolean;
  signIn: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <WisperLogoStack className="mb-6" />
      <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
        {t("onboarding.login.title")}
      </h2>
      <p className="mt-2 max-w-md text-sm text-stone-500 dark:text-stone-400">
        {t("onboarding.login.body")}
      </p>
      {user ? (
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          ✓ {t("onboarding.login.signedIn")}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || loading}
          onClick={async () => {
            setBusy(true);
            try {
              await signIn();
            } catch {
              /* surfaced by the auth layer */
            } finally {
              setBusy(false);
            }
          }}
          className="mt-6 inline-flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-stone-900 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-50"
        >
          <GoogleG className="h-5 w-5" />
          {busy ? t("account.openingBrowser") : t("account.continueGoogle")}
        </button>
      )}
    </div>
  );
}
