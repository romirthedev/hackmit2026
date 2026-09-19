import AppKit
import Foundation

/// Shells out to `claude -p` in headless mode (subscription auth via
/// `claude setup-token`, not a metered API key) and streams events back so
/// the UI can narrate execution live.
///
/// Note on the spec: `--bare` is deliberately NOT used — in current CLI
/// versions it disables OAuth/keychain auth entirely, which breaks the
/// setup-token path. Self-contained behavior comes from `--setting-sources ""`,
/// an explicit `--system-prompt`, and a scratch working directory instead.
final class ClaudeCodeInvoker {

    struct StreamEvent {
        enum Kind {
            /// A concrete tool invocation worth narrating ("Opening Safari…").
            /// `toolName`/`detail` carry the raw call (command or file path)
            /// for the per-request activity log.
            case step(text: String, isCommand: Bool, isVerification: Bool, toolName: String, detail: String)
            /// The agent's final text output.
            case result(text: String, isError: Bool, sessionID: String?, costUSD: Double?)
        }
        let kind: Kind
    }

    enum InvokerError: LocalizedError {
        case claudeNotFound
        case launchFailed(String)
        case timedOut

        var errorDescription: String? {
            switch self {
            case .claudeNotFound: return "The `claude` CLI was not found. Install Claude Code and run `claude setup-token`."
            case .launchFailed(let why): return "Couldn't start the agent: \(why)"
            case .timedOut: return "The agent took too long and was stopped."
            }
        }
    }

    /// Captured from the last run; pass back for follow-ups within one
    /// expanded-panel session. Cleared by the view model on collapse.
    private(set) var lastSessionID: String?
    /// Dev-only sanity check against rate limits; never user-facing.
    private(set) var lastCostUSD: Double?

    private var process: Process?
    /// Progress-aware watchdog, not a fixed kill timer. Verified action
    /// flows (act → screenshot → inspect, per step) run several model
    /// turns; multi-page web flows need real room, so healthy long runs
    /// must never be killed. The agent is terminated only when
    /// (a) no stream-json output has arrived for `idleTimeout` seconds —
    /// a genuine stall; every event extends the deadline indefinitely — or
    /// (b) total runtime exceeds `hardTimeout`, a runaway backstop.
    /// NOTCH_AGENT_TIMEOUT is honored as a legacy override for the hard
    /// ceiling when NOTCH_AGENT_MAX_TIMEOUT is unset.
    private var idleTimeout: TimeInterval {
        NotchConfig.liveValue("NOTCH_AGENT_IDLE_TIMEOUT").flatMap(Double.init) ?? 180
    }
    private var hardTimeout: TimeInterval {
        NotchConfig.liveValue("NOTCH_AGENT_MAX_TIMEOUT").flatMap(Double.init)
            ?? NotchConfig.liveValue("NOTCH_AGENT_TIMEOUT").flatMap(Double.init)
            ?? 3600
    }

    // MARK: - Screen resolution facts

    /// Returns a block describing the main screen's resolution in both
    /// points and pixels, including backingScaleFactor (Retina).
    private static func screenResolutionBlock() -> String {
        guard let screen = NSScreen.main else { return "" }
        let pointW = Int(screen.frame.width)
        let pointH = Int(screen.frame.height)
        let scale = Int(screen.backingScaleFactor)
        let pixelW = pointW * scale
        let pixelH = pointH * scale
        return """
            SCREEN RESOLUTION FACTS (main display):
            - Points: \(pointW) × \(pointH)
            - Pixels: \(pixelW) × \(pixelH)
            - Backing scale factor: \(scale)x (Retina)
            - Coordinate conversion: divide screenshot pixel coordinates \
            by \(scale) to get screen points for click targets.
            - Example: a button at pixel (\(pixelW * 3 / 4), \(pixelH / 2)) \
            in a screenshot is clicked at point (\(pointW * 3 / 4), \(pointH / 2)).
            """
    }

    // MARK: - Model capability tier

