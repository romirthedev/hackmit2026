import Foundation

// MARK: - Per-request activity log model

/// One tool action the agent took while handling a request.
struct RequestLogStep: Codable, Identifiable {
    let id: UUID
    let time: Date
    let text: String          // narrated description ("Opening Safari")
    let toolName: String      // Bash / Read / Write / …
    let detail: String        // full command or file path ("" when none)
    let isCommand: Bool
    let isVerification: Bool

    init(time: Date = Date(), text: String, toolName: String, detail: String,
         isCommand: Bool, isVerification: Bool) {
        self.id = UUID()
        self.time = time
        self.text = text
        self.toolName = toolName
        self.detail = detail
        self.isCommand = isCommand
        self.isVerification = isVerification
    }
}

/// Anything the request added to the memory vault (~/.notch).
struct RequestMemoryWrite: Codable, Identifiable {
    let id: UUID
    let time: Date
    let kind: String          // "journal" | "lesson" | "skill" | "note"
    let detail: String        // the journal line, skill name, or note path

    init(time: Date = Date(), kind: String, detail: String) {
        self.id = UUID()
        self.time = time
        self.kind = kind
        self.detail = detail
    }
}

/// Everything that happened for one spoken/typed request. Persisted as one
/// JSON file under ~/.notch/requests/ so the Command Center history can
/// show a full timeline long after the panel collapsed.
struct RequestLog: Codable, Identifiable {
    let id: String
    let startedAt: Date
    var finishedAt: Date?
    let request: String
    var response: String = ""
    var kind: String = ""             // ASK / ACTION / CLARIFY / FAILED / CANCELLED
    var success: Bool = false
    var steps: [RequestLogStep] = []
    var filesWritten: [String] = []
    var workersStarted: [String] = []
    var memoryWrites: [RequestMemoryWrite] = []
    var learnedSkill: String?
    var outputFile: String?

    var duration: TimeInterval? {
        guard let finishedAt else { return nil }
        return finishedAt.timeIntervalSince(startedAt)
    }
}

// MARK: - Store

/// Owns the in-flight logs (one per running session — parallel sessions
/// each get their own timeline, keyed by the ID `begin` returns) and
/// persists finished logs. All writes are defensive — logging must never
/// break the agent flow.
@MainActor
final class RequestLogStore {

    private var logs: [String: RequestLog] = [:]

