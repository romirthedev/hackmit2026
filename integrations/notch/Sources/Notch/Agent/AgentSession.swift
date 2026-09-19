import Foundation

/// One independent agent turn. Every request — including ones spoken while
/// other requests are still running — gets its own session with its own
/// `claude` process, so any number of them can transcribe, think, and act
/// concurrently. The view model keeps the running ones in `sessions` and
/// renders one of them (the "staged" session) on the panel at a time.
@MainActor
final class AgentSession: Identifiable {

    let id = UUID()
    /// Display number for the notch-edge indicator ("1", "2", …). Stable
    /// for the session's lifetime — finished sessions vanish rather than
    /// renumbering the survivors.
    let number: Int
    let request: String
    /// Each session owns its own invoker (its own `claude` process), so
    /// cancelling or finishing one never touches the others.
    let invoker: ClaudeCodeInvoker
    /// Key into RequestLogStore for this session's activity timeline.
    let logID: String
    /// True when this session resumed a previous agent conversation
    /// (clarify follow-ups) — journal-marked so history threads the exchange.
    let isFollowUp: Bool
    let startedAt = Date()

    /// UI-collapsed step list (consecutive verification steps merged),
    /// mirrored onto the panel whenever this session is staged.
    var steps: [AgentStep] = []
    /// Set when the session is killed; orphans its in-flight stream events.
    var cancelled = false
    /// The turn is over but its result hasn't taken the stage yet (queued
    /// behind another response). The indicator stays — dimmed — until the
    /// answer actually shows up, so number and answer disappear together.
    var isFinished = false

    init(number: Int, request: String, invoker: ClaudeCodeInvoker, logID: String, isFollowUp: Bool) {
        self.number = number
        self.request = request
        self.invoker = invoker
        self.logID = logID
        self.isFollowUp = isFollowUp
    }
}