    /// Top-tier models that handle the perceive→act→verify loop reliably
    /// without extra hand-holding. Edit this list as new models emerge.
    private static let topTierPatterns: [String] = [
        "claude",       // all Claude models
        "gpt-5",        // GPT-5 family
        "gpt-4",        // GPT-4 family
        "o1",           // OpenAI o1
        "o3",           // OpenAI o3
        "o4",           // OpenAI o4
        "gemini-.*-pro", // Gemini Pro tiers
        "gemini-.*-ultra",
        "fable",        // Fable family
    ]

    private static func isTopTierModel(_ model: String) -> Bool {
        let lower = model.lowercased()
        return topTierPatterns.contains { pattern in
            lower.range(of: pattern, options: .regularExpression) != nil
        }
    }

    /// Extra guidance appended for weaker/less-agentic models that need
    /// explicit step-by-step recipes to drive the perceive→act→verify loop.
    private static let stepByStepGuidance = """

        GUIDANCE FOR STEP-BY-STEP OPERATION
        You are running in guided mode. Follow these rules strictly:

        RULE 1 — ONE TOOL CALL AT A TIME. Make exactly one tool call per \
        turn. Wait for the result before deciding the next step.

        RULE 2 — SCREENSHOT BEFORE AND AFTER EVERY UI ACTION. Before you \
        act on the screen, take a screenshot to see current state. After \
        every action, take another screenshot to verify the result.

        RECIPE TEMPLATES — use these exact patterns:

        • Take a screenshot and look at it:
          Bash: screencapture -x /tmp/notch-see.png
          Read: /tmp/notch-see.png

        • Click at a screen coordinate (points, NOT pixels):
          Bash: osascript -e 'tell application "System Events" to click at {x, y}'

        • Type text:
          Bash: osascript -e 'tell application "System Events" to keystroke "hello"'

        • Press a key (e.g. Return):
          Bash: osascript -e 'tell application "System Events" to key code 36'

        • Open a URL or app:
          Bash: open "https://example.com"
          (then sleep 2, then screenshot to verify it loaded)

        WORKED EXAMPLE — open a website and click a button:

        Turn 1: Take a screenshot to see current state.
          → Bash: screencapture -x /tmp/notch-see.png
        Turn 2: Read the screenshot.
          → Read: /tmp/notch-see.png
        Turn 3: Open the target URL.
          → Bash: open "https://example.com"
        Turn 4: Wait for the page to load.
          → Bash: sleep 2
        Turn 5: Screenshot to verify the page loaded.
          → Bash: screencapture -x /tmp/notch-see.png
        Turn 6: Read the screenshot to find the button position.
          → Read: /tmp/notch-see.png
          (Identify the button's pixel position in the screenshot, \
        then divide by the backing scale factor to get points.)
        Turn 7: Click the button.
          → Bash: osascript -e 'tell application "System Events" to click at {600, 400}'
        Turn 8: Wait and screenshot to verify.
          → Bash: sleep 1 && screencapture -x /tmp/notch-verify.png
        Turn 9: Read the verification screenshot.
          → Read: /tmp/notch-verify.png
          (Confirm the click had the intended effect.)
        Turn 10: Return your final JSON result.

        REQUIRED FINAL JSON — your very last message must be ONLY this \
        JSON (no other text around it):
        {
          "type": "action",
          "steps": ["Opened example.com", "Clicked the Sign In button"],
          "response": "Done — I opened the site and clicked Sign In.",
          "success": true
        }
        For a question (no action needed):
        {
          "type": "answer",
          "steps": [],
          "response": "The answer is 42.",
          "success": true
        }
        """

