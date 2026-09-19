import Foundation

// MARK: - Journal

struct CCJournalEntry: Identifiable {
    let id = UUID()
    let date: Date?
    let kind: String      // ACTION, ASK, WORKER, NUDGE, CONSOLIDATION, …
    let title: String     // the spoken question, or the headline for non-question entries
    let summary: String   // the response summary after "→" (may be empty)
    let isQuestion: Bool  // had a quoted question — feeds the sidebar "Recent questions"
    let isFollowUp: Bool  // journal-marked "(follow-up)" — threads with the previous exchange

    var relativeStamp: String { CCFormat.relative(date) }
}

/// A group of related journal entries rendered as one collapsible history
/// card. Entries are chronological (oldest first).
struct CCThread: Identifiable {
    var entries: [CCJournalEntry]

    /// Stable across reloads (unlike CCJournalEntry.id) so expansion state
    /// survives the store re-parsing the journal.
    var id: String {
        let first = entries[0]
        let stamp = first.date.map { String($0.timeIntervalSince1970) } ?? "undated"
        return stamp + "|" + String(first.title.prefix(40))
    }

    var latest: CCJournalEntry { entries[entries.count - 1] }
    var earlierCount: Int { entries.count - 1 }
}

// MARK: - Agents

struct CCWorker: Identifiable {
    let id: String        // filename stem, e.g. "elevenlabs-voice"
    let prettyName: String
    let isRunning: Bool
    let modified: Date?
    let startedAt: Date?  // .pid file date — when the current run was launched
    let excerpt: String   // last result / assistant text from the jsonl tail
    let activity: String  // most recent tool description or assistant snippet (live status)
    let model: String?

    var relativeStamp: String { CCFormat.relative(modified) }
}

// MARK: - Active section

/// One in-flight item in the Command Center's persistent "Active" list:
/// the current spoken/typed request, or a running background worker.
struct CCActiveItem: Identifiable {
    enum Kind { case request, worker }
    let id: String
    let kind: Kind
    let name: String
    let status: String    // live progress line
    let startedAt: Date?

    var elapsed: String {
        guard let startedAt else { return "" }
        return CCFormat.duration(max(0, Date().timeIntervalSince(startedAt)))
    }
}

/// A worker that recently completed, shown under "Recently finished".
struct CCFinishedItem: Identifiable {
    let id: String
    let name: String
    let result: String
    let finishedAt: Date?

    var relativeStamp: String { CCFormat.relative(finishedAt) }
}

// MARK: - Memory graph

struct CCGraphNode: Identifiable, Hashable {
    let id: String        // lowercase slug
    let label: String
    let kind: Kind
    let fileURL: URL?     // nil for phantom topic nodes (wikilink with no file)

    enum Kind { case note, skill, topic }
}

struct CCGraphEdge: Hashable {
    let from: String
    let to: String
}

// MARK: - Config

struct CCConfigEntry: Identifiable {
    let id = UUID()
    let key: String
    let displayValue: String
    let masked: Bool
}

// MARK: - Formatting helpers

enum CCFormat {
    static let stampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static let absoluteFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy · HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static func duration(_ seconds: TimeInterval) -> String {
        if seconds < 60 { return String(format: "%.0fs", seconds) }
        if seconds < 3600 { return String(format: "%dm %02ds", Int(seconds) / 60, Int(seconds) % 60) }
        return String(format: "%dh %02dm", Int(seconds) / 3600, (Int(seconds) % 3600) / 60)
    }

