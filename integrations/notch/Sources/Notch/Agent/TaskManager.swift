import Foundation

/// Manages long-horizon tasks that span multiple worker sessions.
///
/// Each task is persisted as a JSON file in ~/.notch/tasks/<task-id>.json.
/// The manager monitors associated worker session logs on a timer, updates
/// progress summaries, detects completion/failure/stalls, and drives
/// proactive notifications and auto-resume for multi-step workflows.
@MainActor
final class TaskManager: ObservableObject {

    /// A single long-horizon task that may span multiple worker sessions.
    struct LongTask: Codable, Identifiable {
        let id: String
        var name: String
        var goal: String
        var status: TaskStatus
        var workerSessionIDs: [String]
        var started: Date
        var updated: Date
        var progressSummary: String
        /// Ordered sub-steps for multi-step tasks. Each entry is a short
        /// instruction string; the manager advances through them as workers
        /// complete.
        var steps: [String]
        /// Index of the step currently being executed (0-based). Workers
        /// that finish successfully bump this forward.
        var currentStep: Int
    }

    enum TaskStatus: String, Codable {
        case running, blocked, done, failed
    }

    static var tasksDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/tasks", isDirectory: true)
    }

    @Published private(set) var tasks: [LongTask] = []

    /// Fired when a task changes state in a way that warrants a proactive
    /// announcement (completion, failure, stall, step advance).
    var onTaskEvent: ((String, String, Bool) -> Void)?

    private var monitorTimer: Timer?
    /// Worker log path → last known file size. Used to detect stalls
    /// (no growth for >10 min).
    private var lastLogSizes: [String: Int] = [:]
    /// Worker log path → last time we saw the file grow.
    private var lastLogGrowth: [String: Date] = [:]
    /// Task IDs we've already announced as stalled, so we don't repeat.
    private var stalledAnnounced: Set<String> = []

    // MARK: - Lifecycle

    func start() {
        let fm = FileManager.default
        try? fm.createDirectory(at: Self.tasksDirectory, withIntermediateDirectories: true)
        loadAll()
        // Prime log sizes so we don't false-positive on existing logs.
        for task in tasks where task.status == .running {
            primeLogSizes(for: task)
        }
        monitorTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.monitor() }
        }
    }

    // MARK: - CRUD

    @discardableResult
    func create(name: String, goal: String, workerSessionIDs: [String] = [],
                steps: [String] = []) -> LongTask {
        let id = UUID().uuidString.prefix(8).lowercased()
        let task = LongTask(
            id: String(id), name: name, goal: goal, status: .running,
            workerSessionIDs: workerSessionIDs,
            started: Date(), updated: Date(),
            progressSummary: "Starting…",
            steps: steps, currentStep: 0
        )
        tasks.append(task)
        save(task)
        return task
    }

    func addWorkerSession(_ workerName: String, toTask taskID: String) {
        guard var task = tasks.first(where: { $0.id == taskID }) else { return }
        if !task.workerSessionIDs.contains(workerName) {
            task.workerSessionIDs.append(workerName)
            task.updated = Date()
            update(task)
        }
    }

    func updateProgress(_ taskID: String, summary: String) {
        guard var task = tasks.first(where: { $0.id == taskID }) else { return }
        task.progressSummary = summary
        task.updated = Date()
        update(task)
    }

    func complete(_ taskID: String, summary: String? = nil) {
        guard var task = tasks.first(where: { $0.id == taskID }) else { return }
        task.status = .done
        task.updated = Date()
        if let summary { task.progressSummary = summary }
        update(task)
    }

    func fail(_ taskID: String, reason: String) {
        guard var task = tasks.first(where: { $0.id == taskID }) else { return }
        task.status = .failed
        task.progressSummary = reason
        task.updated = Date()
        update(task)
    }

    // MARK: - Context injection

    /// Compact summary of active tasks for agent prompt injection.
    func activeTasksBlock() -> String {
        let active = tasks.filter { $0.status == .running || $0.status == .blocked }
        guard !active.isEmpty else { return "" }
        var lines = [String]()
        for t in active {
            let stepInfo = t.steps.isEmpty ? "" : " (step \(t.currentStep + 1)/\(t.steps.count))"
            lines.append("- \(t.name) [\(t.status.rawValue)\(stepInfo)]: \(JournalStore.truncate(t.progressSummary, to: 120))")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Monitoring

    private func monitor() {
        for i in tasks.indices where tasks[i].status == .running {
            var task = tasks[i]
            var changed = false

            // Check each associated worker log.
            for workerName in task.workerSessionIDs {
                let logURL = WorkerSessionMonitor.sessionsDirectory
                    .appendingPathComponent(workerName + ".jsonl")
                let key = logURL.path

                // Track log size for stall detection.
                let currentSize = (try? FileManager.default.attributesOfItem(atPath: key))?[.size] as? Int ?? 0
                let previousSize = lastLogSizes[key] ?? currentSize

                if currentSize > previousSize {
                    lastLogSizes[key] = currentSize
                    lastLogGrowth[key] = Date()
                    stalledAnnounced.remove(task.id)

                    // Parse tail for progress update.
                    if let summary = parseProgressFromTail(logURL) {
                        task.progressSummary = summary
                        task.updated = Date()
                        changed = true
                    }
                } else if lastLogSizes[key] == nil {
                    lastLogSizes[key] = currentSize
                    lastLogGrowth[key] = Date()
                }

                // Check for result event (completion/failure).
                if let result = lastResultEvent(in: logURL) {
                    if result.isError {
                        task.status = .failed
                        task.progressSummary = JournalStore.truncate(result.text, to: 200)
                        task.updated = Date()
                        changed = true
                        update(task)
                        onTaskEvent?(task.name, "Task failed: \(task.progressSummary)", true)
                        break
                    } else if !isWorkerRunning(name: workerName) {
                        // Worker finished successfully.
                        changed = true
                        task.updated = Date()

                        // Multi-step: advance to next step.
                        if !task.steps.isEmpty && task.currentStep < task.steps.count - 1 {
                            task.currentStep += 1
                            task.progressSummary = "Advancing to step \(task.currentStep + 1): \(task.steps[task.currentStep])"
                            update(task)
                            onTaskEvent?(task.name,
                                "Step \(task.currentStep) done. Moving to: \(task.steps[task.currentStep])",
                                false)
                            resumeWorker(task: task)
                        } else {
                            task.status = .done
                            task.progressSummary = JournalStore.truncate(result.text, to: 200)
                            update(task)
                            onTaskEvent?(task.name, "Task completed: \(task.progressSummary)", false)
                        }
                        break
                    }
                }

                // Stall detection: no log growth for >10 min.
                if let lastGrowth = lastLogGrowth[key],
                   Date().timeIntervalSince(lastGrowth) > 600,
                   !stalledAnnounced.contains(task.id),
                   isWorkerRunning(name: workerName) {
                    task.status = .blocked
                    task.progressSummary = "Stalled — no activity for 10+ minutes"
                    task.updated = Date()
                    changed = true
                    stalledAnnounced.insert(task.id)
                    update(task)
                    onTaskEvent?(task.name, "Task appears stalled — no progress for 10 minutes.", true)
                    break
                }
            }

            if changed {
                tasks[i] = task
            }
        }
    }

    // MARK: - Worker log parsing

    /// Extracts the most recent actionable line from a worker's log tail.
    private func parseProgressFromTail(_ url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }

        let size = Int((try? handle.seekToEnd()) ?? 0)
        let readFrom = max(0, size - 32_768)
        try? handle.seek(toOffset: UInt64(readFrom))
        guard let data = try? handle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return nil }

        // Walk lines backwards to find the most recent tool_use description
        // or assistant text content.
        var bestDescription: String?
        for line in text.components(separatedBy: "\n").reversed() {
            guard let lineData = line.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { continue }

            if event["type"] as? String == "assistant",
               let message = event["message"] as? [String: Any],
               let content = message["content"] as? [[String: Any]] {
                for block in content {
                    if block["type"] as? String == "tool_use",
                       let input = block["input"] as? [String: Any],
                       let desc = input["description"] as? String, !desc.isEmpty {
                        bestDescription = desc
                        break
                    }
                }
                if bestDescription != nil { break }
            }
        }
        return bestDescription
    }

    private func lastResultEvent(in url: URL) -> (text: String, isError: Bool)? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }

        let size = Int((try? handle.seekToEnd()) ?? 0)
        let readFrom = max(0, size - 262_144)
        try? handle.seek(toOffset: UInt64(readFrom))
        guard let data = try? handle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return nil }

        var best: (String, Bool)?
        for line in text.components(separatedBy: "\n") {
            guard line.contains("\"type\":\"result\""),
                  let lineData = line.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  event["type"] as? String == "result" else { continue }
            best = (
                event["result"] as? String ?? "Task finished.",
                (event["is_error"] as? Bool) ?? false
            )
        }
        return best
    }

    private func isWorkerRunning(name: String) -> Bool {
        let pidFile = WorkerSessionMonitor.sessionsDirectory.appendingPathComponent(name + ".pid")
        guard let pidText = try? String(contentsOf: pidFile, encoding: .utf8),
              let pid = Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return kill(pid, 0) == 0
    }

    // MARK: - Auto-resume

    /// Resume the worker for the current step of a multi-step task.
    private func resumeWorker(task: LongTask) {
        guard task.currentStep < task.steps.count,
              let workerName = task.workerSessionIDs.last else { return }

        let logURL = WorkerSessionMonitor.sessionsDirectory
            .appendingPathComponent(workerName + ".jsonl")

        // Find the session_id from the last result to resume.
        var sessionID: String?
        if let handle = try? FileHandle(forReadingFrom: logURL) {
            defer { try? handle.close() }
            let size = Int((try? handle.seekToEnd()) ?? 0)
            let readFrom = max(0, size - 262_144)
            try? handle.seek(toOffset: UInt64(readFrom))
            if let data = try? handle.readToEnd(),
               let text = String(data: data, encoding: .utf8) {
                for line in text.components(separatedBy: "\n") {
                    guard line.contains("\"session_id\""),
                          let lineData = line.data(using: .utf8),
                          let event = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                          let sid = event["session_id"] as? String else { continue }
                    sessionID = sid
                }
            }
        }

        guard let sessionID, let claude = ClaudeCodeInvoker.findClaudeBinary() else { return }

        let step = task.steps[task.currentStep]
        let sessionsDir = WorkerSessionMonitor.sessionsDirectory.path

        // Resume the worker with the next step instruction.
        let script = """
            nohup \(claude) --resume \(sessionID) -p "\(step.replacingOccurrences(of: "\"", with: "\\\""))" \
            --output-format stream-json --verbose --permission-mode bypassPermissions \
            >> \(sessionsDir)/\(workerName).jsonl 2>&1 < /dev/null & \
            echo $! > \(sessionsDir)/\(workerName).pid
            """
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = ["-c", script]
        var env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let extraPaths = ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
        env["PATH"] = (extraPaths + [(env["PATH"] ?? "")]).joined(separator: ":")
        proc.environment = env
        try? proc.run()
    }

    // MARK: - Persistence

    private func save(_ task: LongTask) {
        let url = Self.tasksDirectory.appendingPathComponent("\(task.id).json")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(task) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func update(_ task: LongTask) {
        if let idx = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[idx] = task
        }
        save(task)
    }

    func loadAll() {
        let fm = FileManager.default
        try? fm.createDirectory(at: Self.tasksDirectory, withIntermediateDirectories: true)
        guard let files = try? fm.contentsOfDirectory(
            at: Self.tasksDirectory, includingPropertiesForKeys: nil
        ) else { return }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var loaded = [LongTask]()
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let task = try? decoder.decode(LongTask.self, from: data) else { continue }
            loaded.append(task)
        }
        tasks = loaded.sorted { $0.started < $1.started }
    }

    private func primeLogSizes(for task: LongTask) {
        for workerName in task.workerSessionIDs {
            let logPath = WorkerSessionMonitor.sessionsDirectory
                .appendingPathComponent(workerName + ".jsonl").path
            let size = (try? FileManager.default.attributesOfItem(atPath: logPath))?[.size] as? Int ?? 0
            lastLogSizes[logPath] = size
            lastLogGrowth[logPath] = Date()
        }
    }
}