    private static func systemPrompt(skillsSection: String, model: String, permFlags: String) -> String {
        let screenInfo = screenResolutionBlock()
        let base = """
        You are Notch, a voice-activated macOS assistant with real system \
        access, living in the MacBook's notch.
        You receive a transcribed spoken request, usually preceded by a \
        <screen_context> block describing what the user is looking at right \
        now (frontmost app, window title, selected text, visible UI). When \
        the user says "this", "that", "it", "this email", "this error" — \
        resolve it against the screen context.

        \(screenInfo)

        Decide:

        1. If it's a QUESTION (general knowledge, calculation, something \
        answerable from the screen context) — answer directly and concisely. \
        The response will be SPOKEN ALOUD; write 1-3 natural conversational \
        sentences. Do NOT use tools for a question you can answer directly.

        2. If it's an ACTION (open something, navigate somewhere, run \
        something, fill out something, reply to something) — do NOT describe \
        what you would do. Execute it with a strict PERCEIVE → ACT → VERIFY \
        loop. Never fire-and-forget:
           - PERCEIVE: if <screen_context> isn't enough to act confidently,
             look first: `screencapture -x /tmp/notch-see.png` then Read
             that file — you can see images.
           - ACT: one concrete step at a time. Use `open <url>` for
             sites/apps, `osascript -e '<applescript>'` for native app
             automation (Safari, Mail, Messages, Calendar, System
             Settings…). Set every Bash call's `description` to one short
             present-tense line ("Opening Safari" / "Filling the address
             field") so the UI narrates live.
           - VERIFY: after EVERY state-changing step, wait for the UI to
             settle (`sleep 1`; 2-3s for page loads), then
             `screencapture -x /tmp/notch-verify.png` and Read it. Confirm
             the screen actually changed the way you intended — right page
             loaded, field contains the right text, dialog dismissed. Do
             not take the command's exit code as proof; the screenshot is
             the proof.
           - If the screen does NOT match your intent: diagnose from the
             screenshot (popup blocking? wrong page? focus elsewhere? typo
             in the field?), adjust your approach and retry — at most 2
             retries per step. Still stuck → stop and ask the user (type
             "clarify"), describing what you actually see.
           - If a step needs information you don't have (payment
             confirmation, ambiguous destination), stop and ask ONE
             clarifying question rather than guessing.
           - Report success:true ONLY when your final verification
             screenshot confirms the outcome. Never claim success you
             haven't seen.

        3. If the request is ambiguous or you're not confident, ask a short \
        clarifying question.

        SKILLS
        \(skillsSection)
        LEARNING: when you figure out how to do something reusable — or the \
        user explicitly asks you to learn something — save it as an \
        executable script at ~/.notch/skills/<kebab-name>.sh whose first \
        lines are `#!/bin/bash`, `# skill: <name>`, `# description: <one \
        line, when to use it>`. chmod +x it, run it once to verify it works, \
        and report it via "learned_skill" in your final JSON. Parameterize \
        with script arguments where sensible.

        BACKGROUND CODING WORKERS — you can start and completely manage \
        other Claude Code sessions:
        For any substantial coding task in a repo ("have Claude Code do X \
        in <repo>", "fix the tests in <repo>"), NEVER run `claude` \
        synchronously — it outlives your turn. Start a DETACHED worker:
          cd <repo> && nohup claude -p "<task>" --output-format stream-json \
        --verbose \(permFlags) \
        > ~/.notch/sessions/<kebab-name>.jsonl 2>&1 < /dev/null & \
        echo $! > ~/.notch/sessions/<kebab-name>.pid
        Then respond IMMEDIATELY (type "action") saying you've started it — \
        the notch watches worker logs and will tell the user proactively \
        when it finishes. Do NOT wait for or poll the worker yourself.
        STATUS ("how's the X task going?"): read the tail of the worker's \
        .jsonl (e.g. `tail -c 30000`), then summarize what it's currently \
        doing (its recent tool calls / final result) in one spoken sentence.
        STEER or FOLLOW-UP on a finished/running worker: its session_id is \
        on every log line. Resume it detached, appending to the same log:
          cd <repo> && nohup claude --resume <session_id> -p \
        "<instruction>" --output-format stream-json --verbose \
        \(permFlags) \
        >> ~/.notch/sessions/<kebab-name>.jsonl 2>&1 < /dev/null & \
        echo $! > ~/.notch/sessions/<kebab-name>.pid
        STOP: kill $(cat ~/.notch/sessions/<kebab-name>.pid)
        REPO HYGIENE (for you AND every worker prompt you write): commit \
        and push ONLY files that belong to the task's repo and scope. \
        NEVER `git add` stray files from other projects, notes, reviews, \
        or anything outside the task — check `git status` before \
        committing and leave unrelated files untracked. Pushing someone's \
        unrelated work data to a public repo is a serious failure.
        Common repos live under ~. Resolve spoken repo names against \
        directory names (e.g. "peak" → ~/peak); if genuinely ambiguous, \
        clarify.

        SELF-IMPROVEMENT — you can modify your own code:
        You ARE the Notch app; your source lives at ~/notch (Swift/SwiftUI, \
        SwiftPM). When the user asks you to change your own behavior, UI, \
        or capabilities, start a DETACHED WORKER in ~/notch (workers \
        survive your own restart) with a task of this shape:
          "<the change>. Then run scripts/build-app.sh and confirm it \
        prints a success checkmark — NEVER relaunch on a failed build. \
        Then relaunch the app: pkill -x Notch; sleep 1; open \
        ~/notch/build/Notch.app. Verify the process is running again \
        (pgrep -x Notch). If the new build crashes on launch, roll back: \
        rm -rf ~/notch/build/Notch.app && cp -R ~/notch/build/Notch.app.bak \
        ~/notch/build/Notch.app && open ~/notch/build/Notch.app."
        Tell the user you've started the self-modification and that you'll \
        restart yourself when it's ready. Config values in ~/.notch/config \
        (API keys, model, voice) are NOT code — write those directly \
        yourself without a worker.

        WHEN APPLESCRIPT CAN'T REACH A UI (Chrome, Electron apps, web \
        content): you can SEE the screen. Run \
        `screencapture -x /tmp/notch-see.png`, then Read that file — you can \
        view images. Divide screenshot pixel coordinates by the backing \
        scale factor (see SCREEN RESOLUTION FACTS above) to get screen \
        points. Then interact via System Events: \
        `osascript -e 'tell application "System Events" to click at {x, y}'` \
        and `keystroke "text"`. Prefer AppleScript dictionaries when they \
        exist; this is the fallback.

        DIAGNOSING FAILURES: never call a failure "transient", "a flake", or \
        "would pass on a retry" unless you have EVIDENCE it is \
        non-deterministic — it actually succeeded on a re-run, or the error \
        is a known infra signature (HTTP 429/5xx, network timeout, registry \
        rate-limit). An identical error that repeats across attempts is \
        DETERMINISTIC: find and state the real root cause instead of blaming \
        luck. Read the actual error text and inspect the inputs it names (a \
        missing file/dir, a rejected flag, an empty source) before concluding \
        anything. An honest "success: false" with a root cause beats a \
        falsely reassuring "just retry".

        SUBSTANTIAL OUTPUT: when the result is long-form (a report, table, \
        document, code, anything beyond ~5 sentences), do NOT cram it into \
        "response". Write it to a file in ~/NotchOutbox/ (mkdir -p first; \
        kebab-case filename, proper extension), open it with `open <file>` \
        so it appears on screen, keep "response" to one short spoken \
        sentence, and include "output_file": "<absolute path>" in your \
        final JSON. The notch panel and the phone remote both surface that \
        file.

        MEMORY: a <recent_activity> block in the request shows your recent \
        journal, and a <lessons> block shows lessons distilled from your \
        past mistakes — apply them. A <memory_graph> block shows your \
        vault's map of content (~/.notch/MOC.md) — scan it every request \
        and Read any [[linked]] note relevant to the task before acting. \
        Your full memory vault lives in ~/.notch \
        (journal.md, lessons.md, MOC.md, skills/) — Read those files when \
        asked about earlier work; trust them over guessing. When writing \
        vault files, link related notes Obsidian-style: [[skill-name]]. \
        If the user asks you to reflect on or consolidate your memory, \
        touch the file ~/.notch/.consolidate-now (the app watches for it) \
        and tell them consolidation is starting.

        Work fast: prefer a single decisive step over exploratory tool loops.

        Your final message must be ONLY structured JSON in this exact shape \
        (no prose around it):
        {
          "type": "answer" | "action" | "clarify",
          "steps": ["short present-tense action description", ...],
          "response": "final message, will be spoken aloud, keep it natural",
          "success": true | false,
          "learned_skill": "<skill name — include ONLY if you saved a new skill>",
          "output_file": "<absolute path — include ONLY if you wrote a substantial output file>"
        }
        """
        if isTopTierModel(model) {
            return base
        }
        return base + stepByStepGuidance
    }

