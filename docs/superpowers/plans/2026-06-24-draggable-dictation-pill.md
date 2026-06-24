# Draggable Dictation Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag the dictation/transcription pill (the floating "overlay" window) anywhere on screen and have it stay there, exactly like the meeting-recording bubble.

**Architecture:** The pill lives in the `overlay` webview window — a transparent, always-on-top, non-activating macOS NSPanel that is positioned bottom-center by Rust on every show. We make the visible pill a `data-tauri-drag-region` (native window dragging, same mechanism the `meeting-bubble` already uses), persist the dragged window position to config, and restore it on show (clamped on-screen) instead of always re-centering.

**Tech Stack:** Tauri 2 (webview windows, `data-tauri-drag-region`, `core:window:allow-start-dragging`, `WindowEvent::Moved`, NSPanel), Rust, React/TypeScript, TOML config, serde.

## Global Constraints

- The `overlay` window is a **non-activating NSPanel** (`convert_overlay_to_panel` in `src-tauri/src/lib.rs`). Dragging must NOT make the app activate/steal key focus; the pill must keep working without taking focus from the app the user is dictating into.
- The pill must stay **click-through outside its interactive band** — the existing `update_overlay_clickthrough` / `cursor_over_pill` / `point_in_band` machinery (driven by live `outer_position()`) must keep working after a drag. Do not change it; it already follows the window.
- The interactive buttons on the pill (mic, language, cancel, stop) must stay clickable. Only non-button areas drag — the same pattern already proven on `meeting-bubble` (`src/routes/MeetingBubble.tsx`): the drag region is the container; interactive children keep pointer events, decorative children are `pointer-events-none`.
- Capability is already in place: `src-tauri/capabilities/default.json` lists `"overlay"` in `windows` and grants `core:window:allow-start-dragging`. Do not remove or duplicate these.
- Positions are stored and compared in **physical pixels** (Tauri `outer_position()` / `WindowEvent::Moved(PhysicalPosition)` are physical px). `bottom_center`/`top_center`/`clamp_to_monitor` all take physical px.
- Rust: `cargo fmt` clean, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` clean. Frontend: `pnpm lint`, `pnpm typecheck`, `pnpm test` clean. (CI enforces all of these; the Rust job runs on Linux, so keep new code OS-agnostic or behind existing `#[cfg(...)]` gates — the pure helpers here are OS-agnostic.)
- Config struct changes must be backward compatible: every new field uses `#[serde(default)]` so existing `config.toml` files keep loading.

---

## File Structure

- `src-tauri/src/overlay.rs` — pure geometry helpers (`bottom_center`, `top_center`, `point_in_band`). **Add** `clamp_to_monitor`. Unit-tested, no OS calls.
- `src-tauri/src/config.rs` — the `Config` struct + TOML (de)serialization. **Add** `overlay_x`/`overlay_y` optional fields.
- `src-tauri/src/lib.rs` — overlay window lifecycle. **Modify** `place_and_show_overlay` to restore a saved position; **add** an overlay `WindowEvent::Moved` handler that debounce-persists the position.
- `src/routes/Overlay.tsx` — the pill React component. **Modify** the pill `shell` to be a drag region and mark decorative children `pointer-events-none`.

No new files. Each task below ends with an independently testable deliverable.

---

### Task 1: `clamp_to_monitor` geometry helper

Keeps a saved or dragged window position fully on-screen (within the monitor minus a margin), so a stale saved position (resolution change, unplugged monitor) can never strand the pill off-screen.

**Files:**

- Modify: `src-tauri/src/overlay.rs` (add function after `top_center`, ~line 41; add tests into the existing `#[cfg(test)] mod tests` at line 63)

**Interfaces:**

- Consumes: nothing.
- Produces: `pub fn clamp_to_monitor(pos: (i32, i32), win: (u32, u32), mon_pos: (i32, i32), mon_size: (u32, u32), margin: i32) -> (i32, i32)` — clamps `pos` (window top-left) so the `win`-sized window stays within the monitor at `mon_pos`/`mon_size`, keeping `margin` px from each edge. Used by Task 4.

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block in `src-tauri/src/overlay.rs` (just before its closing `}`):

