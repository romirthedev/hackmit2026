import Foundation

/// Orchestrates Live Translator mode: continuously captures the Mac's SYSTEM
/// audio (whatever the speakers are playing — a foreign-language video, call,
/// or podcast) via ScreenCaptureKit, and every few seconds sends a rolling,
/// slightly-overlapping chunk to Groq/Whisper's /translations endpoint, which
/// returns English regardless of source language. The running English text is
/// published as scrolling caption segments for the notch UI.
///
/// Modeled on `MeetingModeManager`, but tuned for LOW LATENCY (short chunks,
/// no mic, no file output) and it never speaks — the translation is read, not
/// heard, so it doesn't fight the video's own audio.
@MainActor
final class TranslatorModeManager: ObservableObject {

    struct Caption: Identifiable {
        let id = UUID()
        let text: String
    }

    @Published private(set) var isActive = false
    @Published private(set) var captions: [Caption] = []
    @Published private(set) var elapsedSeconds: Int = 0
    /// True until the first non-empty translation lands — drives the
    /// "Listening for audio…" placeholder.
    @Published private(set) var awaitingFirst = true

    // MARK: - Config

    /// Rolling chunk cadence. Short enough to feel live, long enough to give
    /// Whisper coherent phrases to translate.
    private let chunkSeconds: Double = 6
    /// Audio carried over into the next chunk so words at a boundary survive.
    private let overlapSeconds: Double = 1.0

    // MARK: - Engines

    private let systemAudio = SystemAudioCapture()
    private let groq = GroqTranscriptionClient()

    private var chunkTimer: Timer?
    private var elapsedTimer: Timer?
    private var startTime: Date?
    /// Last few words of the most recent segment, for overlap de-duplication.
    private var lastWords: [String] = []
    /// Bumped on stop so an in-flight translation from a stale run is dropped.
    private var generation = 0

    // MARK: - Public

    func start() async throws {
        guard !isActive else { return }

        // Checks Screen Recording permission internally and throws a
        // user-readable error if it's missing.
        try await systemAudio.start()

        captions = []
        lastWords = []
        awaitingFirst = true
        startTime = Date()
        elapsedSeconds = 0
        generation += 1
        isActive = true

        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isActive, let start = self.startTime else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(start))
            }
        }

        chunkTimer = Timer.scheduledTimer(withTimeInterval: chunkSeconds, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.translateChunk() }
        }

        NSLog("[Notch] Live Translator started")
    }

    func stop() {
        guard isActive else { return }
        isActive = false
        generation += 1
        chunkTimer?.invalidate()
        chunkTimer = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        systemAudio.stop()
        NSLog("[Notch] Live Translator stopped, %d segments", captions.count)
    }

    // MARK: - Translation

    private func translateChunk() {
        guard isActive else { return }
        let wav = systemAudio.snapshotWAVRetainingTail(overlapSeconds: overlapSeconds)
        // Skip near-silent chunks (< ~0.4s of real audio beyond WAV header).
        guard wav.count > 14_000 else { return }
        let gen = generation

        Task { [weak self] in
            guard let self else { return }
            guard let english = try? await self.groq.translate(wav: wav) else { return }
            await MainActor.run {
                guard self.generation == gen, self.isActive else { return }
                self.appendTranslated(english)
            }
        }
    }

    /// Append a fresh English segment, trimming any leading words that repeat
    /// the tail of the previous segment (an artifact of the audio overlap).
    private func appendTranslated(_ raw: String) {
        let cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, !Self.isHallucination(cleaned) else { return }

        let deduped = Self.trimOverlap(previousTail: lastWords, new: cleaned)
        guard !deduped.isEmpty else { return }

        captions.append(Caption(text: deduped))
        awaitingFirst = false
        lastWords = cleaned.split(separator: " ").suffix(8).map(String.init)

        // Bound memory on long sessions — the UI only scrolls recent lines.
        if captions.count > 200 {
            captions.removeFirst(captions.count - 200)
        }
    }

    /// Drops the largest prefix of `new` that duplicates the suffix of the
    /// previous segment (word-level, case/punctuation-insensitive, ≤8 words).
    private static func trimOverlap(previousTail: [String], new: String) -> String {
        var words = new.split(separator: " ").map(String.init)
        guard !previousTail.isEmpty, !words.isEmpty else { return new }

        func norm(_ w: String) -> String {
            w.lowercased().trimmingCharacters(in: .punctuationCharacters)
        }
        let maxOverlap = min(previousTail.count, words.count, 8)
        var best = 0
        for k in stride(from: maxOverlap, through: 2, by: -1) {
            let tail = previousTail.suffix(k).map(norm)
            let head = words.prefix(k).map(norm)
            if tail == head { best = k; break }
        }
        if best > 0 { words.removeFirst(best) }
        return words.joined(separator: " ")
    }

    /// Whisper reliably hallucinates a handful of stock phrases on silence or
    /// music. Only filter when the WHOLE segment is one of them.
    private static func isHallucination(_ text: String) -> Bool {
        let t = text.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: " .!,"))
        let junk: Set<String> = [
            "you", "thank you", "thanks for watching", "thanks for watching!",
            "please subscribe", "subscribe", "bye", "bye bye", ".", "",
        ]
        return junk.contains(t)
    }
}