    /// Appended to the system prompt of sessions launched while another
    /// session holds the GUI token: parallel sessions must transcribe and
    /// answer concurrently, but only ONE session may drive the screen at a
    /// time — two agents fighting over the mouse/keyboard corrupt each
    /// other's PERCEIVE → ACT → VERIFY loops.
    private static let guiRestriction = """

        PARALLEL SESSION — SCREEN IS BUSY: another Notch session is \
        controlling the screen right now, so in THIS session GUI automation \
        is OFF-LIMITS: no AppleScript UI scripting or System Events \
        clicks/keystrokes, no opening/switching/closing apps or windows, no \
        `open <url>`, and no screenshot-driven interaction loops. You may \
        still answer questions, run non-GUI shell commands (curl, file \
        reads/writes, computations), and start detached background workers. \
        If the request fundamentally requires controlling the screen, don't \
        attempt it — reply (type "answer", success true) with one short \
        sentence saying you'll need the screen once the current task \
        finishes.
        """

    /// Reset per-panel-session continuity (call when the panel collapses).
    func resetSession() {
        lastSessionID = nil
    }

    func cancel() {
        process?.terminate()
        process = nil
    }

    /// Runs one request, invoking `onEvent` on the main queue for each
    /// narratable step and finally exactly one `.result` event.
    /// `contextBlock` is the deictic screen-context snapshot, if captured.
    /// `allowGUI: false` marks a parallel session that must not drive the
    /// screen while another session holds the GUI token.
    // MARK: - Permission mode plumbing

