/// The dictation lifecycle. Pure data — no I/O lives here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Recording,
    Transcribing,
    Injecting,
}

/// Events that drive transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    HotkeyPressed,
    HotkeyReleased,
    TranscriptionDone,
    InjectionDone,
    /// User discarded the in-progress take from the pill.
    Cancel,
    /// Any failure returns the machine to Idle.
    Error,
}

/// Pure transition function. Unknown (state, event) pairs leave the state
/// unchanged so stray events can never corrupt the machine.
pub fn next(state: State, event: Event) -> State {
    use Event::*;
    use State::*;
    match (state, event) {
        (Idle, HotkeyPressed) => Recording,
        (Recording, HotkeyReleased) => Transcribing,
        (Transcribing, TranscriptionDone) => Injecting,
        (Injecting, InjectionDone) => Idle,
        (Recording, Cancel) => Idle,
        (_, Error) => Idle,
        // Any other pairing is a no-op.
        (s, _) => s,
    }
}

/// Lowercase label used in events sent to the frontend.
pub fn label(state: State) -> &'static str {
    match state {
        State::Idle => "idle",
        State::Recording => "recording",
        State::Transcribing => "transcribing",
        State::Injecting => "injecting",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_cycles_back_to_idle() {
        let mut s = State::Idle;
        s = next(s, Event::HotkeyPressed);
        assert_eq!(s, State::Recording);
        s = next(s, Event::HotkeyReleased);
        assert_eq!(s, State::Transcribing);
        s = next(s, Event::TranscriptionDone);
        assert_eq!(s, State::Injecting);
        s = next(s, Event::InjectionDone);
        assert_eq!(s, State::Idle);
    }

    #[test]
    fn error_from_any_state_returns_to_idle() {
        for s in [State::Recording, State::Transcribing, State::Injecting] {
            assert_eq!(next(s, Event::Error), State::Idle);
        }
    }

    #[test]
    fn stray_events_are_no_ops() {
        assert_eq!(next(State::Idle, Event::HotkeyReleased), State::Idle);
        assert_eq!(
            next(State::Recording, Event::HotkeyPressed),
            State::Recording
        );
    }

    #[test]
    fn labels_are_stable() {
        assert_eq!(label(State::Idle), "idle");
        assert_eq!(label(State::Recording), "recording");
        assert_eq!(label(State::Transcribing), "transcribing");
        assert_eq!(label(State::Injecting), "injecting");
    }

    #[test]
    fn cancel_from_recording_returns_to_idle() {
        assert_eq!(next(State::Recording, Event::Cancel), State::Idle);
    }

    #[test]
    fn cancel_is_noop_outside_recording() {
        assert_eq!(next(State::Idle, Event::Cancel), State::Idle);
        assert_eq!(next(State::Transcribing, Event::Cancel), State::Transcribing);
        assert_eq!(next(State::Injecting, Event::Cancel), State::Injecting);
    }
}
