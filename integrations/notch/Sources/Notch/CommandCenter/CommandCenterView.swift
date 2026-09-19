import SwiftUI

/// Codex-style design tokens for the Command Center window only.
/// The notch panel keeps NotchTheme; this hub deliberately mimics the
/// ChatGPT Codex macOS app's dark chrome.
enum CCTheme {
    static let sidebarBackground = Color(hex: 0x161616)
    static let contentBackground = Color(hex: 0x1E1E1E)
    static let cardBackground = Color(hex: 0x262626)
    static let cardHover = Color(hex: 0x2E2E2E)
    static let inputBackground = Color(hex: 0x2A2A2A)
    static let selection = Color.white.opacity(0.09)
    static let hover = Color.white.opacity(0.05)
    static let hairline = Color.white.opacity(0.07)
    static let textPrimary = Color.white.opacity(0.92)
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary = Color.white.opacity(0.35)
    static let accent = Color(hex: 0x5E9EFF)

    static let sidebarWidth: CGFloat = 300
}

enum CCTab: String, CaseIterable, Identifiable {
    case history = "History"
    case agents = "Agents"
    case memoryGraph = "Memory Graph"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .history: return "clock"
        case .agents: return "cpu"
        case .memoryGraph: return "point.3.connected.trianglepath.dotted"
        case .settings: return "gearshape"
        }
    }
}

@MainActor
final class CommandCenterStore: ObservableObject {
    @Published var journal: [CCJournalEntry] = []
    @Published var threads: [CCThread] = []
    @Published var workers: [CCWorker] = []
    @Published var graphNodes: [CCGraphNode] = []
    @Published var graphEdges: [CCGraphEdge] = []
    @Published var config: [CCConfigEntry] = []
    @Published var activeItems: [CCActiveItem] = []
    @Published var recentlyFinished: [CCFinishedItem] = []

    private var activeTimer: Timer?
    private var lastActiveIDs: Set<String> = []

    var recentQuestions: [CCJournalEntry] {
        Array(journal.filter(\.isQuestion).prefix(20))
    }

    func reload() {
        journal = CommandCenterData.loadJournal()
        threads = CommandCenterData.buildThreads(journal)
        workers = CommandCenterData.loadWorkers()
        let graph = CommandCenterData.loadGraph()
        graphNodes = graph.nodes
        graphEdges = graph.edges
        config = CommandCenterData.loadConfig()
    }

    /// Poll the Active feed every few seconds while the hub is visible.
    /// Ticks while hidden are a single bool check — the timer stays armed
    /// so a reopened window self-heals within one interval.
    func startActiveRefresh() {
        refreshActive()
        guard activeTimer == nil else { return }
        activeTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard CommandCenterWindowController.shared.isWindowVisible else { return }
                self?.refreshActive()
            }
        }
    }

    func refreshActive() {
        var items: [CCActiveItem] = []
        if let request = NotchViewModel.shared?.activeRequestSummary {
            items.append(CCActiveItem(
                id: "request",
                kind: .request,
                name: JournalStore.truncate(request.title, to: 60),
                status: request.status,
                startedAt: request.startedAt))
        }
        let workers = CommandCenterData.loadWorkers()
        for worker in workers where worker.isRunning {
            items.append(CCActiveItem(
                id: "worker-" + worker.id,
                kind: .worker,
                name: worker.prettyName,
                status: worker.activity.isEmpty ? "Working…" : worker.activity,
                startedAt: worker.startedAt ?? worker.modified))
        }
        self.workers = workers
        activeItems = items
        recentlyFinished = workers
            .filter { !$0.isRunning && $0.modified.map { Date().timeIntervalSince($0) < 5400 } == true }
            .prefix(5)
            .map { CCFinishedItem(
                id: $0.id, name: $0.prettyName,
                result: $0.excerpt.isEmpty ? "Finished." : $0.excerpt,
                finishedAt: $0.modified) }

        // Something entered or left the Active list (request finished,
        // worker completed) — the journal gained lines; refresh history.
        let ids = Set(items.map(\.id))
        if ids != lastActiveIDs {
            lastActiveIDs = ids
            journal = CommandCenterData.loadJournal()
            threads = CommandCenterData.buildThreads(journal)
        }
    }
}

