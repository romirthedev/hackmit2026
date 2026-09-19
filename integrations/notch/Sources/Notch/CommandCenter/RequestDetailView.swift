import SwiftUI

/// Full activity timeline for one history entry: every step the agent took,
/// files it wrote, workers it started, and everything it added to the
/// memory vault. Backed by the per-request JSON logs in ~/.notch/requests/;
/// entries older than that feature fall back to a journal-only summary.
struct RequestDetailView: View {
    let entry: CCJournalEntry
    let onBack: () -> Void

    @State private var log: RequestLog?
    @State private var searchedForLog = false

    private var kindColor: Color {
        switch log?.kind ?? entry.kind {
        case "ACTION": return Color(hex: 0x4ADE80)
        case "ASK", "ANSWER", "CLARIFY": return CCTheme.accent
        case "NUDGE": return Color(hex: 0xFFB65E)
        case "WORKER": return Color(hex: 0xB15EFF)
        case "FAILED", "CANCELLED": return Color(hex: 0xFF6B6B)
        default: return CCTheme.textTertiary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    responseCard
                    if let log {
                        if !log.steps.isEmpty { timelineSection(log) }
                        if !log.filesWritten.isEmpty { filesSection(log) }
                        if !log.workersStarted.isEmpty { workersSection(log) }
                        if !log.memoryWrites.isEmpty { memorySection(log) }
                    } else if searchedForLog {
                        noLogNote
                    }
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 28)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CCTheme.contentBackground)
        .task(id: entry.id) {
            log = nil
            searchedForLog = false
            log = RequestLogStore.find(title: entry.title, near: entry.date)
            searchedForLog = true
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: onBack) {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 11, weight: .semibold))
                    Text("History")
                        .font(.system(size: 12.5, weight: .medium))
                }
                .foregroundStyle(CCTheme.textSecondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text(entry.title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(CCTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            HStack(spacing: 10) {
                Text(log?.kind ?? entry.kind)
                    .font(.system(size: 9.5, weight: .semibold))
                    .kerning(0.5)
                    .foregroundStyle(kindColor)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(kindColor.opacity(0.14)))
                if let date = log?.startedAt ?? entry.date {
                    Text(CCFormat.absoluteFormatter.string(from: date))
                        .font(.system(size: 11.5))
                        .foregroundStyle(CCTheme.textTertiary)
                }
                if let duration = log?.duration {
                    Label(CCFormat.duration(duration), systemImage: "timer")
                        .font(.system(size: 11.5))
                        .foregroundStyle(CCTheme.textTertiary)
                }
                if let log, !log.steps.isEmpty {
                    Text(log.steps.count == 1 ? "1 step" : "\(log.steps.count) steps")
                        .font(.system(size: 11.5))
                        .foregroundStyle(CCTheme.textTertiary)
                }
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 44)
        .padding(.bottom, 18)
    }

    // MARK: Sections

    private var responseText: String {
        if let r = log?.response, !r.isEmpty { return r }
        return entry.summary
    }

    private var responseCard: some View {
        section("Response") {
            Text(responseText.isEmpty ? "No response recorded." : responseText)
                .font(.system(size: 13))
                .foregroundStyle(CCTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(16)
        }
    }

    private func timelineSection(_ log: RequestLog) -> some View {
        section("Timeline") {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(log.steps.enumerated()), id: \.element.id) { index, step in
                    TimelineRow(step: step, isLast: index == log.steps.count - 1)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private func filesSection(_ log: RequestLog) -> some View {
        section("Files written") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(log.filesWritten, id: \.self) { path in
                    HStack(spacing: 8) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 11))
                            .foregroundStyle(Color(hex: 0x4ADE80))
                        Text(path)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(CCTheme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(16)
        }
    }

    private func workersSection(_ log: RequestLog) -> some View {
        section("Worker sessions started") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(log.workersStarted, id: \.self) { name in
                    HStack(spacing: 8) {
                        Image(systemName: "cpu")
                            .font(.system(size: 11))
                            .foregroundStyle(Color(hex: 0xB15EFF))
                        Text(CCFormat.prettify(name))
                            .font(.system(size: 12.5))
                            .foregroundStyle(CCTheme.textPrimary)
                        Text("~/.notch/sessions/\(name).jsonl")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(CCTheme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            .padding(16)
        }
    }

    private func memorySection(_ log: RequestLog) -> some View {
        section("Memory vault") {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(log.memoryWrites) { write in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: memoryIcon(write.kind))
                            .font(.system(size: 11))
                            .foregroundStyle(CCTheme.accent)
                            .frame(width: 16)
                            .padding(.top, 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(memoryLabel(write.kind))
                                .font(.system(size: 10, weight: .semibold))
                                .kerning(0.4)
                                .textCase(.uppercase)
                                .foregroundStyle(CCTheme.textTertiary)
                            Text(write.detail)
                                .font(.system(size: 12))
                                .foregroundStyle(CCTheme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private var noLogNote: some View {
        HStack(spacing: 10) {
            Image(systemName: "info.circle")
                .font(.system(size: 13))
                .foregroundStyle(CCTheme.textTertiary)
            Text("No detailed activity log exists for this entry — step-by-step logs are recorded for requests made after this feature shipped.")
                .font(.system(size: 12))
                .foregroundStyle(CCTheme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(CCTheme.cardBackground.opacity(0.6))
        )
    }

    private func memoryIcon(_ kind: String) -> String {
        switch kind {
        case "journal": return "book.closed"
        case "lesson": return "lightbulb"
        case "skill": return "wand.and.stars"
        default: return "note.text"
        }
    }

    private func memoryLabel(_ kind: String) -> String {
        switch kind {
        case "journal": return "Journal entry"
        case "lesson": return "Lesson"
        case "skill": return "Skill"
        default: return "Vault note"
        }
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(CCTheme.textTertiary)
                .textCase(.uppercase)
                .kerning(0.4)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(CCTheme.cardBackground)
                )
        }
    }
}

// MARK: - Timeline row

private struct TimelineRow: View {
    let step: RequestLogStep
    let isLast: Bool

    private var icon: String {
        if step.isVerification { return "eye" }
        if step.toolName == "Write" { return "square.and.pencil" }
        if step.toolName == "Read" { return "doc.text.magnifyingglass" }
        if step.isCommand || step.toolName == "Bash" { return "terminal" }
        return "circle.fill"
    }

    private var iconColor: Color {
        if step.isVerification { return Color(hex: 0xFFB65E) }
        if step.toolName == "Write" { return Color(hex: 0x4ADE80) }
        return CCTheme.textTertiary
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(CCFormat.clockFormatter.string(from: step.time))
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(CCTheme.textTertiary)
                .frame(width: 58, alignment: .trailing)
                .padding(.top, 3)

            // Rail: icon + connector line down to the next row.
            VStack(spacing: 0) {
                Image(systemName: icon)
                    .font(.system(size: 10))
                    .foregroundStyle(iconColor)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(Color.white.opacity(0.05)))
                if !isLast {
                    Rectangle()
                        .fill(CCTheme.hairline)
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 18)

            VStack(alignment: .leading, spacing: 3) {
                Text(step.text)
                    .font(.system(size: 12.5, design: step.isCommand ? .monospaced : .default))
                    .foregroundStyle(CCTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if !step.detail.isEmpty, step.detail != step.text {
                    Text(step.detail)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(CCTheme.textTertiary)
                        .lineLimit(3)
                        .truncationMode(.tail)
                        .textSelection(.enabled)
                }
            }
            .padding(.bottom, isLast ? 0 : 14)
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}
