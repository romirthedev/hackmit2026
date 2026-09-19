import Foundation

/// Sleep-time consolidation: periodically spawns a detached worker that
/// reads the vault (journal, failures, skills), promotes repeated patterns
/// into new skills, distills failures into lessons, and maintains the
/// Obsidian-style index. Runs on Sonnet 5 — this task doesn't need
/// Fable-tier reasoning and shouldn't draw Fable-tier plan weight.
///
/// The worker writes its log into ~/.notch/sessions/, so the existing
/// WorkerSessionMonitor announces completion proactively — the notch
/// swells and says what it taught itself.
@MainActor
final class ConsolidationScheduler {

    static let workerName = "memory-consolidation"

    private var timer: Timer?
    private var markerURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/.last-consolidation")
    }

    /// Hours between passes; NOTCH_CONSOLIDATE_HOURS=0 disables.
    private var intervalHours: Double {
        NotchConfig.liveValue("NOTCH_CONSOLIDATE_HOURS").flatMap(Double.init) ?? 6
    }

    private var triggerTimer: Timer?
    private var triggerURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/.consolidate-now")
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1800, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkAndRun() }
        }
        // The agent (or user, by voice) requests a pass by touching
        // ~/.notch/.consolidate-now — poll for it cheaply.
        triggerTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, FileManager.default.fileExists(atPath: self.triggerURL.path) else { return }
                try? FileManager.default.removeItem(at: self.triggerURL)
                self.runNow()
            }
        }
        // Also check shortly after launch (covers overnight gaps).
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            self?.checkAndRun()
        }
    }

    private func checkAndRun() {
        let hours = intervalHours
        guard hours > 0 else { return }

        let fm = FileManager.default
        let markerAttrs = try? fm.attributesOfItem(atPath: markerURL.path)
        let lastRun = (markerAttrs?[.modificationDate] as? Date) ?? .distantPast
        guard Date().timeIntervalSince(lastRun) > hours * 3600 else { return }

        // Only when there's new experience to consolidate.
        let journalAttrs = try? fm.attributesOfItem(atPath: JournalStore.url.path)
        guard let journalModified = journalAttrs?[.modificationDate] as? Date,
              journalModified > lastRun else { return }

        runNow()
    }

    /// Kick off a consolidation pass (also exposed via the menu).
    func runNow() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let sessions = "\(home)/.notch/sessions"
        let pidFile = "\(sessions)/\(Self.workerName).pid"

        // Don't stack passes.
        if let pidText = try? String(contentsOfFile: pidFile, encoding: .utf8),
           let pid = Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines)),
           kill(pid, 0) == 0 {
            NSLog("[Notch] consolidation already running")
            return
        }

        try? FileManager.default.createDirectory(atPath: sessions, withIntermediateDirectories: true)
        try? Data().write(to: markerURL)

        guard let claude = ClaudeCodeInvoker.findClaudeBinary() else { return }

        let prompt = Self.consolidationPrompt
        let command = """
        cd "\(home)/.notch" && nohup "\(claude)" -p \(shellQuote(prompt)) \
        --model claude-sonnet-5 --output-format stream-json --verbose \
        --permission-mode bypassPermissions --setting-sources "" --strict-mcp-config \
        > "\(sessions)/\(Self.workerName).jsonl" 2>&1 < /dev/null & echo $! > "\(pidFile)"
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-c", command]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        process.environment = env
        try? process.run()
        JournalStore.append("CONSOLIDATION pass started")
        NSLog("[Notch] consolidation worker launched")
    }

    private func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private static let consolidationPrompt = """
    You are Notch's memory consolidation process — its sleep phase. The \
    working directory (~/.notch) is Notch's memory vault, Obsidian-compatible \
    markdown. Notch is a voice assistant living in the MacBook notch; you are \
    improving its memory while the user is away.

    The vault:
    - journal.md — chronological log of everything Notch did
    - failures.log — raw failure records since the last consolidation
    - lessons.md — distilled lessons; the bullet lines ride along in EVERY \
    future Notch prompt, so keep them short, general, and high-value
    - skills/*.sh — executable skills (header lines `# skill: <name>` and \
    `# description: <when to use it>`)
    - MOC.md — the vault's index (map of content)

    Do these, in order:
    1. Read journal.md (focus on entries since the last CONSOLIDATION line) \
    and failures.log.
    2. PROMOTE: if the journal shows the same kind of multi-step task done \
    repeatedly, compile it into a new executable skill in skills/ (kebab-case \
    filename, the header format above, chmod +x). Test it once ONLY if the \
    test is harmless and side-effect-free; never test anything destructive \
    or state-changing.
    3. DISTILL: convert failure records and hard-won discoveries into \
    one-line lessons in lessons.md, formatted `- [[topic]]: lesson`. Merge \
    duplicates, delete lessons that proved wrong, keep the file under 40 \
    bullet lines total.
    4. INDEX: update MOC.md with [[wikilinks]] to every skill and lesson \
    topic so the vault graph stays connected.
    5. Clear failures.log (write an empty file) — you have processed it.
    6. Append one line to journal.md: `- [<date>] CONSOLIDATION: <what you \
    did>`.

    Your final message will be spoken aloud to the user by the notch: 1-2 \
    natural sentences summarizing what you learned or created (e.g. "While \
    you were away I compiled two new skills and noted a lesson about Safari \
    dialogs."). If there was nothing worth consolidating, say so briefly.
    """
}
