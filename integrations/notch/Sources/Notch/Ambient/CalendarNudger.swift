import EventKit
import Foundation

/// First ambient-awareness trigger: the notch speaks up on its own when a
/// calendar event is about to start. Checks every 30s for events starting
/// within the next 3 minutes; each event nudges exactly once.
@MainActor
final class CalendarNudger {

    /// (display text, spoken text)
    var onNudge: ((String, String) -> Void)?

    private let store = EKEventStore()
    private var timer: Timer?
    private var notified = Set<String>()

    func start() {
        store.requestFullAccessToEvents { [weak self] granted, _ in
            guard granted else {
                NSLog("[Notch] calendar access not granted — ambient nudges off")
                return
            }
            Task { @MainActor in self?.startPolling() }
        }
    }

    private func startPolling() {
        NSLog("[Notch] calendar nudges armed")
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.check() }
        }
        check()
    }

    private func check() {
        let now = Date()
        let horizon = now.addingTimeInterval(180)
        let predicate = store.predicateForEvents(withStart: now, end: horizon, calendars: nil)

        for event in store.events(matching: predicate) {
            guard !event.isAllDay,
                  let start = event.startDate,
                  start > now.addingTimeInterval(-30),
                  start <= horizon else { continue }

            let key = (event.eventIdentifier ?? event.title ?? "?") + start.description
            guard !notified.contains(key) else { continue }
            notified.insert(key)

            let title = event.title ?? "An event"
            let minutes = max(1, Int(start.timeIntervalSince(now) / 60))
            let when = minutes <= 1 ? "right now" : "in \(minutes) minutes"
            var display = "\(title) starts \(when)."
            if let location = event.location, !location.isEmpty {
                display += " — \(location)"
            }
            onNudge?(display, "\(title) starts \(when).")
            JournalStore.append("NUDGE calendar: \(title) at \(start)")
            break // one nudge per check; the next event gets the next pass
        }
    }
}
