import Foundation

/// The JSON contract the invoked agent must return (see the system prompt
/// in ClaudeCodeInvoker). Parsed leniently: if the agent's final text isn't
/// valid JSON we fall back to treating the whole text as an answer.
struct AgentResponse: Codable {
    enum Kind: String, Codable {
        case answer
        case action
        case clarify
    }

    var type: Kind
    var steps: [String]
    var response: String
    var success: Bool
    /// Name of a skill the agent taught itself during this request.
    var learnedSkill: String?
    /// Absolute path of a substantial output written to ~/NotchOutbox.
    var outputFile: String?

    enum CodingKeys: String, CodingKey {
        case type, steps, response, success
        case learnedSkill = "learned_skill"
        case outputFile = "output_file"
    }

    init(type: Kind, steps: [String] = [], response: String, success: Bool = true,
         learnedSkill: String? = nil, outputFile: String? = nil) {
        self.type = type
        self.steps = steps
        self.response = response
        self.success = success
        self.learnedSkill = learnedSkill
        self.outputFile = outputFile
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = (try? c.decode(Kind.self, forKey: .type)) ?? .answer
        steps = (try? c.decode([String].self, forKey: .steps)) ?? []
        response = (try? c.decode(String.self, forKey: .response)) ?? ""
        success = (try? c.decode(Bool.self, forKey: .success)) ?? true
        learnedSkill = try? c.decodeIfPresent(String.self, forKey: .learnedSkill)
        outputFile = try? c.decodeIfPresent(String.self, forKey: .outputFile)
    }

    /// Extract the first balanced top-level `{...}` block from agent output
    /// and decode it. Agents sometimes wrap JSON in prose or code fences.
    static func parse(from text: String) -> AgentResponse? {
        let stripped = text
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")

        guard let start = stripped.firstIndex(of: "{") else { return nil }
        var depth = 0
        var inString = false
        var escaped = false
        var i = start
        while i < stripped.endIndex {
            let ch = stripped[i]
            if escaped {
                escaped = false
            } else if ch == "\\" && inString {
                escaped = true
            } else if ch == "\"" {
                inString.toggle()
            } else if !inString {
                if ch == "{" { depth += 1 }
                if ch == "}" {
                    depth -= 1
                    if depth == 0 {
                        let json = String(stripped[start...i])
                        if let data = json.data(using: .utf8),
                           let resp = try? JSONDecoder().decode(AgentResponse.self, from: data),
                           !resp.response.isEmpty || !resp.steps.isEmpty {
                            return resp
                        }
                        return nil
                    }
                }
            }
            i = stripped.index(after: i)
        }
        return nil
    }
}

/// One narrated step shown live in the `executing` state.
struct AgentStep: Identifiable, Equatable {
    let id = UUID()
    var text: String
    /// True when the text is a verbatim command/URL — rendered in SF Mono.
    var isCommand: Bool
    /// True when this step is the agent inspecting its own work
    /// (screenshot + vision check) — rendered with the eye treatment.
    var isVerification: Bool = false
}
