import Foundation

/// Persistent memory: every interaction, action, and worker completion is
/// appended to ~/.notch/journal.md. The tail is injected into each agent
/// prompt (immediate continuity) and the agent reads the full file when
/// asked about past work — "what did I do today?", "did that PR land?".
enum JournalStore {

    static var url: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/journal.md")
    }

    static var lessonsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/lessons.md")
    }

    static var failuresURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/failures.log")
    }

    static var mocURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch/MOC.md")
    }

    /// Seed the vault so it opens cleanly as an Obsidian vault from day one.
    static func ensureVault() {
        let fm = FileManager.default
        try? fm.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !fm.fileExists(atPath: lessonsURL.path) {
            try? """
            # Lessons

            One line each. This file rides along in every agent prompt — keep it short and high-value.

            """.write(to: lessonsURL, atomically: true, encoding: .utf8)
        }
        if !fm.fileExists(atPath: mocURL.path) {
            try? """
            # Notch — Map of Content

            The index of Notch's memory vault. Maintained by the consolidation worker.

            - [[journal]] — chronological activity log
            - [[lessons]] — distilled lessons, injected into every prompt

            ## Skills

            """.write(to: mocURL, atomically: true, encoding: .utf8)
        }
    }

    /// Raw failure record — free to write, distilled into lessons.md by the
    /// consolidation worker (so repeated failures never trigger token storms).
    static func recordFailure(request: String, detail: String, steps: [String]) {
        let stepText = steps.isEmpty ? "" : " (steps: \(steps.prefix(6).joined(separator: "; ")))"
        let line = "- [\(stampFormatter.string(from: Date()))] REQUEST \"\(truncate(request, to: 120))\" FAILED: \(truncate(detail, to: 200))\(stepText)\n"
        appendRaw(line, to: failuresURL)
    }

    /// Last portion of lessons.md for prompt injection.
    static func lessonsTail(maxChars: Int = 1000) -> String {
        guard let text = try? String(contentsOf: lessonsURL, encoding: .utf8) else { return "" }
        let lines = text.split(separator: "\n").filter { $0.hasPrefix("-") }
        guard !lines.isEmpty else { return "" }
        var out = lines.joined(separator: "\n")
        if out.count > maxChars { out = String(out.suffix(maxChars)) }
        return out
    }

    /// Full contents of MOC.md (the vault's map of content) for prompt
    /// injection. It's small (~40 lines) so no truncation is needed.
    static func mocContents() -> String {
        guard let text = try? String(contentsOf: mocURL, encoding: .utf8) else { return "" }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func appendRaw(_ entry: String, to file: URL) {
        let fm = FileManager.default
        if !fm.fileExists(atPath: file.path) {
            try? fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? "".write(to: file, atomically: true, encoding: .utf8)
        }
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(entry.utf8))
        }
    }

    private static let stampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// Append one entry line. Truncates long payloads so the journal stays
    /// scannable — it's a log of what happened, not a transcript archive.
    static func append(_ line: String) {
        let clean = line
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespaces)
        let entry = "- [\(stampFormatter.string(from: Date()))] \(clean)\n"

        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) {
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? "# Notch journal\n\n".write(to: url, atomically: true, encoding: .utf8)
        }
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(entry.utf8))
        }
    }

    static func truncate(_ text: String, to max: Int = 160) -> String {
        let clean = text.replacingOccurrences(of: "\n", with: " ")
        return clean.count > max ? String(clean.prefix(max)) + "…" : clean
    }

    /// Last portion of the journal for prompt injection.
    static func tail(maxChars: Int = 1200) -> String {
        guard let text = try? String(contentsOf: url, encoding: .utf8), !text.isEmpty else {
            return ""
        }
        if text.count <= maxChars { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        let tail = String(text.suffix(maxChars))
        // Start at a line boundary.
        if let newline = tail.firstIndex(of: "\n") {
            return String(tail[tail.index(after: newline)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return tail
    }
}
