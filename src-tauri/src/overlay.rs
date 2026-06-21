//! Geometry for the floating pill overlay. Pure — no Tauri/OS calls, so it is
//! unit-testable without a real screen.

/// Top-left position (physical px) to anchor a `win`-sized window at the
/// bottom-center of a monitor whose top-left is `mon_pos` and size is
/// `mon_size`, leaving `bottom_margin` px above the monitor's bottom edge
/// (room for the Dock / taskbar).
pub fn bottom_center(
    mon_pos: (i32, i32),
    mon_size: (u32, u32),
    win: (u32, u32),
    bottom_margin: i32,
) -> (i32, i32) {
    let (mx, my) = mon_pos;
    let (mw, mh) = (mon_size.0 as i32, mon_size.1 as i32);
    let (ww, wh) = (win.0 as i32, win.1 as i32);
    let x = mx + (mw - ww) / 2;
    let y = my + mh - wh - bottom_margin;
    (x, y)
}

/// Top-left position (physical px) to anchor a `win`-sized window at the
/// top-center of a monitor, `top_margin` px below the top edge (clear of the
/// menu bar / notch). Mirrors `bottom_center` for the meeting bubble, which sits
/// at the top so it never overlaps the dictation pill at the bottom.
pub fn top_center(
    mon_pos: (i32, i32),
    mon_size: (u32, u32),
    win: (u32, u32),
    top_margin: i32,
) -> (i32, i32) {
    let (mx, my) = mon_pos;
    let mw = mon_size.0 as i32;
    let ww = win.0 as i32;
    let x = mx + (mw - ww) / 2;
    let y = my + top_margin;
    (x, y)
}

/// Is `cursor` within the interactive band of the overlay window? The band is
/// the bottom `band` px of the window (its full width); when the menu is open
/// the caller passes the full window height so the whole window counts. All
/// coordinates are physical px: `win_pos` is the window's top-left, `win_size`
/// its size. Used to decide whether the click-through overlay should currently
/// capture the cursor (over the pill/menu) or pass it through (empty space).
pub fn point_in_band(
    cursor: (f64, f64),
    win_pos: (f64, f64),
    win_size: (f64, f64),
    band: f64,
) -> bool {
    let (cx, cy) = cursor;
    let (wx, wy) = win_pos;
    let (ww, wh) = win_size;
    let left = wx;
    let right = wx + ww;
    let bottom = wy + wh;
    let top = bottom - band.min(wh);
    cx >= left && cx <= right && cy >= top && cy <= bottom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_hits_bottom_strip_only() {
        let pos = (100.0, 200.0);
        let size = (360.0, 340.0);
        // Inside the bottom 104px band, horizontally centered.
        assert!(point_in_band((280.0, 500.0), pos, size, 104.0));
        // Same column but up in the empty area above the band.
        assert!(!point_in_band((280.0, 300.0), pos, size, 104.0));
        // Left of the window.
        assert!(!point_in_band((50.0, 520.0), pos, size, 104.0));
        // Right of the window.
        assert!(!point_in_band((500.0, 520.0), pos, size, 104.0));
    }

    #[test]
    fn full_height_band_covers_whole_window() {
        let pos = (0.0, 0.0);
        let size = (360.0, 340.0);
        // With band == window height the top is interactive too (menu open).
        assert!(point_in_band((180.0, 10.0), pos, size, 340.0));
        // A band taller than the window is clamped, not overflowing upward.
        assert!(!point_in_band((180.0, -5.0), pos, size, 999.0));
    }

    #[test]
    fn centers_horizontally_above_margin() {
        assert_eq!(
            bottom_center((0, 0), (1920, 1080), (360, 72), 90),
            ((1920 - 360) / 2, 1080 - 72 - 90)
        );
    }

    #[test]
    fn respects_monitor_offset() {
        assert_eq!(
            bottom_center((1920, 0), (1280, 1024), (360, 72), 90),
            (1920 + (1280 - 360) / 2, 1024 - 72 - 90)
        );
    }

    #[test]
    fn top_center_centers_horizontally_below_margin() {
        assert_eq!(
            top_center((0, 0), (1920, 1080), (320, 64), 24),
            ((1920 - 320) / 2, 24)
        );
    }

    #[test]
    fn top_center_respects_monitor_offset() {
        assert_eq!(
            top_center((1920, 0), (1280, 1024), (320, 64), 24),
            (1920 + (1280 - 320) / 2, 24)
        );
    }
}
