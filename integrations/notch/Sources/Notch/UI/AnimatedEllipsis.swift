import SwiftUI

/// Trailing dots that cycle ".", "..", "..." to signal ongoing activity.
/// Inherits font and foreground style from its environment.
struct AnimatedEllipsis: View {
    var interval: TimeInterval = 0.4

    var body: some View {
        TimelineView(.periodic(from: .now, by: interval)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / interval) % 3 + 1
            // Hidden full-width ellipsis keeps layout stable as dots cycle.
            Text("...")
                .hidden()
                .overlay(alignment: .leading) {
                    Text(String(repeating: ".", count: step))
                }
        }
    }
}
