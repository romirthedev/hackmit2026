import AVFoundation
import Foundation

/// Simple continuous mic capture for Meeting Mode — no VAD, no callbacks,
/// just accumulates 16kHz mono Int16 PCM. Thread-safe, not MainActor.
final class MeetingMicCapture: @unchecked Sendable {

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16000,
        channels: 1,
        interleaved: true
    )!

    private let queue = DispatchQueue(label: "notch.meeting-mic")
    private var pcmData = Data()
    private var running = false

    func start() throws {
        guard !running else { return }
        let input = engine.inputNode
        let inputFormat = input.inputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else {
            throw NSError(domain: "Notch", code: 11, userInfo: [
                NSLocalizedDescriptionKey: "No audio input device available for meeting mic capture."
            ])
        }
        converter = AVAudioConverter(from: inputFormat, to: targetFormat)
        queue.sync { pcmData = Data() }

        let bufferSize = AVAudioFrameCount(inputFormat.sampleRate / 10)
        input.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            self?.queue.async { self?.process(buffer: buffer) }
        }

        engine.prepare()
        try engine.start()
        running = true
    }

    func stop() {
        guard running else { return }
        running = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        converter = nil
    }

    /// Returns accumulated PCM as WAV and clears the buffer.
    func snapshotWAVAndReset() -> Data {
        queue.sync {
            let wav = AudioCaptureEngine.wavFile(fromPCM16: pcmData, sampleRate: 16000)
            pcmData = Data()
            return wav
        }
    }

    private func process(buffer: AVAudioPCMBuffer) {
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
}