struct CommandCenterView: View {
    @StateObject private var store = CommandCenterStore()
    @State private var tab: CCTab = .history
    @State private var searchText = ""
    @State private var selectedEntry: CCJournalEntry?

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Rectangle().fill(CCTheme.hairline).frame(width: 1)
            content
        }
        .frame(minWidth: 900, minHeight: 560)
        .background(CCTheme.contentBackground)
        .preferredColorScheme(.dark)
        .onAppear {
            store.reload()
            store.startActiveRefresh()
        }
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Room for the inline traffic lights.
            HStack(spacing: 10) {
                StarburstWorkingView(isStatic: true, size: 14)
                Text("Command Center")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(CCTheme.textPrimary)
            }
            .padding(.top, 44)
            .padding(.horizontal, 20)
            .padding(.bottom, 18)

            VStack(spacing: 2) {
                ForEach(CCTab.allCases) { item in
                    SidebarNavRow(tab: item, selected: tab == item) {
                        tab = item
                        selectedEntry = nil
                        store.reload()
                    }
                }
            }
            .padding(.horizontal, 10)

            activeSection

            Text("Recent questions")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(CCTheme.textTertiary)
                .textCase(.uppercase)
                .kerning(0.4)
                .padding(.horizontal, 22)
                .padding(.top, 26)
                .padding(.bottom, 8)

            if store.recentQuestions.isEmpty {
                Text("Nothing asked yet")
                    .font(.system(size: 12))
                    .foregroundStyle(CCTheme.textTertiary)
                    .padding(.horizontal, 22)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 1) {
                        ForEach(store.recentQuestions) { entry in
                            RecentQuestionRow(entry: entry) {
                                tab = .history
                                selectedEntry = entry
                            }
                        }
                    }
                    .padding(.horizontal, 10)
                }
            }
            Spacer(minLength: 12)
        }
        .frame(width: CCTheme.sidebarWidth)
        .frame(maxHeight: .infinity)
        .background(CCTheme.sidebarBackground)
    }

    // MARK: Active section (persistent — everything currently in flight)

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Active")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(CCTheme.textTertiary)
                .textCase(.uppercase)
                .kerning(0.4)
                .padding(.horizontal, 22)
                .padding(.top, 24)
                .padding(.bottom, 6)

            if store.activeItems.isEmpty {
                Text("Nothing in flight")
                    .font(.system(size: 12))
                    .foregroundStyle(CCTheme.textTertiary)
                    .padding(.horizontal, 22)
            } else {
                VStack(spacing: 1) {
                    ForEach(store.activeItems.prefix(6)) { item in
                        ActiveItemRow(item: item)
                    }
                }
                .padding(.horizontal, 10)
            }

            if !store.recentlyFinished.isEmpty {
                Text("Recently finished")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(CCTheme.textTertiary)
                    .textCase(.uppercase)
                    .kerning(0.4)
                    .padding(.horizontal, 22)
                    .padding(.top, 14)
                    .padding(.bottom, 6)
                VStack(spacing: 1) {
                    ForEach(store.recentlyFinished) { item in
                        FinishedItemRow(item: item)
                    }
                }
                .padding(.horizontal, 10)
            }
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .history: HistoryTabView(store: store, searchText: $searchText, selectedEntry: $selectedEntry)
        case .agents: AgentsTabView(store: store)
        case .memoryGraph: MemoryGraphTabView(store: store)
        case .settings: SettingsTabView(store: store)
        }
    }
}

// MARK: - Sidebar rows