    /// Writes the MCP config that exposes the bundled permission shim and
    /// returns its path. The shim POSTs each ask to Notch's local server.
    private static func writePermissionMCPConfig() -> String? {
        guard let shim = Bundle.main.path(forResource: "permission-mcp", ofType: "py") else { return nil }
        let cfgURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/permission-mcp.json")
        let cfg: [String: Any] = [
            "mcpServers": [
                "notchperm": ["command": "/usr/bin/python3", "args": [shim]]
            ]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: cfg, options: [.sortedKeys]) else { return nil }
        try? data.write(to: cfgURL, options: .atomic)
        return cfgURL.path
    }

    /// (args for our own invocation, flag string for worker spawn templates)
    @MainActor
    private static func permissionArguments() -> (own: [String], workerFlags: String) {
        switch PermissionStore.shared.mode {
        case .bypass:
            return (
                ["--allowedTools", "Bash,Read,Write", "--permission-mode", "bypassPermissions"],
                "--permission-mode bypassPermissions"
            )
        case .auto, .manual:
            guard let cfg = writePermissionMCPConfig() else {
                // Shim missing — fail safe by keeping prompts on (default mode).
                return ([], "")
            }
            let own = ["--permission-prompt-tool", "mcp__notchperm__approve", "--mcp-config", cfg]
            return (own, "--permission-prompt-tool mcp__notchperm__approve --mcp-config \(cfg)")
        }
    }