```rust
    #[test]
    fn clamp_keeps_an_inside_position_unchanged() {
        assert_eq!(
            clamp_to_monitor((500, 500), (360, 340), (0, 0), (1920, 1080), 20),
            (500, 500)
        );
    }

    #[test]
    fn clamp_pulls_back_a_position_off_the_right_and_bottom() {
        // x past the right edge clamps to 1920-360-20; y past the bottom to 1080-340-20.
        assert_eq!(
            clamp_to_monitor((5000, 5000), (360, 340), (0, 0), (1920, 1080), 20),
            (1540, 720)
        );
    }

    #[test]
    fn clamp_pulls_back_a_negative_position_to_the_margin() {
        assert_eq!(
            clamp_to_monitor((-300, -50), (360, 340), (0, 0), (1920, 1080), 20),
            (20, 20)
        );
    }

    #[test]
    fn clamp_respects_a_monitor_origin_offset() {
        // Second monitor starts at x=1920; a far-left position clamps to its left margin.
        assert_eq!(
            clamp_to_monitor((0, 100), (360, 340), (1920, 0), (1280, 1024), 20),
            (1940, 100)
        );
    }

    #[test]
    fn clamp_top_left_aligns_when_window_bigger_than_monitor() {
        // max bound would fall below min; min (top-left + margin) must win.
        assert_eq!(
            clamp_to_monitor((9999, 9999), (2000, 2000), (0, 0), (1920, 1080), 20),
            (20, 20)
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib overlay::tests::clamp`
Expected: FAIL — `cannot find function clamp_to_monitor in this scope`.

- [ ] **Step 3: Implement `clamp_to_monitor`**

Add to `src-tauri/src/overlay.rs` immediately after the `top_center` function (before `point_in_band`):

```rust
/// Clamp a window's top-left `pos` (physical px) so the whole `win`-sized window
/// stays within the monitor at `mon_pos`/`mon_size`, keeping `margin` px from
/// each edge. If the window is larger than the monitor the top-left margin wins
/// (so it can't be pushed off the top-left while trying to fit the bottom-right).
pub fn clamp_to_monitor(
    pos: (i32, i32),
    win: (u32, u32),
    mon_pos: (i32, i32),
    mon_size: (u32, u32),
    margin: i32,
) -> (i32, i32) {
    let (px, py) = pos;
    let (ww, wh) = (win.0 as i32, win.1 as i32);
    let (mx, my) = mon_pos;
    let (mw, mh) = (mon_size.0 as i32, mon_size.1 as i32);

    let min_x = mx + margin;
    let max_x = (mx + mw - ww - margin).max(min_x);
    let min_y = my + margin;
    let max_y = (my + mh - wh - margin).max(min_y);

    (px.clamp(min_x, max_x), py.clamp(min_y, max_y))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib overlay::tests::clamp`
Expected: PASS (5 tests).

- [ ] **Step 5: Format, lint, commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add src-tauri/src/overlay.rs
git commit -m "feat(overlay): add clamp_to_monitor geometry helper"
```

---

### Task 2: Persisted overlay position fields in `Config`

Add the storage for the dragged position. Backward compatible: old config files load with both fields `None`.

**Files:**

- Modify: `src-tauri/src/config.rs` (struct ~line 19-57; `Default` impl ~line 71-99; tests `mod tests` at line 136)

**Interfaces:**

- Consumes: nothing.
- Produces: `Config.overlay_x: Option<i32>` and `Config.overlay_y: Option<i32>` (physical px, window top-left). Read/written by Task 4. `None` means "not yet dragged → anchor bottom-center".

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `src-tauri/src/config.rs` (before its closing `}`):

```rust
    #[test]
    fn overlay_position_roundtrips_and_defaults_to_none() {
        // A fresh config has no saved pill position.
        let mut cfg = Config::default();
        assert_eq!(cfg.overlay_x, None);
        assert_eq!(cfg.overlay_y, None);

        // Set + round-trip through TOML.
        cfg.overlay_x = Some(640);
        cfg.overlay_y = Some(480);
        let back = Config::from_toml(&cfg.to_toml().unwrap());
        assert_eq!(back.overlay_x, Some(640));
        assert_eq!(back.overlay_y, Some(480));

        // An old config that predates the fields still parses, with None.
        let legacy = Config::from_toml("hotkey = \"Alt+Space\"\nmodel_id = \"base\"\nlanguage = \"auto\"\ninject_method = \"paste\"");
        assert_eq!(legacy.overlay_x, None);
        assert_eq!(legacy.overlay_y, None);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib config::tests::overlay_position`
Expected: FAIL — `no field overlay_x on type Config`.

- [ ] **Step 3: Add the fields to the struct**

In `src-tauri/src/config.rs`, add these fields to `struct Config` immediately after the `ui_language` field (keep them the last fields, before the closing `}`):

```rust
    /// Saved top-left position (physical px) of the dictation pill window, set
    /// when the user drags it. `None` until the first drag, in which case the
    /// pill is anchored bottom-center on show. `serde(default)` keeps older
    /// config files (without these keys) loadable.
    #[serde(default)]
    pub overlay_x: Option<i32>,
    #[serde(default)]
    pub overlay_y: Option<i32>,
