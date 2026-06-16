//! Gesture detection on top of the raw global-shortcut Pressed/Released stream.
//!
//! The same hotkey drives two recording gestures, like Wispr Flow:
//!
//! - **Hold (push-to-talk):** press and hold → records while held; release →
//!   stop and insert.
//! - **Double-tap (hands-free):** two quick taps → keeps recording without
//!   holding; a later single press → stop and insert.
//!
//! Recording always starts on the very first press so holding is responsive and
//! no audio is lost in the gap between the two taps of a double-tap. The pure
//! [`step`] function holds all the gesture logic and is fully unit-tested; the
//! stateful [`Controller`] only adds the timestamps the pure layer needs.

use std::time::{Duration, Instant};

/// A press/release shorter than this is a "tap"; longer is a "hold".
pub const HOLD_MIN: Duration = Duration::from_millis(350);
/// After the first tap, a second press within this window latches hands-free
/// recording; otherwise the lone tap stops and inserts whatever was caught.
pub const DOUBLE_TAP_WINDOW: Duration = Duration::from_millis(350);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Not recording.
    Idle,
    /// Recording, started by a press that is (so far) being held.
    Holding,
    /// Recording continues after one quick tap, waiting for a second press
    /// (→ latched) or the tap-timeout (→ lone tap ends it).
    PendingTap,
    /// Hands-free recording; ends on the next single press.
    Latched,
}

/// Enriched input to the pure transition: raw events plus the one time-derived
/// bit the logic needs (whether a release ended a long-enough hold).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    Press,
    Release {
        held_long: bool,
    },
    /// Fired once, `DOUBLE_TAP_WINDOW` after a tap, if no second press arrived.
    TapTimeout,
}

/// What the caller should do with the audio pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    None,
    /// Begin capturing audio.
    StartRecording,
    /// Stop capturing and run transcription + injection.
    StopAndInsert,
    /// Keep recording, but schedule a `TapTimeout` to resolve the lone-tap case.
    ArmTapTimeout,
}

/// Pure gesture transition. Unknown pairings are no-ops so stray events can
/// never corrupt the phase.
pub fn step(phase: Phase, input: Input) -> (Phase, Action) {
    use Action::*;
    use Phase::*;
    match (phase, input) {
        // First press starts recording (responsive hold + no lost audio).
        (Idle, Input::Press) => (Holding, StartRecording),
        // Held long enough → genuine push-to-talk release.
        (Holding, Input::Release { held_long: true }) => (Idle, StopAndInsert),
        // Quick tap → keep recording, wait to see if a second tap follows.
        (Holding, Input::Release { held_long: false }) => (PendingTap, ArmTapTimeout),
        // Second press in time → latch hands-free (recording already running).
        (PendingTap, Input::Press) => (Latched, None),
        // No second press → lone tap ends the (short) capture.
        (PendingTap, Input::TapTimeout) => (Idle, StopAndInsert),
        // Hands-free: a single press finishes; releases/timeouts are ignored.
        (Latched, Input::Press) => (Idle, StopAndInsert),
        (Latched, _) => (Latched, None),
        // Everything else is a no-op.
        (p, _) => (p, None),
    }
}

/// Stateful wrapper that feeds [`step`] the timing it needs and hands out
/// monotonic tokens so a stale tap-timeout can't fire after a double-tap.
pub struct Controller {
    phase: Phase,
    press_at: Option<Instant>,
    /// Bumped whenever a tap-timeout is armed; a timeout only acts if its token
    /// still matches (i.e. no newer gesture superseded it).
    generation: u64,
}

impl Default for Controller {
    fn default() -> Self {
        Controller {
            phase: Phase::Idle,
            press_at: None,
            generation: 0,
        }
    }
}

