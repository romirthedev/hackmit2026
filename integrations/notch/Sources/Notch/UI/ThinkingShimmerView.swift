import SwiftUI

/// The "thinking" indicator: a 2pt full-width line along the top edge of
/// the panel with a blue→purple highlight sweeping across it. Evokes
/// Siri's shimmer without copying it.
///
/// The sweep is clock-derived and driven by a main-runloop Timer, not by
/// a `repeatForever` animation or `TimelineView`: the panel's parent
/// spring transactions (`.animation(value:)` on state/steps) cancel
/// implicit animations, and this non-activating NSPanel throttles
/// TimelineView ticks to ~0.6s — both left the sweep frozen or strobing.
struct ThinkingShimmerView: View {
    @State private var phase: Double = 0

    private let ticker = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geo in
            let bandWidth = geo.size.width * 0.6
            ZStack(alignment: .leading) {
                // Full-width track: the line itself always spans edge to
                // edge — the sweep below is only a highlight riding on it.
                LinearGradient(
                    colors: [
                        NotchTheme.accentThinkingA.opacity(0.35),
                        NotchTheme.accentThinkingB.opacity(0.35),
                        NotchTheme.accentThinkingA.opacity(0.35),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                LinearGradient(
                    colors: [
                        .clear,
                        NotchTheme.accentThinkingA,
                        NotchTheme.accentThinkingB,
                        NotchTheme.accentThinkingA,
                        .clear,
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: bandWidth)
                .offset(x: -bandWidth + (geo.size.width + bandWidth) * phase)
            }
        }
        .frame(height: 2)
        .onReceive(ticker) { now in
            phase = (now.timeIntervalSinceReferenceDate / NotchTheme.shimmerDuration)
                .truncatingRemainder(dividingBy: 1)
        }
    }
}
