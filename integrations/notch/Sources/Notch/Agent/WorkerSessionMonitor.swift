import Foundation

/// Watches background Claude Code worker sessions that the runtime agent
/// launches detached into ~/.notch/sessions/ (one stream-json log per
/// worker, plus a .pid file). When a worker's log gains a `result` event,
/// the notch proactively surfaces it — the user never has to poll.
///
/// The registry IS the filesystem, same philosophy as skills: the agent
/// creates workers with plain Bash; this class only observes.
@MainActor
final class WorkerSessionMonitor {

    /// (worker name, final result text, isError)
    var onWorkerFinished: ((String, String, Bool) -> Void)?
    var onRunningCountChanged: ((Int) -> Void)?

    static var sessionsDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/sessions", isDirectory: true)
    }

    private var timer: Timer?
    /// logPath → byte offset of the last result event already surfaced.
    /// Primed on first scan so relaunching the app doesn't replay old
    /// completions.
    private var notifiedOffsets: [String: Int] = [:]
    private var primed = false
    private var lastRunningCount = -1

    func start() {
        try? FileManager.default.createDirectory(at: Self.sessionsDirectory, withIntermediateDirectories: true)
        scan()
        primed = true
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.scan() }
        }
    }

    private func scan() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(
            at: Self.sessionsDirectory, includingPropertiesForKeys: nil
        ) else { return }

        var running = 0
        for log in files where log.pathExtension == "jsonl" {
            let name = log.deletingPathExtension().lastPathComponent

            if isWorkerRunning(name: name) { running += 1 }

            guard let result = lastResultEvent(in: log) else { continue }
            let alreadyNotified = notifiedOffsets[log.path] ?? -1
            if result.offset > alreadyNotified {
                notifiedOffsets[log.path] = result.offset
                if primed {
                    onWorkerFinished?(name, result.text, result.isError)
                }
            }
        }

        if running != lastRunningCount {
            lastRunningCount = running
            onRunningCountChanged?(running)
        }
    }

    private func isWorkerRunning(name: String) -> Bool {
        let pidFile = Self.sessionsDirectory.appendingPathComponent(name + ".pid")
        guard let pidText = try? String(contentsOf: pidFile, encoding: .utf8),
              let pid = Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return kill(pid, 0) == 0
    }

    /// Finds the LAST `{"type":"result",...}` event in the log's tail.
    /// Steered/resumed workers append further result events to the same
    /// log — each new one (larger offset) surfaces again, by design.
    private func lastResultEvent(in url: URL) -> (text: String, isError: Bool, offset: Int)? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }

        let size = Int((try? handle.seekToEnd()) ?? 0)
        let readFrom = max(0, size - 262_144)
        try? handle.seek(toOffset: UInt64(readFrom))
        guard let data = try? handle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return nil }

        var best: (String, Bool, Int)?
        var cursor = readFrom
        for line in text.components(separatedBy: "\n") {
            defer { cursor += line.utf8.count + 1 }
            guard line.contains("\"type\":\"result\""),
                  let lineData = line.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  event["type"] as? String == "result" else { continue }
            best = (
                event["result"] as? String ?? "Task finished.",
                (event["is_error"] as? Bool) ?? false,
                cursor
            )
        }
        return best
    }
}