    nonisolated static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/requests", isDirectory: true)
    }

    // MARK: Recording

    /// Start a fresh log; the returned ID keys every later call for this
    /// request, so overlapping sessions never mix their timelines.
    func begin(request: String) -> String {
        let log = RequestLog(id: UUID().uuidString, startedAt: Date(), request: request)
        logs[log.id] = log
        return log.id
    }

    /// Persist whatever we have if a request was interrupted mid-flight.
    func abandon(_ id: String) {
        guard var log = logs.removeValue(forKey: id) else { return }
        guard !log.steps.isEmpty else { return }
        log.finishedAt = Date()
        log.kind = "CANCELLED"
        Self.persist(log)
    }

    func recordStep(_ id: String, text: String, toolName: String, detail: String,
                    isCommand: Bool, isVerification: Bool) {
        guard var log = logs[id] else { return }
        let step = RequestLogStep(
            text: text, toolName: toolName, detail: detail,
            isCommand: isCommand, isVerification: isVerification)
        log.steps.append(step)
        classify(step, into: &log)
        logs[id] = log
    }

    func finish(_ id: String, response: String, kind: String, success: Bool,
                learnedSkill: String?, outputFile: String?,
                journalEntry: String?, fallbackSteps: [String]) {
        guard var log = logs.removeValue(forKey: id) else { return }

        log.finishedAt = Date()
        log.response = response
        log.kind = kind
        log.success = success
        log.learnedSkill = learnedSkill
        log.outputFile = outputFile

        // Steps the agent reported in its final JSON that we never saw
        // streamed (e.g. resumed sessions) — better than an empty timeline.
        if log.steps.isEmpty {
            log.steps = fallbackSteps.map {
                RequestLogStep(time: log.finishedAt ?? Date(), text: $0,
                               toolName: "", detail: "", isCommand: false, isVerification: false)
            }
        }
        if let outputFile, !outputFile.isEmpty, !log.filesWritten.contains(outputFile) {
            log.filesWritten.append(outputFile)
        }
        if let learnedSkill, !learnedSkill.isEmpty,
           !log.memoryWrites.contains(where: { $0.kind == "skill" && $0.detail == learnedSkill }) {
            log.memoryWrites.append(RequestMemoryWrite(kind: "skill", detail: learnedSkill))
        }
        // The app itself appends one journal line per completed request.
        if let journalEntry, !journalEntry.isEmpty {
            log.memoryWrites.append(RequestMemoryWrite(kind: "journal", detail: journalEntry))
        }
        Self.persist(log)
    }

    // MARK: Step classification

    /// Derive files / workers / vault writes from the raw tool call. Purely
    /// heuristic — misses are fine, false timelines are not, so match narrow.
    private func classify(_ step: RequestLogStep, into log: inout RequestLog) {
        let detail = step.detail

        // Detached worker launches: `nohup claude … > ~/.notch/sessions/<name>.jsonl`
        if detail.contains(".notch/sessions/"), detail.contains("claude") {
            if let name = Self.firstMatch(#"sessions/([A-Za-z0-9_-]+)\.jsonl"#, in: detail),
               !log.workersStarted.contains(name) {
                log.workersStarted.append(name)
            }
        }

        // Direct Write-tool file writes.
        if step.toolName == "Write", !detail.isEmpty, !log.filesWritten.contains(detail) {
            log.filesWritten.append(detail)
        }

        // Bash redirects that create user-visible files (`> file.md`, `tee file`).
        if step.toolName == "Bash",
           let target = Self.firstMatch(#"(?:>>?|tee(?:\s+-a)?)\s+([~/][^\s;&|]+\.[A-Za-z0-9]{1,5})"#, in: detail) {
            let expanded = (target as NSString).expandingTildeInPath
            if !expanded.contains("/tmp/"), !expanded.contains("/.notch/sessions/"),
               !log.filesWritten.contains(expanded) {
                log.filesWritten.append(expanded)
            }
        }

        // Memory vault writes.
        let vaultTouch = step.toolName == "Write" ? detail
            : (Self.firstMatch(#"([~/][^\s;&|]*/\.notch/[^\s;&|]+)"#, in: detail) ?? "")
        if !vaultTouch.isEmpty, step.toolName == "Write" || Self.looksLikeVaultMutation(detail) {
            let path = (vaultTouch as NSString).expandingTildeInPath
            if path.contains("/.notch/skills/") {
                let name = (path as NSString).lastPathComponent
                if !log.memoryWrites.contains(where: { $0.kind == "skill" && $0.detail == name }) {
                    log.memoryWrites.append(RequestMemoryWrite(kind: "skill", detail: name))
                }
            } else if path.hasSuffix("lessons.md") {
                log.memoryWrites.append(RequestMemoryWrite(kind: "lesson", detail: "Appended to lessons.md"))
            } else if path.hasSuffix(".md"), path.contains("/.notch/") {
                let name = (path as NSString).lastPathComponent
                if !log.memoryWrites.contains(where: { $0.kind == "note" && $0.detail == name }) {
                    log.memoryWrites.append(RequestMemoryWrite(kind: "note", detail: name))
                }
            }
        }
    }

    /// True when a Bash command plausibly writes into ~/.notch (vs reading).
    private static func looksLikeVaultMutation(_ command: String) -> Bool {
        command.contains(">") || command.contains("tee ")
            || command.contains("chmod") || command.contains("touch ")
            || command.contains("cp ") || command.contains("mv ")
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let r = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    // MARK: Persistence

    // Created per call — cheap, and keeps these usable from any isolation.
    private nonisolated static func makeEncoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }

    private nonisolated static func makeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    private static func persist(_ log: RequestLog) {
        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = String(format: "%.0f-%@.json",
                          log.startedAt.timeIntervalSince1970, String(log.id.prefix(8)))
        guard let data = try? makeEncoder().encode(log) else { return }
        try? data.write(to: directory.appendingPathComponent(name), options: .atomic)
        pruneIfNeeded()
    }

    /// Cap the directory at ~500 files so it never grows unbounded.
    private static func pruneIfNeeded() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil),
              files.count > 500 else { return }
        // Epoch-prefixed names sort chronologically.
        let sorted = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
        for url in sorted.prefix(files.count - 500) {
            try? fm.removeItem(at: url)
        }
    }

    // MARK: Reading (Command Center)

    nonisolated static func loadAll() -> [RequestLog] {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else { return [] }
        var logs: [RequestLog] = []
        let decoder = makeDecoder()
        for url in files where url.pathExtension == "json" {
            guard let data = try? Data(contentsOf: url),
                  let log = try? decoder.decode(RequestLog.self, from: data) else { continue }
            logs.append(log)
        }
        return logs.sorted { $0.startedAt > $1.startedAt }
    }

    /// Best-effort match of a journal history row to its detailed log:
    /// same (truncated) request text, closest start time. Journal stamps
    /// have minute precision, so allow a generous window.
    nonisolated static func find(title: String, near date: Date?) -> RequestLog? {
        let wanted = normalize(title)
        guard !wanted.isEmpty else { return nil }
        let candidates = loadAll().filter { log in
            let have = normalize(log.request)
            return have.hasPrefix(wanted) || wanted.hasPrefix(have)
        }
        guard let date else { return candidates.first }
        return candidates.min {
            abs($0.startedAt.timeIntervalSince(date)) < abs($1.startedAt.timeIntervalSince(date))
        }
        .flatMap { best in
            abs(best.startedAt.timeIntervalSince(date)) <= 30 * 60 ? best : candidates.first
        }
    }

    private nonisolated static func normalize(_ text: String) -> String {
        var t = text.replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if t.hasSuffix("…") { t = String(t.dropLast()) }
        // Compare on a stable prefix — journal titles are truncated to 90.
        return String(t.prefix(80))
    }
}
