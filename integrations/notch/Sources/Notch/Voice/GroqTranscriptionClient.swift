import Foundation

/// Sends WAV audio to Groq's Whisper endpoint and returns the transcript.
/// Groq is used specifically for STT speed — the latency-critical leg.
final class GroqTranscriptionClient {

    enum TranscriptionError: LocalizedError {
        case missingAPIKey
        case badResponse(Int, String)

        var errorDescription: String? {
            switch self {
            case .missingAPIKey:
                return "GROQ_API_KEY is not set. Add it to ~/.notch/config."
            case .badResponse(let code, let body):
                return "Transcription failed (\(code)): \(body.prefix(120))"
            }
        }
    }

    private let transcriptionsEndpoint = URL(string: "https://api.groq.com/openai/v1/audio/transcriptions")!
    private let translationsEndpoint = URL(string: "https://api.groq.com/openai/v1/audio/translations")!
    private let model = "whisper-large-v3-turbo"
    /// The /translations endpoint only supports the full v3 model (turbo is
    /// transcription-only). It always returns English regardless of source.
    private let translationModel = "whisper-large-v3"

    /// Same-language transcription (source → source text).
    func transcribe(wav: Data) async throws -> String {
        try await send(wav: wav, endpoint: transcriptionsEndpoint, model: model)
    }

    /// Whisper's translation leg: any-language speech → English text, in one
    /// call, using the same key/auth as `transcribe`. Powers live translation.
    func translate(wav: Data) async throws -> String {
        try await send(wav: wav, endpoint: translationsEndpoint, model: translationModel)
    }

    private func send(wav: Data, endpoint: URL, model: String) async throws -> String {
        guard let key = NotchConfig.shared.groqAPIKey, !key.isEmpty else {
            throw TranscriptionError.missingAPIKey
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        let boundary = "notch-\(UUID().uuidString)"
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("model", model)
        field("response_format", "json")
        field("temperature", "0")
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n".utf8))
        body.append(wav)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw TranscriptionError.badResponse(code, String(data: data, encoding: .utf8) ?? "")
        }

        struct Reply: Decodable { let text: String }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        return reply.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Local config: environment first, then ~/.notch/config (KEY=VALUE lines).
/// Never committed, never bundled.
final class NotchConfig {
    static let shared = NotchConfig()

    private var values: [String: String] = [:]

    private init() {
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/config")
        if let text = try? String(contentsOf: configURL, encoding: .utf8) {
            for line in text.split(separator: "\n") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard !trimmed.hasPrefix("#"), let eq = trimmed.firstIndex(of: "=") else { continue }
                let key = String(trimmed[..<eq]).trimmingCharacters(in: .whitespaces)
                var value = String(trimmed[trimmed.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                value = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                values[key] = value
            }
        }
    }

    subscript(key: String) -> String? {
        ProcessInfo.processInfo.environment[key] ?? values[key]
    }

    /// Re-reads ~/.notch/config on every call — for values the agent can
    /// write at runtime (e.g. an API key it just obtained itself).
    static func liveValue(_ key: String) -> String? {
        if let env = ProcessInfo.processInfo.environment[key] { return env }
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/config")
        guard let text = try? String(contentsOf: configURL, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.hasPrefix("#"), let eq = trimmed.firstIndex(of: "=") else { continue }
            let k = String(trimmed[..<eq]).trimmingCharacters(in: .whitespaces)
            guard k == key else { continue }
            return String(trimmed[trimmed.index(after: eq)...])
                .trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }
        return nil
    }

    var groqAPIKey: String? { self["GROQ_API_KEY"] }

    /// Writes KEY=VALUE to ~/.notch/config (replacing an existing line),
    /// so preferences the user flips in the UI survive relaunch.
    static func setValue(_ value: String, forKey key: String) {
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".notch/config")
        var lines = ((try? String(contentsOf: configURL, encoding: .utf8)) ?? "")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        while lines.last?.isEmpty == true { lines.removeLast() }
        var replaced = false
        for (i, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.hasPrefix("#"), let eq = trimmed.firstIndex(of: "=") else { continue }
            if String(trimmed[..<eq]).trimmingCharacters(in: .whitespaces) == key {
                lines[i] = "\(key)=\(value)"
                replaced = true
            }
        }
        if !replaced { lines.append("\(key)=\(value)") }
        try? (lines.joined(separator: "\n") + "\n")
            .write(to: configURL, atomically: true, encoding: .utf8)
        shared.values[key] = value
    }
}
