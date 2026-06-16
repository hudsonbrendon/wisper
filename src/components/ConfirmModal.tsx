import { useI18n } from "../lib/i18n";

export type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
};

/// A small centered confirmation dialog. Controlled: pass `opts` to open it,
/// `onClose` clears it. Clicking the backdrop or Cancel dismisses without acting.
export default function ConfirmModal({
  opts,
  onClose,
}: {
  opts: ConfirmOpts | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!opts) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-stone-900">{opts.title}</h3>
        <p className="mt-2 text-sm text-stone-600">{opts.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            {t("btn.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              opts.onConfirm();
              onClose();
            }}
            className={
              "rounded-lg px-4 py-2 text-sm font-medium text-white " +
              (opts.danger
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-stone-900 hover:bg-stone-800")
            }
          >
            {opts.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