```

- [ ] **Step 4: Add the fields to the `Default` impl**

In the `impl Default for Config`, add to the returned `Config { ... }` literal immediately after `ui_language: "en".to_string(),`:

```rust
            overlay_x: None,
            overlay_y: None,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib config::tests::overlay_position`
Expected: PASS.

- [ ] **Step 6: Format, lint, commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add src-tauri/src/config.rs
git commit -m "feat(config): persist dragged dictation-pill position"
```

---

### Task 3: Make the pill draggable (frontend)

Turn the visible pill into a native drag region, exactly like the meeting bubble. This is a frontend-only change; verification is on-device because the overlay is an NSPanel.

**Files:**

- Modify: `src/routes/Overlay.tsx` (the `shell` string ~line 132 and the decorative children inside the returned JSX)
- Reference (already-working pattern): `src/routes/MeetingBubble.tsx` (`data-tauri-drag-region` + `pointer-events-none` decorative children)

**Interfaces:**

- Consumes: capability `core:window:allow-start-dragging` for the `overlay` window (already present in `src-tauri/capabilities/default.json`).
- Produces: a pill whose non-button surface drags the window. Task 4 persists the resulting position.

- [ ] **Step 1: Add the drag-region attribute to the pill shell**

In `src/routes/Overlay.tsx`, the pill is rendered by a `div` with `className={shell}` in two places (the `error` early-return and the main return). Add `data-tauri-drag-region` to BOTH.

Find (error branch):

```tsx
<div className={wrapper}>
  <div className={shell}>
    <span className="h-3 w-3 shrink-0 rounded-full bg-rose-500" />
    <span className="max-w-[260px] text-sm text-rose-300">{error}</span>
  </div>
</div>
```

Replace with:

```tsx
<div className={wrapper}>
  <div className={shell} data-tauri-drag-region>
    <span className="pointer-events-none h-3 w-3 shrink-0 rounded-full bg-rose-500" />
    <span className="pointer-events-none max-w-[260px] text-sm text-rose-300">
      {error}
    </span>
  </div>
</div>
```

Find (main branch):

```tsx
      <div className={shell}>
        {state === "idle" && (
```

Replace with:

```tsx
      <div className={shell} data-tauri-drag-region>
        {state === "idle" && (
```

- [ ] **Step 2: Mark the recording-state decorative children non-interactive**

So a mousedown on the meter/timer drags (instead of being swallowed), mark the non-button children inside the `state === "recording"` block `pointer-events-none`. The Cancel and Stop `<button>`s keep their default pointer events (they stay clickable and do NOT start a drag, exactly like the bubble's Stop button).

Find:

```tsx
            <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${meterWidth}%` }}
              />
            </div>
            <span className="w-10 text-xs tabular-nums text-zinc-300">
              {mmss}
            </span>
```

Replace with:

```tsx
            <div className="pointer-events-none h-2 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${meterWidth}%` }}
              />
            </div>
            <span className="pointer-events-none w-10 text-xs tabular-nums text-zinc-300">
              {mmss}
            </span>
