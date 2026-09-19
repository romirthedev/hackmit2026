import SwiftUI

/// One live narration line in the `executing` state. Verbatim commands get
/// SF Mono — the one intentionally "technical" surface, signalling the
/// machine is doing a real thing.
struct ActionStepRow: View {
    let step: AgentStep
    /// The most recent step gets the accent treatment; done steps recede.
    let isCurrent: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: iconName)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(isCurrent ? NotchTheme.accentPrimary : NotchTheme.textSecondary)
                .frame(width: 12)
            Text(step.text)
                .font(step.isCommand ? NotchTheme.command : NotchTheme.confirmationText)
                .foregroundStyle(isCurrent ? NotchTheme.shinyBase : NotchTheme.textSecondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .shinySheen(isActive: isCurrent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var iconName: String {
        if step.isVerification {
            // The agent inspecting its own work — the loop's signature beat.
            return isCurrent ? "eye" : "checkmark.seal"
        }
        return isCurrent ? "arrow.up.right" : "checkmark"
    }
}
