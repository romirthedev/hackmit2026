import AppKit
import AVFoundation
import CoreGraphics
import EventKit
import SwiftUI

/// One place to see and fix every permission Notch needs. Statuses are
/// checked live; each row's button either triggers the system prompt or
/// jumps to the exact Settings pane.
@MainActor
enum PermissionCenter {

    struct Item: Identifiable {
        let id: String
        let name: String
        let detail: String
        let granted: Bool
        let action: () -> Void
    }

    static func items() -> [Item] {
        var list: [Item] = []

        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        list.append(Item(
            id: "mic", name: "Microphone", detail: "Voice commands",
            granted: micStatus == .authorized,
            action: {
                if micStatus == .notDetermined {
                    AVCaptureDevice.requestAccess(for: .audio) { _ in }
                } else {
                    openPane("Privacy_Microphone")
                }
            }
        ))

        list.append(Item(
            id: "ax", name: "Accessibility", detail: "Screen context + Fn push-to-talk",
            granted: AXIsProcessTrusted(),
            action: {
                _ = ScreenContextProvider.isTrusted(promptIfNeeded: true)
                openPane("Privacy_Accessibility")
            }
        ))

        list.append(Item(
            id: "screen", name: "Screen Recording", detail: "The agent verifies every action visually",
            granted: CGPreflightScreenCaptureAccess(),
            action: {
                if !CGRequestScreenCaptureAccess() {
                    openPane("Privacy_ScreenCapture")
                }
            }
        ))

        let calStatus = EKEventStore.authorizationStatus(for: .event)
        list.append(Item(
            id: "cal", name: "Calendar", detail: "Meeting nudges from the notch",
            granted: calStatus == .fullAccess,
            action: {
                if calStatus == .notDetermined {
                    EKEventStore().requestFullAccessToEvents { _, _ in }
                } else {
                    openPane("Privacy_Calendars")
                }
            }
        ))

        list.append(Item(
            id: "automation", name: "Automation (7 apps)", detail: "Safari, Mail, Calendar, Messages, Finder, Reminders, System Events",
            granted: FileManager.default.fileExists(
                atPath: FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".notch/.automation-preflighted").path
            ),
            action: {
                AppleScriptRunner.preflightAutomationPermission(force: true)
                openPane("Privacy_Automation")
            }
        ))

        list.append(Item(
            id: "folders", name: "Desktop / Documents / Downloads", detail: "Agent file access without mid-flow prompts",
            granted: foldersAccessible(),
            action: { preflightFolders() }
        ))

        list.append(Item(
            id: "fda", name: "Full Disk Access (recommended)", detail: "Kills every remaining file prompt; add Notch manually",
            granted: hasFullDiskAccess(),
            action: { openPane("Privacy_AllFiles") }
        ))

        return list
    }

    static func openPane(_ pane: String) {
        NSWorkspace.shared.open(
            URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
        )
    }

    /// Reading each protected folder triggers its one-time prompt.
    static func preflightFolders() {
        DispatchQueue.global(qos: .utility).async {
            let home = FileManager.default.homeDirectoryForCurrentUser
            for folder in ["Desktop", "Documents", "Downloads"] {
                _ = try? FileManager.default.contentsOfDirectory(atPath: home.appendingPathComponent(folder).path)
            }
        }
    }

    private static func foldersAccessible() -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return ["Desktop", "Documents", "Downloads"].allSatisfy {
            (try? FileManager.default.contentsOfDirectory(atPath: home.appendingPathComponent($0).path)) != nil
        }
    }

    private static func hasFullDiskAccess() -> Bool {
        let tccDB = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/com.apple.TCC/TCC.db")
        return FileManager.default.isReadableFile(atPath: tccDB.path)
    }
}

struct PermissionsView: View {
    @State private var items: [PermissionCenter.Item] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Grant each once — the stable signature keeps them across rebuilds.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .padding(.bottom, 10)
            ForEach(items) { item in
                HStack(spacing: 10) {
                    Image(systemName: item.granted ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(item.granted ? .green : .red)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.name).font(.system(size: 13, weight: .semibold))
                        Text(item.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if !item.granted {
                        Button("Grant") { item.action() }
                            .font(.system(size: 12))
                    }
                }
                .padding(.vertical, 6)
            }
            HStack {
                Spacer()
                Button("Re-check") { items = PermissionCenter.items() }
                    .font(.system(size: 12))
            }
            .padding(.top, 8)
        }
        .padding(20)
        .frame(width: 440)
        .onAppear { items = PermissionCenter.items() }
    }
}