```

Leave the `transcribing` / `injecting` `<span>`s as-is — they are inside the drag-region `shell` and already non-interactive (plain text), so they drag fine.

Do NOT add `pointer-events-none` to any `<button>` (mic, language `▾`, cancel `X`, stop) — they must remain clickable.

- [ ] **Step 3: Verify the frontend builds clean**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: ESLint "No issues found"; `tsc --noEmit` exits 0; all tests pass (no test file targets `Overlay.tsx`, so the suite count is unchanged).

- [ ] **Step 4: Build, install, verify the drag on-device (NSPanel gate)**

This is the critical verification: the overlay is a non-activating NSPanel, and `startDragging` (what `data-tauri-drag-region` calls) must move it without activating the app.

Run (signing env per the project's standard release build):

```bash
KC="$HOME/Library/Keychains/openwispr-signing.keychain-db"
security unlock-keychain -p openwispr-ci "$KC"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k openwispr-ci "$KC" >/dev/null 2>&1
export APPLE_SIGNING_IDENTITY="OpenWispr Dev"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/openwispr-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='OpenWispr-OTA-2026'
pnpm tauri build
osascript -e 'quit app "Wisper"' 2>/dev/null; sleep 1
rm -rf /Applications/Wisper.app
cp -R src-tauri/target/release/bundle/macos/Wisper.app /Applications/Wisper.app
open /Applications/Wisper.app
```

Manually verify ALL of these (the pill is visible when "Show pill" is on; otherwise start a dictation to show it):

1. Press-and-drag the pill body (the padding/gaps, not a button) → the pill follows the cursor and stays where dropped.
2. Clicking the mic / language `▾` / (while recording) Cancel / Stop buttons still fires their action and does NOT drag.
3. While dragging, the app you were focused on stays frontmost (the pill does not steal focus / does not activate Wisper).
4. After moving the pill, the language `▾` menu still opens and the buttons still respond at the new location (click-through band followed the window).

If step 1 fails (the panel does not move): the NSPanel does not honor `startDragging`. Fallback (implement instead of `data-tauri-drag-region`): add a Rust command `#[tauri::command] fn move_overlay(app: AppHandle, dx: i32, dy: i32)` that reads `overlay.outer_position()` and `overlay.set_position(PhysicalPosition::new(x+dx, y+dy))`, register it in `invoke_handler`, and in `Overlay.tsx` track `mousedown`→`mousemove`→`mouseup` on the `shell` (using `e.movementX/Y` times `window.devicePixelRatio`) to call it; keep `pointer-events-none` on decorative children and nothing on buttons. Then re-run this step. Record in the progress ledger which mechanism shipped, because Task 4's persistence reads `outer_position()` either way and is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/routes/Overlay.tsx
git commit -m "feat(overlay): make the dictation pill draggable"
```

---

### Task 4: Persist the dragged position and restore it on show

Save the window position when the user drags it (debounced), and restore it (clamped on-screen) instead of always re-centering. After this task the pill stays where the user left it across dictations and app restarts.

**Files:**

- Modify: `src-tauri/src/lib.rs` — `place_and_show_overlay` (~line 509-538); add a `WindowEvent::Moved` handler for the overlay in the `setup` block near the existing `main.on_window_event(...)` (~line 1093); add a module-level debounce helper + static.

**Interfaces:**

- Consumes: `overlay::clamp_to_monitor` (Task 1); `Config.overlay_x`/`overlay_y` (Task 2); `config::save(&config_dir, &cfg)` (existing, `src-tauri/src/config.rs:129`); `AppState.config` and `AppState.config_dir` (existing).
- Produces: persisted pill position; no new public function consumed by later tasks (final task).

- [ ] **Step 1: Restore the saved position in `place_and_show_overlay`**

In `src-tauri/src/lib.rs`, replace the body of `place_and_show_overlay` (the function starting at ~line 509) with the version below. The change: if config holds a saved `(overlay_x, overlay_y)`, clamp it to the current monitor and use it; otherwise fall back to the existing bottom-center anchor.

```rust
/// Anchor the pill at its saved position (clamped on-screen) if the user has
/// dragged it, else bottom-center above the Dock/taskbar, then show it.
fn place_and_show_overlay(app: &tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let monitor = overlay
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| overlay.primary_monitor().ok().flatten());
        if let Some(mon) = monitor {
            let pos = mon.position();
            let size = mon.size();
            let win = overlay
                .outer_size()
                .unwrap_or(tauri::PhysicalSize::new(360, 340));

            let saved = {
                let cfg = app.state::<AppState>().config.lock().unwrap();
                cfg.overlay_x.zip(cfg.overlay_y)
            };
            let (x, y) = match saved {
                // Keep a previously-dragged position visible on the current
                // monitor (guards against resolution changes / unplugged displays).
                Some((sx, sy)) => overlay::clamp_to_monitor(
                    (sx, sy),
                    (win.width, win.height),
                    (pos.x, pos.y),
                    (size.width, size.height),
                    16,
                ),
                None => overlay::bottom_center(
                    (pos.x, pos.y),
                    (size.width, size.height),
                    (win.width, win.height),
                    90,
                ),
            };
            let _ = overlay.set_position(tauri::PhysicalPosition::new(x, y));
        }
        // Only pin it on screen if the user wants the pill always visible;
        // otherwise it stays hidden until dictation starts (see `transition`).
        if app.state::<AppState>().config.lock().unwrap().show_pill {
            let _ = overlay.show();
        } else {
            let _ = overlay.hide();
        }
    }
}
```

- [ ] **Step 2: Add the debounced position-persist helper**

Add this near `place_and_show_overlay` in `src-tauri/src/lib.rs` (top-level items). It debounces so a drag (many `Moved` events) results in a single config write 400 ms after the user stops moving.

```rust
/// Generation counter for debounced overlay-position saves: each `Moved` bumps
/// it; a save only lands if its generation is still current after the delay.
static OVERLAY_MOVE_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Persist the pill's new top-left (physical px) to config, debounced 400 ms so
/// a drag writes once. Called from the overlay's `WindowEvent::Moved` handler.
fn persist_overlay_position(app: &tauri::AppHandle, x: i32, y: i32) {
    let gen = OVERLAY_MOVE_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        // A newer move superseded this one — let that one write instead.
        if OVERLAY_MOVE_GEN.load(std::sync::atomic::Ordering::SeqCst) != gen {
            return;
        }
        let state = app.state::<AppState>();
        let config_dir = state.config_dir.clone();
        let cfg = {
            let mut cfg = state.config.lock().unwrap();
            cfg.overlay_x = Some(x);
            cfg.overlay_y = Some(y);
            cfg.clone()
        };
        if let Err(e) = crate::config::save(&config_dir, &cfg) {
            eprintln!("persist overlay position: {e}");
        }
    });
}
```

Note: `Config` already derives `Clone` (it is cloned elsewhere, e.g. in `save_config`), so `cfg.clone()` compiles.

- [ ] **Step 3: Wire the overlay `Moved` handler in `setup`**

In `src-tauri/src/lib.rs`, find the `setup` block where the main window's events are wired (the `main.on_window_event(move |event| match event { ... })` around line 1093). Immediately after that block (still inside `setup`, where `handle`/`app` is available — use the same handle variable the surrounding code uses to fetch windows, e.g. `handle`), add:

```rust
                if let Some(overlay) = handle.get_webview_window("overlay") {
                    let app_for_move = handle.clone();
                    overlay.on_window_event(move |event| {
                        if let tauri::WindowEvent::Moved(pos) = event {
                            persist_overlay_position(&app_for_move, pos.x, pos.y);
                        }
                    });
                }