    func run(request: String, contextBlock: String? = nil, allowGUI: Bool = true,
             activeTasksBlock: String? = nil,
             onEvent: @escaping (StreamEvent) -> Void) throws {
        guard let claude = Self.findClaudeBinary() else {
            throw InvokerError.claudeNotFound
        }

        var prompt = ""
        if let contextBlock, !contextBlock.isEmpty {
            prompt += contextBlock + "\n\n"
        }
        let journalTail = JournalStore.tail()
        if !journalTail.isEmpty {
            prompt += "<recent_activity note=\"your journal; full history at ~/.notch/journal.md — read that file when asked about past work\">\n"
            prompt += journalTail + "\n</recent_activity>\n\n"
        }
        if let tasksBlock = activeTasksBlock, !tasksBlock.isEmpty {
            prompt += "<active_tasks note=\"long-horizon tasks you are managing — check status, avoid duplicating work\">\n"
            prompt += tasksBlock + "\n</active_tasks>\n\n"
        }
        let lessons = JournalStore.lessonsTail()
        if !lessons.isEmpty {
            prompt += "<lessons note=\"distilled from your past mistakes and discoveries — apply them\">\n"
            prompt += lessons + "\n</lessons>\n\n"
        }
        let moc = JournalStore.mocContents()
        if !moc.isEmpty {
            prompt += "<memory_graph note=\"your memory vault's map of content (~/.notch/MOC.md). [[links]] are notes in ~/.notch/ (e.g. [[personalities]] -> ~/.notch/personalities.md) or skills in ~/.notch/skills/. Scan this every request and Read any linked note relevant to the current task BEFORE acting.\">\n"
            prompt += moc + "\n</memory_graph>\n\n"
        }
        prompt += "USER REQUEST (spoken): " + request

        // Runtime model: Fable 5. The perceive→act→verify loop is
        // load-bearing — sustained multi-step sessions where the model
        // inspects its own screenshots and self-corrects are exactly what
        // the deeper model buys; a faster model verifies sloppily.
        let model = NotchConfig.shared["NOTCH_MODEL"] ?? "claude-fable-5"
        // run() is always entered from the view model on the main thread.
        let permission = MainActor.assumeIsolated { Self.permissionArguments() }

        var args = [
            "-p", prompt,
            "--model", model,
            "--output-format", "stream-json",
            "--verbose",
            "--setting-sources", "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--system-prompt", Self.systemPrompt(
                skillsSection: SkillLibrary.promptSection(),
                model: model,
                permFlags: permission.workerFlags
            ) + (allowGUI ? "" : Self.guiRestriction),
        ]
        args += permission.own
        // Light continuity within one expanded-panel session: follow-ups
        // resume the same agent session. Only in bypass mode — resumed
        // sessions can carry cached tool approvals, which would let a
        // previously-allowed tool skip the permission hook.
        let bypassing = MainActor.assumeIsolated { PermissionStore.shared.mode == .bypass }
        if bypassing, let session = lastSessionID {
            args += ["--resume", session]
        }

        // Scratch cwd keeps invocations self-contained (no project CLAUDE.md,
        // no repo access side effects).
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("notch-agent", isDirectory: true)
        try? FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: claude)
        proc.arguments = args
        proc.currentDirectoryURL = scratch
        var env = ProcessInfo.processInfo.environment
        let extraPaths = [
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/.local/bin",
            "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
        ]
        env["PATH"] = (extraPaths + [(env["PATH"] ?? "")]).joined(separator: ":")
        proc.environment = env

        let stdout = Pipe()
        proc.standardOutput = stdout
        proc.standardError = Pipe()

        var buffer = Data()
        var finished = false
        var resultDelivered = false
        var lastActivity = Date()
        var watchdog: DispatchSourceTimer?
        let startedAt = Date()
        let lock = NSLock()

        func deliverResult(_ text: String, isError: Bool, sessionID: String?, costUSD: Double?) {
            lock.lock()
            let alreadyDone = resultDelivered
            resultDelivered = true
            lock.unlock()
            guard !alreadyDone else { return }
            DispatchQueue.main.async { [weak self] in
                self?.lastSessionID = sessionID ?? self?.lastSessionID
                self?.lastCostUSD = costUSD
                if let cost = costUSD {
                    NSLog("[Notch] agent turn cost: $%.4f", cost)
                }
                onEvent(StreamEvent(kind: .result(text: text, isError: isError, sessionID: sessionID, costUSD: costUSD)))
            }
        }

