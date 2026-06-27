import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";

/// A six-dot grip that is the ONLY draggable region of a floating pill window.
/// It drives the drag manually (pointer capture + `setPosition` following the
/// cursor) instead of relying on `data-tauri-drag-region` / native
/// `startDragging`, which does not move a non-activating NSPanel reliably on
/// recent macOS. The inner SVG is `pointer-events-none` so the pointerdown lands
/// on this span. Pass `className` for color (e.g. "text-zinc-500").
export default function DragHandle({ className = "" }: { className?: string }) {
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.screenX;
    const startY = e.screenY;
    const win = getCurrentWindow();

    // Window's logical top-left at drag start; the cursor delta is in logical
    // (CSS) points, so we can add it directly.
    let origin: { x: number; y: number } | null = null;
    void Promise.all([win.outerPosition(), win.scaleFactor()]).then(
      ([pos, sf]) => {
        const lp = pos.toLogical(sf);
        origin = { x: lp.x, y: lp.y };
      },
    );

    const onMove = (ev: PointerEvent) => {
      if (!origin) return;
      void win.setPosition(
        new LogicalPosition(
          origin.x + (ev.screenX - startX),
          origin.y + (ev.screenY - startY),
        ),
      );
    };
    const onUp = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return (
    <span
      onPointerDown={onPointerDown}
      className={
        "flex shrink-0 cursor-grab items-center active:cursor-grabbing " +
        className
      }
    >
      <svg
        className="pointer-events-none h-4 w-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <circle cx="9" cy="6" r="1.4" />
        <circle cx="15" cy="6" r="1.4" />
        <circle cx="9" cy="12" r="1.4" />
        <circle cx="15" cy="12" r="1.4" />
        <circle cx="9" cy="18" r="1.4" />
        <circle cx="15" cy="18" r="1.4" />
      </svg>
    </span>
  );
}