```

If the surrounding code uses a different handle name than `handle` (confirm by reading lines ~1085-1110 first), use that name. `WindowEvent::Moved` carries a `tauri::PhysicalPosition<i32>`, so `pos.x`/`pos.y` are `i32` — no conversion needed.

- [ ] **Step 4: Verify it compiles, formats and lints clean**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: build + clippy clean (only the pre-existing unrelated `block v0.1.6` future-incompat note is allowed); all lib tests pass.

- [ ] **Step 5: Build, install, verify persistence on-device**

Build + install with the same signed-build commands as Task 3 Step 4, then verify:

1. Drag the pill to a new spot, wait ~1 s.
2. Do a dictation (hotkey) so the overlay hides + reshows → the pill reappears at the dragged spot, not bottom-center.
3. Fully quit Wisper (tray → Quit) and reopen → the pill is still at the dragged spot.
4. Inspect the saved value: `grep overlay_ "$HOME/Library/Application Support/chat.wisper/config.toml"` (config dir is the app config dir; adjust if your install differs) shows `overlay_x`/`overlay_y` matching where you dropped it.
5. Sanity: with no prior drag (fresh config — temporarily `rm` the config or test on a clean profile), the pill still anchors bottom-center.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(overlay): persist and restore the dragged pill position"
```

---

## Self-Review

**1. Spec coverage** — the spec is one sentence: "drag the dictation/transcription pill anywhere, like the meeting bubble."

- Drag the pill like the bubble → Task 3 (`data-tauri-drag-region`, same mechanism as `MeetingBubble.tsx`, buttons stay clickable). ✅
- "Anywhere you want" / it stays there → Task 4 (persist on `Moved`, restore on show). ✅
- Don't strand it off-screen → Task 1 (`clamp_to_monitor`) used in Task 4. ✅
- Storage for the position → Task 2 (config fields). ✅
- No gaps.

**2. Placeholder scan** — no "TBD/handle edge cases/similar to Task N". Each code step shows full code. The Task 3 NSPanel fallback is fully specified (command + JS approach), not a placeholder. ✅

**3. Type consistency** — `clamp_to_monitor(pos,(u32,u32),...)` returns `(i32,i32)`; Task 4 calls it with `(win.width, win.height)` (`u32` from `PhysicalSize`) and physical-px monitor/position tuples, assigns to `(x, y): i32` passed to `PhysicalPosition::new` — consistent. `Config.overlay_x/overlay_y: Option<i32>` written from `WindowEvent::Moved(PhysicalPosition<i32>)` and read via `cfg.overlay_x.zip(cfg.overlay_y) -> Option<(i32,i32)>` — consistent. `config::save(&Path, &Config)` matches the existing signature. ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-24-draggable-dictation-pill.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
