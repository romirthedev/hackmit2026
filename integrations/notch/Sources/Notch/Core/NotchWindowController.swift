import AppKit
import Combine
import SwiftUI

/// Borderless non-activating panel pinned over the physical notch.
/// Collapsed, the window frame is exactly the notch's bounding box (so a
/// click on the notch reaches us and the rest of the screen is untouched).
/// Expanded, the window grows downward around the top-center anchor and the
/// SwiftUI content animates within it.
@MainActor
final class NotchWindowController {

    let panel: NotchPanel
    let viewModel: NotchViewModel

    private var clickOutsideMonitor: Any?
    private var localKeyMonitor: Any?
    private var globalKeyMonitor: Any?
    private var textInputObserver: AnyCancellable?

    /// Held while the panel is expanded. Without it, App Nap coalesces
    /// this accessory app's timers and display updates to ~0.6s ticks —
    /// the shimmer/sheen animations visibly freeze or strobe.
    private var expandedActivity: NSObjectProtocol?

    /// Physical notch bounding box in screen coordinates. Pulled from real
    /// safe-area geometry — never hardcoded (models differ). Falls back to a
    /// synthetic notch on non-notched displays for development.
    static func notchRect(on screen: NSScreen) -> NSRect {
        let frame = screen.frame
        if screen.safeAreaInsets.top > 0,
           let left = screen.auxiliaryTopLeftArea,
           let right = screen.auxiliaryTopRightArea {
            let width = frame.width - left.width - right.width
            let height = screen.safeAreaInsets.top
            return NSRect(
                x: frame.origin.x + left.width,
                y: frame.maxY - height,
                width: width,
                height: height
            )
        }
        // Dev fallback: fake notch, top-center.
        let width: CGFloat = 200
        let height: CGFloat = 32
        return NSRect(x: frame.midX - width / 2, y: frame.maxY - height, width: width, height: height)
    }