impl Controller {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Force the gesture back to idle (e.g. when the audio layer refused to
    /// start because the app was still busy with the previous utterance).
    pub fn reset(&mut self) {
        self.phase = Phase::Idle;
        self.press_at = None;
    }

    pub fn on_press(&mut self, now: Instant) -> Action {
        self.press_at = Some(now);
        let (phase, action) = step(self.phase, Input::Press);
        self.phase = phase;
        action
    }

    /// Returns the action and, when a tap-timeout must be armed, the token to
    /// pass back to [`Controller::on_tap_timeout`] after `DOUBLE_TAP_WINDOW`.
    pub fn on_release(&mut self, now: Instant) -> (Action, Option<u64>) {
        let held_long = self
            .press_at
            .map(|t| now.duration_since(t) >= HOLD_MIN)
            .unwrap_or(false);
        let (phase, action) = step(self.phase, Input::Release { held_long });
        self.phase = phase;
        let token = if action == Action::ArmTapTimeout {
            self.generation += 1;
            Some(self.generation)
        } else {
            None
        };
        (action, token)
    }

    /// The most recently armed tap-timeout token (the current generation).
    /// Valid to read right after an `on_release` that returned `ArmTapTimeout`.
    pub fn arm_token(&self) -> u64 {
        self.generation
    }

    pub fn on_tap_timeout(&mut self, token: u64) -> Action {
        if self.phase == Phase::PendingTap && token == self.generation {
            let (phase, action) = step(self.phase, Input::TapTimeout);
            self.phase = phase;
            action
        } else {
            Action::None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_records_then_inserts_on_release() {
        let (p, a) = step(Phase::Idle, Input::Press);
        assert_eq!((p, a), (Phase::Holding, Action::StartRecording));
        let (p, a) = step(p, Input::Release { held_long: true });
        assert_eq!((p, a), (Phase::Idle, Action::StopAndInsert));
    }

    #[test]
    fn double_tap_latches_then_single_press_inserts() {
        // press1 -> recording
        let (p, a) = step(Phase::Idle, Input::Press);
        assert_eq!((p, a), (Phase::Holding, Action::StartRecording));
        // release1 quick -> pending, keep recording
        let (p, a) = step(p, Input::Release { held_long: false });
        assert_eq!((p, a), (Phase::PendingTap, Action::ArmTapTimeout));
        // press2 -> latched, no audio action (already recording)
        let (p, a) = step(p, Input::Press);
        assert_eq!((p, a), (Phase::Latched, Action::None));
        // release2 ignored while latched
        let (p, a) = step(p, Input::Release { held_long: false });
        assert_eq!((p, a), (Phase::Latched, Action::None));
        // a stale timeout must not stop a latched session
        let (p, a) = step(p, Input::TapTimeout);
        assert_eq!((p, a), (Phase::Latched, Action::None));
        // single press finishes hands-free
        let (p, a) = step(p, Input::Press);
        assert_eq!((p, a), (Phase::Idle, Action::StopAndInsert));
    }

    #[test]
    fn lone_tap_times_out_and_inserts() {
        let (p, _) = step(Phase::Idle, Input::Press);
        let (p, a) = step(p, Input::Release { held_long: false });
        assert_eq!((p, a), (Phase::PendingTap, Action::ArmTapTimeout));
        let (p, a) = step(p, Input::TapTimeout);
        assert_eq!((p, a), (Phase::Idle, Action::StopAndInsert));
    }

    #[test]
    fn stray_events_are_no_ops() {
        assert_eq!(
            step(Phase::Idle, Input::TapTimeout),
            (Phase::Idle, Action::None)
        );
        assert_eq!(
            step(Phase::Idle, Input::Release { held_long: true }),
            (Phase::Idle, Action::None)
        );
    }

    #[test]
    fn controller_token_invalidates_stale_timeout() {
        let mut c = Controller::new();
        let start = Instant::now();
        // press + quick release -> arms timeout with token 1
        assert_eq!(c.on_press(start), Action::StartRecording);
        let (a, token) = c.on_release(start); // zero elapsed => tap
        assert_eq!(a, Action::ArmTapTimeout);
        let token = token.unwrap();
        // second press latches, superseding the pending tap
        assert_eq!(c.on_press(start), Action::None);
        assert_eq!(c.phase(), Phase::Latched);
        // the original timeout now must do nothing
        assert_eq!(c.on_tap_timeout(token), Action::None);
        assert_eq!(c.phase(), Phase::Latched);
    }

    #[test]
    fn controller_treats_long_press_as_hold() {
        let mut c = Controller::new();
        let t0 = Instant::now();
        assert_eq!(c.on_press(t0), Action::StartRecording);
        let (a, token) = c.on_release(t0 + HOLD_MIN);
        assert_eq!(a, Action::StopAndInsert);
        assert!(token.is_none());
        assert_eq!(c.phase(), Phase::Idle);
    }
}
