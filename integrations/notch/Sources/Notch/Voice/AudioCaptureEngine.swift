import AVFoundation
import Foundation

/// Captures mic audio via an AVAudioEngine tap, downsamples to 16kHz mono
/// Int16 PCM (Whisper's native rate), publishes live amplitude for the
/// waveform UI, and runs a simple silence-based VAD:
///  - a rolling-average pause of ~400ms after speech triggers `onPause`
///    (send accumulated audio for a live transcript update)
///  - 2.5s of silence after speech triggers `onUtteranceEnd`
///  - if no speech is ever detected, `onNoSpeechTimeout` fires after 12s
final class AudioCaptureEngine {

    // Callbacks are always invoked on the main queue.
    var onAmplitude: ((Float) -> Void)?
    var onPause: ((Data) -> Void)?
    var onUtteranceEnd: ((Data) -> Void)?
    var onNoSpeechTimeout: (() -> Void)?

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16000,
        channels: 1,
        interleaved: true
    )!

    private let queue = DispatchQueue(label: "notch.audio")
    private var pcmData = Data()
    private var running = false

    // VAD tuning
    private let speechThreshold: Float = 0.015
    private let pauseInterval: TimeInterval = 0.4
    private let utteranceEndInterval: TimeInterval = 2.5
    private let noSpeechTimeout: TimeInterval = 12.0

    private var startTime: Date = .distantPast
    private var lastSpeechTime: Date?
    private var pauseFired = false
    private var vadTimer: DispatchSourceTimer?
    private var smoothedAmplitude: Float = 0

    static func requestPermission(_ completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        default:
            completion(false)
        }
    }

    func start() throws {
        guard !running else { return }
        pcmData = Data()
        lastSpeechTime = nil
        pauseFired = false
        smoothedAmplitude = 0
        startTime = Date()

        let input = engine.inputNode
        let inputFormat = input.inputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else {
            throw NSError(domain: "Notch", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "No audio input device available."
            ])
        }
        converter = AVAudioConverter(from: inputFormat, to: targetFormat)

        // ~100ms windows at the native rate.
        let bufferSize = AVAudioFrameCount(inputFormat.sampleRate / 10)
        input.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            self?.queue.async { self?.process(buffer: buffer) }
        }

        engine.prepare()
        try engine.start()
        running = true
        startVADTimer()
    }

    func stop() {
        guard running else { return }
        running = false
        vadTimer?.cancel()
        vadTimer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// Everything captured so far, as a WAV file ready for transcription.
    func snapshotWAV() -> Data {
        queue.sync { Self.wavFile(fromPCM16: pcmData, sampleRate: 16000) }
    }

    // MARK: - Internals

    private func process(buffer: AVAudioPCMBuffer) {
        // Amplitude (RMS over the raw buffer) for the waveform + VAD.
        var rms: Float = 0
        if let channel = buffer.floatChannelData?[0] {
            let n = Int(buffer.frameLength)
            guard n > 0 else { return }
            var sum: Float = 0
            for i in 0..<n { sum += channel[i] * channel[i] }
            rms = sqrt(sum / Float(n))
        }
        smoothedAmplitude = smoothedAmplitude * 0.7 + rms * 0.3
        let amp = smoothedAmplitude
        DispatchQueue.main.async { [weak self] in self?.onAmplitude?(amp) }

        if amp > speechThreshold {
            lastSpeechTime = Date()
            pauseFired = false
        }

        // Downsample to 16k mono Int16 and accumulate.
        guard let converter else { return }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

        var consumed = false
        converter.convert(to: out, error: nil) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }

        if out.frameLength > 0, let int16 = out.int16ChannelData?[0] {
            pcmData.append(UnsafeBufferPointer(start: int16, count: Int(out.frameLength)))
        }
    }

    private func startVADTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
        timer.setEventHandler { [weak self] in self?.tickVAD() }
        timer.resume()
        vadTimer = timer
    }

    private func tickVAD() {
        guard running else { return }
        guard let lastSpeech = lastSpeechTime else {
            if Date().timeIntervalSince(startTime) > noSpeechTimeout {
                DispatchQueue.main.async { [weak self] in self?.onNoSpeechTimeout?() }
                lastSpeechTime = .distantPast // fire once
            }
            return
        }
        let silence = Date().timeIntervalSince(lastSpeech)

        if silence >= utteranceEndInterval {
            let wav = Self.wavFile(fromPCM16: pcmData, sampleRate: 16000)
            lastSpeechTime = nil
            startTime = Date() // reset the no-speech clock
            DispatchQueue.main.async { [weak self] in self?.onUtteranceEnd?(wav) }
        } else if silence >= pauseInterval && !pauseFired {
            pauseFired = true
            let wav = Self.wavFile(fromPCM16: pcmData, sampleRate: 16000)
            DispatchQueue.main.async { [weak self] in self?.onPause?(wav) }
        }
    }

    /// Minimal PCM16 mono WAV wrapper.
    static func wavFile(fromPCM16 pcm: Data, sampleRate: Int) -> Data {
        var data = Data()
        let byteRate = sampleRate * 2
        func append(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func append16(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }

        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + pcm.count))
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8))
        append(16)                    // fmt chunk size
        append16(1)                   // PCM
        append16(1)                   // mono
        append(UInt32(sampleRate))
        append(UInt32(byteRate))
        append16(2)                   // block align
        append16(16)                  // bits per sample
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(pcm.count))
        data.append(pcm)
        return data
    }
}
