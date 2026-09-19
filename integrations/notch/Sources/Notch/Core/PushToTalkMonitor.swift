import AppKit
import CoreGraphics

/// Push-to-talk on the Fn (globe) key: hold ≥0.3s → the notch starts
/// listening; release → the utterance finalizes immediately (snappier than
/// waiting out the silence VAD).
///
/// Activation is hold-only and anything else cancels it: a quick tap, any
/// key press, or any mouse click while Fn is down before the threshold —
/// those are shortcuts (Fn-arrows, dictation, emoji picker), not
/// push-to-talk.
///
/// Implemented as a listen-only CGEventTap: Fn is a modifier (Carbon
/// hotkeys can't see it), and NSEvent global monitors proved unreliable
/// for flagsChanged delivery — the tap is what actually receives them.
/// Requires Accessibility; creation is retried every 10s so granting the
/// permission mid-run enables the feature without a relaunch. The ⌥Space
/// hotkey and notch-click paths don't depend on this.
@MainActor
final class PushToTalkMonitor {

    var onHoldBegan: (() -> Void)?
    var onReleased: (() -> Void)?

    private var tap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var retryTimer: Timer?

    private var holdTask: Task<Void, Never>?
    private var keyIsDown = false
    private var activated = false
    private let holdThreshold: TimeInterval = 0.3
    private let pttKeyCode: Int64 = 63 // kVK_Function (Fn/globe)

    init() {
        if !createTap() {
            retryTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    if self.createTap() {
                        self.retryTimer?.invalidate()
                        self.retryTimer = nil
                    }
                }
            }
        }
    }

    private func createTap() -> Bool {
        guard tap == nil else { return true }
        let mask = (1 << CGEventType.flagsChanged.rawValue)
            | (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.leftMouseDown.rawValue)
            | (1 << CGEventType.rightMouseDown.rawValue)
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        // .defaultTap (active pass-through), NOT .listenOnly: listen-only
        // keyboard taps are gated by the Input Monitoring permission, while
        // active taps are gated by Accessibility — which the app already
        // needs for screen context. We always return the event unmodified.
        guard let newTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, userInfo in
                if let userInfo {
                    let monitor = Unmanaged<PushToTalkMonitor>.fromOpaque(userInfo).takeUnretainedValue()
                    monitor.handleTapEvent(type: type, event: event)
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: selfPtr
        ) else {
            NSLog("[Notch] push-to-talk tap creation FAILED (Accessibility not granted yet?)")
            return false
        }
        NSLog("[Notch] push-to-talk tap created")

        tap = newTap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, newTap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: newTap, enable: true)
        return true
    }

    /// Called on the main run loop (tap source is attached to it).
    nonisolated private func handleTapEvent(type: CGEventType, event: CGEvent) {
        // macOS disables taps that stall; just switch ours back on.
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            MainActor.assumeIsolated {
                if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            }
            return
        }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let fnHeld = event.flags.contains(.maskSecondaryFn)
        MainActor.assumeIsolated {
            switch type {
            case .flagsChanged where keyCode == pttKeyCode:
                fnHeld ? keyPressed() : keyReleased()
            case .keyDown, .leftMouseDown, .rightMouseDown:
                // Fn+<key> / Fn-click is a shortcut, not push-to-talk.
                if keyIsDown && !activated { holdTask?.cancel() }
            default:
                break
            }
        }
    }

    private func keyPressed() {
        guard !keyIsDown else { return }
        keyIsDown = true
        holdTask?.cancel()
        holdTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((self?.holdThreshold ?? 0.3) * 1_000_000_000))
            guard let self, !Task.isCancelled, self.keyIsDown, !self.activated else { return }
            self.activated = true
            self.onHoldBegan?()
        }
    }

    private func keyReleased() {
        keyIsDown = false
        holdTask?.cancel()
        if activated {
            activated = false
            onReleased?()
        }
    }

    deinit {
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
    }
}
