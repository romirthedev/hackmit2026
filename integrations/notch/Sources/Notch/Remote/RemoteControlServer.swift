import Foundation
import Network

/// Phone remote: a tiny LAN HTTP server. The phone opens a dark,
/// ChatGPT-style chat page (URL/QR from the menu bar), sends text commands
/// into the same pipeline as typed input, and watches live state —
/// transcript, narrated steps, response, running workers — rendered as a
/// scrolling conversation.
///
/// All routes live under /t/<token>/ — the token is generated per launch,
/// so a phone on your Wi-Fi can't drive an agent with system access just
/// by port-scanning.
///
/// Network callbacks run nonisolated; only the view-model touchpoints
/// (command/cancel/state) hop to the main actor.
final class RemoteControlServer {

    /// Snapshot of everything the phone UI renders.
    struct StateSnapshot {
        var state: String
        var transcript: String
        var response: String
        var steps: [(text: String, isVerification: Bool)]
        var errorMessage: String
        var workersRunning: Int
        var contextApp: String?
        var actionSucceeded: Bool
        var learnedSkill: String?
        var outputFile: String?
        var requestID: String? = nil
        var pendingPermission: [String: String]? = nil
        var accessibilityGranted: Bool = false
        var screenRecordingGranted: Bool = false
    }

    /// Decides a permission ask from the MCP shim: (toolName, detail) →
    /// allow? + optional denial message. Wired by NotchApp to the
    /// PermissionStore rules + the panel's Allow/Deny card.
    var permissionDecider: (@Sendable (String, String) async -> (allow: Bool, message: String?))?

    var onRewindCommand: (@MainActor (String, String) -> Bool)?
    var onRewindCancel: (@MainActor (String) -> Bool)?
    var onPermissionDecision: (@MainActor (String, Bool) -> Bool)?
    var onCommand: (@MainActor (String) -> Void)?
    var onCancel: (@MainActor () -> Void)?
    var stateProvider: (@MainActor () -> StateSnapshot)?

    let token: String
    let port: UInt16
    private let contextOnly: Bool
    private let loopbackOnly: Bool

    private var listener: NWListener?
    private var browser: NWBrowser?

    init(port: UInt16 = 8737, contextOnly: Bool = false, loopbackOnly: Bool = false) {
        self.port = port
        self.contextOnly = contextOnly
        self.loopbackOnly = contextOnly || loopbackOnly
        // Persistent token: the phone's bookmark/QR survives relaunches.
        let tokenFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/remote-token")
        if let saved = try? String(contentsOf: tokenFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), saved.count >= 8 {
            self.token = saved
        } else {
            let fresh = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            try? FileManager.default.createDirectory(at: tokenFile.deletingLastPathComponent(),
                withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try? (fresh + "\n").write(to: tokenFile, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenFile.path)
            self.token = fresh
        }
    }

    /// All reachable URLs, LAN first. The Tailscale entry appears only when
    /// a tailnet interface is up — traffic over it is WireGuard-encrypted,
    /// so the plain-HTTP server is safe to use from anywhere.
    var urls: [(label: String, url: String)] {
        var out: [(label: String, url: String)] = []
        if let ip = Self.lanIPAddress() {
            out.append(("Wi-Fi", "http://\(ip):\(port)/t/\(token)/"))
        }
        if let ip = Self.tailscaleIPAddress() {
            out.append(("Anywhere (Tailscale)", "http://\(ip):\(port)/t/\(token)/"))
        }
        return out
    }

    /// LAN URL when available (preferred for local uses like the graph).
    var url: String? { urls.first?.url }

    func start() {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        if loopbackOnly {
            params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        }
        let boundListener = loopbackOnly
            ? try? NWListener(using: params)
            : try? NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        guard let listener = boundListener else {
            NSLog("[Notch] remote server failed to bind port %d", port)
            return
        }
        // Bonjour advertisement — makes the server discoverable AND
        // triggers macOS's Local Network permission prompt (without the
        // grant, LAN peers' traffic to this listener is silently dropped
        // while loopback keeps working).
        if !loopbackOnly { listener.service = NWListener.Service(name: "Notch", type: "_http._tcp") }
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: .main)
            self?.receive(on: connection, buffer: Data())
        }
        listener.start(queue: .main)
        self.listener = listener
        if loopbackOnly {
            NSLog("[Notch] REWIND bridge on loopback port %d", port)
            return
        }

        // Browsing the local network sends the multicast traffic that
        // actually raises macOS's Local Network permission prompt
        // (advertising alone doesn't). Without the grant, LAN peers can't
        // reach the listener.
        let browser = NWBrowser(for: .bonjour(type: "_http._tcp", domain: nil), using: .tcp)
        browser.start(queue: .main)
        self.browser = browser

