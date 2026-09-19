import Foundation

/// Permission system for agent tool use — Claude-Code-style modes and rules.
///
/// Modes (menu bar → Permission Mode, persisted as NOTCH_PERMISSION_MODE):
///  - manual: every mutating tool call asks in the panel (reads run free)
///  - auto:   safe read-only commands + screenshots run free; the rest asks
///  - bypass: everything runs (today's single-user behavior; the default)
///
/// "Always Allow" decisions persist as prefix rules in
/// ~/.notch/permissions.json and are honored before asking again:
///   {"allow": [{"tool": "Bash", "prefix": "git push"}], "deny": []}
@MainActor
final class PermissionStore: ObservableObject {

    static let shared = PermissionStore()

    enum Mode: String, CaseIterable {
        case manual, auto, bypass

        var title: String {
            switch self {
            case .manual: return "Manual — ask for everything"
            case .auto: return "Auto — ask for risky actions"
            case .bypass: return "Full Bypass — never ask"
            }
        }
    }

    enum Verdict: Sendable {
        case allow
        case deny(String)
        case ask
    }

    struct Rule: Codable, Equatable {
        let tool: String
        /// Empty prefix = the rule covers the whole tool.
        let prefix: String
    }

    private struct RulesFile: Codable {
        var allow: [Rule] = []
        var deny: [Rule] = []
    }

    @Published private(set) var mode: Mode

    private var rules = RulesFile()
    private static var rulesURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/permissions.json")
    }

    private init() {
        mode = Mode(rawValue: NotchConfig.shared["NOTCH_PERMISSION_MODE"] ?? "") ?? .bypass
        if let data = try? Data(contentsOf: Self.rulesURL),
           let parsed = try? JSONDecoder().decode(RulesFile.self, from: data) {
            rules = parsed
        }
    }

    func setMode(_ newMode: Mode) {
        mode = newMode
        NotchConfig.setValue(newMode.rawValue, forKey: "NOTCH_PERMISSION_MODE")
    }

    // MARK: - Evaluation

    /// First token pairs that are read-only and always safe to run in auto.
    private static let safeBashPrefixes: Set<String> = [
        "ls", "cat", "grep", "rg", "find", "head", "tail", "wc", "pwd",
        "which", "echo", "sleep", "date", "file", "stat", "du", "df",
        "uname", "screencapture", "ffprobe", "sw_vers", "whoami",
    ]
    private static let safeGitSubcommands: Set<String> = [
        "status", "log", "diff", "show", "branch", "remote",
    ]
    /// Tools that only read — free in every mode.
    private static let readOnlyTools: Set<String> = [
        "Read", "Glob", "Grep", "TodoWrite", "Task",
    ]

    func evaluate(tool: String, detail: String) -> Verdict {
        if mode == .bypass { return .allow }
        if Self.readOnlyTools.contains(tool) { return .allow }

        // Persisted rules beat everything else.
        if matches(rules.deny, tool: tool, detail: detail) {
            return .deny("blocked by a saved rule")
        }
        if matches(rules.allow, tool: tool, detail: detail) { return .allow }

        if mode == .auto, tool == "Bash" {
            let tokens = detail.split(separator: " ", maxSplits: 2)
            if let first = tokens.first {
                if Self.safeBashPrefixes.contains(String(first)) { return .allow }
                if first == "git", tokens.count > 1,
                   Self.safeGitSubcommands.contains(String(tokens[1])) {
                    return .allow
                }
            }
        }
        return .ask
    }

    private func matches(_ list: [Rule], tool: String, detail: String) -> Bool {
        list.contains { rule in
            rule.tool == tool && (rule.prefix.isEmpty || detail.hasPrefix(rule.prefix))
        }
    }

    // MARK: - "Always Allow" persistence

    /// Derives the rule an "Always Allow" tap should save: for Bash, the
    /// command's first two tokens ("git push", "osascript -e"); for other
    /// tools, the whole tool.
    static func foreverRule(tool: String, detail: String) -> Rule {
        guard tool == "Bash" else { return Rule(tool: tool, prefix: "") }
        let tokens = detail.split(separator: " ").prefix(2)
        return Rule(tool: tool, prefix: tokens.joined(separator: " "))
    }

    func addAllowRule(_ rule: Rule) {
        guard !rules.allow.contains(rule) else { return }
        rules.allow.append(rule)
        save()
    }

    private func save() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(rules) {
            try? data.write(to: Self.rulesURL, options: .atomic)
        }
    }
}
