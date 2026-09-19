import SwiftUI

/// All design tokens for Notch. Never hardcode colors/fonts elsewhere.
enum NotchTheme {

    // MARK: - Colors

    /// Base fill — pure black, must match the physical bezel exactly.
    static let notchBlack = Color(hex: 0x000000)

    /// Expanded panel background tint, layered over `.ultraThinMaterial`.
    static let surfaceElevated = Color(hex: 0x141414).opacity(0.8)

    /// Active listening state, primary actions.
    static let accentPrimary = Color(hex: 0x5E9EFF)

    /// Endpoints of the animated "thinking" gradient sweep.
    static let accentThinkingA = Color(hex: 0x5E9EFF)
    static let accentThinkingB = Color(hex: 0xB15EFF)

    /// Action completed confirmation flash.
    static let accentSuccess = Color(hex: 0x4ADE80)

    /// Failed action / clarification needed.
    static let accentError = Color(hex: 0xFF6B6B)

    /// Primary transcript / response text.
    static let textPrimary = Color.white.opacity(0.95)

    /// Placeholder, meta text, timestamps.
    static let textSecondary = Color.white.opacity(0.5)

    /// Subtle dividers inside the expanded panel. Use extremely sparingly.
    static let hairline = Color.white.opacity(0.08)

    /// Base tone for "shiny" live-status text — dim enough that the sheen
    /// sweep reads as a highlight.
    static let shinyBase = Color.white.opacity(0.55)

    /// Peak of the shiny-text sheen sweep.
    static let sheenHighlight = Color.white.opacity(0.9)

    // MARK: - Typography

    /// Collapsed notch label (rare, brief status word).
    static let collapsedLabel = Font.system(size: 11, weight: .medium, design: .rounded)

    /// Expanded panel prompt/input text.
    static let inputText = Font.system(size: 15, weight: .regular, design: .default)

    /// Expanded panel response text.
    static let responseText = Font.system(size: 14, weight: .regular, design: .default)

    /// Action confirmation text.
    static let confirmationText = Font.system(size: 13, weight: .semibold, design: .rounded)

    /// UI chrome, buttons, state labels.
    static let chrome = Font.system(size: 12, weight: .medium, design: .rounded)

    /// Verbatim commands being executed (the one intentionally "technical" surface).
    static let command = Font.system(size: 12, weight: .regular, design: .monospaced)

    // MARK: - Geometry

    /// Expanded panel bottom corner radius (continuous/squircle).
    static let panelCornerRadius: CGFloat = 24

    /// Expanded panel max width.
    static let panelMaxWidth: CGFloat = 420

    /// Expanded panel max height before internal scroll.
    static let panelMaxHeight: CGFloat = 340

    // MARK: - Motion

    /// Expand: slightly bouncy, not linear, not overshooting cartoonishly.
    static let expandSpring = Animation.spring(response: 0.45, dampingFraction: 0.72, blendDuration: 0)

    /// Collapse: snappier on the way back in.
    static let collapseSpring = Animation.spring(response: 0.32, dampingFraction: 0.85, blendDuration: 0)

    /// Thinking shimmer loop duration.
    static let shimmerDuration: Double = 1.2

    /// Shiny-text sheen loop duration.
    static let shinySheenDuration: Double = 2.5
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
