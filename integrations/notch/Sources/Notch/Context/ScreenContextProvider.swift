import AppKit
import ApplicationServices

/// Deictic context: a semantic snapshot of what the user is looking at,
/// built by walking the frontmost app's Accessibility tree. Captured the
/// moment the notch activates (our panel is non-activating, so the user's
/// app is still frontmost), then injected into the agent prompt so
/// "reply to this" / "fix this error" / "add this to my calendar" resolve.
///
/// Deliberately dependency-free: this file must compile standalone so it
/// can be integration-tested from the CLI against live apps.
struct ScreenContext {
    var appName: String
    var bundleID: String
    var windowTitle: String
    var selectedText: String?
    var focusedElement: String?
    var outline: String

    /// The block injected into the agent prompt.
    var promptBlock: String {
        var lines = ["<screen_context>"]
        lines.append("Frontmost app: \(appName) (\(bundleID))")
        if !windowTitle.isEmpty { lines.append("Window: \(windowTitle)") }
        if let focused = focusedElement, !focused.isEmpty { lines.append("Focused element: \(focused)") }
        if let selected = selectedText, !selected.isEmpty { lines.append("Selected text: \"\(selected)\"") }
        if !outline.isEmpty {
            lines.append("Visible UI:")
            lines.append(outline)
        }
        lines.append("</screen_context>")
        return lines.joined(separator: "\n")
    }
}

final class ScreenContextProvider {

    // Budgets keep capture fast and the prompt small.
    private let maxNodes = 400
    private let maxDepth = 12
    private let maxOutlineChars = 2800
    private let maxTextPerNode = 220

    static func isTrusted(promptIfNeeded: Bool) -> Bool {
        if promptIfNeeded {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            return AXIsProcessTrustedWithOptions(options)
        }
        return AXIsProcessTrusted()
    }

    /// Synchronous; call off the main thread. Returns nil when there's no
    /// frontmost app or Accessibility isn't granted.
    func capture() -> ScreenContext? {
        guard Self.isTrusted(promptIfNeeded: false) else { return nil }
        guard let app = NSWorkspace.shared.frontmostApplication,
              app.bundleIdentifier != Bundle.main.bundleIdentifier else { return nil }

        let axApp = AXUIElementCreateApplication(app.processIdentifier)

        // Electron/Chromium apps only build their AX tree once an assistive
        // client announces itself. Harmless no-op elsewhere.
        AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)

        guard let window: AXUIElement = copyAttr(axApp, kAXFocusedWindowAttribute)
            ?? firstElement(of: axApp, attribute: kAXWindowsAttribute) else { return nil }

        let windowTitle: String = copyAttr(window, kAXTitleAttribute) ?? ""

        // Selected text + focused element, the highest-signal pieces.
        var selectedText: String?
        var focusedDescription: String?
        if let focused: AXUIElement = copyAttr(axApp, kAXFocusedUIElementAttribute) {
            selectedText = nonEmpty(copyAttr(focused, kAXSelectedTextAttribute), limit: 1200)
            focusedDescription = describe(focused)
        }

        var lines: [String] = []
        var nodeCount = 0
        var charCount = 0
        walk(window, depth: 0, lines: &lines, nodeCount: &nodeCount, charCount: &charCount)

        return ScreenContext(
            appName: app.localizedName ?? "Unknown",
            bundleID: app.bundleIdentifier ?? "?",
            windowTitle: windowTitle,
            selectedText: selectedText,
            focusedElement: focusedDescription,
            outline: lines.joined(separator: "\n")
        )
    }

    // MARK: - Tree walk

    /// Roles whose text content is worth surfacing, mapped to a friendly label.
    private static let contentRoles: [String: String] = [
        "AXStaticText": "Text",
        "AXHeading": "Heading",
        "AXTextField": "Field",
        "AXTextArea": "TextArea",
        "AXSearchField": "Search",
        "AXComboBox": "Combo",
        "AXButton": "Button",
        "AXPopUpButton": "Popup",
        "AXCheckBox": "Checkbox",
        "AXRadioButton": "Radio",
        "AXLink": "Link",
        "AXMenuItem": "MenuItem",
        "AXTabButton": "Tab",
        "AXImage": "Image",
        "AXMenuButton": "MenuButton",
        "AXSlider": "Slider",
    ]

    private func walk(
        _ element: AXUIElement,
        depth: Int,
        lines: inout [String],
        nodeCount: inout Int,
        charCount: inout Int
    ) {
        guard depth <= maxDepth, nodeCount < maxNodes, charCount < maxOutlineChars else { return }
        nodeCount += 1

        let role: String = copyAttr(element, kAXRoleAttribute) ?? ""

        if let label = Self.contentRoles[role], let line = contentLine(element, label: label) {
            let indent = String(repeating: "  ", count: min(depth, 6))
            lines.append(indent + line)
            charCount += line.count
            // Content nodes re-emit their own text through child Text
            // nodes — recursing would double every line.
            return
        }

        // Containers are structural — recurse.
        guard let children: [AXUIElement] = copyAttrArray(element, kAXChildrenAttribute) else { return }
        for child in children {
            guard nodeCount < maxNodes, charCount < maxOutlineChars else { return }
            walk(child, depth: depth + 1, lines: &lines, nodeCount: &nodeCount, charCount: &charCount)
        }
    }

    private func contentLine(_ element: AXUIElement, label: String) -> String? {
        let title = nonEmpty(copyAttr(element, kAXTitleAttribute), limit: maxTextPerNode)
        // A heading's AX "value" is its level (1-6), not content.
        let value = label == "Heading" ? nil : nonEmpty(stringValue(of: element), limit: maxTextPerNode)
        let description = nonEmpty(copyAttr(element, kAXDescriptionAttribute), limit: maxTextPerNode)

        let name = title ?? description
        switch (name, value) {
        case (nil, nil):
            return nil
        case (let n?, nil):
            return "\(label): \(n)"
        case (nil, let v?):
            return "\(label): \(v)"
        case (let n?, let v?):
            return n == v ? "\(label): \(n)" : "\(label) '\(n)': \(v)"
        }
    }

    private func describe(_ element: AXUIElement) -> String? {
        let role: String = copyAttr(element, kAXRoleAttribute) ?? "element"
        let title = nonEmpty(copyAttr(element, kAXTitleAttribute), limit: 120)
        let value = nonEmpty(stringValue(of: element), limit: 300)
        var parts = [role]
        if let title { parts.append("'\(title)'") }
        if let value { parts.append("value: \(value)") }
        return parts.count > 1 ? parts.joined(separator: " ") : nil
    }

    // MARK: - AX plumbing

    private func copyAttr<T>(_ element: AXUIElement, _ attribute: String) -> T? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success else { return nil }
        return ref as? T
    }

    private func copyAttrArray(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
              let array = ref as? [AnyObject] else { return nil }
        return array.compactMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    }

    private func firstElement(of element: AXUIElement, attribute: String) -> AXUIElement? {
        copyAttrArray(element, attribute)?.first
    }

    private func stringValue(of element: AXUIElement) -> String? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &ref) == .success,
              let ref else { return nil }
        if let s = ref as? String { return s }
        if let n = ref as? NSNumber { return n.stringValue }
        return nil
    }

    private func nonEmpty(_ s: String?, limit: Int) -> String? {
        guard var s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        if s.count > limit { s = String(s.prefix(limit)) + "…" }
        return s.replacingOccurrences(of: "\n", with: " ⏎ ")
    }
}