    static func targetScreen() -> NSScreen {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 }
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }

    private var notchRect: NSRect
    private var expandedFrame: NSRect

    init(viewModel: NotchViewModel) {
        self.viewModel = viewModel

        let screen = Self.targetScreen()
        notchRect = Self.notchRect(on: screen)

        // Expanded window: wide/tall enough for the panel + its shadow;
        // anchored top-center, pinned to the notch position.
        let width = NotchTheme.panelMaxWidth + 80
        let height = NotchTheme.panelMaxHeight + 120
        expandedFrame = NSRect(
            x: notchRect.midX - width / 2,
            y: notchRect.maxY - height,
            width: width,
            height: height
        )

        panel = NotchPanel(
            contentRect: notchRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovable = false
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true
        panel.animationBehavior = .none
        // After isFloatingPanel — that setter resets level to .floating,
        // which would put us underneath the menu bar.
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]

        let root = NotchRootView(notchSize: notchRect.size)
            .environmentObject(viewModel)
        let hosting = NSHostingView(rootView: root)
        hosting.frame = NSRect(origin: .zero, size: notchRect.size)
        panel.contentView = hosting

        viewModel.onExpansionChange = { [weak self] expanded in
            self?.setExpanded(expanded)
        }

        installMonitors()

        // Make the panel key only while the typed-input field is visible.
        textInputObserver = viewModel.$showTextInput.sink { [weak self] shown in
            guard let self else { return }
            self.panel.wantsKey = shown
            if shown {
                self.panel.makeKeyAndOrderFront(nil)
            } else {
                self.panel.resignKey()
            }
        }

        panel.orderFrontRegardless()
    }

    private func setExpanded(_ expanded: Bool) {
        if expanded {
            if expandedActivity == nil {
                expandedActivity = ProcessInfo.processInfo.beginActivity(
                    options: [.userInitiated, .latencyCritical],
                    reason: "Notch panel expanded — animations running"
                )
            }
            // Grow the window immediately; SwiftUI animates the content.
            panel.setFrame(expandedFrame, display: true)
            panel.orderFrontRegardless()
            removeClickOutsideMonitor()
            clickOutsideMonitor = NSEvent.addGlobalMonitorForEvents(
                matching: [.leftMouseDown, .rightMouseDown]
            ) { [weak self] _ in
                guard let self else { return }
                // Global monitors only fire for clicks in OTHER apps'
                // windows, so any hit here is outside the panel. While a
                // request is in flight or a response is showing, the click
                // is ignored — the user keeps working, Notch keeps going.
                guard !self.viewModel.state.isBusy else { return }
                self.viewModel.cancel()
            }
        } else {
            if let activity = expandedActivity {
                ProcessInfo.processInfo.endActivity(activity)
                expandedActivity = nil
            }
            removeClickOutsideMonitor()
            // Shrink back after the collapse animation completes.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                guard let self, !self.viewModel.state.isExpanded else { return }
                self.panel.setFrame(self.notchRect, display: true)
            }
        }
    }

    private func installMonitors() {
        // Escape and Tab handled locally while our panel is key.
        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            switch event.keyCode {
            case 53: // Escape — instant cancel from any state
                if self.viewModel.state.isExpanded {
                    self.viewModel.cancel()
                    return nil
                }
                if self.viewModel.translatorModeActive {
                    self.viewModel.stopTranslatorMode()
                    return nil
                }
            case 48: // Tab — typed-input fallback during listening
                if self.viewModel.state == .listening {
                    self.viewModel.toggleTextInput()
                    return nil
                }
            default:
                break
            }
            return event
        }

        // Global Escape/Tab monitor — fires when another app has keyboard
        // focus, which is the normal case since our panel is non-activating
        // with canBecomeKey=false. Global monitors can't consume events (void
        // return), but that's fine — we just need the signal.
        //
        // Tab MUST be here, not only in the local monitor: while listening
        // the panel isn't key yet (wantsKey flips true only after the text
        // field is shown), so the local monitor can never see the first Tab —
        // without this the typed-input fallback is unreachable.
        globalKeyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return }
            switch event.keyCode {
            case 53: // Escape
                if self.viewModel.state.isExpanded {
                    self.viewModel.cancel()
                } else if self.viewModel.translatorModeActive {
                    self.viewModel.stopTranslatorMode()
                }
            case 48: // Tab — reveal typed input (⌘⌃⌥-modified Tabs are
                     // app shortcuts like ⌘Tab switching, not for us)
                if self.viewModel.state == .listening, !self.viewModel.showTextInput,
                   event.modifierFlags.intersection([.command, .control, .option]).isEmpty {
                    self.viewModel.toggleTextInput()
                }
            default:
                break
            }
        }
    }

    private func removeClickOutsideMonitor() {
        if let monitor = clickOutsideMonitor {
            NSEvent.removeMonitor(monitor)
            clickOutsideMonitor = nil
        }
    }

    /// Re-anchor when displays change (lid open/close, external monitor).
    func displaysChanged() {
        let screen = Self.targetScreen()
        notchRect = Self.notchRect(on: screen)
        let width = expandedFrame.width
        let height = expandedFrame.height
        expandedFrame = NSRect(
            x: notchRect.midX - width / 2,
            y: notchRect.maxY - height,
            width: width,
            height: height
        )
        panel.setFrame(viewModel.state.isExpanded ? expandedFrame : notchRect, display: true)
    }
}

/// Panel that can become key (needed for the typed-input fallback) without
/// activating the app.  `wantsKey` is flipped on only while the text-input
/// field is visible so the passive overlay never steals keyboard focus.
final class NotchPanel: NSPanel {
    var wantsKey = false
    override var canBecomeKey: Bool { wantsKey }
    override var canBecomeMain: Bool { false }

    /// AppKit constrains borderless windows to sit below the menu bar,
    /// which pushed the panel 34pt down. We own the geometry — bypass it.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}
