import SwiftUI

/// The expanded command surface: drops downward from the notch, top edge
/// flush with the screen, bottom corners in a continuous 24pt squircle.
struct NotchExpandedView: View {
    @EnvironmentObject var viewModel: NotchViewModel
    let notchSize: CGSize

    @FocusState private var inputFocused: Bool
    @State private var successFlash = false

    var body: some View {
        VStack(spacing: 0) {
            // Clearance for the physical notch itself.
            Spacer().frame(height: notchSize.height + 4)

            header
                .padding(.horizontal, 20)
                .padding(.bottom, 10)

            content
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

            if !viewModel.taskManager.tasks.filter({ $0.status == .running || $0.status == .blocked }).isEmpty {
                taskListSection
                    .padding(.horizontal, 20)
                    .padding(.bottom, 4)
            }

            HStack {
                meetingModeControls
                Spacer()
                footerHints
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
        }
        .frame(width: NotchTheme.panelMaxWidth)
        .frame(maxHeight: NotchTheme.panelMaxHeight, alignment: .top)
        .fixedSize(horizontal: false, vertical: true)
        .background(panelBackground)
        .overlay(alignment: .top) {
            if viewModel.state == .thinking || viewModel.state == .executing {
                ThinkingShimmerView()
                    .padding(.top, notchSize.height)
            }
        }
        .overlay(alignment: .topLeading) {
            sessionIndicators
        }
        .overlay(successFlashOverlay)
        .clipShape(panelShape)
        .shadow(color: .black.opacity(0.45), radius: 24, y: 10)
        .onChange(of: viewModel.actionSucceeded) { _, succeeded in
            guard succeeded else { return }
            successFlash = true
            withAnimation(.easeOut(duration: 0.4).delay(0.1)) { successFlash = false }
        }
        .onChange(of: viewModel.showTextInput) { _, shown in
            if shown { inputFocused = true }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: viewModel.state)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: viewModel.steps)
    }

