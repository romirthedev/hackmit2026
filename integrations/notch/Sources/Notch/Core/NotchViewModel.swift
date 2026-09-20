import AppKit
import Combine
import Foundation

/// Single orchestrator for the whole interaction: owns the state machine,
/// drives audio → transcription → agent → UI, and guarantees every
/// transition is interruptible.
///
/// PARALLEL SESSIONS: every request runs as an independent `AgentSession`
/// with its own `claude` process. Activating Notch while sessions are
/// running never blocks, defers, or kills them — it opens a fresh capture
/// whose utterance becomes session N+1, running concurrently. The panel is
/// a single "stage" that shows one thing at a time (a live capture, one
/// running session's progress, or one finished result), while numbered
/// indicators along the notch's right edge show everything in flight.
/// Finished results present one at a time, in completion order, so spoken
/// responses never talk over each other.
@MainActor
final class NotchViewModel: ObservableObject {

    /// Set once at init. The Command Center's Active section reads the
    /// in-flight request through this (both are MainActor).
    private(set) static weak var shared: NotchViewModel?

    @Published private(set) var state: NotchState = .idle
    @Published var transcript = ""
    @Published var responseText = ""
    @Published var steps: [AgentStep] = []
    @Published var amplitude: CGFloat = 0
    @Published var errorMessage = ""
    @Published var showTextInput = false
    @Published var typedText = ""
    /// "still working…" sub-label when thinking exceeds 8s.
    @Published var stillWorking = false
    /// Drives the accentSuccess flash + checkmark pulse.
    @Published var actionSucceeded = false
    /// App the deictic screen context was captured from ("Seeing: Mail").
    @Published var contextAppName: String?
    /// Skill the agent taught itself during this request.
    @Published var learnedSkillName: String?
    /// Substantial output file the agent wrote to ~/NotchOutbox.
    @Published var outputFile: String?
    /// Background Claude Code workers currently running.
    @Published var workersRunning = 0
    /// Long-horizon task manager — tracks multi-step tasks across workers.
    let taskManager = TaskManager()
    /// All agent sessions currently running, in start order. Drives the
    /// numbered indicators beside the notch.
    @Published private(set) var sessions: [AgentSession] = []
    /// The running session whose live progress the panel is showing, if the
    /// stage isn't occupied by a capture or a finished result.
    @Published private(set) var stagedSessionID: UUID?
    /// Voice mode: when off, responses render in the panel but are never
    /// spoken. Persisted as NOTCH_TTS in ~/.notch/config.
    @Published var voiceModeEnabled: Bool = (NotchConfig.shared["NOTCH_TTS"] ?? "1") != "0" {
        didSet {
            guard voiceModeEnabled != oldValue else { return }
            speaker.enabled = voiceModeEnabled
            if !voiceModeEnabled { speaker.stop() }
            NotchConfig.setValue(voiceModeEnabled ? "1" : "0", forKey: "NOTCH_TTS")
        }
    }

    /// Meeting Mode: silently records system + mic audio, transcribes
    /// continuously, and writes meeting notes on exit.
    let meetingManager = MeetingModeManager()
    @Published var meetingModeActive = false

    /// Live Translator: captures system audio and shows a running English
    /// translation as scrolling captions until stopped. Never speaks.
    let translatorManager = TranslatorModeManager()
    @Published var translatorModeActive = false

    /// Set by the window controller so state changes resize the panel.
    var onExpansionChange: ((Bool) -> Void)?

    private let audio = AudioCaptureEngine()
    private let groq = GroqTranscriptionClient()
    /// Persists a detailed per-request activity log for the Command Center.
    private let requestLogger = RequestLogStore()
    private let contextProvider = ScreenContextProvider()
    private let speaker = SpeechSpeaker()
    private var screenContext: ScreenContext?

    private var transcriptionTask: Task<Void, Never>?
    private var collapseTask: Task<Void, Never>?
    private var stillWorkingTask: Task<Void, Never>?
    /// Monotonic staleness token for STAGE-scoped async work (transcription,
    /// collapse timers, speech callbacks). Bumping it orphans those without
    /// touching running sessions — session stream events are guarded by
    /// each session's own `cancelled` flag instead.
    private var generation = 0
    /// While Fn is held, the finger is the VAD: silence never finalizes
    /// or times out the utterance — only release does.
    private var pushToTalkHeld = false

    // MARK: Parallel-session bookkeeping

    /// True while a capture (open mic / typed input / remote command about
    /// to launch) owns the stage. Running sessions are untouched beneath it.
    private var captureActive = false
    /// True while a finished session's result owns the stage (being shown
    /// and spoken). Queued results wait for this to clear.
    private var presentationActive = false
    /// Finished results waiting for the stage, in completion order.
    private var presentationQueue: [Presentation] = []
    /// GUI-automation token: the one session allowed to drive the screen.
    /// Sessions launched while it's held run with GUI automation disabled
    /// (they still transcribe, think, and answer in parallel).
    private var guiSessionID: UUID?
    /// Conversation continuity across turns within one expanded-panel
    /// stretch: the invoker of the most recently presented result, so a
    /// barge-in or clarify follow-up resumes that conversation. Cleared on
    /// collapse to idle.
    private var carryInvoker: ClaudeCodeInvoker?

