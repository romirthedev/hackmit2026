import Foundation

/// Explicit state machine for the notch. All UI renders off this single
/// source of truth — no loose booleans.
enum NotchState: Equatable {
    /// Collapsed, just the physical notch, nothing rendered.
    case idle
    /// Expanded, mic active, waveform animating, live transcript streaming.
    case listening
    /// Expanded, transcript locked, shimmer animating, agent reasoning.
    case thinking
    /// Expanded, showing the specific action being taken.
    case executing
    /// Expanded, streaming text response OR action confirmation.
    case responding
    /// Expanded, error treatment, short human-readable failure + retry.
    case error

    var isExpanded: Bool { self != .idle }

    /// A request is in flight or a response is on screen. Outside clicks
    /// must not dismiss the panel in these states — only Escape does.
    var isBusy: Bool {
        self == .thinking || self == .executing || self == .responding
    }
}
