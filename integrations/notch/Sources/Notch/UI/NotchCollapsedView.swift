import SwiftUI

/// The idle notch: a pure-black shape matching the physical notch exactly,
/// invisible against the bezel. Its only job is to catch the click.
struct NotchCollapsedView: View {
    @EnvironmentObject var viewModel: NotchViewModel
    let notchSize: CGSize

    @State private var hovering = false

    var body: some View {
        UnevenRoundedRectangle(
            cornerRadii: .init(bottomLeading: 8, bottomTrailing: 8),
            style: .continuous
        )
        .fill(NotchTheme.notchBlack)
        .frame(width: notchSize.width, height: notchSize.height)
        // A whisper of feedback on hover so the click target is discoverable
        // without ever reading as "an app is here".
        .scaleEffect(hovering ? 1.03 : 1.0, anchor: .top)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: hovering)
        .onHover { hovering = $0 }
        .contentShape(Rectangle())
        .onTapGesture { viewModel.activate() }
    }
}
