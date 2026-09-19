import SwiftUI

/// The live-translation caption surface. Shown while the translator is running
/// and the agent panel isn't occupying the stage. Drops from the notch like
/// the command panel, streams English segments, and auto-scrolls to the
/// newest line. Passive/never-speaking — it's read while the video plays.
struct TranslatorCaptionView: View {
    @EnvironmentObject var viewModel: NotchViewModel
    @ObservedObject var manager: TranslatorModeManager
    let notchSize: CGSize

    var body: some View {
        VStack(spacing: 0) {
            // Clearance for the physical notch itself.
            Spacer().frame(height: notchSize.height + 4)

            header
                .padding(.horizontal, 20)
                .padding(.bottom, 10)

            captionScroll
                .padding(.horizontal, 20)
                .padding(.bottom, 14)
        }
        .frame(width: NotchTheme.panelMaxWidth)
        .frame(maxHeight: NotchTheme.panelMaxHeight, alignment: .top)
        .fixedSize(horizontal: false, vertical: true)
        .background(panelBackground)
        .clipShape(panelShape)
        .shadow(color: .black.opacity(0.45), radius: 24, y: 10)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "globe")
                .font(.system(size: 13))
                .foregroundStyle(NotchTheme.accentPrimary)
            Text("Live Translation")
                .font(NotchTheme.chrome)
                .foregroundStyle(NotchTheme.textPrimary)
            Text("→ English")
                .font(NotchTheme.chrome)
                .foregroundStyle(NotchTheme.textSecondary)
            Spacer()
            Text(formatElapsed(manager.elapsedSeconds))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(NotchTheme.textSecondary)
            stopButton
        }
        .frame(height: 20)
    }

    private var stopButton: some View {
        Button {
            viewModel.stopTranslatorMode()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "stop.fill").font(.system(size: 8))
                Text("Stop").font(.system(size: 10, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(NotchTheme.accentError)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule(style: .continuous).fill(NotchTheme.accentError.opacity(0.14)))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Captions

    @ViewBuilder
    private var captionScroll: some View {
        if manager.captions.isEmpty {
            HStack(spacing: 8) {
                if manager.awaitingFirst {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.7)
                }
                Text("Listening for audio…")
                    .font(NotchTheme.responseText)
                    .foregroundStyle(NotchTheme.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(manager.captions) { caption in
                            Text(caption.text)
                                .font(NotchTheme.responseText)
                                .foregroundStyle(NotchTheme.textPrimary)
                                .lineSpacing(3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(caption.id)
                        }
                        // Anchor the auto-scroll to the very bottom.
                        Color.clear.frame(height: 1).id(Self.bottomID)
                    }
                }
                .frame(maxHeight: 220)
                .onChange(of: manager.captions.count) { _, _ in
                    withAnimation(.easeOut(duration: 0.25)) {
                        proxy.scrollTo(Self.bottomID, anchor: .bottom)
                    }
                }
            }
        }
    }

    private static let bottomID = "translator-bottom"

    // MARK: - Chrome (mirrors NotchExpandedView)

    private var panelShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            cornerRadii: .init(
                bottomLeading: NotchTheme.panelCornerRadius,
                bottomTrailing: NotchTheme.panelCornerRadius
            ),
            style: .continuous
        )
    }

    private var panelBackground: some View {
        ZStack {
            panelShape.fill(.ultraThinMaterial)
            panelShape.fill(NotchTheme.surfaceElevated)
            LinearGradient(
                colors: [NotchTheme.notchBlack, NotchTheme.notchBlack.opacity(0)],
                startPoint: .top,
                endPoint: .center
            )
        }
    }

    private func formatElapsed(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%02d:%02d", m, s)
    }
}
