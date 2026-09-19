import Carbon
import Foundation

/// Global ⌥+Space hotkey via Carbon RegisterEventHotKey.
///
/// Deliberate deviation from the spec's NSEvent.addGlobalMonitorForEvents:
/// global *keyboard* monitors silently receive nothing until the app is
/// granted Accessibility permission — a classic demo-killer. Carbon hotkeys
/// need no permission and fire reliably from any app.
final class HotkeyManager {

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private let callback: @MainActor () -> Void

    init(callback: @escaping @MainActor () -> Void) {
        self.callback = callback
        register()
    }

    private func register() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, userData in
                guard let userData else { return noErr }
                let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
                Task { @MainActor in manager.callback() }
                return noErr
            },
            1,
            &eventType,
            selfPtr,
            &eventHandler
        )

        let hotKeyID = EventHotKeyID(signature: OSType(0x4E54_4348), id: 1) // 'NTCH'
        RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    deinit {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}