    // MARK: - Chrome

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
            // Pure black at the top so the panel melts into the bezel.
            LinearGradient(
                colors: [NotchTheme.notchBlack, NotchTheme.notchBlack.opacity(0)],
                startPoint: .top,
                endPoint: .center
            )
        }
    }

    @ViewBuilder
    private var successFlashOverlay: some View {
        if successFlash {
            panelShape.fill(NotchTheme.accentSuccess.opacity(0.2))
                .allowsHitTesting(false)
        }
    }

    // MARK: - Parallel session indicators

    /// Small numbered chips hugging the RIGHT edge of the physical notch —
    /// one per running session, like tabs. The staged session (whose
    /// progress the panel is showing) is filled; tapping another number
    /// brings that session's progress onto the panel. Numbers vanish as
    /// sessions finish (survivors keep their numbers — no renumbering).
    @ViewBuilder
    private var sessionIndicators: some View {
        if !viewModel.sessions.isEmpty {
            HStack(spacing: 5) {
                ForEach(viewModel.sessions) { session in
                    sessionChip(session)
                }
            }
            .frame(height: notchSize.height)
            .padding(.leading, NotchTheme.panelMaxWidth / 2 + notchSize.width / 2 + 10)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: viewModel.sessions.map(\.id))
        }
    }

    private func sessionChip(_ session: AgentSession) -> some View {
        let staged = session.id == viewModel.stagedSessionID
        return Text("\(session.number)")
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(staged ? Color.black : NotchTheme.textPrimary)
            .frame(width: 16, height: 16)
            .background(
                Circle().fill(staged ? NotchTheme.accentPrimary : Color.white.opacity(0.16))
            )
            .overlay(
                Circle().strokeBorder(Color.white.opacity(staged ? 0 : 0.3), lineWidth: 1)
            )
            // Done but waiting its turn to speak: dimmed until the answer
            // takes the stage, then number and answer disappear together.
            .opacity(session.isFinished ? 0.4 : 1)
            .contentShape(Circle())
            .onTapGesture { viewModel.stage(sessionID: session.id) }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            stateIcon
            stateLabel
            Spacer()
            if viewModel.state == .listening && !viewModel.showTextInput {
                WaveformView(amplitude: viewModel.amplitude)
            }
        }
        .frame(height: 20)
    }

    @ViewBuilder
    private var stateIcon: some View {
        switch viewModel.state {
        case .listening:
            Image(systemName: viewModel.showTextInput ? "keyboard" : "mic.fill")
                .font(.system(size: 13))
                .foregroundStyle(NotchTheme.accentPrimary)
        case .thinking:
            StarburstWorkingView()
        case .executing:
            StarburstWorkingView()
        case .responding:
            if viewModel.actionSucceeded {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(NotchTheme.accentSuccess)
                    .symbolEffect(.bounce, value: viewModel.actionSucceeded)
            } else {
                StarburstWorkingView()
            }
        case .error:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(NotchTheme.accentError)
        case .idle:
            EmptyView()
        }
    }

    private var stateLabel: some View {
        let live = viewModel.state == .thinking || viewModel.state == .executing
        return HStack(spacing: 0) {
            Text(labelText)
                .contentTransition(.opacity)
            if live {
                AnimatedEllipsis()
            }
        }
        .font(NotchTheme.chrome)
        .foregroundStyle(live ? NotchTheme.shinyBase : NotchTheme.textSecondary)
        .shinySheen(isActive: live)
    }

    private var labelText: String {
        switch viewModel.state {
        case .idle: return ""
        case .listening: return viewModel.showTextInput ? "Type your request" : "Listening"
        case .thinking: return viewModel.stillWorking ? "Still working" : "Thinking"
        case .executing: return viewModel.stillWorking ? "Still working" : "Doing it"
        case .responding: return viewModel.actionSucceeded ? "Done" : "Notch"
        case .error: return "Hmm"
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let ask = viewModel.pendingPermission {
                permissionCard(ask)
            }
            stateContent
        }
    }

    @ViewBuilder
    private var stateContent: some View {
        switch viewModel.state {
        case .listening:
            listeningContent
        case .thinking:
            transcriptLocked
        case .executing:
            VStack(alignment: .leading, spacing: 8) {
                transcriptLocked
                Rectangle().fill(NotchTheme.hairline).frame(height: 1)
                stepsList
            }
        case .responding:
            VStack(alignment: .leading, spacing: 8) {
                if !viewModel.steps.isEmpty {
                    stepsList
                    Rectangle().fill(NotchTheme.hairline).frame(height: 1)
                }
                responseView
                if let file = viewModel.outputFile {
                    outputFileChip(file)
                }
                if let skill = viewModel.learnedSkillName {
                    learnedSkillBadge(skill)
                }
            }
        case .error:
            errorContent
        case .idle:
            EmptyView()
        }
    }

    /// Allow Once / Always Allow / Deny card for a pending agent action.
    private func permissionCard(_ ask: NotchViewModel.PermissionAsk) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NotchTheme.accentPrimary)
                Text("Wants to use \(ask.tool)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(NotchTheme.textPrimary)
                Spacer()
            }
            Text(ask.detail)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(NotchTheme.textSecondary)
                .lineLimit(3)
                .truncationMode(.middle)
            HStack(spacing: 8) {
                permissionButton("Deny", role: .deny) {
                    viewModel.resolvePermission(allow: false, forever: false)
                }
                Spacer()
                permissionButton("Allow Once", role: .neutral) {
                    viewModel.resolvePermission(allow: true, forever: false)
                }
                permissionButton("Always Allow", role: .primary) {
                    viewModel.resolvePermission(allow: true, forever: true)
                }
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(NotchTheme.accentPrimary.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(NotchTheme.accentPrimary.opacity(0.35), lineWidth: 1)
                )
        )
    }

    private enum PermissionButtonRole { case deny, neutral, primary }

    private func permissionButton(
        _ title: String, role: PermissionButtonRole, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule().fill(
                        role == .primary
                            ? NotchTheme.accentPrimary.opacity(0.9)
                            : Color.white.opacity(role == .deny ? 0.06 : 0.12)
                    )
                )
                .foregroundStyle(
                    role == .primary ? Color.black : NotchTheme.textPrimary
                )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var listeningContent: some View {
        if viewModel.showTextInput {
            TextField("Ask anything…", text: $viewModel.typedText)
                .textFieldStyle(.plain)
                .font(NotchTheme.inputText)
                .foregroundStyle(NotchTheme.textPrimary)
                .focused($inputFocused)
                .onSubmit { viewModel.submitTypedText() }
        } else {
            Text(viewModel.transcript.isEmpty ? "Say something…" : viewModel.transcript)
                .font(NotchTheme.inputText)
                .foregroundStyle(viewModel.transcript.isEmpty ? NotchTheme.textSecondary : NotchTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentTransition(.opacity)
        }
    }

    private var transcriptLocked: some View {
        Text(viewModel.transcript)
            .font(NotchTheme.inputText)
            .foregroundStyle(NotchTheme.textSecondary)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var stepsList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(viewModel.steps.enumerated()), id: \.element.id) { index, step in
                    ActionStepRow(
                        step: step,
                        isCurrent: index == viewModel.steps.count - 1 && viewModel.state == .executing
                    )
                }
            }
        }
        .frame(maxHeight: 120)
    }

    private var responseView: some View {
        ScrollView {
            Text(viewModel.responseText)
                .font(viewModel.actionSucceeded ? NotchTheme.confirmationText : NotchTheme.responseText)
                .foregroundStyle(viewModel.actionSucceeded ? NotchTheme.accentSuccess : NotchTheme.textPrimary)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 180)
    }

    private var errorContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(viewModel.errorMessage)
                .font(NotchTheme.responseText)
                .foregroundStyle(NotchTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                viewModel.activate()
            } label: {
                Text("Try again")
                    .font(NotchTheme.confirmationText)
                    .foregroundStyle(NotchTheme.accentError)
            }
            .buttonStyle(.plain)
        }
    }

    private func outputFileChip(_ path: String) -> some View {
        Button {
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "doc.text")
                    .font(.system(size: 11))
                Text((path as NSString).lastPathComponent)
                    .font(NotchTheme.confirmationText)
                    .lineLimit(1)
            }
            .foregroundStyle(NotchTheme.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous).fill(Color.white.opacity(0.08))
            )
        }
        .buttonStyle(.plain)
        .transition(.scale(scale: 0.8).combined(with: .opacity))
    }

    private func learnedSkillBadge(_ name: String) -> some View {
        HStack(spacing: 6) {
            StarburstWorkingView(isStatic: true, size: 11)
            Text("Learned: \(name)")
                .font(NotchTheme.confirmationText)
        }
        .foregroundStyle(NotchTheme.accentPrimary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule(style: .continuous).fill(NotchTheme.accentPrimary.opacity(0.12))
        )
        .transition(.scale(scale: 0.8).combined(with: .opacity))
    }

    // Meeting Mode is voice-controlled ("activate meeting mode" /
    // "deactivate meeting mode") — no button. This is just a passive
    // recording indicator that appears only while a meeting is being
    // captured, so the "you're being recorded" cue is never lost.
    @ViewBuilder
    private var meetingModeControls: some View {
        if viewModel.meetingModeActive {
            HStack(spacing: 5) {
                Circle()
                    .fill(Color.red)
                    .frame(width: 7, height: 7)
                    .overlay {
                        Circle()
                            .fill(Color.red.opacity(0.4))
                            .frame(width: 12, height: 12)
                            .blinking()
                    }
                Text("Recording")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                Text(formatElapsed(viewModel.meetingManager.elapsedSeconds))
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(NotchTheme.textSecondary)
            }
            .foregroundStyle(Color.red)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(Color.red.opacity(0.12))
            )
            .transition(.opacity.combined(with: .scale(scale: 0.9)))
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

    private var taskListSection: some View {
        let active = viewModel.taskManager.tasks.filter { $0.status == .running || $0.status == .blocked }
        return VStack(alignment: .leading, spacing: 4) {
            Rectangle().fill(NotchTheme.hairline).frame(height: 1)
            ForEach(active) { task in
                HStack(spacing: 6) {
                    Circle()
                        .fill(task.status == .blocked ? NotchTheme.accentError : NotchTheme.accentPrimary)
                        .frame(width: 6, height: 6)
                    Text(task.name)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(NotchTheme.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    Text(task.progressSummary)
                        .font(.system(size: 10, weight: .regular, design: .rounded))
                        .foregroundStyle(NotchTheme.textSecondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var footerHints: some View {
        var hints = [String]()
        if viewModel.state == .listening, let app = viewModel.contextAppName {
            hints.append("seeing \(app)")
        }
        if viewModel.workersRunning > 0 {
            hints.append("\(viewModel.workersRunning) agent\(viewModel.workersRunning == 1 ? "" : "s") working")
        }
        if viewModel.state == .thinking || viewModel.state == .executing {
            hints.append("fn to ask something else")
        }
        hints.append("esc to dismiss")
        if viewModel.state == .listening { hints.append("tab to type") }
        return Text(hints.joined(separator: " · "))
            .font(.system(size: 10, weight: .medium, design: .rounded))
            .foregroundStyle(NotchTheme.textSecondary.opacity(0.6))
    }
}

// MARK: - Blinking modifier for recording indicator

private struct BlinkingModifier: ViewModifier {
    @State private var opacity: Double = 1
    func body(content: Content) -> some View {
        content
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    opacity = 0.2
                }
            }
    }
}

extension View {
    func blinking() -> some View {
        modifier(BlinkingModifier())
    }
}
