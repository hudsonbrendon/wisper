/// A six-dot grip that is the ONLY draggable region of a floating pill window.
/// It carries `data-tauri-drag-region` and the grab cursor, so a drag (and the
/// hand cursor) only start over the dots — never the rest of the pill, so the
/// dots can't be confused with the pill's buttons. The inner SVG is
/// `pointer-events-none` so the mousedown lands on this span (the drag region),
/// not the SVG. Pass `className` for color (e.g. "text-zinc-500").
export default function DragHandle({ className = "" }: { className?: string }) {
  return (
    <span
      data-tauri-drag-region
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