        NSLog("[Notch] phone remote at %@", url ?? "?")
        // Written for scripting/debugging: `cat ~/.notch/remote-url`.
        let urlList = urls.map(\.url)
        if !urlList.isEmpty {
            let file = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".notch/remote-url")
            try? (urlList.joined(separator: "\n") + "\n").write(to: file, atomically: true, encoding: .utf8)
        }
    }

    // MARK: - HTTP plumbing (minimal, Connection: close)

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, error in
            guard let self, error == nil else { connection.cancel(); return }
            var buffer = buffer
            if let data { buffer.append(data) }

            if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let headerText = String(data: buffer[..<headerEnd.lowerBound], encoding: .utf8) ?? ""
                let contentLength = Self.contentLength(in: headerText)
                let bodySoFar = buffer[headerEnd.upperBound...]
                if bodySoFar.count >= contentLength {
                    let body = Data(bodySoFar.prefix(contentLength))
                    self.route(headerText: headerText, body: body, connection: connection)
                    return
                }
            }
            if done { connection.cancel(); return }
            if buffer.count > 1_000_000 { connection.cancel(); return }
            self.receive(on: connection, buffer: buffer)
        }
    }

    // MARK: - Auth

    /// Timestamps of recent wrong-token requests. All connection callbacks
    /// run on the main queue, so plain vars are safe.
    private var authFailureTimes: [Date] = []
    private var authCooldownUntil: Date = .distantPast

    /// Wrong token (or no token). Normally answers 404 like any unknown
    /// path; after 10 failures in 60 s, drops failing connections without
    /// a byte for 60 s — brute force and path scanning get silence.
    private func rejectUnauthorized(_ connection: NWConnection) {
        let now = Date()
        authFailureTimes = authFailureTimes.filter { now.timeIntervalSince($0) < 60 }
        authFailureTimes.append(now)
        if authFailureTimes.count >= 10 {
            authCooldownUntil = now.addingTimeInterval(60)
        }
        if now < authCooldownUntil {
            connection.cancel()
        } else {
            send(connection, status: "404 Not Found", contentType: "text/plain", body: Data("nope".utf8))
        }
    }

    /// Byte-wise comparison that always touches every byte — no
    /// short-circuit for an attacker to time.
    private func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let ab = Array(a.utf8), bb = Array(b.utf8)
        guard ab.count == bb.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<ab.count { diff |= ab[i] ^ bb[i] }
        return diff == 0
    }

    private static func contentLength(in header: String) -> Int {
        for line in header.split(separator: "\r\n") {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                return Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        return 0
    }

    private func route(headerText: String, body: Data, connection: NWConnection) {
        let requestLine = headerText.split(separator: "\r\n").first.map(String.init) ?? ""
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { connection.cancel(); return }
        let method = String(parts[0])
        let fullPath = String(parts[1])

        // Path shape: /t/<token>/<rest>. Extract the token segment and
        // compare in constant time — hasPrefix short-circuits on the first
        // differing byte, which leaks token bytes through timing.
        var rest: Substring?
        if fullPath.hasPrefix("/t/") {
            let afterT = fullPath.dropFirst("/t/".count)
            if let slash = afterT.firstIndex(of: "/"),
               constantTimeEquals(String(afterT[..<slash]), token) {
                rest = afterT[afterT.index(after: slash)...]
            }
        }
        guard let rest else {
            rejectUnauthorized(connection)
            return
        }
        let pathAndQuery = String(rest)
        let path = pathAndQuery.split(separator: "?").first.map(String.init) ?? ""
        let query = pathAndQuery.firstIndex(of: "?").map { String(pathAndQuery[pathAndQuery.index(after: $0)...]) } ?? ""

        if contextOnly && (path != "context" || (method != "GET" && method != "POST")) {
            send(connection, status: "404 Not Found", contentType: "text/plain", body: Data())
            return
        }
        switch (method, path) {
        case ("GET", ""), ("GET", "index.html"):
            send(connection, status: "200 OK", contentType: "text/html; charset=utf-8", body: Data(Self.pageHTML.utf8))
        case ("GET", "state"):
            Task { @MainActor [weak self] in
                guard let self else { connection.cancel(); return }
                let json = self.stateJSON()
                self.send(connection, status: "200 OK", contentType: "application/json", body: json)
            }
        case ("GET", "context"), ("POST", "context"):
            let scopes = method == "POST" ? (try? JSONSerialization.jsonObject(with: body)) as? [String: Bool] : nil
            Task { @MainActor [weak self] in
                let json = await RewindContext.snapshot(connect: scopes)
                self?.send(connection, status: "200 OK", contentType: "application/json", body: json)
            }
        case ("POST", "rewind-command"), ("POST", "rewind-cancel"), ("POST", "permission-decision"):
            guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let id = obj["id"] as? String, UUID(uuidString: id) != nil else {
                send(connection, status: "400 Bad Request", contentType: "application/json", body: Data("{}".utf8))
                return
            }
            Task { @MainActor [weak self] in
                guard let self else { connection.cancel(); return }
                let ok: Bool
                if path == "rewind-command", let text = obj["text"] as? String,
                   !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.count <= 2000 {
                    ok = self.onRewindCommand?(text, id) ?? false
                } else if path == "rewind-cancel" {
                    ok = self.onRewindCancel?(id) ?? false
                } else if path == "permission-decision", let allow = obj["allow"] as? Bool {
                    ok = self.onPermissionDecision?(id, allow) ?? false
                } else { ok = false }
                self.send(connection, status: ok ? "200 OK" : "409 Conflict", contentType: "application/json",
                          body: Data((ok ? "{\"ok\":true}" : "{\"ok\":false}").utf8))
            }
        case ("POST", "command"):
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let text = (obj["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
               !text.isEmpty {
                Task { @MainActor [weak self] in self?.onCommand?(text) }
                send(connection, status: "200 OK", contentType: "application/json", body: Data("{\"ok\":true}".utf8))
            } else {
                send(connection, status: "400 Bad Request", contentType: "application/json", body: Data("{\"ok\":false}".utf8))
            }
        case ("POST", "permission"):
            guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let tool = obj["tool_name"] as? String else {
                send(connection, status: "400 Bad Request", contentType: "application/json",
                     body: Data("{\"behavior\":\"deny\",\"message\":\"bad request\"}".utf8))
                return
            }
            let input = obj["input"] as? [String: Any] ?? [:]
            let detail = (input["command"] as? String)
                ?? (input["file_path"] as? String)
                ?? ((try? JSONSerialization.data(withJSONObject: input)).flatMap { String(data: $0, encoding: .utf8) } ?? "")
            guard let decider = permissionDecider else {
                send(connection, status: "200 OK", contentType: "application/json",
                     body: Data("{\"behavior\":\"allow\"}".utf8))
                return
            }
            Task { [weak self] in
                let decision = await decider(tool, detail)
                let payload: [String: Any] = decision.allow
                    ? ["behavior": "allow"]
                    : ["behavior": "deny", "message": decision.message ?? "Denied in Notch."]
                let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{\"behavior\":\"deny\"}".utf8)
                self?.send(connection, status: "200 OK", contentType: "application/json", body: data)
            }
        case ("POST", "cancel"):
            Task { @MainActor [weak self] in self?.onCancel?() }
            send(connection, status: "200 OK", contentType: "application/json", body: Data("{\"ok\":true}".utf8))
        case ("GET", _) where path.hasPrefix("outbox/"):
            serveOutboxFile(named: String(path.dropFirst("outbox/".count)), on: connection)
        case ("GET", "graph"):
            send(connection, status: "200 OK", contentType: "text/html; charset=utf-8", body: Data(Self.graphHTML.utf8))
        case ("GET", "vault"):
            send(connection, status: "200 OK", contentType: "application/json", body: Self.vaultGraphJSON())
        case ("GET", "note"):
            let id = query.split(separator: "&")
                .first(where: { $0.hasPrefix("id=") })
                .map { String($0.dropFirst(3)) } ?? ""
            if let json = Self.noteJSON(rawId: id) {
                send(connection, status: "200 OK", contentType: "application/json", body: json)
            } else {
                send(connection, status: "404 Not Found", contentType: "application/json", body: Data("{\"error\":\"unknown note\"}".utf8))
            }
        default:
            send(connection, status: "404 Not Found", contentType: "text/plain", body: Data("nope".utf8))
        }
    }

    /// Serves files from ~/NotchOutbox ONLY — basename-only, no traversal.
    private func serveOutboxFile(named rawName: String, on connection: NWConnection) {
        let name = rawName.removingPercentEncoding ?? rawName
        guard !name.isEmpty, !name.contains("/"), !name.contains(".."), !name.hasPrefix(".") else {
            send(connection, status: "404 Not Found", contentType: "text/plain", body: Data("nope".utf8))
            return
        }
        let file = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("NotchOutbox").appendingPathComponent(name)
        guard let data = try? Data(contentsOf: file), data.count < 20_000_000 else {
            send(connection, status: "404 Not Found", contentType: "text/plain", body: Data("nope".utf8))
            return
        }
        let types: [String: String] = [
            "md": "text/plain; charset=utf-8", "txt": "text/plain; charset=utf-8",
            "csv": "text/plain; charset=utf-8", "html": "text/html; charset=utf-8",
            "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "pdf": "application/pdf", "json": "application/json",
        ]
        let contentType = types[file.pathExtension.lowercased()] ?? "text/plain; charset=utf-8"
        send(connection, status: "200 OK", contentType: contentType, body: data)
    }

    private func send(_ connection: NWConnection, status: String, contentType: String, body: Data) {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Cache-Control: no-store\r\n"
        header += "Connection: close\r\n\r\n"
        var response = Data(header.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    @MainActor
    private func stateJSON() -> Data {
        guard let snap = stateProvider?() else { return Data("{}".utf8) }
        let steps = snap.steps.map { ["text": $0.text, "verify": $0.isVerification] as [String: Any] }
        let obj: [String: Any] = [
            "request_id": snap.requestID ?? "",
            "accessibility_granted": snap.accessibilityGranted,
            "screen_recording_granted": snap.screenRecordingGranted,
            "agent_backend": NotchConfig.shared["NOTCH_AGENT_BACKEND"] ?? "claude",
            "permission": snap.pendingPermission as Any? ?? NSNull(),
            "state": snap.state,
            "transcript": snap.transcript,
            "response": snap.response,
            "error": snap.errorMessage,
            "steps": steps,
            "workers": snap.workersRunning,
            "seeing": snap.contextApp ?? "",
            "success": snap.actionSucceeded,
            "skill": snap.learnedSkill ?? "",
            "file": (snap.outputFile as NSString?)?.lastPathComponent ?? "",
        ]
        return (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
    }

    // MARK: - LAN IP

    static func lanIPAddress() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let iface = ptr.pointee
            guard iface.ifa_addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: iface.ifa_name)
            guard name == "en0" || name == "en1" else { continue }
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(iface.ifa_addr, socklen_t(iface.ifa_addr.pointee.sa_len),
                           &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
                address = String(cString: hostname)
                if name == "en0" { break }
            }
        }
        return address
    }

    /// Tailnet IPv4: any utun* interface with an address in Tailscale's
    /// CGNAT range 100.64.0.0/10. Pure interface scan — no dependency on
    /// the Tailscale CLI or which client variant is installed.
    static func tailscaleIPAddress() -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let iface = ptr.pointee
            guard iface.ifa_addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            guard String(cString: iface.ifa_name).hasPrefix("utun") else { continue }
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(iface.ifa_addr, socklen_t(iface.ifa_addr.pointee.sa_len),
                              &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0
            else { continue }
            let ip = String(cString: hostname)
            let octets = ip.split(separator: ".").compactMap { UInt8($0) }
            if octets.count == 4, octets[0] == 100, (64...127).contains(octets[1]) {
                return ip
            }
        }
        return nil
    }

    // MARK: - Memory vault graph

    /// Parses ~/.notch markdown for [[wikilinks]] and skills into a
    /// nodes/edges JSON the graph page renders.
    private static func vaultGraphJSON() -> Data {
        let vault = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch")
        var nodes: [String: [String: Any]] = [:]
        var edges: [[String]] = []
        var edgeSet = Set<String>()

        func addNode(_ id: String, kind: String) {
            if nodes[id] == nil { nodes[id] = ["id": id, "kind": kind] }
        }
        func addEdge(_ a: String, _ b: String) {
            guard a != b else { return }
            let key = a < b ? a + "|" + b : b + "|" + a
            if edgeSet.insert(key).inserted { edges.append([a, b]) }
        }

        for skill in SkillLibrary.list() {
            addNode(skill.name, kind: "skill")
        }

        for name in ["MOC", "lessons", "journal"] {
            let file = vault.appendingPathComponent(name + ".md")
            guard var text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            addNode(name, kind: "file")
            if text.count > 60_000 { text = String(text.suffix(60_000)) }

            var search = Substring(text)
            while let open = search.range(of: "[[") {
                guard let close = search[open.upperBound...].range(of: "]]") else { break }
                let target = String(search[open.upperBound..<close.lowerBound])
                    .trimmingCharacters(in: .whitespaces)
                search = search[close.upperBound...]
                guard !target.isEmpty, target.count < 64, !target.contains("\n") else { continue }
                addNode(target, kind: "topic")
                addEdge(name, target)
            }
        }

        let obj: [String: Any] = ["nodes": Array(nodes.values), "edges": edges]
        return (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
    }

    /// Resolves a graph node id (same derivation as vaultGraphJSON: skill
    /// name, vault file basename, or wikilink topic) to markdown content
    /// for the note panel. Basename-only ids — no traversal.
    private static func noteJSON(rawId: String) -> Data? {
        let id = (rawId.removingPercentEncoding ?? rawId)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.count < 128,
              !id.contains("/"), !id.contains(".."), !id.contains("\\"),
              !id.hasPrefix(".") else { return nil }
        let vault = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".notch")

        func payload(_ kind: String, _ content: String) -> Data? {
            let obj: [String: Any] = ["id": id, "kind": kind, "content": String(content.suffix(60_000))]
            return try? JSONSerialization.data(withJSONObject: obj)
        }

        if let skill = SkillLibrary.list().first(where: { $0.name == id }),
           let text = try? String(contentsOf: URL(fileURLWithPath: skill.path), encoding: .utf8) {
            var md = skill.description.isEmpty ? "" : skill.description + "\n\n"
            md += "```bash\n" + text + "\n```"
            return payload("skill", md)
        }

        if let text = try? String(contentsOf: vault.appendingPathComponent(id + ".md"), encoding: .utf8) {
            return payload("file", text)
        }

        // Topic node: no file of its own — show backlinks, Obsidian-style.
        var out = "*No note file yet — mentions across the vault:*\n"
        var found = false
        for name in ["MOC", "lessons", "journal"] {
            guard let text = try? String(contentsOf: vault.appendingPathComponent(name + ".md"), encoding: .utf8)
            else { continue }
            let matches = text.split(separator: "\n", omittingEmptySubsequences: false)
                .filter { $0.contains("[[" + id + "]]") }
            guard !matches.isEmpty else { continue }
            found = true
            out += "\n## From [[" + name + "]]\n"
            out += matches.suffix(20).map(String.init).joined(separator: "\n") + "\n"
        }
        return found ? payload("topic", out) : payload("topic", "*Nothing written about this memory yet.*")
    }

    private static let graphHTML = """
    <!DOCTYPE html>
    <html lang="en"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#000000">
    <title>Notch — Memory</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
      html, body { height:100%; background:#000; overflow:hidden;
                   font-family:-apple-system, system-ui, sans-serif; }
      canvas { display:block; touch-action:none; }
      .hud { position:fixed; top:calc(env(safe-area-inset-top) + 14px); left:0; right:0;
             text-align:center; color:rgba(255,255,255,.9); pointer-events:none; }
      .hud h1 { font-size:15px; font-weight:700; letter-spacing:-.01em; }
      .hud p { font-size:11px; color:rgba(255,255,255,.4); margin-top:3px; }
      .legend { position:fixed; bottom:calc(env(safe-area-inset-bottom) + 14px); left:0; right:0;
                display:flex; justify-content:center; gap:14px; font-size:11px;
                color:rgba(255,255,255,.5); pointer-events:none; }
      .legend i { display:inline-block; width:8px; height:8px; border-radius:50%;
                  margin-right:5px; vertical-align:-1px; }

      /* ---- Obsidian-style note panel ---- */
      #panel { position:fixed; top:0; right:0; bottom:0; width:min(420px, 100vw);
               background:#16161a; border-left:1px solid rgba(255,255,255,.09);
               transform:translateX(105%); transition:transform .32s cubic-bezier(.3,.9,.3,1);
               z-index:20; display:flex; flex-direction:column;
               padding-top:calc(env(safe-area-inset-top) + 8px);
               padding-bottom:env(safe-area-inset-bottom);
               box-shadow:-20px 0 50px rgba(0,0,0,.6); }
      #panel.open { transform:translateX(0); }
      .phead { display:flex; align-items:center; gap:10px; padding:10px 16px 4px; }
      #ptitle { flex:1; font-size:18px; font-weight:700; letter-spacing:-.01em;
                color:rgba(255,255,255,.95); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #pclose { flex:none; width:32px; height:32px; border-radius:50%; border:none;
                background:rgba(255,255,255,.08); color:rgba(255,255,255,.7);
                font-size:14px; line-height:1; cursor:pointer; }
      #pclose:active { background:rgba(255,255,255,.18); }
      #pkind { font-size:10px; font-weight:700; letter-spacing:.09em; text-transform:uppercase;
               padding:0 18px 6px; }
      #pbody { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;
               padding:6px 18px 26px; font-size:14px; line-height:1.55;
               color:rgba(255,255,255,.82); overflow-wrap:break-word; }
      #pbody h1, #pbody h2, #pbody h3, #pbody h4 {
        color:rgba(255,255,255,.95); letter-spacing:-.01em; margin:16px 0 6px; line-height:1.3; }
      #pbody h1 { font-size:19px; } #pbody h2 { font-size:16px; }
      #pbody h3 { font-size:14.5px; } #pbody h4 { font-size:13.5px; }
      #pbody p { margin:7px 0; }
      #pbody ul { margin:7px 0; padding-left:22px; }
      #pbody li { margin:3px 0; }
      #pbody code { background:rgba(255,255,255,.08); border-radius:4px; padding:1px 5px;
                    font-family:ui-monospace, Menlo, monospace; font-size:12.5px; }
      #pbody pre { background:#0d0d10; border:1px solid rgba(255,255,255,.07);
                   border-radius:10px; padding:10px 12px; overflow-x:auto; margin:10px 0; }
      #pbody pre code { background:none; padding:0; font-size:12px; line-height:1.5; }
      #pbody blockquote { border-left:3px solid rgba(177,94,255,.5); padding:2px 12px;
                          margin:8px 0; color:rgba(255,255,255,.6); }
      #pbody hr { border:none; border-top:1px solid rgba(255,255,255,.1); margin:14px 0; }
      #pbody .dim { color:rgba(255,255,255,.4); font-style:italic; }
      .wl { color:#B15EFF; cursor:pointer; text-decoration:none;
            border-bottom:1px solid rgba(177,94,255,.35); }
      .wl:active { opacity:.6; }
    </style></head><body>
    <canvas id="c"></canvas>
    <div class="hud"><h1>Notch&rsquo;s memory</h1><p id="stats">loading&hellip;</p></div>
    <div class="legend">
      <span><i style="background:#5E9EFF"></i>files</span>
      <span><i style="background:#4ADE80"></i>skills</span>
      <span><i style="background:#B15EFF"></i>topics</span>
    </div>
    <div id="panel">
      <div class="phead"><div id="ptitle"></div><button id="pclose">&#10005;</button></div>
      <div id="pkind"></div>
      <div id="pbody"></div>
    </div>
    <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let W = 0, H = 0, camReady = false;
    const cam = { x: 0, y: 0, k: 1 };
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      if (!camReady) { cam.x = W/2; cam.y = H/2; camReady = true; }
    }
    window.addEventListener('resize', resize); resize();

    const COLORS = { file:'#5E9EFF', skill:'#4ADE80', topic:'#B15EFF' };
    let nodes = new Map(), edges = [], adj = new Map();
    let hoverId = null, selectedId = null, camTarget = null;

    function toWorld(sx, sy) { return { x:(sx - W/2)/cam.k + cam.x, y:(sy - H/2)/cam.k + cam.y }; }

    async function load() {
      try {
        const data = await (await fetch('vault')).json();
        const seen = new Set();
        for (const n of (data.nodes || [])) {
          seen.add(n.id);
          if (!nodes.has(n.id)) {
            nodes.set(n.id, {
              id:n.id, kind:n.kind, deg:0,
              x: W/2 + (Math.random()-0.5)*W*0.5,
              y: H/2 + (Math.random()-0.5)*H*0.5,
              vx:0, vy:0, born: performance.now()
            });
          }
        }
        for (const id of [...nodes.keys()]) if (!seen.has(id)) nodes.delete(id);
        edges = (data.edges || []).filter(e => nodes.has(e[0]) && nodes.has(e[1]));
        for (const n of nodes.values()) n.deg = 0;
        adj = new Map();
        for (const id of nodes.keys()) adj.set(id, new Set());
        for (const e of edges) {
          nodes.get(e[0]).deg++; nodes.get(e[1]).deg++;
          adj.get(e[0]).add(e[1]); adj.get(e[1]).add(e[0]);
        }
        document.getElementById('stats').textContent = nodes.size + ' memories · ' + edges.length + ' links';
      } catch(e) {}
      setTimeout(load, 5000);
    }
    load();

    // ---- interaction: tap vs drag vs pan vs pinch ----
    function pick(sx, sy) {
      const p = toWorld(sx, sy);
      const rr = Math.max(16, 20/cam.k);
      let best = null, bd = rr*rr;
      for (const n of nodes.values()) {
        const dx = n.x - p.x, dy = n.y - p.y, d2 = dx*dx + dy*dy;
        if (d2 < bd) { bd = d2; best = n; }
      }
      return best;
    }
    let ptr = null, pinch = null;
    function pDown(x, y) {
      ptr = { sx:x, sy:y, node: pick(x, y), camx:cam.x, camy:cam.y, moved:false };
    }
    function pMove(x, y) {
      if (!ptr) return;
      const dx = x - ptr.sx, dy = y - ptr.sy;
      if (!ptr.moved && dx*dx + dy*dy > 36) ptr.moved = true;
      if (!ptr.moved) return;
      if (ptr.node) {
        const w = toWorld(x, y);
        ptr.node.x = w.x; ptr.node.y = w.y; ptr.node.vx = 0; ptr.node.vy = 0;
      } else {
        cam.x = ptr.camx - dx/cam.k; cam.y = ptr.camy - dy/cam.k;
        camTarget = null;
      }
    }
    function pUp() {
      if (ptr && !ptr.moved) {
        if (ptr.node) openNote(ptr.node.id, false);
        else closePanel();
      }
      ptr = null;
    }
    canvas.addEventListener('mousedown', e => { pDown(e.clientX, e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove', e => {
      if (ptr) { pMove(e.clientX, e.clientY); return; }
      const n = pick(e.clientX, e.clientY);
      hoverId = n ? n.id : null;
      canvas.style.cursor = n ? 'pointer' : 'default';
    });
    window.addEventListener('mouseup', pUp);

    function zoomAt(sx, sy, f) {
      const w = toWorld(sx, sy);
      cam.k = Math.min(6, Math.max(0.2, cam.k * f));
      cam.x = w.x - (sx - W/2)/cam.k;
      cam.y = w.y - (sy - H/2)/cam.k;
      camTarget = null;
    }
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002));
    }, { passive:false });

    function snapPinch(e) {
      const a = e.touches[0], b = e.touches[1];
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
               mx: (a.clientX + b.clientX)/2, my: (a.clientY + b.clientY)/2 };
    }
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      if (e.touches.length === 2) { ptr = null; pinch = snapPinch(e); }
      else if (e.touches.length === 1) pDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive:false });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (pinch && e.touches.length >= 2) {
        const p = snapPinch(e);
        if (pinch.d > 0) zoomAt(p.mx, p.my, p.d / pinch.d);
        cam.x -= (p.mx - pinch.mx)/cam.k;
        cam.y -= (p.my - pinch.my)/cam.k;
        pinch = p;
      } else if (e.touches.length === 1) {
        pMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive:false });
    canvas.addEventListener('touchend', e => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) pUp();
    }, { passive:false });

    // ---- note panel ----
    const panel = document.getElementById('panel');
    let noteSeq = 0;
    async function openNote(id, center) {
      selectedId = id; hoverId = null;
      const n = nodes.get(id);
      if (center && n) camTarget = { x:n.x, y:n.y, k: Math.max(cam.k, 1.15) };
      document.getElementById('ptitle').textContent = id;
      const kb = document.getElementById('pkind');
      const kind = n ? n.kind : 'topic';
      kb.textContent = kind; kb.style.color = COLORS[kind] || '#888';
      document.getElementById('pbody').innerHTML = '<p class="dim">loading&hellip;</p>';
      panel.classList.add('open');
      const seq = ++noteSeq;
      try {
        const r = await fetch('note?id=' + encodeURIComponent(id));
        if (seq !== noteSeq) return;
        if (!r.ok) throw 0;
        const d = await r.json();
        if (seq !== noteSeq) return;
        if (d.kind) { kb.textContent = d.kind; kb.style.color = COLORS[d.kind] || '#888'; }
        const body = document.getElementById('pbody');
        body.innerHTML = md(d.content || '');
        body.scrollTop = 0;
      } catch(e) {
        if (seq === noteSeq)
          document.getElementById('pbody').innerHTML = '<p class="dim">No content for this memory.</p>';
      }
    }
    function closePanel() { panel.classList.remove('open'); selectedId = null; }
    document.getElementById('pclose').addEventListener('click', closePanel);
    window.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
    document.getElementById('pbody').addEventListener('click', e => {
      const a = e.target.closest('.wl');
      if (a) openNote(a.dataset.id, true);
    });

    // ---- tiny markdown renderer ----
    function escHtml(s) {
      return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    }
    function inline(s) {
      s = escHtml(s);
      s = s.replace(/\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]/g, function(m, t, alias) {
        t = t.trim();
        return '<a class="wl" data-id="' + t + '">' + (alias || t) + '</a>';
      });
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\\*([^*\\s][^*]*)\\*/g, '$1<em>$2</em>');
      return s;
    }
    function md(src) {
      const lines = (src || '').split('\\n');
      let html = '', inCode = false, code = [], inList = false;
      function closeList() { if (inList) { html += '</ul>'; inList = false; } }
      for (const line of lines) {
        if (line.trim().startsWith('```')) {
          if (inCode) { html += '<pre><code>' + escHtml(code.join('\\n')) + '</code></pre>'; code = []; inCode = false; }
          else { closeList(); inCode = true; }
          continue;
        }
        if (inCode) { code.push(line); continue; }
        const t = line.trim();
        if (!t) { closeList(); continue; }
        let m = t.match(/^(#{1,4})\\s+(.*)$/);
        if (m) { closeList(); const l = m[1].length; html += '<h' + l + '>' + inline(m[2]) + '</h' + l + '>'; continue; }
        if (/^(-{3,}|\\*{3,})$/.test(t)) { closeList(); html += '<hr>'; continue; }
        m = t.match(/^[-*+]\\s+(.*)$/);
        if (m) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
        m = t.match(/^&gt;\\s?(.*)$/) || t.match(/^>\\s?(.*)$/);
        if (m) { closeList(); html += '<blockquote>' + inline(m[1]) + '</blockquote>'; continue; }
        closeList();
        html += '<p>' + inline(t) + '</p>';
      }
      if (inCode) html += '<pre><code>' + escHtml(code.join('\\n')) + '</code></pre>';
      closeList();
      return html;
    }

    // ---- physics + draw ----
    function focusSet() {
      const f = hoverId || selectedId;
      if (!f || !nodes.has(f)) return null;
      const s = new Set([f]);
      for (const x of (adj.get(f) || [])) s.add(x);
      return { f: f, s: s };
    }
    function tick() {
      if (camTarget) {
        cam.x += (camTarget.x - cam.x) * 0.12;
        cam.y += (camTarget.y - cam.y) * 0.12;
        if (camTarget.k) cam.k += (camTarget.k - cam.k) * 0.12;
        if (Math.abs(camTarget.x - cam.x) < 0.5 && Math.abs(camTarget.y - cam.y) < 0.5) camTarget = null;
      }
      const arr = [...nodes.values()];
      const dragNode = ptr && ptr.moved ? ptr.node : null;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i+1; j < arr.length; j++) {
          const b = arr[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx*dx + dy*dy + 1;
          if (d2 < 90000) {
            const f = 2200 / d2;
            const d = Math.sqrt(d2);
            dx /= d; dy /= d;
            a.vx += dx*f; a.vy += dy*f;
            b.vx -= dx*f; b.vy -= dy*f;
          }
        }
        a.vx += (W/2 - a.x) * 0.0015;
        a.vy += (H/2 - a.y) * 0.0015;
      }
      for (const e of edges) {
        const a = nodes.get(e[0]), b = nodes.get(e[1]);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx*dx + dy*dy) + 0.01;
        const f = (d - 110) * 0.004;
        a.vx += dx/d*f; a.vy += dy/d*f;
        b.vx -= dx/d*f; b.vy -= dy/d*f;
      }
      for (const n of arr) {
        if (n === dragNode) continue;
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(W/2, H/2);
      ctx.scale(cam.k, cam.k);
      ctx.translate(-cam.x, -cam.y);

      const fs = focusSet();
      ctx.lineWidth = 1 / cam.k;
      for (const e of edges) {
        const a = nodes.get(e[0]), b = nodes.get(e[1]);
        let alpha = 0.13;
        if (fs) alpha = (e[0] === fs.f || e[1] === fs.f) ? 0.5 : 0.04;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const now = performance.now();
      const labelSize = Math.max(10 / cam.k, 4);
      for (const n of arr) {
        const r = 5 + Math.min(n.deg * 1.6, 10);
        const pop = Math.min(1, (now - n.born) / 600);
        const color = COLORS[n.kind] || '#888';
        const inFocus = !fs || fs.s.has(n.id);
        const dimmed = fs && !inFocus;
        const base = (dimmed ? 0.12 : 1) * pop;
        ctx.globalAlpha = base;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * pop, 0, 7);
        ctx.fillStyle = color; ctx.fill();
        ctx.globalAlpha = (dimmed ? 0.05 : 0.25) * pop;
        ctx.lineWidth = 1 / cam.k;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * pop + 5, 0, 7);
        ctx.strokeStyle = color; ctx.stroke();
        if (fs && n.id === fs.f) {
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 2 / cam.k;
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 7, 0, 7);
          ctx.strokeStyle = '#fff'; ctx.stroke();
        }
        const showLabel = (cam.k >= 0.5 || (fs && inFocus));
        if (showLabel) {
          ctx.globalAlpha = (dimmed ? 0.08 : (fs && inFocus ? 0.95 : 0.75)) * pop;
          ctx.fillStyle = '#fff';
          ctx.font = labelSize + 'px -apple-system, system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(n.id, n.x, n.y + r + 4 + labelSize);
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    tick();
    </script></body></html>
    """

    // MARK: - Phone page

    private static let pageHTML = """
    <!DOCTYPE html>
    <html lang="en"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Notch">
    <meta name="theme-color" content="#0d0d0d">
    <title>Notch</title>
    <style>
      :root {
        --bg:#0d0d0d; --raised:#212121; --raised2:#2f2f2f;
        --text:#ececec; --dim:#b4b4b4; --faint:#7d7d7d;
        --hair:rgba(255,255,255,.08);
        --green:#4ADE80; --red:#ff8583; --blue:#5E9EFF;
      }
      * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
      html, body { height:100%; }
      body { background:var(--bg); color:var(--text);
             font-family:-apple-system, system-ui, "Segoe UI", sans-serif;
             display:flex; flex-direction:column; height:100dvh;
             overflow:hidden; overscroll-behavior:none; }

      /* ---- minimal centered header ---- */
      header { flex:none; text-align:center;
               padding:calc(env(safe-area-inset-top) + 10px) 16px 8px; }
      .htitle { font-size:17px; font-weight:600; letter-spacing:-.01em; }
      .hsub { font-size:12px; color:var(--faint); margin-top:2px; min-height:15px; }

      /* ---- conversation ---- */
      #chat { flex:1; overflow-y:auto; overflow-x:hidden;
              -webkit-overflow-scrolling:touch; padding:4px 16px 12px; }
      .empty { min-height:100%; display:flex; flex-direction:column;
               align-items:center; justify-content:center; gap:28px;
               text-align:center; padding-bottom:40px; }
      .empty h2 { font-size:26px; font-weight:600; letter-spacing:-.02em; }
      .chips { display:flex; flex-wrap:wrap; justify-content:center; gap:8px;
               max-width:340px; }
      .chip { font-size:13.5px; color:var(--dim); background:transparent;
              border:1px solid var(--hair); border-radius:999px; padding:9px 14px; }
      .chip:active { background:var(--raised); }

      .turn { margin:20px 0; }
      .u { display:flex; justify-content:flex-end; }
      .bubble { max-width:80%; background:var(--raised); border-radius:20px;
                padding:10px 16px; font-size:16px; line-height:1.45;
                overflow-wrap:break-word; white-space:pre-wrap;
                animation:pop .3s cubic-bezier(.3,.9,.3,1.05); }
      @keyframes pop { from { opacity:0; transform:translateY(8px) } }
      .a { margin-top:16px; }
      .steps { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
      .steps:empty { display:none; }
      .step { display:flex; gap:8px; align-items:baseline; font-size:13.5px;
              line-height:1.45; color:var(--faint); animation:pop .25s ease-out; }
      .step em { flex:none; font-style:normal; width:15px; text-align:center; font-size:11px; }
      .step.cur { color:var(--dim); }
      .step.vfy { color:var(--blue); opacity:.8; }
      .think { display:none; padding:4px 0; }
      .think.on { display:block; }
      .think span { display:block; width:11px; height:11px; border-radius:50%;
                    background:var(--text); animation:pulse 1.1s ease-in-out infinite; }
      @keyframes pulse { 0%,100% { opacity:.25; transform:scale(.8) } 50% { opacity:1; transform:scale(1) } }
      .resp { font-size:16px; line-height:1.6; white-space:pre-wrap; overflow-wrap:break-word; }
      .resp.err { color:var(--red); }
      .extra { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .extra:empty { display:none; }
      .badge { display:inline-flex; align-items:center; gap:6px; font-size:13px;
               font-weight:500; color:var(--dim); background:var(--raised);
               border:1px solid var(--hair); border-radius:999px; padding:7px 13px;
               text-decoration:none; }
      .badge.good { color:var(--green); border-color:rgba(74,222,128,.25); }
      .retry { font-size:13px; font-weight:600; color:var(--text);
               background:var(--raised2); border:none; border-radius:999px; padding:8px 15px; }
      .hidden { display:none !important; }

      /* ---- bottom composer pill ---- */
      footer { flex:none; padding:8px 12px calc(env(safe-area-inset-bottom) + 10px); }
      .pill { display:flex; align-items:center; gap:2px;
              background:var(--raised); border:1px solid var(--hair);
              border-radius:28px; padding:6px; min-height:52px; }
      .icon { flex:none; width:40px; height:40px; border-radius:50%; border:none;
              background:transparent; color:var(--text);
              display:flex; align-items:center; justify-content:center;
              transition:transform .12s; }
      .icon:active { transform:scale(.9); }
      .icon.solid { background:#fff; color:#000; }
      .icon.rec { color:var(--red); }
      #cmd { flex:1; min-width:0; background:transparent; border:none; outline:none;
             font-size:16px; color:var(--text); padding:8px 4px; }
      #cmd::placeholder { color:var(--faint); }

      /* ---- plus menu ---- */
      #scrim { position:fixed; inset:0; z-index:30; display:none; background:rgba(0,0,0,.35); }
      #scrim.open { display:block; }
      #menu { position:absolute; left:14px;
              bottom:calc(env(safe-area-inset-bottom) + 74px);
              background:var(--raised2); border:1px solid var(--hair);
              border-radius:16px; overflow:hidden; min-width:220px;
              box-shadow:0 12px 40px rgba(0,0,0,.6); animation:pop .18s ease-out; }
      .mi { display:flex; align-items:center; gap:10px; width:100%; padding:14px 16px;
            background:none; border:none; color:var(--text); font-size:15px; text-align:left; }
      .mi + .mi { border-top:1px solid var(--hair); }
      .mi:active { background:rgba(255,255,255,.06); }
    </style></head><body>

    <header>
      <div class="htitle">Notch</div>
      <div class="hsub" id="sub"></div>
    </header>

    <main id="chat">
      <div class="empty" id="empty">
        <h2>What can I do for you?</h2>
        <div class="chips" id="chips"></div>
      </div>
      <div id="msgs"></div>
    </main>

    <footer>
      <form class="pill" id="form">
        <button class="icon" id="plus" type="button" aria-label="Menu"></button>
        <input id="cmd" placeholder="Ask anything" autocomplete="off" autocorrect="on" enterkeyhint="send">
        <button class="icon" id="btn" type="button" aria-label="Send"></button>
      </form>
    </footer>

    <div id="scrim"><div id="menu">
      <button class="mi" id="miGraph">&#129504; Memory graph</button>
      <button class="mi" id="miClear">&#128465;&#65039; Clear conversation</button>
    </div></div>

    <script>
    const $ = id => document.getElementById(id);
    const esc = t => (t||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    const BUSY = ['listening','thinking','executing','still working'];
    const isBusy = st => BUSY.some(x => st.startsWith(x));

    const IC = {
      plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      mic:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5"/></svg>',
      send: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
      stop: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>'
    };
    $('plus').innerHTML = IC.plus;

    let prevState = 'idle', lastJSON = '', lastSent = '', lastTranscript = '';
    let cur = null, clearedTranscript = null, wasOffline = false;

    function el(tag, cls, parent) {
      const d = document.createElement(tag);
      if (cls) d.className = cls;
      parent.appendChild(d);
      return d;
    }
    function nearBottom() { const c = $('chat'); return c.scrollHeight - c.scrollTop - c.clientHeight < 140; }
    function scrollBottom() { const c = $('chat'); c.scrollTop = c.scrollHeight; }

    async function post(p, body) {
      try { await fetch(p, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{})}); }
      catch(e) {}
    }

    // The right composer button is tri-state: stop while Notch is busy,
    // send arrow when there's text, mic otherwise (ChatGPT-style swap).
    function updateBtn() {
      const b = $('btn');
      if (isBusy(prevState)) { b.innerHTML = IC.stop; b.className = 'icon solid'; }
      else if ($('cmd').value.trim()) { b.innerHTML = IC.send; b.className = 'icon solid'; }
      else if (!b.classList.contains('rec')) { b.innerHTML = IC.mic; b.className = 'icon'; }
    }
    $('cmd').addEventListener('input', updateBtn);
    $('btn').addEventListener('click', e => {
      e.preventDefault();
      if (isBusy(prevState)) { post('cancel'); return; }
      const t = $('cmd').value.trim();
      if (t) sendCmd(t); else micTap();
    });
    $('form').addEventListener('submit', e => { e.preventDefault(); sendCmd($('cmd').value); });

    function sendCmd(t) {
      t = (t||'').trim();
      if (!t) return;
      lastSent = t;
      saveRecent(t);
      newTurn(t);
      cur.awaitFresh = true;   // ignore stale snapshot content until the Mac picks this up
      post('command', {text: t});
      $('cmd').value = '';
      updateBtn();
    }

    // ---- chat turns ----
    // Each turn: right-aligned user bubble + left-aligned assistant block
    // (steps, thinking dot, response text, badges).
    function newTurn(text) {
      clearedTranscript = null;
      $('empty').classList.add('hidden');
      const t = el('div', 'turn', $('msgs'));
      const u = el('div', 'u', t);
      const b = el('div', 'bubble', u);
      b.textContent = text || '';
      if (!text) u.classList.add('hidden');
      const a = el('div', 'a', t);
      cur = {
        u: u, b: b,
        steps: el('div', 'steps', a),
        think: el('div', 'think on', a),
        resp: el('div', 'resp', a),
        extra: el('div', 'extra', a),
        transcript: text || '', renderedSteps: 0,
        done: false, awaitFresh: false, extraHTML: ''
      };
      cur.think.innerHTML = '<span></span>';
      scrollBottom();
    }
    function setUser(text) {
      cur.transcript = text;
      cur.b.textContent = text;
      cur.u.classList.toggle('hidden', !text);
    }

    function render(s) {
      const st = s.state || 'idle';
      const busy = isBusy(st);

      let sub = '';
      if (st === 'listening') sub = s.seeing ? 'listening · seeing ' + s.seeing : 'listening…';
      else if (st.startsWith('thinking') || st.startsWith('still')) sub = st;
      else if (st === 'executing') sub = 'working…';
      else if (s.workers > 0) sub = s.workers + ' agent' + (s.workers > 1 ? 's' : '') + ' working';
      $('sub').textContent = sub;

      const t = s.transcript || '';
      const tChanged = t !== lastTranscript;
      lastTranscript = t;

      // Turn boundaries: new activity after a finished turn starts a fresh
      // one; live dictation updates the current bubble in place.
      if (!cur) {
        if (busy || (t && t !== clearedTranscript)) newTurn(t === clearedTranscript ? '' : t);
        else if ((s.response || s.error) && clearedTranscript === null) newTurn('');
      } else if (cur.awaitFresh) {
        if (busy) cur.awaitFresh = false;
      } else if (cur.done && (busy || (tChanged && t))) {
        newTurn(t);
      } else if (tChanged && t) {
        setUser(t);
      }
      if (!cur || cur.awaitFresh) { prevState = st; updateBtn(); return; }

      const keep = nearBottom();

      const steps = s.steps || [];
      if (steps.length < cur.renderedSteps) { cur.steps.innerHTML = ''; cur.renderedSteps = 0; }
      for (let i = cur.renderedSteps; i < steps.length; i++) {
        const d = el('div', 'step' + (steps[i].verify ? ' vfy' : ''), cur.steps);
        const em = document.createElement('em');
        em.innerHTML = steps[i].verify ? '&#128065;' : '&#8250;';
        const sp = document.createElement('span');
        sp.textContent = steps[i].text;
        d.appendChild(em); d.appendChild(sp);
      }
      cur.renderedSteps = steps.length;
      const rows = cur.steps.children;
      for (let i = 0; i < rows.length; i++) {
        rows[i].classList.toggle('cur', st === 'executing' && i === rows.length - 1);
      }

      const respText = st === 'error' ? s.error : s.response;
      cur.resp.textContent = respText || '';
      cur.resp.classList.toggle('err', st === 'error');
      cur.think.classList.toggle('on', busy && !steps.length && !respText);

      if (st === 'responding' || st === 'error' || (!busy && !!(s.response || s.error))) cur.done = true;

      let extra = '';
      if (s.file) extra += '<a class="badge" href="outbox/' + encodeURIComponent(s.file) + '" target="_blank">&#128196; ' + esc(s.file) + '</a>';
      if (s.skill) extra += '<span class="badge">&#10024; Learned: ' + esc(s.skill) + '</span>';
      if (cur.done && st !== 'error' && s.success) extra += '<span class="badge good">&#10003; Done</span>';
      if (st === 'error' && lastSent) extra += '<button class="retry" type="button">Try again</button>';
      if (extra !== cur.extraHTML) { cur.extra.innerHTML = extra; cur.extraHTML = extra; }

      if (keep) scrollBottom();
      prevState = st;
      updateBtn();
    }
    $('msgs').addEventListener('click', e => {
      if (e.target.closest('.retry') && lastSent) sendCmd(lastSent);
    });

    // ---- suggestion chips (empty state) ----
    const STATIC_CHIPS = ['What am I looking at?', 'How are the workers doing?', 'Toggle dark mode', 'Open Safari'];
    function recents() { try { return JSON.parse(localStorage.getItem('notch-recents')||'[]'); } catch(e) { return []; } }
    function saveRecent(t) {
      const r = [t].concat(recents().filter(x => x !== t)).slice(0,5);
      localStorage.setItem('notch-recents', JSON.stringify(r));
      drawChips();
    }
    function drawChips() {
      let html = '';
      const seen = new Set();
      recents().concat(STATIC_CHIPS).forEach(t => {
        if (seen.has(t) || seen.size >= 6) return; seen.add(t);
        html += '<button class="chip" type="button" data-t="' + esc(t).replace(/"/g,'&quot;') + '">' + esc(t) + '</button>';
      });
      $('chips').innerHTML = html;
    }
    $('chips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (b) sendCmd(b.dataset.t);
    });

    // ---- plus menu ----
    $('plus').addEventListener('click', e => { e.preventDefault(); $('scrim').classList.add('open'); });
    $('scrim').addEventListener('click', e => { if (e.target === $('scrim')) $('scrim').classList.remove('open'); });
    $('miGraph').addEventListener('click', () => { location.href = 'graph'; });
    $('miClear').addEventListener('click', () => {
      $('msgs').innerHTML = '';
      cur = null;
      clearedTranscript = lastTranscript;  // don't resurrect the last turn from the snapshot
      $('empty').classList.remove('hidden');
      drawChips();
      $('scrim').classList.remove('open');
    });

    // ---- mic: browser speech recognition when available, else focus the
    // input so the keyboard's own dictation can take over ----
    let rec = null;
    function micTap() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { $('cmd').focus(); return; }
      try {
        rec = new SR();
        rec.lang = navigator.language || 'en-US';
        rec.onresult = e => { $('cmd').value = e.results[0][0].transcript; };
        rec.onerror = () => { $('btn').classList.remove('rec'); $('cmd').focus(); };
        rec.onend = () => { $('btn').classList.remove('rec'); updateBtn(); };
        $('btn').classList.add('rec');
        rec.start();
      } catch(e) { $('btn').classList.remove('rec'); $('cmd').focus(); }
    }

    // ---- keyboard-aware layout: track the visual viewport so the composer
    // stays above the iOS keyboard ----
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        document.body.style.height = window.visualViewport.height + 'px';
        window.scrollTo(0, 0);
        scrollBottom();
      });
    }
    $('cmd').addEventListener('focus', () => setTimeout(scrollBottom, 300));

    async function poll() {
      let busy = false;
      try {
        const r = await fetch('state');
        const txt = await r.text();
        if (txt !== lastJSON || wasOffline) {
          lastJSON = txt; wasOffline = false;
          render(JSON.parse(txt));
        }
        busy = isBusy(prevState);
      } catch(e) { wasOffline = true; $('sub').textContent = 'offline'; }
      setTimeout(poll, busy ? 500 : 1400);
    }
    drawChips();
    updateBtn();
    poll();
    </script></body></html>
    """
}
