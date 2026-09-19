import AppKit
import SwiftUI

/// The Command Center hub window — Codex-style dark chrome: hidden title
/// bar with inline traffic lights, full-height sidebar, forced dark
/// appearance. Openable from the status menu, the distributed notification
/// `com.romir.notch.commandcenter`, or by touching
/// `~/.notch/.open-command-center` (polled by NotchApp).
@MainActor
final class CommandCenterWindowController: NSObject, NSWindowDelegate {

    static let shared = CommandCenterWindowController()

    private var window: NSWindow?

    /// The Active-section refresh timer only does work while the hub is
    /// actually on screen.
    var isWindowVisible: Bool { window?.isVisible ?? false }

    func show() {
        let window = self.window ?? makeWindow()
        self.window = window
        // Notch runs as an accessory app, but accessory windows can't own
        // a fullscreen Space — the green button just zooms with the menu
        // bar and desktop still showing. Become a regular app while the
        // hub is open; windowWillClose drops back to accessory.
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        // Strongly referenced here — default release-on-close would
        // use-after-free on the second open (same lesson as the QR window).
        window.isReleasedWhenClosed = false
        window.title = "Command Center"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(srgbRed: 0x1E / 255.0, green: 0x1E / 255.0, blue: 0x1E / 255.0, alpha: 1)
        window.minSize = NSSize(width: 900, height: 560)
        window.isMovableByWindowBackground = false
        // Native fullscreen: the green traffic light takes over the whole
        // screen (own Space, menu bar auto-hides).
        window.collectionBehavior = [.fullScreenPrimary, .managed]
        window.delegate = self
        window.contentView = NSHostingView(rootView: CommandCenterView())
        window.center()
        window.setFrameAutosaveName("NotchCommandCenter")
        return window
    }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        // Back to menu-bar-only once the hub goes away.
        NSApp.setActivationPolicy(.accessory)
    }

    /// Option-click zoom / titlebar double-click: fill the visible screen
    /// instead of NSWindow's content-sized default.
    func windowWillUseStandardFrame(_ window: NSWindow, defaultFrame: NSRect) -> NSRect {
        window.screen?.visibleFrame ?? defaultFrame
    }
}