    /// A finished session's result, ready to be shown + spoken.
    private struct Presentation {
        /// Session whose indicator drops the moment this takes the stage.
        let sessionID: UUID?
        let request: String
        let steps: [AgentStep]
        let message: String
        let isFailure: Bool
        let type: AgentResponse.Kind?
        let learnedSkill: String?
        let outputFile: String?
        let invoker: ClaudeCodeInvoker
    }

    private var hasBackgroundWork: Bool {
        !sessions.isEmpty || !presentationQueue.isEmpty
    }

    private var stagedSession: AgentSession? {
        sessions.first { $0.id == stagedSessionID }
    }

    init() {
        Self.shared = self
        audio.onAmplitude = { [weak self] amp in
            guard let self, self.state == .listening else { return }
            // Map raw RMS into a usable 0...1 range for the waveform.
            self.amplitude = min(1, CGFloat(amp) * 18)
        }
        audio.onPause = { [weak self] wav in
            self?.transcribeLive(wav: wav)
        }
        audio.onUtteranceEnd = { [weak self] wav in
            guard let self, !self.pushToTalkHeld else { return }
            self.finishListening(wav: wav)
        }
        audio.onNoSpeechTimeout = { [weak self] in
            guard let self, self.state == .listening, !self.showTextInput, !self.pushToTalkHeld else { return }
            self.cancel()
        }
    }

    // MARK: - Triggers

    func toggle() {
        if state == .idle {
            activate()
        } else if stagedSessionID != nil && !captureActive && !presentationActive {
            // A running task is on stage — activating again asks something
            // NEW in parallel rather than killing or blocking the task.
            // (Escape still kills the staged session.)
            activate()
        } else {
            cancel()
        }
    }

    /// Ready the stage for a new capture. With sessions running or results
    /// pending, this is a SOFT takeover: only stage-side tasks are stopped —
    /// no invoker.cancel(), no queue clearing — so everything in flight
    /// keeps going underneath. Otherwise it's the full interrupt.
    private var remoteRequestID: String?
    private var remoteResponseSucceeded = false

    private func prepareStageForCapture() {
        remoteRequestID = nil
        remoteResponseSucceeded = false
        if hasBackgroundWork || presentationActive {
            generation += 1
            presentationActive = false
            stagedSessionID = nil
            speaker.onFinish = nil
            speaker.stop()
            transcriptionTask?.cancel()
            collapseTask?.cancel()
            stillWorkingTask?.cancel()
            stillWorking = false
        } else {
            interruptEverything()
        }
        captureActive = true
    }

    /// idle → listening. Also the retry path from `error`, and the
    /// parallel-ask path while sessions are running.
    func activate() {
        prepareStageForCapture()
        transition(to: .listening)
        transcript = ""
        responseText = ""
        steps = []
        errorMessage = ""
        typedText = ""
        showTextInput = false
        learnedSkillName = nil
        outputFile = nil
        captureScreenContext()

        AudioCaptureEngine.requestPermission { [weak self] granted in
            guard let self, self.state == .listening else { return }
            guard granted else {
                self.fail("Microphone access is off. Enable it in System Settings → Privacy & Security.")
                return
            }
            do {
                try self.audio.start()
            } catch {
                // Typed input still works without a mic.
                self.showTextInput = true
                self.transcript = ""
            }
        }
    }

    /// Escape / click-outside / programmatic cancel. Scoped to whatever owns
    /// the stage: a capture over running work dismisses just the capture; a
    /// presented result dismisses just the result (the next queued one takes
    /// the stage); a running session's progress view kills THAT session
    /// only. Only with nothing left in flight does the panel collapse.
    /// Deny every queued permission ask (cancel / shutdown paths).
    func denyAllPendingPermissions() {
        for (_, cont) in permissionContinuations { cont.resume(returning: false) }
        permissionContinuations.removeAll()
        permissionQueue.removeAll()
        pendingPermission = nil
    }

    func cancel() {
        denyAllPendingPermissions()
        if captureActive && hasBackgroundWork {
            dismissCapture()
            return
        }
        if presentationActive {
            endPresentation()
            return
        }
        if let session = stagedSession {
            terminate(session)
            return
        }
        if state == .error && hasBackgroundWork {
            stageFallback()
            return
        }
        goIdle()
    }

