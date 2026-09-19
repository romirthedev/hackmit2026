import SwiftUI

/// "Shiny text" treatment for live status lines: the content renders in a
/// dim base tone with a bright white sheen sweeping across it left to
/// right on a continuous loop (reactbits.dev "Shiny Text", rebuilt in
/// SwiftUI). The sheen is a moving linear gradient masked by the content
/// itself, so it only lights up the glyphs.
///
/// Driven by a main-runloop Timer for the same reason as
/// `ThinkingShimmerView`: `repeatForever` animations get cancelled by
/// parent spring transactions, and TimelineView ticks are throttled to
/// ~0.6s in the notch's non-activating NSPanel.
struct ShinySheen: ViewModifier {
    /// Sheen sweep is skipped entirely when inactive — static content.
    var isActive: Bool = true

    @State private var phase: Double = 0

    private let ticker = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    func body(content: Content) -> some View {
        content.overlay {
            if isActive {
                GeometryReader { geo in
                    let bandWidth = max(geo.size.width * 0.7, 40)
                    let travel = geo.size.width + bandWidth
                    LinearGradient(
                        colors: [.clear, NotchTheme.sheenHighlight, .clear],
                        // Slight diagonal, matching the ~120° gradient
                        // of the reference effect.
                        startPoint: UnitPoint(x: 0, y: 0.2),
                        endPoint: UnitPoint(x: 1, y: 0.8)
                    )
                    .frame(width: bandWidth)
                    .offset(x: -bandWidth + travel * phase)
                }
                .allowsHitTesting(false)
                .mask(content)
                .onReceive(ticker) { now in
                    phase = (now.timeIntervalSinceReferenceDate / NotchTheme.shinySheenDuration)
                        .truncatingRemainder(dividingBy: 1)
                }
            }
        }
    }
}

extension View {
    /// Apply the looping sheen to any view (masked by the view itself).
    /// Pair with a dim foreground color — the sweep reads as a highlight
    /// only when the base has headroom to brighten.
    func shinySheen(isActive: Bool = true) -> some View {
        modifier(ShinySheen(isActive: isActive))
    }
}

/// Convenience wrapper for the common case: a single line of live status
/// text in the dim base tone with the sheen running.
struct ShinyText: View {
    let text: String
    var font: Font = NotchTheme.confirmationText

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(NotchTheme.shinyBase)
            .shinySheen()
    }
}
