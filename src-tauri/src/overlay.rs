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

#[cfg(test)]
mod tests {
    use super::*;

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
}
