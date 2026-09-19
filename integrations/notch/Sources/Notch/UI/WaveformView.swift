import SwiftUI

/// Live microphone waveform: five vertical bars driven by real mic
/// amplitude, each with its own phase so the motion reads organic.
struct WaveformView: View {
    /// 0...1 smoothed amplitude from the audio engine.
    var amplitude: CGFloat
    var color: Color = NotchTheme.accentPrimary

    private let barCount = 5
    private let barWidth: CGFloat = 3
    private let maxHeight: CGFloat = 18
    private let minHeight: CGFloat = 3

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0..<barCount, id: \.self) { i in
                    let phase = Double(i) * 0.9
                    let wobble = 0.55 + 0.45 * sin(t * 9 + phase)
                    let height = minHeight + (maxHeight - minHeight) * amplitude * CGFloat(wobble)
                    Capsule(style: .continuous)
                        .fill(color)
                        .frame(width: barWidth, height: max(minHeight, height))
                }
            }
            .frame(height: maxHeight)
        }
    }
}
