/// Build a Tauri global-shortcut accelerator string from a keydown event.
/// Returns null while only modifier keys are held (combo not complete yet).
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = code.slice(6);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  else if (code === "Enter" || code === "NumpadEnter") key = "Enter";
  else if (code === "Tab") key = "Tab";
  else if (code === "ArrowUp") key = "Up";
  else if (code === "ArrowDown") key = "Down";
  else if (code === "ArrowLeft") key = "Left";
  else if (code === "ArrowRight") key = "Right";
  // Fallback for other layouts (e.g. ABNT): use the printable character.
  else if (e.key.length === 1 && e.key !== " ") key = e.key.toUpperCase();

  if (!key) return null; // only modifiers down so far
  return [...mods, key].join("+");
}
