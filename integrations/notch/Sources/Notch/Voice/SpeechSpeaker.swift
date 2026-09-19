import AVFoundation
import Foundation

/// Speaks agent responses aloud. Two engines:
///  - ElevenLabs (human-quality) whenever ELEVENLABS_API_KEY exists in
///    ~/.notch/config — read fresh per utterance, so the agent can obtain
///    a key at runtime and the very next sentence uses the new voice.
///  - Apple's AVSpeechSynthesizer as the always-available fallback.
///
/// Interruption-safe: `stop()` cuts speech instantly. Half-duplex by
/// design — the mic is never open while Notch talks.
@MainActor
final class SpeechSpeaker: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {

    /// Fires after speech completes naturally (not on stop()).
    var onFinish: (() -> Void)?

    private let synthesizer = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var fetchTask: Task<Void, Never>?
    private var utteranceGen = 0
    var enabled: Bool = (NotchConfig.shared["NOTCH_TTS"] ?? "1") != "0"

    /// Default voice: "Sarah" — free-tier default. Override with
    /// ELEVENLABS_VOICE_ID (or legacy NOTCH_VOICE_ID) in ~/.notch/config.
    private static let defaultVoiceID = "EXAVITQu4vr4xnSDxMaL"

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Speaks `text`; returns false when TTS is disabled or text is empty
    /// (caller falls back to its silent-path timing).
    @discardableResult
    func speak(_ text: String) -> Bool {
        guard enabled, !text.isEmpty else { return false }
        stop()
        utteranceGen += 1
        let gen = utteranceGen

        if let key = NotchConfig.liveValue("ELEVENLABS_API_KEY"), !key.isEmpty {
            let voice = NotchConfig.liveValue("ELEVENLABS_VOICE_ID")
                ?? NotchConfig.liveValue("NOTCH_VOICE_ID")
                ?? Self.defaultVoiceID
            fetchTask = Task { [weak self] in
                let audio = await Self.fetchElevenLabsAudio(text: text, key: key, voiceID: voice)
                await MainActor.run {
                    guard let self, self.utteranceGen == gen else { return }
                    if let audio, self.play(audio) { return }
                    self.speakWithApple(text) // graceful fallback
                }
            }
            return true
        }

        speakWithApple(text)
        return true
    }

    func stop() {
        fetchTask?.cancel()
        fetchTask = nil
        player?.stop()
        player = nil
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    // MARK: - Engines

    private func speakWithApple(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.5
        utterance.prefersAssistiveTechnologySettings = false
        synthesizer.speak(utterance)
    }

    private func play(_ data: Data) -> Bool {
        guard let newPlayer = try? AVAudioPlayer(data: data) else { return false }
        newPlayer.delegate = self
        player = newPlayer
        return newPlayer.play()
    }

    private static func fetchElevenLabsAudio(text: String, key: String, voiceID: String) async -> Data? {
        var request = URLRequest(
            url: URL(string: "https://api.elevenlabs.io/v1/text-to-speech/\(voiceID)?output_format=mp3_44100_128")!
        )
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue(key, forHTTPHeaderField: "xi-api-key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": ["stability": 0.5, "similarity_boost": 0.75],
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              data.count > 500 else {
            NSLog("[Notch] ElevenLabs TTS failed — falling back to Apple voice")
            return nil
        }
        return data
    }

    // MARK: - Completion plumbing

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.onFinish?() }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.onFinish?() }
    }
}