    /// Codex-style compact relative stamp: "3m", "2h", "1d".
    static func relative(_ date: Date?) -> String {
        guard let date else { return "" }
        let seconds = max(0, Date().timeIntervalSince(date))
        if seconds < 60 { return "now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        return "\(Int(seconds / 86_400))d"
    }

    static func prettify(_ kebab: String) -> String {
        kebab.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

// MARK: - Loading (all defensive: missing/garbled files → empty results)

enum CommandCenterData {

    static var notchDir: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch", isDirectory: true)
    }

    // MARK: Journal

    /// Parses ~/.notch/journal.md lines of the form
    /// `- [YYYY-MM-DD HH:MM] KIND "question…" → response summary`
    /// Lines that deviate (consolidation notes, date-only stamps, no arrow)
    /// still show up with best-effort fields. Newest first.
    static func loadJournal() -> [CCJournalEntry] {
        let url = notchDir.appendingPathComponent("journal.md")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }

        var entries: [CCJournalEntry] = []
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("- ["), let close = trimmed.firstIndex(of: "]") else { continue }

            let stamp = String(trimmed[trimmed.index(trimmed.startIndex, offsetBy: 3)..<close])
            let date = CCFormat.stampFormatter.date(from: stamp) ?? CCFormat.dayFormatter.date(from: stamp)
            var rest = String(trimmed[trimmed.index(after: close)...]).trimmingCharacters(in: .whitespaces)

            // Leading uppercase token = entry kind (ACTION, ASK, WORKER…).
            var kind = "NOTE"
            if let space = rest.firstIndex(of: " ") {
                let head = String(rest[..<space]).trimmingCharacters(in: CharacterSet(charactersIn: ":"))
                if head.count >= 2, head.allSatisfy({ $0.isUppercase || $0 == "_" }) {
                    kind = head
                    rest = String(rest[rest.index(after: space)...]).trimmingCharacters(in: .whitespaces)
                }
            } else if rest.allSatisfy({ $0.isUppercase }) && !rest.isEmpty {
                kind = rest; rest = ""
            }

            // Trailing "(follow-up)" marker: the app appends it when a
            // request resumed the previous agent session. Strip before
            // further parsing so it never leaks into the summary.
            var isFollowUp = false
            if rest.hasSuffix("(follow-up)") {
                isFollowUp = true
                rest = String(rest.dropLast("(follow-up)".count)).trimmingCharacters(in: .whitespaces)
            }

            var title = rest
            var summary = ""
            var isQuestion = false

            // Quoted question form: "…question…" → summary
            if rest.hasPrefix("\"") {
                let body = String(rest.dropFirst())
                if let endQuote = body.firstIndex(of: "\"") {
                    title = String(body[..<endQuote])
                    isQuestion = true
                    let after = String(body[body.index(after: endQuote)...])
                    if let arrow = after.range(of: "→") {
                        summary = String(after[arrow.upperBound...]).trimmingCharacters(in: .whitespaces)
                    }
                }
            } else if let arrow = rest.range(of: "→") {
                title = String(rest[..<arrow.lowerBound]).trimmingCharacters(in: .whitespaces)
                summary = String(rest[arrow.upperBound...]).trimmingCharacters(in: .whitespaces)
            }

            guard !title.isEmpty || !summary.isEmpty else { continue }
            entries.append(CCJournalEntry(
                date: date, kind: kind, title: title, summary: summary,
                isQuestion: isQuestion, isFollowUp: isFollowUp))
        }
        return entries.reversed()
    }

    // MARK: Threads

    /// Conversation kinds participate in threading; everything else
    /// (WORKER, NUDGE, CONSOLIDATION…) stays a standalone card and never
    /// breaks an ongoing conversation chain.
    private static let threadableKinds: Set<String> = ["ASK", "ACTION", "ANSWER", "CLARIFY"]

    /// Groups newest-first journal entries into threads: a conversation
    /// entry attaches to the most recent conversation thread when it is
    /// journal-marked as a follow-up OR arrived within 10 minutes of that
    /// thread's last message; otherwise it starts a new thread.
    static func buildThreads(_ newestFirst: [CCJournalEntry]) -> [CCThread] {
        var threads: [CCThread] = []
        var lastConversationIndex: Int?

        for entry in newestFirst.reversed() {
            guard threadableKinds.contains(entry.kind) else {
                threads.append(CCThread(entries: [entry]))
                continue
            }
            if let i = lastConversationIndex {
                var withinWindow = false
                if let date = entry.date, let previous = threads[i].entries.last?.date {
                    let gap = date.timeIntervalSince(previous)
                    withinWindow = gap >= 0 && gap <= 600
                }
                if entry.isFollowUp || withinWindow {
                    threads[i].entries.append(entry)
                    continue
                }
            }
            threads.append(CCThread(entries: [entry]))
            lastConversationIndex = threads.count - 1
        }
        return threads.reversed()
    }

    // MARK: Agents