        stdout.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else { return }
            // Each chunk of stream-json (tool call, assistant event) is
            // forward progress: push the idle deadline out.
            lock.lock()
            lastActivity = Date()
            lock.unlock()
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: buffer.startIndex..<newline)
                buffer.removeSubrange(buffer.startIndex...newline)
                guard let event = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { continue }
                Self.handle(event: event, onStep: { text, isCommand, isVerification, toolName, detail in
                    DispatchQueue.main.async {
                        onEvent(StreamEvent(kind: .step(
                            text: text, isCommand: isCommand, isVerification: isVerification,
                            toolName: toolName, detail: detail)))
                    }
                }, onResult: deliverResult)
            }
        }

        proc.terminationHandler = { [weak self] p in
            lock.lock()
            finished = true
            let dog = watchdog
            watchdog = nil
            lock.unlock()
            dog?.cancel()
            stdout.fileHandleForReading.readabilityHandler = nil
            self?.process = nil
            if p.terminationStatus != 0 {
                deliverResult("The agent exited unexpectedly (code \(p.terminationStatus)). Try again.",
                              isError: true, sessionID: nil, costUSD: nil)
            } else {
                // Normal exit but no result event seen — extremely unlikely.
                deliverResult("Done.", isError: false, sessionID: nil, costUSD: nil)
            }
        }

        do {
            try proc.run()
        } catch {
            throw InvokerError.launchFailed(error.localizedDescription)
        }
        process = proc

        let idleLimit = idleTimeout
        let hardLimit = hardTimeout
        let dog = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
        dog.schedule(deadline: .now() + 15, repeating: 15)
        dog.setEventHandler { [weak proc, weak dog] in
            lock.lock()
            let done = finished
            let idle = Date().timeIntervalSince(lastActivity)
            let elapsed = Date().timeIntervalSince(startedAt)
            lock.unlock()
            guard !done, let proc, proc.isRunning else {
                dog?.cancel()
                return
            }
            if elapsed >= hardLimit {
                dog?.cancel()
                proc.terminate()
                deliverResult("The agent hit the \(Self.minutesPhrase(hardLimit))-minute ceiling and was stopped.",
                              isError: true, sessionID: nil, costUSD: nil)
            } else if idle >= idleLimit {
                dog?.cancel()
                proc.terminate()
                deliverResult("The agent stalled — no activity for \(Self.minutesPhrase(idleLimit)) minutes — and was stopped.",
                              isError: true, sessionID: nil, costUSD: nil)
            }
        }
        dog.resume()
        lock.lock()
        if finished {
            // Process already exited before the watchdog was registered.
            lock.unlock()
            dog.cancel()
        } else {
            watchdog = dog
            lock.unlock()
        }
    }

    /// "3" for 180s, "60" for 3600s — rounded whole minutes, minimum 1.
    private static func minutesPhrase(_ seconds: TimeInterval) -> String {
        String(max(1, Int((seconds / 60).rounded())))
    }

    // MARK: - Stream event parsing

    private static func handle(
        event: [String: Any],
        onStep: (String, Bool, Bool, String, String) -> Void,
        onResult: (String, Bool, String?, Double?) -> Void
    ) {
        switch event["type"] as? String {
        case "assistant":
            guard let message = event["message"] as? [String: Any],
                  let content = message["content"] as? [[String: Any]] else { return }
            for block in content where block["type"] as? String == "tool_use" {
                let name = block["name"] as? String ?? "Tool"
                let input = block["input"] as? [String: Any] ?? [:]
                let command = input["command"] as? String ?? ""
                let path = input["file_path"] as? String ?? ""
                let detail = command.isEmpty ? path : command

                // The perceive→act→verify protocol's inspection steps.
                if name == "Read", path.contains("notch-verify") || path.contains("notch-see") {
                    onStep("Checking the screen", false, true, name, detail)
                } else if command.contains("screencapture") {
                    onStep("Looking at the result", false, true, name, detail)
                } else if let description = input["description"] as? String, !description.isEmpty {
                    let verifying = description.lowercased().contains("verif")
                    onStep(description, false, verifying, name, detail)
                } else if name == "Bash", !command.isEmpty {
                    onStep(String(command.prefix(80)), true, false, name, detail)
                } else if !path.isEmpty {
                    onStep("\(name == "Read" ? "Reading" : "Writing") \((path as NSString).lastPathComponent)", false, false, name, detail)
                } else {
                    onStep("Running \(name)", false, false, name, detail)
                }
            }
        case "result":
            let text = event["result"] as? String ?? ""
            let isError = (event["is_error"] as? Bool) ?? false
            let sessionID = event["session_id"] as? String
            let cost = event["total_cost_usd"] as? Double
            onResult(text, isError, sessionID, cost)
        default:
            break
        }
    }

    static func findClaudeBinary() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.local/bin/claude",
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }
}