private struct SidebarNavRow: View {
    let tab: CCTab
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: tab.icon)
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 18)
                    .foregroundStyle(selected ? CCTheme.textPrimary : CCTheme.textSecondary)
                Text(tab.rawValue)
                    .font(.system(size: 13, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? CCTheme.textPrimary : CCTheme.textSecondary)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? CCTheme.selection : (hovering ? CCTheme.hover : .clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct RecentQuestionRow: View {
    let entry: CCJournalEntry
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Text(entry.title)
                    .font(.system(size: 12.5))
                    .foregroundStyle(hovering ? CCTheme.textPrimary : CCTheme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                Text(entry.relativeStamp)
                    .font(.system(size: 11))
                    .foregroundStyle(CCTheme.textTertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(hovering ? CCTheme.hover : .clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

// MARK: - Active / Recently finished rows

private struct ActiveItemRow: View {
    let item: CCActiveItem

    private var dotColor: Color {
        item.kind == .request ? CCTheme.accent : Color(hex: 0x4ADE80)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(dotColor)
                .frame(width: 7, height: 7)
                .shadow(color: dotColor.opacity(0.7), radius: 3)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.name)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(CCTheme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 4)
                    Text(item.elapsed)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(CCTheme.textTertiary)
                }
                Text(item.status)
                    .font(.system(size: 11.5))
                    .foregroundStyle(CCTheme.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

private struct FinishedItemRow: View {
    let item: CCFinishedItem

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Color(hex: 0x4ADE80).opacity(0.8))
                .padding(.top, 3)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.name)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(CCTheme.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(item.relativeStamp)
                        .font(.system(size: 10.5))
                        .foregroundStyle(CCTheme.textTertiary)
                }
                Text(item.result)
                    .font(.system(size: 11.5))
                    .foregroundStyle(CCTheme.textTertiary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

// MARK: - Empty state (Codex-style centered muted prompt)

struct CCEmptyState: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(CCTheme.textTertiary)
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(CCTheme.textSecondary)
            Text(subtitle)
                .font(.system(size: 12.5))
                .foregroundStyle(CCTheme.textTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - History tab

struct HistoryTabView: View {
    @ObservedObject var store: CommandCenterStore
    @Binding var searchText: String
    @Binding var selectedEntry: CCJournalEntry?
    @State private var expandedThreads: Set<String> = []

    private func matches(_ entry: CCJournalEntry, _ query: String) -> Bool {
        entry.title.localizedCaseInsensitiveContains(query)
            || entry.summary.localizedCaseInsensitiveContains(query)
            || entry.kind.localizedCaseInsensitiveContains(query)
    }

    /// Whole threads survive filtering when any of their messages match.
    private var filteredThreads: [CCThread] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return store.threads }
        return store.threads.filter { thread in
            thread.entries.contains { matches($0, query) }
        }
    }

    var body: some View {
        if let entry = selectedEntry {
            RequestDetailView(entry: entry) { selectedEntry = nil }
        } else {
            listBody
        }
    }

    private var listBody: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12))
                    .foregroundStyle(CCTheme.textTertiary)
                TextField("Search history…", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(CCTheme.textPrimary)
                if !searchText.isEmpty {
                    Button { searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(CCTheme.textTertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(CCTheme.inputBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(CCTheme.hairline, lineWidth: 1)
                    )
            )
            .padding(.horizontal, 28)
            .padding(.top, 44)
            .padding(.bottom, 16)

            if filteredThreads.isEmpty {
                CCEmptyState(
                    icon: "clock",
                    title: store.journal.isEmpty ? "No history yet" : "No matches",
                    subtitle: store.journal.isEmpty
                        ? "Conversations and actions will appear here\nas you talk to the notch."
                        : "Nothing in the journal matches “\(searchText)”."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredThreads) { thread in
                            if thread.entries.count == 1 {
                                HistoryCard(entry: thread.latest) { selectedEntry = thread.latest }
                            } else {
                                ThreadCard(
                                    thread: thread,
                                    expanded: expandedThreads.contains(thread.id),
                                    onToggle: {
                                        if expandedThreads.contains(thread.id) {
                                            expandedThreads.remove(thread.id)
                                        } else {
                                            expandedThreads.insert(thread.id)
                                        }
                                    },
                                    onOpen: { selectedEntry = $0 }
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 24)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CCTheme.contentBackground)
    }
}

private func ccKindColor(_ kind: String) -> Color {
    switch kind {
    case "ACTION": return Color(hex: 0x4ADE80)
    case "ASK", "ANSWER", "CLARIFY": return CCTheme.accent
    case "NUDGE": return Color(hex: 0xFFB65E)
    case "WORKER": return Color(hex: 0xB15EFF)
    case "FAILED", "CANCELLED": return Color(hex: 0xFF6B6B)
    default: return CCTheme.textTertiary
    }
}

/// The full title + summary + badge layout shared by standalone history
/// cards and the latest message inside a thread card.
private struct HistoryEntryBody: View {
    let entry: CCJournalEntry

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(entry.title)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(CCTheme.textPrimary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if !entry.summary.isEmpty {
                    Text(entry.summary)
                        .font(.system(size: 12.5))
                        .foregroundStyle(CCTheme.textSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Text(entry.relativeStamp)
                    .font(.system(size: 11))
                    .foregroundStyle(CCTheme.textTertiary)
                Text(entry.kind)
                    .font(.system(size: 9.5, weight: .semibold))
                    .kerning(0.5)
                    .foregroundStyle(ccKindColor(entry.kind))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(ccKindColor(entry.kind).opacity(0.14)))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }
}

private struct HistoryCard: View {
    let entry: CCJournalEntry
    let onOpen: () -> Void
    @State private var hovering = false

    var body: some View {
        HistoryEntryBody(entry: entry)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(hovering ? CCTheme.cardHover : CCTheme.cardBackground)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .onTapGesture(perform: onOpen)
            .onHover { hovering = $0 }
    }
}

// MARK: - Thread card (collapsible related exchange)

private struct ThreadCard: View {
    let thread: CCThread
    let expanded: Bool
    let onToggle: () -> Void
    let onOpen: (CCJournalEntry) -> Void
    @State private var hoveringLatest = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            toggleHeader
            Rectangle().fill(CCTheme.hairline).frame(height: 1)
            if expanded {
                ForEach(thread.entries.dropLast()) { entry in
                    ThreadEntryRow(entry: entry) { onOpen(entry) }
                    Rectangle().fill(CCTheme.hairline).frame(height: 1)
                        .padding(.leading, 16)
                }
            }
            HistoryEntryBody(entry: thread.latest)
                .background(hoveringLatest ? CCTheme.cardHover : .clear)
                .contentShape(Rectangle())
                .onTapGesture { onOpen(thread.latest) }
                .onHover { hoveringLatest = $0 }
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(CCTheme.cardBackground)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var toggleHeader: some View {
        Button(action: onToggle) {
            HStack(spacing: 6) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(CCTheme.textTertiary)
                Text(expanded
                     ? "Hide earlier messages"
                     : "\(thread.earlierCount) earlier message\(thread.earlierCount == 1 ? "" : "s")")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(CCTheme.textSecondary)
                Spacer()
                Text("THREAD")
                    .font(.system(size: 9, weight: .semibold))
                    .kerning(0.6)
                    .foregroundStyle(CCTheme.textTertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Compact row for an earlier message inside an expanded thread.
private struct ThreadEntryRow: View {
    let entry: CCJournalEntry
    let onOpen: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(ccKindColor(entry.kind).opacity(0.7))
                    .frame(width: 5, height: 5)
                    .padding(.top, 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(CCTheme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if !entry.summary.isEmpty {
                        Text(entry.summary)
                            .font(.system(size: 11.5))
                            .foregroundStyle(CCTheme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                Spacer(minLength: 6)
                Text(entry.relativeStamp)
                    .font(.system(size: 10.5))
                    .foregroundStyle(CCTheme.textTertiary)
                    .padding(.top, 2)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(hovering ? CCTheme.hover : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

// MARK: - Agents tab

struct AgentsTabView: View {
    @ObservedObject var store: CommandCenterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Background agents")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(CCTheme.textPrimary)
                Spacer()
                Button {
                    store.reload()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(CCTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 28)
            .padding(.top, 44)
            .padding(.bottom, 16)

            if store.workers.isEmpty {
                CCEmptyState(
                    icon: "cpu",
                    title: "No background agents yet",
                    subtitle: "Workers the notch spawns for long tasks\nwill show up here with live status."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(store.workers) { worker in
                            WorkerCard(worker: worker)
                        }
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 24)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CCTheme.contentBackground)
    }
}

private struct WorkerCard: View {
    let worker: CCWorker
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Circle()
                .fill(worker.isRunning ? Color(hex: 0x4ADE80) : CCTheme.textTertiary)
                .frame(width: 8, height: 8)
                .shadow(color: worker.isRunning ? Color(hex: 0x4ADE80).opacity(0.7) : .clear, radius: 4)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(worker.prettyName)
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(CCTheme.textPrimary)
                    if let model = worker.model {
                        Text(model)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(CCTheme.textTertiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.white.opacity(0.06)))
                    }
                }
                if !worker.excerpt.isEmpty {
                    Text(worker.excerpt)
                        .font(.system(size: 12.5))
                        .foregroundStyle(CCTheme.textSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Text(worker.isRunning ? "running" : "finished")
                    .font(.system(size: 9.5, weight: .semibold))
                    .kerning(0.5)
                    .foregroundStyle(worker.isRunning ? Color(hex: 0x4ADE80) : CCTheme.textTertiary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(
                        (worker.isRunning ? Color(hex: 0x4ADE80) : CCTheme.textTertiary).opacity(0.14)))
                Text(worker.relativeStamp)
                    .font(.system(size: 11))
                    .foregroundStyle(CCTheme.textTertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(hovering ? CCTheme.cardHover : CCTheme.cardBackground)
        )
        .onHover { hovering = $0 }
    }
}

// MARK: - Settings tab

struct SettingsTabView: View {
    @ObservedObject var store: CommandCenterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Settings & Info")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(CCTheme.textPrimary)
                .padding(.horizontal, 28)
                .padding(.top, 44)
                .padding(.bottom, 16)

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    settingsSection("Configuration — ~/.notch/config") {
                        if store.config.isEmpty {
                            Text("No config file found.")
                                .font(.system(size: 12.5))
                                .foregroundStyle(CCTheme.textTertiary)
                                .padding(.vertical, 8)
                        } else {
                            ForEach(store.config) { entry in
                                HStack(spacing: 12) {
                                    Text(entry.key)
                                        .font(.system(size: 12, design: .monospaced))
                                        .foregroundStyle(CCTheme.textPrimary)
                                    Spacer()
                                    HStack(spacing: 6) {
                                        if entry.masked {
                                            Image(systemName: "lock.fill")
                                                .font(.system(size: 9))
                                                .foregroundStyle(CCTheme.textTertiary)
                                        }
                                        Text(entry.displayValue)
                                            .font(.system(size: 12, design: .monospaced))
                                            .foregroundStyle(CCTheme.textSecondary)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                }
                                .padding(.vertical, 7)
                                if entry.id != store.config.last?.id {
                                    Rectangle().fill(CCTheme.hairline).frame(height: 1)
                                }
                            }
                        }
                    }

                    settingsSection("About") {
                        infoRow("Version", CommandCenterData.appVersion)
                        Rectangle().fill(CCTheme.hairline).frame(height: 1)
                        infoRow("Built", CommandCenterData.buildDate)
                        Rectangle().fill(CCTheme.hairline).frame(height: 1)
                        infoRow("Vault", "~/.notch")
                    }
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CCTheme.contentBackground)
    }

    private func settingsSection(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(CCTheme.textTertiary)
                .textCase(.uppercase)
                .kerning(0.4)
            VStack(alignment: .leading, spacing: 0) {
                content()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(CCTheme.cardBackground)
            )
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12.5))
                .foregroundStyle(CCTheme.textPrimary)
            Spacer()
            Text(value)
                .font(.system(size: 12.5))
                .foregroundStyle(CCTheme.textSecondary)
        }
        .padding(.vertical, 7)
    }
}
