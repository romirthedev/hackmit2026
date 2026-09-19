import SwiftUI

/// Top-level view hosted in the panel. Renders the collapsed notch pill or
/// the expanded command surface, both pinned to the top-center anchor.
struct NotchRootView: View {
    @EnvironmentObject var viewModel: NotchViewModel
    let notchSize: CGSize

    var body: some View {
        ZStack(alignment: .top) {
            Color.clear
            if viewModel.state.isExpanded {
                NotchExpandedView(notchSize: notchSize)
                    .transition(
                        .scale(scale: 0.2, anchor: .top)
                            .combined(with: .opacity)
                    )
            } else if viewModel.translatorModeActive {
                // Agent idle but translation running: the caption panel keeps
                // the stage until translation stops.
                TranslatorCaptionView(manager: viewModel.translatorManager, notchSize: notchSize)
                    .transition(
                        .scale(scale: 0.2, anchor: .top)
                            .combined(with: .opacity)
                    )
            } else {
                NotchCollapsedView(notchSize: notchSize)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(
            viewModel.panelExpanded ? NotchTheme.expandSpring : NotchTheme.collapseSpring,
            value: viewModel.panelExpanded
        )
    }
}
