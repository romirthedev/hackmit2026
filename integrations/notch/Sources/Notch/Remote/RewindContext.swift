import AppKit
import Contacts
import EventKit
import Foundation

/// Read-only export for REWIND. Collection starts only after Connect Notch.
/// Credentials, sessions, scripts and computer-use commands are never exported.
@MainActor
enum RewindContext {
    private static let events = EKEventStore()
    private static let contacts = CNContactStore()
    private static let defaultsKey = "rewindContextScopes"

    static func snapshot(connect: [String: Bool]? = nil) async -> Data {
        if let connect {
            UserDefaults.standard.set(connect, forKey: defaultsKey)
            if connect["calendar"] == true, EKEventStore.authorizationStatus(for: .event) == .notDetermined {
                _ = try? await events.requestFullAccessToEvents()
            }
            if connect["contacts"] == true, CNContactStore.authorizationStatus(for: .contacts) == .notDetermined {
                _ = try? await contacts.requestAccess(for: .contacts)
            }
        }
        let scopes = UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Bool] ?? [:]
        var documents: [[String: Any]] = []
        var status: [String: String] = [:]
        if scopes["notes"] == true {
            let vault = JournalStore.url.deletingLastPathComponent()
            let files = (try? FileManager.default.contentsOfDirectory(at: vault, includingPropertiesForKeys: nil)) ?? []
            for file in files.filter({ $0.pathExtension == "md" }).sorted(by: { $0.path < $1.path }).prefix(200) {
                guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
                documents.append(["key": "note:" + file.deletingPathExtension().lastPathComponent,
                    "kind": "note", "title": file.deletingPathExtension().lastPathComponent,
                    "text": String(text.suffix(30000)), "links": []])
            }
            for skill in SkillLibrary.list().prefix(200) {
                documents.append(["key": "skill:" + skill.name, "kind": "note", "title": skill.name,
                    "text": "Saved Notch skill: " + skill.name + "\n" + skill.description, "links": []])
            }
            status["notes"] = "connected"
        }
        if scopes["calendar"] == true {
            if EKEventStore.authorizationStatus(for: .event) == .fullAccess {
                let now = Date()
                let predicate = events.predicateForEvents(withStart: now.addingTimeInterval(-86400),
                    end: now.addingTimeInterval(7 * 86400), calendars: nil)
                for event in events.events(matching: predicate).prefix(500) {
                    guard let start = event.startDate, let end = event.endDate else { continue }
                    let key = "calendar:" + (event.eventIdentifier ?? event.calendarItemIdentifier) + ":" + String(start.timeIntervalSince1970)
                    documents.append(["key": key, "kind": "calendar", "title": event.title ?? "Untitled appointment",
                        "text": [event.title, event.location, event.notes].compactMap { $0 }.joined(separator: "\n"),
                        "starts_at": start.timeIntervalSince1970, "ends_at": end.timeIntervalSince1970,
                        "all_day": event.isAllDay, "location": event.location ?? "",
                        "emails": (event.attendees ?? []).map { $0.url.absoluteString.replacingOccurrences(of: "mailto:", with: "") },
                        "links": []])
                }
                status["calendar"] = "connected"
            } else { status["calendar"] = "permission_required" }
        }
        if scopes["contacts"] == true {
            if CNContactStore.authorizationStatus(for: .contacts) == .authorized {
                let request = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey, CNContactGivenNameKey,
                    CNContactFamilyNameKey, CNContactEmailAddressesKey, CNContactRelationsKey] as [CNKeyDescriptor])
                do {
                    var relatives: [String: [String]] = [:]
                    try contacts.enumerateContacts(with: request) { person, stop in
                        if documents.count >= 2000 { stop.pointee = true; return }
                        let name = [person.givenName, person.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                        guard !name.isEmpty else { return }
                        let relations = person.contactRelations.map { relation in
                            (relation.label.map { CNLabeledValue<CNContactRelation>.localizedString(forLabel: $0) } ?? "Related person") + ": " + relation.value.name
                        }
                        relatives["contact:" + person.identifier] = person.contactRelations.map { $0.value.name }
                        documents.append(["key": "contact:" + person.identifier, "kind": "contact", "title": name,
                            "text": ([name] + relations).joined(separator: "\n"),
                            "emails": person.emailAddresses.map { String($0.value) }, "links": []])
                    }
                    // Link only unique exact names supplied by the contact's explicit related-person field.
                    var keysByName: [String: [String]] = [:]
                    for doc in documents where doc["kind"] as? String == "contact" {
                        if let name = doc["title"] as? String, let key = doc["key"] as? String {
                            keysByName[name.lowercased(), default: []].append(key)
                        }
                    }
                    for i in documents.indices {
                        guard let key = documents[i]["key"] as? String, let names = relatives[key] else { continue }
                        documents[i]["links"] = names.compactMap { name -> String? in
                            let matches = keysByName[name.lowercased()] ?? []
                            return matches.count == 1 ? matches[0] : nil
                        }
                    }
                    status["contacts"] = "connected"
                } catch { status["contacts"] = "unavailable" }
            } else { status["contacts"] = "permission_required" }
        }
        if scopes["mail"] == true {
            // Read the 40 most recent inbox entries; no sending, marking read, or other mutation.
            let script = NSAppleScript(source: """
            tell application "Mail"
                set outputRows to {}
                set inboxMessages to messages of inbox
                set takeCount to count of inboxMessages
                if takeCount > 40 then set takeCount to 40
                repeat with idx from 1 to takeCount
                    set msg to item idx of inboxMessages
                    set bodyText to content of msg as string
                    if length of bodyText > 6000 then set bodyText to text 1 thru 6000 of bodyText
                    set end of outputRows to {message id of msg, subject of msg, sender of msg, bodyText, date received of msg as string}
                end repeat
                return outputRows
            end tell
            """)
            var error: NSDictionary?
            if let result = script?.executeAndReturnError(&error), error == nil {
                if result.numberOfItems > 0 {
                    for i in 1...result.numberOfItems {
                        guard let row = result.atIndex(i), let identifier = row.atIndex(1)?.stringValue else { continue }
                        let title = row.atIndex(2)?.stringValue ?? "Email"
                        let sender = row.atIndex(3)?.stringValue ?? ""
                        documents.append(["key": "email:" + identifier, "kind": "email", "title": title,
                            "text": "From: \(sender)\nReceived: \(row.atIndex(5)?.stringValue ?? "")\n\(row.atIndex(4)?.stringValue ?? "")",
                            "emails": [sender], "links": []])
                    }
                }
                status["mail"] = "connected"
            } else { status["mail"] = "permission_required_or_unavailable" }
        }
        let payload: [String: Any] = ["version": 1, "exported_at": Date().timeIntervalSince1970,
            "documents": documents, "sources": status, "scopes": scopes]
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    }
}
