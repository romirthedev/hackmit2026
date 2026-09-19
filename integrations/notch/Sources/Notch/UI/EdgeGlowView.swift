import SwiftUI

/// Observable state bridging AppKit → SwiftUI for edge-glow activation.
@MainActor
final class EdgeGlowModel: ObservableObject {
    @Published var isActive = false
    @Published var topCornerRadius: CGFloat = 10
    @Published var bottomCornerRadius: CGFloat = 10
}

/// Apple-Intelligence / Siri-style animated edge glow — a thin, crisp,
/// continuous stroke hugging the screen edge with vivid animated colors,
/// plus a subtle tight bloom behind it.
///
/// Animation: evenly-spaced gradient stops with hue rotation (no randomised
/// locations).  `.drawingGroup()` composites into a single Metal pass.
/// The `.blur()` modifier only softens stroke pixels — the transparent
/// background stays transparent (no CIGaussianBlur on the window).
struct EdgeGlowContentView: View {

    @ObservedObject var model: EdgeGlowModel

    // MARK: - Vivid Apple Intelligence palette (fully saturated, bright)

    private static let colors: [Color] = [
        Color(red: 0.40, green: 0.60, blue: 1.00),  // vivid blue
        Color(red: 0.65, green: 0.35, blue: 1.00),  // vivid purple
        Color(red: 1.00, green: 0.25, blue: 0.80),  // vivid pink
        Color(red: 1.00, green: 0.50, blue: 0.30),  // vivid orange
        Color(red: 1.00, green: 0.75, blue: 0.20),  // bright amber
        Color(red: 0.40, green: 0.60, blue: 1.00),  // wrap back to blue
    ]

    /// Fixed, evenly-spaced stops — the gradient itself rotates via
    /// `.rotationEffect` driven by Core Animation for perfectly smooth flow.
    private static let stops: [Gradient.Stop] = {
        let count = colors.count
        return (0..<count).map { i in
            Gradient.Stop(color: colors[i],
                          location: Double(i) / Double(count - 1))
        }
    }()

    /// Padding added around the screen-sized window so bloom + blur
    /// at the top corners is never clipped by the drawable region boundary.
    static let glowPadding: CGFloat = 20

    private static let bloomLineWidth: CGFloat = 12
    private static let coreLineWidth: CGFloat = 5.5
    private static let sideExtraWidth: CGFloat = 6

    // MARK: - Body

    var body: some View {
        // TimelineView drives a smooth, GPU-friendly phase that shifts the
        // AngularGradient's start angle every frame.  Core Animation
        // interpolates the resulting layer at display refresh rate.
        TimelineView(.animation(minimumInterval: nil, paused: !model.isActive)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            // One full revolution every 6 seconds.
            let phase = Angle.degrees(elapsed.truncatingRemainder(dividingBy: 6.0) / 6.0 * 360.0)

            GeometryReader { geo in
                let gradient = AngularGradient(
                    stops: Self.stops,
                    center: .center,
                    startAngle: phase,
                    endAngle: phase + .degrees(360)
                )
                let sideGradient = LinearGradient(
                    colors: Self.colors, startPoint: .top, endPoint: .bottom
                )

                // The shape is drawn inside a padded region; the window itself
                // extends `glowPadding` beyond the screen on every side so the
                // blur/bloom at the top corners is never clipped by the drawable
                // region boundary.
                // Top corners use radius 0 (sharp) so the stroke
                // extends fully into the extreme corner tips.  The
                // physical display's own rounded-corner clipping gives
                // the visible glow a natural curve — no software radius
                // needed, and no black gap at the tips.
                let shape = UnevenRoundedRectangle(
                    topLeadingRadius: 0,
                    bottomLeadingRadius: model.bottomCornerRadius,
                    bottomTrailingRadius: model.bottomCornerRadius,
                    topTrailingRadius: 0,
                    style: .circular
                )

                ZStack {
                    // Layer 1: Bloom — wide, blurred, high-opacity for vibrancy.
                    shape
                        .stroke(gradient, lineWidth: Self.bloomLineWidth)
                        .blur(radius: 16)
                        .opacity(0.85)
                        .compositingGroup()

                    // Layer 2: Crisp core stroke — full opacity, no blur.
                    shape
                        .stroke(gradient, lineWidth: Self.coreLineWidth)
                        .opacity(1.0)

                    // Layer 3: Side emphasis — extra glow on left & right edges.
                    sideGradient
                        .frame(width: Self.sideExtraWidth)
                        .blur(radius: 8)
                        .opacity(0.70)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    sideGradient
                        .frame(width: Self.sideExtraWidth)
                        .blur(radius: 8)
                        .opacity(0.70)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .padding(Self.glowPadding)
                .drawingGroup()
            }
        }
        .ignoresSafeArea()
        .opacity(model.isActive ? 1 : 0)
        .animation(.easeInOut(duration: model.isActive ? 0.45 : 0.55),
                   value: model.isActive)
        .allowsHitTesting(false)
    }
}
