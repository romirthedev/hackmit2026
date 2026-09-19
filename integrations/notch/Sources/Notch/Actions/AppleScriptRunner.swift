import Foundation

/// Thin wrapper for running AppleScript directly from the app.
/// The invoked agent usually runs `osascript` itself through its Bash tool;
/// this exists for app-initiated automation and pre-flighting the
/// Automation permission prompt on first launch (never mid-demo).
enum AppleScriptRunner {

    @discardableResult
    static func run(_ source: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", source]
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        try process.run()
        process.waitUntilExit()

        let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        if process.terminationStatus != 0 {
            let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            throw NSError(domain: "Notch.AppleScript", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            ])
        }
        return stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Apps the agent commonly automates, each with a query that REALLY
    /// sends an Apple Event. (`get name` of an app object is answered
    /// locally by AppleScript with no event — and no permission prompt.)
    /// Automation TCC grants are per TARGET app — each one prompts
    /// separately, and a prompt mid-agent-flow blocks the osascript step
    /// and kills the run. So we surface the whole batch up front.
    private static let automationProbes: [(String, String)] = [
        ("System Events", "tell application \"System Events\" to get name of first process"),
        ("Safari", "tell application \"Safari\" to count windows"),
        ("Finder", "tell application \"Finder\" to count windows"),
        ("Mail", "tell application \"Mail\" to count accounts"),
        ("Calendar", "tell application \"Calendar\" to count calendars"),
        ("Messages", "tell application \"Messages\" to count windows"),
        ("Reminders", "tell application \"Reminders\" to count lists"),
    ]

    /// Fires a harmless Apple Event at every common target so all
    /// Automation dialogs appear in one sitting. Runs once (marker file);
    /// grants persist across rebuilds thanks to the stable signing
    /// identity. Note: this launches the target apps.
    static func preflightAutomationPermission(force: Bool = false) {
        let marker = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/.automation-preflighted")
        if !force && FileManager.default.fileExists(atPath: marker.path) { return }

        DispatchQueue.global(qos: .utility).async {
            for (target, probe) in automationProbes {
                do {
                    _ = try run(probe)
                    NSLog("[Notch] automation OK: %@", target)
                } catch {
                    NSLog("[Notch] automation FAILED for %@: %@", target, error.localizedDescription)
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
            try? Data().write(to: marker)
        }
    }
}
