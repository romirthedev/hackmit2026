import SwiftUI
import AppKit

/// Animated starburst icon for thinking/executing states.
/// 12 teardrop spikes build clockwise then erase clockwise (T = 6s).
///
/// Pass `isStatic: true` for a non-animating logo (all spikes fully visible).
/// Use `size` to scale the whole starburst proportionally (default 16pt).
struct StarburstWorkingView: View {
    private let spikeCount = 12
    private let cycleDuration: Double = 6.0
    private let spikeDelay: Double = 0.2
    private let riseDuration: Double = 0.5

    var isStatic: Bool = false
    var size: CGFloat = 16

    private var scale: CGFloat { size / 16.0 }

    var body: some View {
        ZStack {
            // Spikes
            ForEach(0..<spikeCount, id: \.self) { i in
                if isStatic {
                    TeardropShape()
                        .fill(NotchTheme.accentPrimary)
                        .frame(width: 2.4 * scale, height: 5.5 * scale)
                        .offset(y: -5 * scale)
                        .rotationEffect(.degrees(Double(i) * 30))
                } else {
                    SpikeView(
                        index: i,
                        cycleDuration: cycleDuration,
                        spikeDelay: spikeDelay,
                        riseDuration: riseDuration,
                        scale: scale
                    )
                    .rotationEffect(.degrees(Double(i) * 30))
                }
            }

            // Center orb
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(0.9),
                            NotchTheme.accentPrimary
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 3 * scale
                    )
                )
                .frame(width: 5 * scale, height: 5 * scale)
        }
        .frame(width: size, height: size)
    }

    /// Render the starburst as a template NSImage for use in AppKit (e.g. menu bar).
    static func templateImage(size: CGFloat) -> NSImage {
        let spikeCount = 12
        let scale = size / 16.0
        let spikeWidth = 2.4 * scale
        let spikeHeight = 5.5 * scale
        let spikeOffset = 5.0 * scale
        let orbRadius = 2.5 * scale

        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            let center = CGPoint(x: size / 2, y: size / 2)

            // Draw spikes
            for i in 0..<spikeCount {
                let angle = Double(i) * 30.0 * .pi / 180.0
                ctx.saveGState()
                ctx.translateBy(x: center.x, y: center.y)
                ctx.rotate(by: CGFloat(angle))
                // Spike extends upward from center; offset pushes it outward
                let spikeRect = CGRect(
                    x: -spikeWidth / 2,
                    y: spikeOffset - spikeHeight / 2,
                    width: spikeWidth,
                    height: spikeHeight
                )
                let path = StarburstPathHelper.teardropCGPath(in: spikeRect)
                ctx.addPath(path)
                ctx.fillPath()
                ctx.restoreGState()
            }

            // Draw center orb
            let orbRect = CGRect(
                x: center.x - orbRadius,
                y: center.y - orbRadius,
                width: orbRadius * 2,
                height: orbRadius * 2
            )
            ctx.fillEllipse(in: orbRect)

            return true
        }
        image.isTemplate = true
        return image
    }
}

/// A single teardrop spike that animates scaleY only.
/// The rotation is static on the parent — this view just grows/shrinks vertically.
private struct SpikeView: View {
    let index: Int
    let cycleDuration: Double
    let spikeDelay: Double
    let riseDuration: Double
    var scale: CGFloat = 1.0

    @State private var scaleY: CGFloat = 0

    var body: some View {
        TeardropShape()
            .fill(NotchTheme.accentPrimary)
            .frame(width: 2.4 * scale, height: 5.5 * scale)
            // anchor at bottom = inner end touching orb center
            .scaleEffect(y: scaleY, anchor: .bottom)
            .offset(y: -5 * scale)  // push outward from center (spike radiates outward)
            .onAppear { startAnimation() }
    }

    private func startAnimation() {
        let delay = Double(index) * spikeDelay
        // Keyframe-style animation using a timer-driven approach
        animateCycle(delay: delay)
    }

    private func animateCycle(delay: Double) {
        let halfCycle = cycleDuration / 2.0

        // Phase 1: rise after initial delay
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            withAnimation(.easeInOut(duration: riseDuration)) {
                scaleY = 1.0
            }
        }

        // Phase 2: erase at 50% + own delay
        DispatchQueue.main.asyncAfter(deadline: .now() + halfCycle + delay) {
            withAnimation(.easeInOut(duration: riseDuration)) {
                scaleY = 0.0
            }
        }

        // Repeat: schedule next cycle
        DispatchQueue.main.asyncAfter(deadline: .now() + cycleDuration) {
            animateCycle(delay: delay)
        }
    }
}

/// Teardrop / pointed oval spike shape, pointed at top, rounded at bottom.
struct TeardropShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width
        let h = rect.height
        let midX = w / 2

        // Pointed top, curves out to widest near bottom, rounded bottom
        path.move(to: CGPoint(x: midX, y: 0))
        path.addCurve(
            to: CGPoint(x: midX, y: h),
            control1: CGPoint(x: midX + w * 0.45, y: h * 0.35),
            control2: CGPoint(x: midX + w * 0.2, y: h * 0.75)
        )
        path.addCurve(
            to: CGPoint(x: midX, y: 0),
            control1: CGPoint(x: midX - w * 0.2, y: h * 0.75),
            control2: CGPoint(x: midX - w * 0.45, y: h * 0.35)
        )
        path.closeSubpath()
        return path
    }
}

/// Shared spike geometry for AppKit (NSImage) rendering.
enum StarburstPathHelper {
    static func teardropCGPath(in rect: CGRect) -> CGPath {
        let w = rect.width
        let h = rect.height
        let midX = rect.midX
        let minY = rect.minY
        let maxY = rect.maxY

        let path = CGMutablePath()
        // Pointed top (away from center), curves out, rounded bottom (near center)
        path.move(to: CGPoint(x: midX, y: maxY))
        path.addCurve(
            to: CGPoint(x: midX, y: minY),
            control1: CGPoint(x: midX + w * 0.45, y: maxY - h * 0.35),
            control2: CGPoint(x: midX + w * 0.2, y: minY + h * 0.25)
        )
        path.addCurve(
            to: CGPoint(x: midX, y: maxY),
            control1: CGPoint(x: midX - w * 0.2, y: minY + h * 0.25),
            control2: CGPoint(x: midX - w * 0.45, y: maxY - h * 0.35)
        )
        path.closeSubpath()
        return path
    }
}
