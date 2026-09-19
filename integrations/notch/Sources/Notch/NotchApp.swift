import AppKit
import SwiftUI

@main
@MainActor
final class NotchApp: NSObject, NSApplicationDelegate {

    private static var delegate: NotchApp?

    static func main() {
        let app = NSApplication.shared
        let delegate = NotchApp()
        Self.delegate = delegate // NSApplication.delegate is weak
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    private var viewModel: NotchViewModel!
    private var windowController: NotchWindowController!
    private var edgeGlowController: EdgeGlowWindowController!
    private var hotkeyManager: HotkeyManager!
    private var pushToTalkMonitor: PushToTalkMonitor!
    private var statusItem: NSStatusItem!
    private var workerMonitor: WorkerSessionMonitor!
    private var calendarNudger: CalendarNudger!
    private var consolidationScheduler: ConsolidationScheduler!
    private var remoteServer: RemoteControlServer!
    private var qrWindow: NSWindow?
    private var voiceModeItem: NSMenuItem?
    private var commandCenterMarkerTimer: Timer?
    private var meetingModeMarkerTimer: Timer?
    private var translatorModeMarkerTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A phone workspace needs only read-only context, not desktop agent automation.
        if CommandLine.arguments.contains("--rewind-bridge") {
            remoteServer = RemoteControlServer(port: 8738, contextOnly: true)
            remoteServer.start()
            return
        }
        viewModel = NotchViewModel()
        windowController = NotchWindowController(viewModel: viewModel)
        edgeGlowController = EdgeGlowWindowController()
        hotkeyManager = HotkeyManager { [weak self] in
            self?.viewModel.toggle()
        }

        // Hold Fn = push-to-talk (needs Accessibility for global keys). The
        // Siri-style screen-edge glow tracks the hold: on while listening,
        // off the instant the key is released.
        pushToTalkMonitor = PushToTalkMonitor()
        pushToTalkMonitor.onHoldBegan = { [weak self] in
            self?.viewModel.beginPushToTalk()
            self?.edgeGlowController.setActive(true)
        }
        pushToTalkMonitor.onReleased = { [weak self] in
            self?.viewModel.endPushToTalk()
            self?.edgeGlowController.setActive(false)
        }

        workerMonitor = WorkerSessionMonitor()
        workerMonitor.onWorkerFinished = { [weak self] name, summary, isError in
            self?.viewModel.workerFinished(name: name, summary: summary, isError: isError)
        }
        workerMonitor.onRunningCountChanged = { [weak self] count in
            self?.viewModel.workersRunning = count
        }
        workerMonitor.start()

        // Long-horizon task manager: reloads persisted tasks from
        // ~/.notch/tasks/ and resumes monitoring worker logs.
        viewModel.taskManager.onTaskEvent = { [weak self] name, summary, isError in
            self?.viewModel.taskEvent(name: name, summary: summary, isError: isError)
        }
        viewModel.taskManager.start()

        remoteServer = RemoteControlServer()
        remoteServer.onCommand = { [weak self] text in self?.viewModel.remoteCommand(text) }
        remoteServer.onCancel = { [weak self] in self?.viewModel.cancel() }
        remoteServer.stateProvider = { [weak self] in
            self?.viewModel.remoteStateSnapshot()
                ?? RemoteControlServer.StateSnapshot(
                    state: "idle", transcript: "", response: "", steps: [],
                    errorMessage: "", workersRunning: 0, contextApp: nil,
                    actionSucceeded: false, learnedSkill: nil, outputFile: nil
                )
        }
        // Permission asks from the MCP shim: rules first, then the panel card.
        remoteServer.permissionDecider = { [weak self] tool, detail in
            let verdict = await MainActor.run {
                PermissionStore.shared.evaluate(tool: tool, detail: detail)
            }
            switch verdict {
            case .allow:
                return (true, nil)
            case .deny(let why):
                return (false, why)
            case .ask:
                guard let vm = await MainActor.run(body: { self?.viewModel }) else {
                    return (false, "Notch unavailable")
                }
                let allowed = await vm.requestPermission(tool: tool, detail: detail)
                return (allowed, allowed ? nil : "Denied by the user in Notch.")
            }
        }
        remoteServer.start()

        // Ambient awareness: the notch speaks first when a meeting nears.
        calendarNudger = CalendarNudger()
        calendarNudger.onNudge = { [weak self] display, spoken in
            self?.viewModel.proactiveAnnounce(display: display, spoken: spoken, isSuccess: true)
        }
        calendarNudger.start()

        setupStatusItem()
        SkillLibrary.ensureDirectoryExists()
        JournalStore.ensureVault()

        // Sleep-time memory consolidation (Sonnet-powered, announces via
        // the worker monitor when it finishes).
        consolidationScheduler = ConsolidationScheduler()
        consolidationScheduler.start()

        // Surface permission prompts at launch, never mid-demo.
        AudioCaptureEngine.requestPermission { _ in }
        AppleScriptRunner.preflightAutomationPermission()
        // Accessibility powers the deictic screen-context layer.
        _ = ScreenContextProvider.isTrusted(promptIfNeeded: true)
        // Screen Recording powers the perceive→act→verify loop. The CLI
        // screencapture probe silently degrades instead of prompting —
        // this is the API that actually raises the dialog.
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
        // Desktop/Documents/Downloads each prompt on first touch — fire
        // those now, not when the agent is mid-task.
        PermissionCenter.preflightFolders()

        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.windowController.displaysChanged()
                self?.edgeGlowController.displaysChanged()
            }
        }

        // Scripting hook: `com.romir.notch.toggle` toggles the panel from
        // anywhere (Raycast, BTT, shell) with no permissions needed.
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.romir.notch.toggle"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.viewModel.toggle() }
        }

        // Scripting hook: open the Command Center hub window from anywhere.
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.romir.notch.commandcenter"),
            object: nil,
            queue: .main
        ) { _ in
            Task { @MainActor in CommandCenterWindowController.shared.show() }
        }

        // Agent hook: touching ~/.notch/.open-command-center opens the hub
        // (the marker is consumed). Lets detached workers surface the window.
        commandCenterMarkerTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
            Task { @MainActor in
                let marker = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/.open-command-center")
                guard FileManager.default.fileExists(atPath: marker.path) else { return }
                try? FileManager.default.removeItem(at: marker)
                CommandCenterWindowController.shared.show()
            }
        }

        // Agent hook: touching ~/.notch/.meeting-mode toggles meeting mode.
        // The marker's presence = active; absence = inactive. The agent
        // writes this file via voice command or a detached worker.
        meetingModeMarkerTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let marker = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/.meeting-mode")
                let exists = FileManager.default.fileExists(atPath: marker.path)
                if exists && !self.viewModel.meetingModeActive {
                    self.viewModel.startMeetingMode()
                } else if !exists && self.viewModel.meetingModeActive {
                    self.viewModel.stopMeetingMode()
                }
            }
        }

        // Agent hook: touching ~/.notch/.translator-mode toggles live
        // translation (presence = active), mirroring the meeting-mode marker.
        translatorModeMarkerTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let marker = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/.translator-mode")
                let exists = FileManager.default.fileExists(atPath: marker.path)
                if exists && !self.viewModel.translatorModeActive {
                    self.viewModel.startTranslatorMode()
                } else if !exists && self.viewModel.translatorModeActive {
                    self.viewModel.stopTranslatorMode()
                }
            }
        }

        // Debug hook: flash the push-to-talk edge glow for ~2.5s so it can
        // be seen without physically holding Fn (post com.romir.notch.edgeglow).
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.romir.notch.edgeglow"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.edgeGlowController.setActive(true)
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                    self?.edgeGlowController.setActive(false)
                }
            }
        }

        // Debug hook: dump the current screen-context snapshot to
        // ~/.notch/last-context.txt (verifies the deictic layer live).
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.romir.notch.dumpcontext"),
            object: nil,
            queue: .main
        ) { _ in
            Task.detached {
                let block = ScreenContextProvider().capture()?.promptBlock ?? "NO CONTEXT"
                let url = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/last-context.txt")
                try? block.write(to: url, atomically: true, encoding: .utf8)
            }
        }
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let icon = StarburstWorkingView.templateImage(size: 18)
        icon.accessibilityDescription = "Notch"
        statusItem.button?.image = icon

        let menu = NSMenu()
        let activate = NSMenuItem(title: "Activate", action: #selector(activateNotch), keyEquivalent: " ")
        activate.keyEquivalentModifierMask = [.option]
        activate.target = self
        menu.addItem(activate)
        if !ScreenContextProvider.isTrusted(promptIfNeeded: false) {
            let grant = NSMenuItem(
                title: "⚠️ Grant Accessibility (Fn key + screen context)…",
                action: #selector(openAccessibilitySettings),
                keyEquivalent: ""
            )
            grant.target = self
            menu.addItem(grant)
        }
        menu.addItem(.separator())
        let voice = NSMenuItem(title: "Voice Responses", action: #selector(toggleVoiceMode), keyEquivalent: "v")
        voice.target = self
        voice.state = viewModel.voiceModeEnabled ? .on : .off
        menu.addItem(voice)
        voiceModeItem = voice
        let permMenu = NSMenu()
        for mode in PermissionStore.Mode.allCases {
            let item = NSMenuItem(title: mode.title, action: #selector(setPermissionMode(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode.rawValue
            item.state = PermissionStore.shared.mode == mode ? .on : .off
            permMenu.addItem(item)
        }
        let permRoot = NSMenuItem(title: "Permission Mode", action: nil, keyEquivalent: "")
        permRoot.submenu = permMenu
        menu.addItem(permRoot)
        let remote = NSMenuItem(title: "Phone Remote…", action: #selector(showPhoneRemote), keyEquivalent: "r")
        remote.target = self
        menu.addItem(remote)
        let permissions = NSMenuItem(title: "Permissions…", action: #selector(showPermissions), keyEquivalent: "p")
        permissions.target = self
        menu.addItem(permissions)
        let preflight = NSMenuItem(title: "Pre-authorize Automation…", action: #selector(runAutomationPreflight), keyEquivalent: "")
        preflight.target = self
        menu.addItem(preflight)
        let consolidate = NSMenuItem(title: "Consolidate Memory Now", action: #selector(consolidateNow), keyEquivalent: "")
        consolidate.target = self
        menu.addItem(consolidate)
        let graph = NSMenuItem(title: "Memory Graph…", action: #selector(showMemoryGraph), keyEquivalent: "g")
        graph.target = self
        menu.addItem(graph)
        let commandCenter = NSMenuItem(title: "Command Center…", action: #selector(showCommandCenter), keyEquivalent: "k")
        commandCenter.target = self
        menu.addItem(commandCenter)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Notch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    /// White-on-black QR reads as "Notch"; phone cameras scan it fine.
    private static func qrImage(for string: String, size: CGFloat) -> NSImage? {
        let filter = CIFilter(name: "CIQRCodeGenerator")!
        filter.setValue(Data(string.utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let ciImage = filter.outputImage else { return nil }
        let scale = size / ciImage.extent.width
        let inverted = ciImage
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .applyingFilter("CIColorInvert")
            .applyingFilter("CIMaskToAlpha")
        let image = NSImage(size: NSSize(width: size, height: size))
        image.addRepresentation(NSCIImageRep(ciImage: inverted))
        return image
    }

    /// QR code window: scan with the phone camera, control from the couch —
    /// or, when a Tailscale tailnet IP is up, from anywhere.
    @objc private func showPhoneRemote() {
        let entries = remoteServer.urls
        guard let first = entries.first else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(first.url, forType: .string)

        let qrSize: CGFloat = 240
        let columns = NSStackView()
        columns.orientation = .horizontal
        columns.alignment = .top
        columns.spacing = 28
        for entry in entries {
            guard let qrImage = Self.qrImage(for: entry.url, size: qrSize) else { continue }
            let column = NSStackView()
            column.orientation = .vertical
            column.spacing = 8
            let title = NSTextField(labelWithString: entry.label)
            title.alignment = .center
            title.font = .systemFont(ofSize: 13, weight: .semibold)
            column.addArrangedSubview(title)
            let imageView = NSImageView(image: qrImage)
            imageView.widthAnchor.constraint(equalToConstant: qrSize).isActive = true
            imageView.heightAnchor.constraint(equalToConstant: qrSize).isActive = true
            column.addArrangedSubview(imageView)
            let urlLabel = NSTextField(labelWithString: entry.url)
            urlLabel.alignment = .center
            urlLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
            urlLabel.textColor = .secondaryLabelColor
            column.addArrangedSubview(urlLabel)
            columns.addArrangedSubview(column)
        }

        let content = NSStackView()
        content.orientation = .vertical
        content.spacing = 12
        content.edgeInsets = NSEdgeInsets(top: 24, left: 24, bottom: 20, right: 24)
        content.addArrangedSubview(columns)
        let hasTailnet = entries.contains { $0.label.contains("Tailscale") }
        let caption = hasTailnet
            ? "\(first.label) URL copied. The Tailscale QR works from anywhere —\ncellular included — once both devices are signed into your tailnet."
            : "(copied — same Wi-Fi required)\nInstall Tailscale on Mac + iPhone for away-from-home control."
        let label = NSTextField(labelWithString: caption)
        label.alignment = .center
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        content.addArrangedSubview(label)

        let window = qrWindow ?? NSWindow(
            contentRect: .zero,
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        // NSWindow releases itself on close by default; combined with our
        // strong reference that's a use-after-free on the second open.
        window.isReleasedWhenClosed = false
        window.title = "Notch Phone Remote"
        window.backgroundColor = .black
        window.contentView = content
        window.setContentSize(content.fittingSize)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        qrWindow = window
    }

    @objc private func activateNotch() {
        viewModel.toggle()
    }

    @objc private func setPermissionMode(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let mode = PermissionStore.Mode(rawValue: raw) else { return }
        PermissionStore.shared.setMode(mode)
        for item in sender.menu?.items ?? [] {
            item.state = (item.representedObject as? String) == raw ? .on : .off
        }
    }

    @objc private func toggleVoiceMode() {
        viewModel.voiceModeEnabled.toggle()
        voiceModeItem?.state = viewModel.voiceModeEnabled ? .on : .off
    }


    private var permissionsWindow: NSWindow?

    @objc private func showPermissions() {
        let window = permissionsWindow ?? NSWindow(
            contentRect: .zero,
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.title = "Notch Permissions"
        window.contentView = NSHostingView(rootView: PermissionsView())
        window.setContentSize(window.contentView!.fittingSize)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        permissionsWindow = window
    }

    @objc private func runAutomationPreflight() {
        AppleScriptRunner.preflightAutomationPermission(force: true)
    }

    @objc private func consolidateNow() {
        consolidationScheduler.runNow()
    }

    @objc private func showCommandCenter() {
        CommandCenterWindowController.shared.show()
    }

    @objc private func showMemoryGraph() {
        guard let url = remoteServer.url, let graphURL = URL(string: url + "graph") else { return }
        NSWorkspace.shared.open(graphURL)
    }

    @objc private func openAccessibilitySettings() {
        NSWorkspace.shared.open(
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        )
    }
}