    static func loadWorkers() -> [CCWorker] {
        let dir = notchDir.appendingPathComponent("sessions", isDirectory: true)
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return [] }

        var workers: [CCWorker] = []
        for log in files where log.pathExtension == "jsonl" {
            let name = log.deletingPathExtension().lastPathComponent
            let modified = (try? log.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate
            let tail = parseSessionTail(log)
            // The .pid file is (re)written each time the worker is launched
            // or resumed — its date is the start of the current run.
            let pidPath = dir.appendingPathComponent(name + ".pid").path
            let startedAt = (try? fm.attributesOfItem(atPath: pidPath))?[.modificationDate] as? Date
            workers.append(CCWorker(
                id: name,
                prettyName: CCFormat.prettify(name),
                isRunning: isWorkerRunning(name: name, dir: dir),
                modified: modified,
                startedAt: startedAt,
                excerpt: tail.excerpt,
                activity: tail.activity,
                model: tail.model
            ))
        }
        return workers.sorted {
            ($0.isRunning ? 1 : 0, $0.modified ?? .distantPast)
                > ($1.isRunning ? 1 : 0, $1.modified ?? .distantPast)
        }
    }

    private static func isWorkerRunning(name: String, dir: URL) -> Bool {
        let pidFile = dir.appendingPathComponent(name + ".pid")
        guard let pidText = try? String(contentsOf: pidFile, encoding: .utf8),
              let pid = Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines))
        else { return false }
        return kill(pid, 0) == 0
    }

    /// Reads the last ~30KB of a session log and pulls the most recent
    /// `result` text (preferred) or assistant text, plus the model name and
    /// the latest activity (tool description or assistant snippet) for the
    /// live "Active" status line. Malformed lines are skipped — never
    /// throws, never crashes.
    private static func parseSessionTail(_ url: URL) -> (excerpt: String, activity: String, model: String?) {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return ("", "", nil) }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let readFrom = size > 30_720 ? size - 30_720 : 0
        try? handle.seek(toOffset: readFrom)
        guard let data = try? handle.readToEnd(),
              let text = String(data: data, encoding: .utf8) else { return ("", "", nil) }

        var lastResult: String?
        var lastAssistantText: String?
        var lastActivity: String?
        var model: String?
        for line in text.components(separatedBy: "\n") {
            guard let lineData = line.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: lineData)) as? [String: Any]
            else { continue }
            if let m = obj["model"] as? String { model = m }
            switch obj["type"] as? String {
            case "result":
                if let r = obj["result"] as? String, !r.isEmpty { lastResult = r }
            case "assistant":
                guard let message = obj["message"] as? [String: Any] else { continue }
                if let m = message["model"] as? String { model = m }
                guard let content = message["content"] as? [[String: Any]] else { continue }
                for block in content {
                    switch block["type"] as? String {
                    case "text":
                        let snippet = (block["text"] as? String ?? "")
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if !snippet.isEmpty {
                            lastAssistantText = snippet
                            lastActivity = snippet
                        }
                    case "tool_use":
                        let input = block["input"] as? [String: Any] ?? [:]
                        if let d = input["description"] as? String, !d.isEmpty {
                            lastActivity = d
                        } else if let c = input["command"] as? String, !c.isEmpty {
                            lastActivity = String(c.prefix(80))
                        } else if let p = input["file_path"] as? String, !p.isEmpty {
                            lastActivity = "Editing \((p as NSString).lastPathComponent)"
                        } else if let n = block["name"] as? String {
                            lastActivity = "Running \(n)"
                        }
                    default: break
                    }
                }
            default: break
            }
        }
        let excerpt = (lastResult ?? lastAssistantText ?? "")
            .replacingOccurrences(of: "\n", with: " ")
        let activity = (lastActivity ?? "").replacingOccurrences(of: "\n", with: " ")
        return (
            excerpt.count > 220 ? String(excerpt.prefix(220)) + "…" : excerpt,
            activity.count > 140 ? String(activity.prefix(140)) + "…" : activity,
            model
        )
    }

    // MARK: Memory graph

    /// Nodes = ~/.notch/*.md notes + ~/.notch/skills/* scripts; edges =
    /// [[wikilinks]] found in file contents. Unresolved link targets become
    /// phantom "topic" nodes, matching the web graph's behavior.
    static func loadGraph() -> (nodes: [CCGraphNode], edges: [CCGraphEdge]) {
        let fm = FileManager.default
        var nodes: [String: CCGraphNode] = [:]
        var edges: Set<CCGraphEdge> = []

        var fileNodes: [(URL, CCGraphNode.Kind)] = []
        if let mdFiles = try? fm.contentsOfDirectory(at: notchDir, includingPropertiesForKeys: nil) {
            for url in mdFiles where url.pathExtension == "md" {
                fileNodes.append((url, .note))
            }
        }
        let skillsDir = notchDir.appendingPathComponent("skills", isDirectory: true)
        if let skillFiles = try? fm.contentsOfDirectory(at: skillsDir, includingPropertiesForKeys: nil) {
            for url in skillFiles where !url.lastPathComponent.hasPrefix(".") {
                fileNodes.append((url, .skill))
            }
        }

        for (url, kind) in fileNodes {
            let slug = url.deletingPathExtension().lastPathComponent.lowercased()
            nodes[slug] = CCGraphNode(
                id: slug,
                label: url.deletingPathExtension().lastPathComponent,
                kind: kind,
                fileURL: url
            )
        }

        let linkRegex = try? NSRegularExpression(pattern: #"\[\[([^\]\|\n]+)(?:\|[^\]\n]*)?\]\]"#)
        for (url, _) in fileNodes {
            guard let content = try? String(contentsOf: url, encoding: .utf8),
                  let regex = linkRegex else { continue }
            let fromSlug = url.deletingPathExtension().lastPathComponent.lowercased()
            let range = NSRange(content.startIndex..., in: content)
            for match in regex.matches(in: content, range: range) {
                guard let targetRange = Range(match.range(at: 1), in: content) else { continue }
                let target = content[targetRange].trimmingCharacters(in: .whitespaces).lowercased()
                guard !target.isEmpty, target != fromSlug else { continue }
                if nodes[target] == nil {
                    nodes[target] = CCGraphNode(
                        id: target, label: CCFormat.prettify(target), kind: .topic, fileURL: nil)
                }
                edges.insert(CCGraphEdge(from: fromSlug, to: target))
            }
        }
        return (Array(nodes.values).sorted { $0.id < $1.id }, Array(edges))
    }

    /// File contents for the graph's side panel. Guarded to ~/.notch so a
    /// crafted node can never read outside the vault.
    static func nodeContents(_ node: CCGraphNode) -> String {
        guard let url = node.fileURL,
              url.standardizedFileURL.path.hasPrefix(notchDir.standardizedFileURL.path),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { return "No file for this node — it only exists as a [[wikilink]] target." }
        return text
    }

    // MARK: Config

    static func loadConfig() -> [CCConfigEntry] {
        let url = notchDir.appendingPathComponent("config")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }

        var entries: [CCConfigEntry] = []
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#"),
                  let eq = trimmed.firstIndex(of: "=") else { continue }
            let key = String(trimmed[..<eq]).trimmingCharacters(in: .whitespaces)
            let value = String(trimmed[trimmed.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }

            if looksSecret(key: key, value: value) {
                let suffix = value.count > 4 ? String(value.suffix(4)) : ""
                entries.append(CCConfigEntry(key: key, displayValue: "••••••••\(suffix)", masked: true))
            } else {
                entries.append(CCConfigEntry(key: key, displayValue: value, masked: false))
            }
        }
        return entries
    }

    private static func looksSecret(key: String, value: String) -> Bool {
        let k = key.uppercased()
        if k.contains("KEY") || k.contains("TOKEN") || k.contains("SECRET") || k.contains("PASSWORD") {
            return true
        }
        // Long opaque values with vendor key prefixes.
        let prefixes = ["sk_", "sk-", "gsk_", "ghp_", "xoxb", "pk_"]
        return prefixes.contains { value.hasPrefix($0) } && value.count > 12
    }

    // MARK: App info

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    static var buildDate: String {
        guard let exe = Bundle.main.executableURL,
              let attrs = try? FileManager.default.attributesOfItem(atPath: exe.path),
              let date = attrs[.modificationDate] as? Date else { return "unknown" }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }
}