    /// A command arriving from the phone remote: same pipeline as typed
    /// input, panel expands on the Mac so both screens show the action.
    /// While sessions are running it becomes a parallel session like any
    /// other request.
    func remoteCommand(_ text: String) {
        prepareStageForCapture()
        pushToTalkHeld = false
        transcript = text
        responseText = ""
        steps = []
        errorMessage = ""
        learnedSkillName = nil
        outputFile = nil
        showTextInput = false
        captureScreenContext()
        transition(to: .thinking)
        // Give the context snapshot a beat to land before the agent runs.
        let gen = generation
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard let self, self.generation == gen, self.state == .thinking, self.captureActive else { return }
            self.runAgent(request: text, alreadyThinking: true)
        }
    }

    /// REWIND phone requests never silently interrupt unrelated work, and retries
    /// of the same accepted request do not repeat a computer action.
    func rewindCommand(_ text: String, id: String) -> Bool {
        if remoteRequestID == id { return transcript == text }
        // A phone follow-up may replace its completed result immediately.
        // It must still never interrupt a running or unrelated native request.
        let replacingRemoteResult = remoteRequestID != nil && presentationActive
            && (state == .responding || state == .error)
        guard !hasBackgroundWork, !captureActive,
              !presentationActive || replacingRemoteResult,
              state == .idle || state == .error || replacingRemoteResult else { return false }
        remoteCommand(text)
        remoteRequestID = id
        return true
    }

    func rewindCancel(id: String) -> Bool {
        guard remoteRequestID == id else { return false }
        cancel()
        return true
    }

    func resolveRemotePermission(id: String, allow: Bool) -> Bool {
        guard let ask = pendingPermission, ask.id.uuidString.lowercased() == id.lowercased() else { return false }
        finishPermission(id: ask.id, allow: allow)
        return true
    }

    /// Everything the phone UI renders.
    func remoteStateSnapshot() -> RemoteControlServer.StateSnapshot {
        let stateName: String
        switch state {
        case .idle: stateName = "idle"
        case .listening: stateName = "listening"
        case .thinking: stateName = stillWorking ? "still working…" : "thinking"
        case .executing: stateName = "executing"
        case .responding: stateName = "responding"
        case .error: stateName = "error"
        }
        return RemoteControlServer.StateSnapshot(
            state: stateName,
            transcript: transcript,
            response: responseText,
            steps: steps.map { ($0.text, $0.isVerification) },
            errorMessage: errorMessage,
            workersRunning: workersRunning,
            contextApp: contextAppName,
            actionSucceeded: remoteResponseSucceeded,
            learnedSkill: learnedSkillName,
            outputFile: outputFile,
            requestID: remoteRequestID,
            pendingPermission: pendingPermission.map { ["id": $0.id.uuidString, "tool": $0.tool, "detail": $0.detail] },
            accessibilityGranted: ScreenContextProvider.isTrusted(promptIfNeeded: false),
            screenRecordingGranted: CGPreflightScreenCaptureAccess()
        )
    }

    // MARK: - Command Center "Active" feed

    struct ActiveRequestSummary {
        let title: String
        let status: String
        let startedAt: Date
    }

    /// The in-flight request, if any, for the Command Center's Active
    /// section: the staged session if one is on stage, else the oldest
    /// running session.
    var activeRequestSummary: ActiveRequestSummary? {
        guard let session = stagedSession ?? sessions.first(where: { !$0.isFinished }) else { return nil }
        let status: String
        if let last = session.steps.last?.text {
            status = last
        } else {
            status = stillWorking ? "Still working…" : "Thinking…"
        }
        return ActiveRequestSummary(
            title: session.request.isEmpty ? "Current request" : session.request,
            status: status,
            startedAt: session.startedAt
        )
    }

    // MARK: - Push-to-talk (hold Fn)

    /// Fn held: start listening. Mid-response/mid-error it barges in; while
    /// sessions are running it opens a PARALLEL capture — the running work
    /// is never interrupted.
    func beginPushToTalk() {
        guard state != .listening else {
            pushToTalkHeld = true // re-hold during an open mic
            return
        }
        activate()
        pushToTalkHeld = true
    }

    /// Fn released: finalize the utterance NOW — no silence-VAD wait.
    /// A hold too short to contain speech cancels quietly.
    func endPushToTalk() {
        pushToTalkHeld = false
        guard state == .listening, !showTextInput else { return }
        let wav = audio.snapshotWAV()
        if wav.count < 16_000 && transcript.isEmpty { // < ~0.5s of audio
            cancel()
            return
        }
        finishListening(wav: wav)
    }

    /// Tab during listening reveals the typed-input fallback.
    func toggleTextInput() {
        guard state == .listening else { return }
        showTextInput.toggle()
        if showTextInput { audio.stop() }
    }

    func submitTypedText() {
        let text = typedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        transcript = text
        audio.stop()
        runAgent(request: text)
    }

    /// Indicator tap: bring a running session's progress onto the stage.
    func stage(sessionID: UUID) {
        guard !captureActive, !presentationActive, state != .error,
              sessionID != stagedSessionID,
              let session = sessions.first(where: { $0.id == sessionID }),
              !session.isFinished else { return }
        stageSession(session)
    }

    /// Snapshot what the user is looking at. Runs in the background while
    /// they speak; the panel is non-activating, so their app is still
    /// frontmost when this fires.
    private func captureScreenContext() {
        screenContext = nil
        contextAppName = nil
        let gen = generation
        let provider = contextProvider
        Task.detached(priority: .userInitiated) {
            let context = provider.capture()
            await MainActor.run { [weak self] in
                guard let self, self.generation == gen else { return }
                self.screenContext = context
                self.contextAppName = context?.appName
            }
        }
    }

    // MARK: - Voice flow

    private func transcribeLive(wav: Data) {
        guard state == .listening, !showTextInput, wav.count > 8_000 else { return }
        let gen = generation
        transcriptionTask?.cancel()
        transcriptionTask = Task { [weak self] in
            guard let self else { return }
            guard let text = try? await self.groq.transcribe(wav: wav) else { return }
            guard !Task.isCancelled, self.generation == gen, self.state == .listening else { return }
            if !text.isEmpty { self.transcript = text }
        }
    }

    private func finishListening(wav: Data) {
        guard state == .listening, !showTextInput else { return }
        audio.stop()
        amplitude = 0
        transition(to: .thinking)

        let gen = generation
        Task { [weak self] in
            guard let self else { return }
            // Final-pass transcription of the full utterance for accuracy.
            var text = self.transcript
            if wav.count > 8_000 {
                do {
                    text = try await self.groq.transcribe(wav: wav)
                } catch {
                    if text.isEmpty {
                        guard self.generation == gen else { return }
                        self.fail(error.localizedDescription)
                        return
                    }
                }
            }
            guard self.generation == gen, self.state == .thinking else { return }
            let request = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !request.isEmpty else {
                self.fail("I didn't catch that. Try again?")
                return
            }
            self.transcript = request
            self.runAgent(request: request, alreadyThinking: true)
        }
    }

    // MARK: - Agent flow

    private func runAgent(request: String, alreadyThinking: Bool = false) {
        // Intercept meeting mode voice commands before hitting the agent.
        let lower = request.lowercased()

        // Live Translator voice commands. "stop"/"end" is checked first so
        // "stop translating" can never mis-fire into a start (it contains
        // "translat"). A bare "stop" also ends translation while it's running.
        if lower.contains("translat") || (translatorModeActive && lower.contains("stop")) {
            if lower.contains("stop") || lower.contains("end") || lower.contains("turn off")
                || lower.contains("dismiss") || lower.contains("disable") || lower.contains("cancel") {
                captureActive = false
                stopTranslatorMode()
                stageFallback()
                return
            }
            if lower.contains("translate this") || lower.contains("translate that")
                || lower.contains("start") || lower.contains("live translate")
                || lower.contains("begin") || lower.contains("turn on")
                || lower.contains("translate") {
                captureActive = false
                startTranslatorMode()
                stageFallback()
                return
            }
        }

        if lower.contains("meeting mode") || lower.contains("meeting-mode") {
            // Deactivation is checked FIRST on purpose: "deactivate" contains
            // the substring "activate", so an activate-first check would
            // mis-fire "deactivate meeting mode" into a start.
            if lower.contains("deactivate") || lower.contains("stop") || lower.contains("exit")
                || lower.contains("end") || lower.contains("leave") || lower.contains("turn off") {
                captureActive = false
                stopMeetingMode()
                stageFallback()
                return
            }
            if lower.contains("activate") || lower.contains("start") || lower.contains("enter")
                || lower.contains("begin") || lower.contains("turn on") {
                captureActive = false
                startMeetingMode()
                stageFallback()
                return
            }
        }

        if !alreadyThinking { transition(to: .thinking) }
        startSession(request: request)
    }

    /// Launch an independent agent session for `request`. The new session
    /// takes the stage; anything already running keeps going beside it.
    private func startSession(request: String) {
        captureActive = false
        generation += 1
        // Continuity: a follow-up right after a presented result resumes
        // that conversation; otherwise the session starts fresh.
        let invoker = carryInvoker ?? ClaudeCodeInvoker()
        carryInvoker = nil
        let session = AgentSession(
            number: (sessions.map(\.number).max() ?? 0) + 1,
            request: request,
            invoker: invoker,
            logID: requestLogger.begin(request: request),
            isFollowUp: invoker.lastSessionID != nil
        )
        sessions.append(session)
        // GUI token: only one session at a time may drive the screen.
        // Sessions launched while it's held run headless — they still
        // transcribe, think, and answer in parallel, but never touch the
        // mouse, keyboard, or windows.
        let allowGUI = guiSessionID == nil
        if allowGUI { guiSessionID = session.id }
        stagedSessionID = session.id
        presentationActive = false
        restartStillWorkingClock()

        do {
            try invoker.run(
                request: request,
                contextBlock: screenContext?.promptBlock,
                allowGUI: allowGUI,
                activeTasksBlock: taskManager.activeTasksBlock()
            ) { [weak self, weak session] event in
                guard let self, let session, !session.cancelled else { return }
                self.handle(event, for: session)
            }
        } catch {
            session.cancelled = true
            sessions.removeAll { $0.id == session.id }
            if guiSessionID == session.id { guiSessionID = nil }
            requestLogger.abandon(session.logID)
            stagedSessionID = nil
            fail(error.localizedDescription)
        }
    }

    private func handle(_ event: ClaudeCodeInvoker.StreamEvent, for session: AgentSession) {
        switch event.kind {
        case .step(let text, let isCommand, let isVerification, let toolName, let detail):
            // The log records every step, even ones the live UI collapses.
            requestLogger.recordStep(
                session.logID,
                text: text, toolName: toolName, detail: detail,
                isCommand: isCommand, isVerification: isVerification)
            // Collapse consecutive "checking" steps into one row.
            if !(isVerification && session.steps.last?.isVerification == true) {
                session.steps.append(AgentStep(text: text, isCommand: isCommand, isVerification: isVerification))
            }
            // Mirror onto the panel only while this session is on stage.
            guard stagedSessionID == session.id else { return }
            if state == .thinking { transition(to: .executing) }
            guard state == .executing else { return }
            steps = session.steps
        case .result(let text, let isError, _, _):
            sessionFinished(session, text: text, isError: isError)
        }
    }

    /// A session's turn is over: journal + log it immediately and queue its
    /// result for the stage. The indicator does NOT drop yet — it dims, and
    /// disappears only when the answer itself takes the stage (in present),
    /// so number and answer always vanish together.
    private func sessionFinished(_ session: AgentSession, text: String, isError: Bool) {
        session.isFinished = true
        sessions = sessions // republish: class mutation is invisible to @Published
        if guiSessionID == session.id { guiSessionID = nil }
        if stagedSessionID == session.id {
            stagedSessionID = nil
            stillWorkingTask?.cancel()
            stillWorking = false
        }

        guard !isError else {
            JournalStore.recordFailure(request: session.request, detail: text, steps: session.steps.map(\.text))
            requestLogger.finish(
                session.logID,
                response: text, kind: "FAILED", success: false,
                learnedSkill: nil, outputFile: nil, journalEntry: nil, fallbackSteps: [])
            enqueue(Presentation(
                sessionID: session.id, request: session.request, steps: session.steps,
                message: text.isEmpty ? "Something went wrong. Try again?" : text,
                isFailure: true, type: nil, learnedSkill: nil, outputFile: nil,
                invoker: session.invoker))
            return
        }

        let parsed = AgentResponse.parse(from: text)
            ?? AgentResponse(type: .answer, response: text.trimmingCharacters(in: .whitespacesAndNewlines))

        // Merge any steps the agent reported that we didn't see live.
        if session.steps.isEmpty {
            session.steps = parsed.steps.map { AgentStep(text: $0, isCommand: false) }
        }

        guard parsed.success || parsed.type == .clarify else {
            JournalStore.recordFailure(
                request: session.request,
                detail: parsed.response,
                steps: session.steps.map(\.text)
            )
            requestLogger.finish(
                session.logID,
                response: parsed.response, kind: "FAILED", success: false,
                learnedSkill: parsed.learnedSkill, outputFile: parsed.outputFile,
                journalEntry: nil, fallbackSteps: parsed.steps)
            enqueue(Presentation(
                sessionID: session.id, request: session.request, steps: session.steps,
                message: parsed.response.isEmpty ? "That didn't work. Try again?" : parsed.response,
                isFailure: true, type: nil, learnedSkill: nil, outputFile: nil,
                invoker: session.invoker))
            return
        }

        var entry = "\(parsed.type == .answer ? "ASK" : "ACTION") \"\(JournalStore.truncate(session.request, to: 90))\""
        entry += " → \(JournalStore.truncate(parsed.response))"
        if let skill = parsed.learnedSkill { entry += " (learned: \(skill))" }
        if let file = parsed.outputFile { entry += " (wrote: \((file as NSString).lastPathComponent))" }
        if session.isFollowUp { entry += " (follow-up)" }
        JournalStore.append(entry)

        let logKind: String
        switch parsed.type {
        case .answer: logKind = "ASK"
        case .action: logKind = "ACTION"
        case .clarify: logKind = "CLARIFY"
        }
        requestLogger.finish(
            session.logID,
            response: parsed.response, kind: logKind, success: parsed.success,
            learnedSkill: parsed.learnedSkill, outputFile: parsed.outputFile,
            journalEntry: entry, fallbackSteps: parsed.steps)

        enqueue(Presentation(
            sessionID: session.id, request: session.request, steps: session.steps,
            message: parsed.response, isFailure: false, type: parsed.type,
            learnedSkill: parsed.learnedSkill, outputFile: parsed.outputFile,
            invoker: session.invoker))
    }

    // MARK: - Presentation queue (TTS arbitration)

    /// Results present strictly one at a time, in completion order — a
    /// session that finishes while another result is being spoken (or while
    /// the user has the mic open) waits its turn instead of talking over it.
    private func enqueue(_ presentation: Presentation) {
        presentationQueue.append(presentation)
        pumpPresentations()
    }

    private func pumpPresentations() {
        guard !captureActive, !presentationActive, state != .error,
              !presentationQueue.isEmpty else { return }
        present(presentationQueue.removeFirst())
    }

    private func present(_ p: Presentation) {
        // The answer is taking the stage NOW — this is the moment its
        // numbered indicator disappears, in the same frame.
        sessions.removeAll { $0.id == p.sessionID }
        presentationActive = true
        captureActive = false
        stagedSessionID = nil
        generation += 1
        let gen = generation
        audio.stop()
        amplitude = 0
        transcriptionTask?.cancel()
        stillWorkingTask?.cancel()
        stillWorking = false
        showTextInput = false
        carryInvoker = p.invoker
        transcript = p.request
        steps = p.steps
        errorMessage = ""
        learnedSkillName = nil
        outputFile = nil

        if p.isFailure {
            responseText = ""
            errorMessage = p.message
            transition(to: .error)
            // Never let one failed session starve queued answers or hide
            // still-running work behind a modal error — auto-advance.
            if hasBackgroundWork { scheduleCollapse(after: readingDuration(for: p.message)) }
            return
        }

        responseText = p.message
        learnedSkillName = p.learnedSkill
        outputFile = p.outputFile
        transition(to: .responding)
        // Successful read-only answers are successful computer requests too.
        // A clarification remains unfinished even though it is presented normally.
        remoteResponseSucceeded = p.type != .clarify
        if p.type == .action { actionSucceeded = true }

        let shownAt = Date()
        let spoke = speaker.speak(p.message)
        switch p.type {
        case .action, .answer, nil:
            if spoke {
                // Collapse once BOTH the voice has finished and the text has
                // been on screen long enough to read; long fallback in case
                // TTS never calls back.
                speaker.onFinish = { [weak self] in
                    guard let self, self.generation == gen, self.state == .responding else { return }
                    let remaining = self.readingDuration(for: p.message) - Date().timeIntervalSince(shownAt)
                    self.scheduleCollapse(after: max(2, remaining))
                }
                scheduleCollapse(after: 45)
            } else {
                scheduleCollapse(after: readingDuration(for: p.message))
            }
        case .clarify:
            if remoteRequestID != nil {
                // The paired phone owns this conversation's microphone.
                // Keep the clarification available there instead of recording
                // an unrelated person speaking near the Mac.
                scheduleCollapse(after: readingDuration(for: p.message))
                return
            }
            // Conversational follow-up: reopen the mic AFTER Notch finishes
            // asking (half-duplex — the mic must never hear our own voice).
            // The follow-up resumes this session's conversation.
            let reopen: () -> Void = { [weak self] in
                guard let self, self.generation == gen, self.state == .responding else { return }
                self.listenForFollowUp()
            }
            if spoke {
                speaker.onFinish = {
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 400_000_000)
                        reopen()
                    }
                }
            } else {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    reopen()
                }
            }
        }
    }

    /// Dismiss the result on stage and hand the stage to whatever's next:
    /// the next queued result, a running session's progress, or idle.
    private func endPresentation() {
        presentationActive = false
        generation += 1
        speaker.onFinish = nil
        speaker.stop()
        collapseTask?.cancel()
        stageFallback()
    }

    // MARK: - Stage management

    /// Give the stage to the next thing that wants it.
    private func stageFallback() {
        if !presentationQueue.isEmpty {
            present(presentationQueue.removeFirst())
            return
        }
        if let session = sessions.last(where: { !$0.isFinished }) {
            stageSession(session)
            return
        }
        goIdle()
    }

    /// Put a running session's live progress on the panel.
    private func stageSession(_ session: AgentSession) {
        captureActive = false
        presentationActive = false
        stagedSessionID = session.id
        generation += 1
        audio.stop()
        amplitude = 0
        transcriptionTask?.cancel()
        collapseTask?.cancel()
        speaker.onFinish = nil
        showTextInput = false
        transcript = session.request
        steps = session.steps
        responseText = ""
        errorMessage = ""
        transition(to: session.steps.isEmpty ? .thinking : .executing)
        restartStillWorkingClock(startedAt: session.startedAt)
    }

    /// End a capture without launching a session; running work gets the
    /// stage back untouched.
    private func dismissCapture() {
        captureActive = false
        pushToTalkHeld = false
        generation += 1
        audio.stop()
        amplitude = 0
        transcriptionTask?.cancel()
        collapseTask?.cancel()
        showTextInput = false
        stageFallback()
    }

    /// Kill one running session (Escape over its progress view). Everything
    /// else keeps going.
    private func terminate(_ session: AgentSession) {
        session.cancelled = true
        session.invoker.cancel()
        sessions.removeAll { $0.id == session.id }
        if guiSessionID == session.id { guiSessionID = nil }
        // A request killed mid-flight still keeps its partial timeline.
        requestLogger.abandon(session.logID)
        if stagedSessionID == session.id {
            stagedSessionID = nil
            stageFallback()
        }
    }

    private func listenForFollowUp() {
        presentationActive = false
        captureActive = true
        generation += 1
        transcriptionTask?.cancel()
        collapseTask?.cancel()
        transition(to: .listening)
        transcript = ""
        steps = []
        actionSucceeded = false
        try? audio.start()
    }

    /// Stage-level failure (mic permission, transcription, launch). Running
    /// sessions are never touched — they keep going behind the error.
    private func fail(_ message: String) {
        captureActive = false
        presentationActive = false
        stagedSessionID = nil
        generation += 1
        audio.stop()
        amplitude = 0
        speaker.onFinish = nil
        speaker.stop()
        transcriptionTask?.cancel()
        collapseTask?.cancel()
        stillWorkingTask?.cancel()
        stillWorking = false
        errorMessage = message
        transition(to: .error)
    }

    /// Collapse to the bare notch. Only reached with nothing in flight.
    private func goIdle() {
        generation += 1
        captureActive = false
        presentationActive = false
        stagedSessionID = nil
        pushToTalkHeld = false
        carryInvoker = nil // panel collapsed → next request starts fresh
        audio.stop()
        amplitude = 0
        speaker.onFinish = nil
        speaker.stop()
        transcriptionTask?.cancel()
        collapseTask?.cancel()
        stillWorkingTask?.cancel()
        stillWorking = false
        transition(to: .idle)
    }

    // MARK: - Proactive announcements (workers, ambient nudges)

    /// A background worker finished: the notch speaks up on its own.
    func workerFinished(name: String, summary: String, isError: Bool) {
        let friendly = name.replacingOccurrences(of: "-", with: " ")
        var text = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count > 400 { text = String(text.prefix(400)) + "…" }
        JournalStore.append("WORKER \(name) \(isError ? "FAILED" : "finished"): \(JournalStore.truncate(text))")
        proactiveAnnounce(
            display: text.isEmpty ? "The \(friendly) task finished." : text,
            spoken: isError ? "Heads up — the \(friendly) task hit a problem." : "The \(friendly) task is done.",
            isSuccess: !isError
        )
    }

    /// A long-horizon task changed state (completed, failed, stalled,
    /// or advanced to a new step).
    func taskEvent(name: String, summary: String, isError: Bool) {
        let friendly = name.replacingOccurrences(of: "-", with: " ")
        var text = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count > 400 { text = String(text.prefix(400)) + "…" }
        JournalStore.append("TASK \(name) \(isError ? "ISSUE" : "update"): \(JournalStore.truncate(text))")
        proactiveAnnounce(
            display: text.isEmpty ? "The \(friendly) task updated." : text,
            spoken: isError ? "Heads up — the \(friendly) task needs attention." : "The \(friendly) task progressed.",
            isSuccess: !isError
        )
    }

    /// The notch swells and speaks with no user input. Never stomps an
    /// active interaction — the user's turn wins.
    // MARK: - Permission asks (Allow Once / Always Allow / Deny)

    struct PermissionAsk: Identifiable, Equatable {
        let id: UUID
        let tool: String
        let detail: String
    }

    @Published var pendingPermission: PermissionAsk?
    private var permissionQueue: [PermissionAsk] = []
    private var permissionContinuations: [UUID: CheckedContinuation<Bool, Never>] = [:]

    /// Awaits the user's decision for one tool call. Returns whether it is
    /// allowed; "Always Allow" also persists a rule via PermissionStore.
    func requestPermission(tool: String, detail: String) async -> Bool {
        let ask = PermissionAsk(id: UUID(), tool: tool, detail: detail)
        permissionQueue.append(ask)
        if pendingPermission == nil { pendingPermission = ask }
        // Surface the panel if it is collapsed — a stalled agent waiting on
        // an invisible question is the worst failure mode here.
        if state == .idle {
            proactiveAnnounce(
                display: "Permission needed",
                spoken: "I need your approval for an action.",
                isSuccess: false
            )
        }
        // Fail closed if the user never answers.
        let id = ask.id
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 240_000_000_000)
            self?.timeoutPermission(id: id)
        }
        return await withCheckedContinuation { cont in
            permissionContinuations[id] = cont
        }
    }

    /// Called by the panel's card buttons.
    func resolvePermission(allow: Bool, forever: Bool) {
        guard let ask = pendingPermission else { return }
        if allow, forever {
            PermissionStore.shared.addAllowRule(
                PermissionStore.foreverRule(tool: ask.tool, detail: ask.detail)
            )
        }
        finishPermission(id: ask.id, allow: allow)
    }

    private func timeoutPermission(id: UUID) {
        guard permissionContinuations[id] != nil else { return }
        finishPermission(id: id, allow: false)
    }

    private func finishPermission(id: UUID, allow: Bool) {
        permissionContinuations.removeValue(forKey: id)?.resume(returning: allow)
        permissionQueue.removeAll { $0.id == id }
        pendingPermission = permissionQueue.first
    }

    func proactiveAnnounce(display: String, spoken: String, isSuccess: Bool) {
        guard state == .idle else { return }
        remoteRequestID = nil
        interruptEverything()
        transcript = ""
        steps = []
        learnedSkillName = nil
        outputFile = nil
        errorMessage = ""
        responseText = display
        actionSucceeded = isSuccess
        transition(to: .responding)

        let gen = generation
        let shownAt = Date()
        if speaker.speak(spoken) {
            speaker.onFinish = { [weak self] in
                guard let self, self.generation == gen, self.state == .responding else { return }
                // Reading time tracks the DISPLAYED text — the spoken
                // phrase is usually shorter than what's on screen.
                let remaining = self.readingDuration(for: display) - Date().timeIntervalSince(shownAt)
                self.scheduleCollapse(after: max(2, remaining))
            }
            scheduleCollapse(after: 45)
        } else {
            scheduleCollapse(after: readingDuration(for: display))
        }
    }

    // MARK: - Live Translator

    /// Toggle live translation. Primary controls are the voice commands
    /// ("translate this" / "stop translating"), the caption panel's Stop
    /// button, and the `.translator-mode` marker file.
    func toggleTranslatorMode() {
        if translatorModeActive {
            stopTranslatorMode()
        } else {
            startTranslatorMode()
        }
    }

    func startTranslatorMode() {
        guard !translatorModeActive else { return }
        // Flip active + open the caption panel synchronously so the window
        // never collapses in the gap before capture actually spins up; the
        // panel shows "Listening for audio…" until the first segment lands.
        translatorModeActive = true
        syncExpansion()
        Task {
            do {
                try await translatorManager.start()
                let marker = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/.translator-mode")
                FileManager.default.createFile(atPath: marker.path, contents: nil)
                JournalStore.append("TRANSLATOR started")
            } catch {
                translatorModeActive = false
                syncExpansion()
                let msg = error.localizedDescription
                NSLog("[Notch] Live Translator failed to start: %@", msg)
                proactiveAnnounce(
                    display: "Could not start live translation: \(msg)",
                    spoken: "Live translation couldn't start. \(msg)",
                    isSuccess: false
                )
            }
        }
    }

    func stopTranslatorMode() {
        guard translatorModeActive else { return }
        translatorModeActive = false
        translatorManager.stop()
        syncExpansion() // caption panel collapses if nothing else is on stage
        let marker = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/.translator-mode")
        try? FileManager.default.removeItem(at: marker)
        JournalStore.append("TRANSLATOR stopped")
    }

    // MARK: - Meeting Mode

    /// Toggle meeting mode on/off. Kept as a scripting/remote entry point;
    /// the primary controls are the voice commands ("activate meeting mode" /
    /// "deactivate meeting mode") and the `.meeting-mode` file watch.
    func toggleMeetingMode() {
        if meetingModeActive {
            stopMeetingMode()
        } else {
            startMeetingMode()
        }
    }

    func startMeetingMode() {
        guard !meetingModeActive else { return }
        Task {
            do {
                try await meetingManager.start()
                meetingModeActive = true
                // Touch marker file so external tools can detect state.
                let marker = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/.meeting-mode")
                FileManager.default.createFile(atPath: marker.path, contents: nil)

                // Brief confirmation (non-intrusive).
                proactiveAnnounce(
                    display: "Meeting Mode is on — recording silently.",
                    spoken: "Meeting mode started.",
                    isSuccess: true
                )
                JournalStore.append("MEETING MODE started")
            } catch {
                let msg = error.localizedDescription
                NSLog("[Notch] Meeting Mode failed to start: %@", msg)
                proactiveAnnounce(
                    display: "Could not start Meeting Mode: \(msg)",
                    spoken: "Meeting mode couldn't start. \(msg)",
                    isSuccess: false
                )
            }
        }
    }

    func stopMeetingMode() {
        guard meetingModeActive else { return }
        meetingModeActive = false
        meetingManager.stop()
        // Remove marker file.
        let marker = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/.meeting-mode")
        try? FileManager.default.removeItem(at: marker)

        proactiveAnnounce(
            display: "Meeting Mode ended — writing transcript and notes.",
            spoken: "Meeting mode ended. Writing your notes now.",
            isSuccess: true
        )
        JournalStore.append("MEETING MODE stopped")
    }

    // MARK: - Plumbing

    private func transition(to newState: NotchState) {
        state = newState
        if newState != .responding { actionSucceeded = false }
        syncExpansion()
    }

    /// The panel window is open while the agent is mid-interaction OR the
    /// live translator is running (its caption panel outlives an idle agent).
    var panelExpanded: Bool { state.isExpanded || translatorModeActive }
    private var panelExpandedShown = false

    /// Resize the window only on a real open↔close transition — driven by
    /// either the agent state machine or the translator toggling.
    private func syncExpansion() {
        let expanded = panelExpanded
        guard expanded != panelExpandedShown else { return }
        panelExpandedShown = expanded
        onExpansionChange?(expanded)
    }

    /// "Still working…" appears once the (re)staged session has been going
    /// 8 seconds — measured from the session's own start, so switching
    /// indicators doesn't reset the clock.
    private func restartStillWorkingClock(startedAt: Date = Date()) {
        stillWorkingTask?.cancel()
        let elapsed = Date().timeIntervalSince(startedAt)
        stillWorking = elapsed >= 8
        guard !stillWorking else { return }
        let gen = generation
        stillWorkingTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((8 - elapsed) * 1_000_000_000))
            guard let self, !Task.isCancelled, self.generation == gen else { return }
            if self.state == .thinking || self.state == .executing {
                self.stillWorking = true
            }
        }
    }

    /// How long a response must stay on screen to be read comfortably:
    /// ~60ms per character, clamped to 4–30s. Short replies stay snappy at
    /// the floor; long ones aren't yanked away mid-read.
    private func readingDuration(for text: String) -> Double {
        min(30, max(4, Double(text.count) * 0.06))
    }

    private func scheduleCollapse(after seconds: Double) {
        collapseTask?.cancel()
        let gen = generation
        collapseTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard let self, !Task.isCancelled, self.generation == gen else { return }
            if self.state == .responding || (self.state == .error && self.presentationActive) {
                self.cancel()
            }
        }
    }

    /// The full stop: cancels audio, in-flight transcription, EVERY running
    /// session, queued results, and all timers. Only for paths where nothing
    /// is meant to survive (fresh start from a clean stage).
    private func interruptEverything() {
        generation += 1
        for session in sessions {
            session.cancelled = true
            session.invoker.cancel()
            requestLogger.abandon(session.logID)
        }
        sessions = []
        presentationQueue = []
        presentationActive = false
        captureActive = false
        stagedSessionID = nil
        guiSessionID = nil
        audio.stop()
        amplitude = 0
        speaker.onFinish = nil
        speaker.stop()
        transcriptionTask?.cancel()
        collapseTask?.cancel()
        stillWorkingTask?.cancel()
        stillWorking = false
        actionSucceeded = false
    }
}
