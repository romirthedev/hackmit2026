@preconcurrency import AVFoundation
import AppKit
import Foundation

/// Orchestrates Meeting Mode: silently captures system audio (other
/// participants via ScreenCaptureKit) and microphone audio (the user),
/// transcribes continuously in ~25-second chunks via Groq/Whisper, and on
/// exit writes a timestamped transcript + AI-generated meeting notes.
@MainActor
final class MeetingModeManager: ObservableObject {

    @Published private(set) var isActive = false
    @Published private(set) var elapsedSeconds: Int = 0

    // MARK: - Audio engines

    private let systemAudio = SystemAudioCapture()
    private let micCapture = MeetingMicCapture()

    // MARK: - Transcription

    private let groq = GroqTranscriptionClient()
    private var entries: [TranscriptEntry] = []
    private var transcriptionTimer: Timer?
    private var elapsedTimer: Timer?
    private var startTime: Date?
    private var chunkIndex = 0

    struct TranscriptEntry {
        let timestamp: String   // "00:01:23"
        let speaker: String     // "You" or "Others"
        let text: String
    }

    // MARK: - Public

    func start() async throws {
        guard !isActive else { return }

        // Check mic permission.
        let micGranted = await withCheckedContinuation { cont in
            AudioCaptureEngine.requestPermission { granted in cont.resume(returning: granted) }
        }
        guard micGranted else {
            throw NSError(domain: "Notch", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "Microphone access is required for Meeting Mode. Enable it in System Settings → Privacy & Security → Microphone."
            ])
        }

        // Start system audio (checks Screen Recording permission internally).
        try await systemAudio.start()

        // Start mic capture.
        try micCapture.start()

        entries = []
        chunkIndex = 0
        startTime = Date()
        isActive = true
        elapsedSeconds = 0

