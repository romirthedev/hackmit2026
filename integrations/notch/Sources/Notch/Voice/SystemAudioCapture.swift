import AVFoundation
import Foundation
import ScreenCaptureKit

/// Captures system/output audio (what speakers play — Zoom, Meet, Teams)
/// via ScreenCaptureKit's SCStream. Requires Screen Recording permission.
/// Accumulates 16kHz mono Int16 PCM suitable for Whisper transcription.
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {

    private var stream: SCStream?
    private var running = false
    private let queue = DispatchQueue(label: "notch.system-audio")

    private var pcmData = Data()
    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16000,
        channels: 1,
        interleaved: true
    )!

    var isRunning: Bool { running }

    /// Starts capturing system audio from the primary display.
    func start() async throws {
        guard !running else { return }

        // Screen Recording permission is required for audio capture.
        guard CGPreflightScreenCaptureAccess() else {
            throw NSError(domain: "Notch", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Screen Recording permission is required for meeting mode. Grant it in System Settings → Privacy & Security → Screen Recording."
            ])
        }

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "Notch", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "No display found for system audio capture."
            ])
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000
        config.channelCount = 1
        // Minimal video — we only want audio.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 10, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()

        self.stream = stream
        queue.sync { pcmData = Data(); converter = nil }
        running = true
    }

    func stop() {
        guard running else { return }
        running = false
        stream?.stopCapture { _ in }
        stream = nil
    }

    /// Returns accumulated PCM as WAV and clears the buffer.
    func snapshotWAVAndReset() -> Data {
        queue.sync {
            let wav = AudioCaptureEngine.wavFile(fromPCM16: pcmData, sampleRate: 16000)
            pcmData = Data()
            return wav
        }
    }

    /// Returns accumulated PCM as WAV but RETAINS the last `overlapSeconds`
    /// of audio as the seed of the next chunk, so consecutive chunks overlap
    /// and a word straddling a boundary is never cut in half. Used by the
    /// live translator (text-level de-dup removes the repeated overlap).
    func snapshotWAVRetainingTail(overlapSeconds: Double) -> Data {
        queue.sync {
            let wav = AudioCaptureEngine.wavFile(fromPCM16: pcmData, sampleRate: 16000)
            let tailBytes = Int(overlapSeconds * 16000) * MemoryLayout<Int16>.size
            if pcmData.count > tailBytes {
                pcmData = Data(pcmData.suffix(tailBytes))
            }
            return wav
        }
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, running else { return }
        guard let formatDesc = sampleBuffer.formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }

        let sampleRate = asbd.pointee.mSampleRate
        let channels = asbd.pointee.mChannelsPerFrame
        guard sampleRate > 0, channels > 0 else { return }

        // Extract raw audio data from the sample buffer.
        guard let blockBuffer = sampleBuffer.dataBuffer else { return }
        let length = CMBlockBufferGetDataLength(blockBuffer)
        guard length > 0 else { return }

        var rawData = Data(count: length)
        _ = rawData.withUnsafeMutableBytes { ptr in
            CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
        }

        // SCStream delivers float32 interleaved audio.
        let frameCount = length / (Int(channels) * MemoryLayout<Float>.size)
        guard frameCount > 0 else { return }

        // Convert to mono float32 if multi-channel.
        var monoFloats = [Float](repeating: 0, count: frameCount)
        rawData.withUnsafeBytes { ptr in
            let floats = ptr.bindMemory(to: Float.self)
            if channels == 1 {
                for i in 0..<frameCount { monoFloats[i] = floats[i] }
            } else {
                let ch = Int(channels)
                for i in 0..<frameCount {
                    var sum: Float = 0
                    for c in 0..<ch { sum += floats[i * ch + c] }
                    monoFloats[i] = sum / Float(ch)
                }
            }
        }

        // Downsample to 16kHz: simple linear interpolation.
        let ratio = 16000.0 / sampleRate
        let outCount = Int(Double(frameCount) * ratio)
        guard outCount > 0 else { return }

        var int16Samples = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcIdx = Double(i) / ratio
            let idx0 = Int(srcIdx)
            let frac = Float(srcIdx - Double(idx0))
            let s0 = monoFloats[min(idx0, frameCount - 1)]
            let s1 = monoFloats[min(idx0 + 1, frameCount - 1)]
            let sample = s0 + frac * (s1 - s0)
            int16Samples[i] = Int16(clamping: Int(sample * 32767))
        }

        int16Samples.withUnsafeBufferPointer { buf in
            pcmData.append(buf)
        }
    }

    // MARK: - SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        NSLog("[Notch] System audio capture stopped: %@", error.localizedDescription)
        running = false
    }
}