        // Elapsed clock.
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isActive, let start = self.startTime else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(start))
            }
        }

        // Transcription chunks every 25 seconds.
        transcriptionTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.transcribeChunk() }
        }

        NSLog("[Notch] Meeting Mode started")
    }

    func stop() {
        guard isActive else { return }
        isActive = false
        transcriptionTimer?.invalidate()
        transcriptionTimer = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil

        // Capture final chunk before stopping audio.
        transcribeChunk()

        systemAudio.stop()
        micCapture.stop()

        NSLog("[Notch] Meeting Mode stopped, %d transcript entries", entries.count)

        // Write output asynchronously.
        let capturedEntries = entries
        let elapsed = elapsedSeconds
        Task { await self.writeOutput(entries: capturedEntries, durationSeconds: elapsed) }
    }

    private func snapshotMicWAVAndReset() -> Data {
        micCapture.snapshotWAVAndReset()
    }

    // MARK: - Transcription

    private func transcribeChunk() {
        guard isActive || chunkIndex == 0 else { return }
        chunkIndex += 1

        let sysWAV = systemAudio.snapshotWAVAndReset()
        let micWAV = snapshotMicWAVAndReset()

        let elapsed = elapsedSeconds
        let timestamp = formatTimestamp(elapsed)

        // Transcribe both in parallel.
        Task {
            async let sysText = transcribeSafe(wav: sysWAV, minBytes: 8_000)
            async let micText = transcribeSafe(wav: micWAV, minBytes: 8_000)

            let sys = await sysText
            let mic = await micText

            await MainActor.run {
                if let text = sys, !text.isEmpty {
                    entries.append(TranscriptEntry(timestamp: timestamp, speaker: "Others", text: text))
                }
                if let text = mic, !text.isEmpty {
                    entries.append(TranscriptEntry(timestamp: timestamp, speaker: "You", text: text))
                }
            }
        }
    }

    private func transcribeSafe(wav: Data, minBytes: Int) async -> String? {
        guard wav.count > minBytes else { return nil }
        return try? await groq.transcribe(wav: wav)
    }

    // MARK: - Output

    private func writeOutput(entries: [TranscriptEntry], durationSeconds: Int) async {
        let title = detectMeetingTitle() ?? generateTitleFromTranscript(entries)
        let dateStr = Self.dateFormatter.string(from: Date())
        let folderName = "\(dateStr) \(sanitizeFilename(title))"

        let outboxURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("NotchOutbox/Meetings")
            .appendingPathComponent(folderName)
        try? FileManager.default.createDirectory(at: outboxURL, withIntermediateDirectories: true)

        // Write transcript.md
        let transcriptMD = buildTranscriptMarkdown(entries: entries, title: title, duration: durationSeconds)
        let transcriptURL = outboxURL.appendingPathComponent("transcript.md")
        try? transcriptMD.write(to: transcriptURL, atomically: true, encoding: .utf8)

        // Generate notes.md via claude CLI
        let notesURL = outboxURL.appendingPathComponent("notes.md")
        await generateNotes(transcript: transcriptMD, outputURL: notesURL)

        // Reveal folder in Finder.
        let folderPath = outboxURL.path
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        proc.arguments = [folderPath]
        try? proc.run()

        NSLog("[Notch] Meeting output written to %@", folderPath)
    }

    private func buildTranscriptMarkdown(entries: [TranscriptEntry], title: String, duration: Int) -> String {
        var md = "# \(title)\n\n"
        md += "**Date:** \(Self.dateFormatter.string(from: Date()))  \n"
        md += "**Duration:** \(formatTimestamp(duration))  \n\n"
        md += "---\n\n"

        if entries.isEmpty {
            md += "_No speech was captured during this meeting._\n"
        } else {
            for entry in entries {
                md += "**[\(entry.timestamp)] \(entry.speaker):**  \n"
                md += "\(entry.text)\n\n"
            }
        }
        return md
    }

    private func generateNotes(transcript: String, outputURL: URL) async {
        guard let claude = ClaudeCodeInvoker.findClaudeBinary() else {
            // Fallback: write a placeholder.
            let placeholder = "# Meeting Notes\n\n_Could not generate summary — `claude` CLI not found._\n\nRefer to transcript.md for the full record.\n"
            try? placeholder.write(to: outputURL, atomically: true, encoding: .utf8)
            return
        }

        let prompt = """
        You are a meeting notes assistant. Below is a word-for-word transcript \
        of a meeting. Write clean, well-organized meeting notes in Markdown with \
        these sections:

        # Meeting Notes

        ## Attendees
        (List names/roles if inferable from the transcript; otherwise write "Not identified")

        ## Key Points
        - Bullet points of the main topics discussed

        ## Decisions
        - Any decisions that were made

        ## Action Items
        - [ ] Specific follow-up tasks with owners if identifiable

        ## Summary
        A 2-3 sentence executive summary of the meeting.

        ---

        TRANSCRIPT:
        \(transcript.prefix(50000))
        """

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: claude)
        proc.arguments = [
            "-p", prompt,
            "--model", "claude-sonnet-4-5-20251001",
            "--output-format", "text",
            "--max-turns", "1",
            "--permission-mode", "bypassPermissions",
            "--setting-sources", "",
            "--strict-mcp-config",
        ]
        var env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        env["PATH"] = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        proc.environment = env
        proc.currentDirectoryURL = FileManager.default.temporaryDirectory

        let stdout = Pipe()
        proc.standardOutput = stdout
        proc.standardError = Pipe()

        do {
            try proc.run()
            proc.waitUntilExit()
            let data = stdout.fileHandleForReading.readDataToEndOfFile()
            let notes = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !notes.isEmpty {
                try? notes.write(to: outputURL, atomically: true, encoding: .utf8)
            } else {
                let fallback = "# Meeting Notes\n\n_Summary generation produced no output._\n\nRefer to transcript.md for the full record.\n"
                try? fallback.write(to: outputURL, atomically: true, encoding: .utf8)
            }
        } catch {
            let fallback = "# Meeting Notes\n\n_Could not generate summary: \(error.localizedDescription)_\n\nRefer to transcript.md for the full record.\n"
            try? fallback.write(to: outputURL, atomically: true, encoding: .utf8)
        }
    }

    // MARK: - Meeting title detection

    /// Prefer the frontmost meeting app's window title.
    private func detectMeetingTitle() -> String? {
        let workspace = NSWorkspace.shared
        let apps = workspace.runningApplications

        // Check for known meeting apps.
        let meetingBundles: [(bundlePrefix: String, appName: String)] = [
            ("us.zoom.xos", "Zoom"),
            ("com.microsoft.teams", "Teams"),
            ("com.cisco.webexmeetings", "Webex"),
        ]

        for app in apps where app.isActive || app.activationPolicy == .regular {
            guard let bundleID = app.bundleIdentifier else { continue }

            for meeting in meetingBundles {
                if bundleID.hasPrefix(meeting.bundlePrefix) {
                    if let title = windowTitle(for: app), !title.isEmpty,
                       title != meeting.appName {
                        return title
                    }
                    return "\(meeting.appName) Meeting"
                }
            }

            // Browser with Meet/Zoom in title.
            let browsers = ["com.apple.Safari", "com.google.Chrome", "com.microsoft.edgemac",
                            "org.mozilla.firefox", "com.brave.Browser", "company.thebrowser.Browser"]
            if browsers.contains(where: { bundleID.hasPrefix($0) }) {
                if let title = windowTitle(for: app) {
                    let lower = title.lowercased()
                    if lower.contains("meet") || lower.contains("zoom") || lower.contains("teams") {
                        // Clean browser suffixes.
                        let cleaned = title
                            .replacingOccurrences(of: " - Google Chrome", with: "")
                            .replacingOccurrences(of: " — Mozilla Firefox", with: "")
                            .replacingOccurrences(of: " - Microsoft Edge", with: "")
                            .replacingOccurrences(of: " – Safari", with: "")
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if !cleaned.isEmpty { return cleaned }
                    }
                }
            }
        }
        return nil
    }

    private func windowTitle(for app: NSRunningApplication) -> String? {
        guard let pid = Optional(app.processIdentifier) else { return nil }
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
        for window in windowList {
            if let ownerPID = window[kCGWindowOwnerPID as String] as? Int32, ownerPID == pid,
               let name = window[kCGWindowName as String] as? String, !name.isEmpty {
                return name
            }
        }
        return nil
    }

    private func generateTitleFromTranscript(_ entries: [TranscriptEntry]) -> String {
        guard !entries.isEmpty else { return "Meeting" }
        // Use first few words of the first substantive entry.
        let firstText = entries.first(where: { $0.text.count > 10 })?.text ?? entries.first!.text
        let words = firstText.split(separator: " ").prefix(6).joined(separator: " ")
        let cleaned = words.trimmingCharacters(in: .punctuationCharacters)
        return cleaned.isEmpty ? "Meeting" : cleaned
    }

    // MARK: - Helpers

    private func formatTimestamp(_ totalSeconds: Int) -> String {
        let h = totalSeconds / 3600
        let m = (totalSeconds % 3600) / 60
        let s = totalSeconds % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%02d:%02d", m, s)
    }

    private func sanitizeFilename(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_"))
        return String(name.unicodeScalars.filter { allowed.contains($0) })
            .trimmingCharacters(in: .whitespaces)
            .prefix(60)
            .trimmingCharacters(in: .whitespaces)
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
