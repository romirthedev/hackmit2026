import SwiftUI
import AppKit

// MARK: - Live force simulation

/// d3-style force simulation running continuously on a 60fps timer while
/// "warm" (alpha above threshold). Interactions reheat it; it goes idle on
/// its own so a settled graph costs nothing. Positions live in unit space,
/// roughly [-1.2, 1.2] around the origin.
@MainActor
final class GraphPhysics: ObservableObject {
    @Published private(set) var positions: [String: CGPoint] = [:]

    private struct Body {
        var position: CGPoint
        var velocity: CGPoint = .zero
        var pinned = false
    }

    private var bodies: [String: Body] = [:]
    private var nodeIDs: [String] = []
    private var edges: [CCGraphEdge] = []
    private(set) var degree: [String: Int] = [:]

    private var timer: Timer?
    private var alpha: CGFloat = 0
    private var alphaTarget: CGFloat = 0

    private let springLength: CGFloat = 0.38
    private let springStrength: CGFloat = 0.55
    private let chargeStrength: CGFloat = 0.014
    private let gravityStrength: CGFloat = 0.045
    private let velocityKeep: CGFloat = 0.6   // d3 velocityDecay 0.4
    private let alphaDecay: CGFloat = 0.0228
    private let alphaMin: CGFloat = 0.002

    // MARK: Graph data

    /// Loads a new node/edge set, keeping positions of nodes that survive so
    /// reloads don't scramble the layout. New nodes seed near their linked
    /// neighbors when possible, else deterministically on a circle.
    func load(nodes: [CCGraphNode], edges: [CCGraphEdge]) {
        self.edges = edges
        nodeIDs = nodes.map(\.id)

        degree = [:]
        for edge in edges {
            degree[edge.from, default: 0] += 1
            degree[edge.to, default: 0] += 1
        }

        var next: [String: Body] = [:]
        for (i, node) in nodes.enumerated() {
            if let existing = bodies[node.id] {
                next[node.id] = existing
                continue
            }
            let linked = edges.compactMap { edge -> CGPoint? in
                if edge.from == node.id { return bodies[edge.to]?.position }
                if edge.to == node.id { return bodies[edge.from]?.position }
                return nil
            }
            if !linked.isEmpty {
                let cx = linked.map(\.x).reduce(0, +) / CGFloat(linked.count)
                let cy = linked.map(\.y).reduce(0, +) / CGFloat(linked.count)
                // Deterministic nudge so co-seeded nodes don't stack exactly.
                let angle = CGFloat(i) * 2.399963           // golden angle
                next[node.id] = Body(position: CGPoint(
                    x: cx + cos(angle) * 0.08, y: cy + sin(angle) * 0.08))
            } else {
                let angle = CGFloat(i) / CGFloat(max(1, nodes.count)) * 2 * .pi
                let r = 0.7 + 0.15 * CGFloat(i % 3)
                next[node.id] = Body(position: CGPoint(x: cos(angle) * r, y: sin(angle) * r))
            }
        }
        bodies = next
        publish()
        kick(0.9)
    }

    // MARK: Interaction

    /// Pins a node to the cursor: it holds position exactly while the rest of
    /// the graph keeps simulating around it.
    func beginDrag(_ id: String, at world: CGPoint) {
        bodies[id]?.pinned = true
        bodies[id]?.position = world
        bodies[id]?.velocity = .zero
        alphaTarget = 0.3
        kick(0.5)
    }

    func dragTo(_ id: String, world: CGPoint) {
        bodies[id]?.position = world
        bodies[id]?.velocity = .zero
        publish()
    }

    /// Releases a pinned node back into the simulation.
    func endDrag(_ id: String) {
        bodies[id]?.pinned = false
        alphaTarget = 0
    }

    func kick(_ value: CGFloat = 0.4) {
        alpha = max(alpha, value)
        startTimerIfNeeded()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        alphaTarget = 0
    }

    // MARK: Stepping

    private func startTimerIfNeeded() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.step() }
        }
    }

    private func step() {
        alpha += (alphaTarget - alpha) * alphaDecay
        if alpha < alphaMin, alphaTarget < alphaMin {
            stop()
            return
        }

        var force: [String: CGPoint] = [:]

        // Pairwise repulsion (n is small — a handful of notes and skills).
        for i in 0..<nodeIDs.count {
            for j in (i + 1)..<nodeIDs.count {
                guard let a = bodies[nodeIDs[i]]?.position,
                      let b = bodies[nodeIDs[j]]?.position else { continue }
                var dx = a.x - b.x, dy = a.y - b.y
                var d = hypot(dx, dy)
                if d < 0.02 {
                    let angle = CGFloat(i &* 31 &+ j) // deterministic separation
                    dx = cos(angle) * 0.02; dy = sin(angle) * 0.02; d = 0.02
                }
                let push = chargeStrength * alpha / (d * d)
                let fx = dx / d * push, fy = dy / d * push
                force[nodeIDs[i], default: .zero].x += fx
                force[nodeIDs[i], default: .zero].y += fy
                force[nodeIDs[j], default: .zero].x -= fx
                force[nodeIDs[j], default: .zero].y -= fy
            }
        }

        // Springs along edges.
        for edge in edges {
            guard let a = bodies[edge.from]?.position,
                  let b = bodies[edge.to]?.position else { continue }
            let dx = b.x - a.x, dy = b.y - a.y
            let d = max(0.01, hypot(dx, dy))
            let pull = (d - springLength) / d * springStrength * alpha * 0.5
            force[edge.from, default: .zero].x += dx * pull
            force[edge.from, default: .zero].y += dy * pull
            force[edge.to, default: .zero].x -= dx * pull
            force[edge.to, default: .zero].y -= dy * pull
        }

        // Gentle gravity keeps disconnected pieces on screen.
        for id in nodeIDs {
            guard let p = bodies[id]?.position else { continue }
            force[id, default: .zero].x -= p.x * gravityStrength * alpha
            force[id, default: .zero].y -= p.y * gravityStrength * alpha
        }

        for id in nodeIDs {
            guard var body = bodies[id], !body.pinned else { continue }
            let f = force[id] ?? .zero
            var vx = (body.velocity.x + f.x) * velocityKeep
            var vy = (body.velocity.y + f.y) * velocityKeep
            let speed = hypot(vx, vy)
            if speed > 0.08 { vx *= 0.08 / speed; vy *= 0.08 / speed }
            body.velocity = CGPoint(x: vx, y: vy)
            body.position.x += vx
            body.position.y += vy
            bodies[id] = body
        }
        publish()
    }

    private func publish() {
        positions = bodies.mapValues(\.position)
    }
}

// MARK: - Graph view

/// Obsidian-style force-directed memory graph. Nodes are draggable (pinned
/// to the cursor while held, released back into the live simulation), the
/// view zooms with scroll/pinch and pans by dragging empty space, hovering
/// highlights a node's neighborhood, and clicking opens a rich detail panel.
struct MemoryGraphTabView: View {
    @ObservedObject var store: CommandCenterStore
    @StateObject private var physics = GraphPhysics()

    @State private var selectedID: String?
    @State private var hoveredID: String?

    // View transform: screen = center + world * baseScale * zoom + pan
    @State private var zoom: CGFloat = 1
    @State private var pan: CGSize = .zero

    // Drag bookkeeping — one gesture serves node-drag, pan, and click.
    @State private var dragNodeID: String?
    @State private var panAtDragStart: CGSize?
    @State private var dragMoved: CGFloat = 0
    @State private var didHitTestDrag = false
    @State private var magnifyStartZoom: CGFloat?

    private let minZoom: CGFloat = 0.25
    private let maxZoom: CGFloat = 5

    var body: some View {
        ZStack(alignment: .trailing) {
            if store.graphNodes.isEmpty {
                CCEmptyState(
                    icon: "point.3.connected.trianglepath.dotted",
                    title: "No memories yet",
                    subtitle: "Notes and skills in ~/.notch will appear here,\nlinked by their [[wikilinks]]."
                )
            } else {
                GeometryReader { geo in
                    canvas(in: geo.size)
                        .background(ScrollZoomCatcher(
                            onScroll: { delta, location in
                                zoomBy(exp(delta * 0.004), at: location, in: geo.size)
                            },
                            onMagnify: { magnification, location in
                                zoomBy(1 + magnification, at: location, in: geo.size)
                            }
                        ))
                        .onContinuousHover(coordinateSpace: .local) { phase in
                            guard dragNodeID == nil, panAtDragStart == nil else { return }
                            switch phase {
                            case .active(let point):
                                hoveredID = hitTest(point, in: geo.size)
                            case .ended:
                                hoveredID = nil
                            }
                        }
                        .gesture(dragGesture(in: geo.size))
                        .simultaneousGesture(magnifyGesture(in: geo.size))
                        .overlay(alignment: .bottomLeading) { legend }
                        .overlay(alignment: .bottomTrailing) {
                            if zoom != 1 || pan != .zero { resetViewButton }
                        }
                }
                .background(CCTheme.contentBackground)
            }

            if let node = selectedNode {
                NodeDetailPanel(
                    node: node,
                    linkCount: physics.degree[node.id] ?? 0,
                    neighbors: neighbors(of: node.id),
                    onClose: { selectedID = nil },
                    onJump: { target in
                        selectedID = target.id
                        centerOn(target.id)
                    }
                )
                .id(node.id)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: selectedID)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CCTheme.contentBackground)
        .onAppear { physics.load(nodes: store.graphNodes, edges: store.graphEdges) }
        .onDisappear { physics.stop() }
        .onChange(of: store.graphNodes) { _, nodes in
            physics.load(nodes: nodes, edges: store.graphEdges)
            if selectedID != nil, !nodes.contains(where: { $0.id == selectedID }) {
                selectedID = nil
            }
        }
    }

    private var selectedNode: CCGraphNode? {
        store.graphNodes.first { $0.id == selectedID }
    }

    private func neighbors(of id: String) -> [CCGraphNode] {
        var ids: Set<String> = []
        for edge in store.graphEdges {
            if edge.from == id { ids.insert(edge.to) }
            if edge.to == id { ids.insert(edge.from) }
        }
        return store.graphNodes.filter { ids.contains($0.id) }
    }

    // MARK: Canvas

    private func canvas(in size: CGSize) -> some View {
        // Snapshot published state in body so the Canvas closure always
        // captures fresh data (the renderer alone doesn't register the
        // dependency reliably).
        let positions = physics.positions
        let degree = physics.degree
        let focusID = hoveredID ?? selectedID
        let neighborhood = focusNeighborhood(focusID)

        return Canvas { context, canvasSize in
            let transform = worldToScreen(in: canvasSize)
            let labelAlpha = max(0, min(1, (zoom - 0.45) / 0.35))

            for edge in store.graphEdges {
                guard let a = positions[edge.from], let b = positions[edge.to] else { continue }
                var path = Path()
                path.move(to: transform(a))
                path.addLine(to: transform(b))
                if let focusID {
                    let touches = edge.from == focusID || edge.to == focusID
                    context.stroke(
                        path,
                        with: .color(touches ? CCTheme.accent.opacity(0.55) : .white.opacity(0.045)),
                        lineWidth: touches ? 1.4 : 1)
                } else {
                    context.stroke(path, with: .color(.white.opacity(0.14)), lineWidth: 1)
                }
            }

            for node in store.graphNodes {
                guard let unit = positions[node.id] else { continue }
                let p = transform(unit)
                let color = nodeColor(node)
                let links = degree[node.id] ?? 0
                let base: CGFloat = node.kind == .topic ? 3.5 : 5
                let radius = min(13, (base + sqrt(CGFloat(links)) * 1.8)) * pow(zoom, 0.35)
                let inFocus = neighborhood?.contains(node.id) ?? true
                let isFocused = node.id == focusID
                let isSelected = node.id == selectedID
                let dim: CGFloat = inFocus ? 1 : 0.14

                var glow = context
                glow.addFilter(.blur(radius: isFocused ? 11 : 6))
                glow.fill(
                    Path(ellipseIn: CGRect(
                        x: p.x - radius * 2, y: p.y - radius * 2,
                        width: radius * 4, height: radius * 4)),
                    with: .color(color.opacity((isFocused ? 0.95 : 0.5) * dim))
                )
                context.fill(
                    Path(ellipseIn: CGRect(
                        x: p.x - radius, y: p.y - radius,
                        width: radius * 2, height: radius * 2)),
                    with: .color(color.opacity(dim))
                )
                if isSelected {
                    context.stroke(
                        Path(ellipseIn: CGRect(
                            x: p.x - radius - 3.5, y: p.y - radius - 3.5,
                            width: (radius + 3.5) * 2, height: (radius + 3.5) * 2)),
                        with: .color(.white.opacity(0.85)),
                        lineWidth: 1.2)
                }

                // Labels fade out when zoomed far away; focus keeps them on.
                let textAlpha = (isFocused || isSelected) ? 1 : labelAlpha * dim
                if textAlpha > 0.02 {
                    context.draw(
                        Text(node.label)
                            .font(.system(size: 10.5, weight: isFocused || isSelected ? .semibold : .regular))
                            .foregroundColor(.white.opacity((isFocused || isSelected ? 1 : 0.6) * textAlpha)),
                        at: CGPoint(x: p.x, y: p.y + radius + 11),
                        anchor: .center
                    )
                }
            }
        }
    }

    /// Set of node ids to render at full strength when a node is focused:
    /// the node itself plus direct neighbors. nil = no focus, show all.
    private func focusNeighborhood(_ focusID: String?) -> Set<String>? {
        guard let focusID else { return nil }
        var set: Set<String> = [focusID]
        for edge in store.graphEdges {
            if edge.from == focusID { set.insert(edge.to) }
            if edge.to == focusID { set.insert(edge.from) }
        }
        return set
    }

    private func nodeColor(_ node: CCGraphNode) -> Color {
        switch node.kind {
        case .note: return CCTheme.accent
        case .skill: return Color(hex: 0xB15EFF)
        case .topic: return Color.white.opacity(0.45)
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendDot(CCTheme.accent, "Notes")
            legendDot(Color(hex: 0xB15EFF), "Skills")
            legendDot(Color.white.opacity(0.45), "Topics")
            Text("·")
                .foregroundStyle(CCTheme.textTertiary)
            Text("drag nodes · scroll to zoom · drag space to pan")
                .foregroundStyle(CCTheme.textTertiary)
        }
        .font(.system(size: 10))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .allowsHitTesting(false)
    }

    private func legendDot(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).foregroundStyle(CCTheme.textSecondary)
        }
    }

    private var resetViewButton: some View {
        Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                zoom = 1
                pan = .zero
            }
        } label: {
            Label("Reset view", systemImage: "arrow.counterclockwise")
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(CCTheme.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(CCTheme.cardBackground)
                        .overlay(RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(CCTheme.hairline, lineWidth: 1))
                )
        }
        .buttonStyle(.plain)
        .padding(12)
    }

    // MARK: Transform

    private func baseScale(in size: CGSize) -> CGFloat {
        max(1, min(size.width - 140, size.height - 140) / 2.4)
    }

    private func worldToScreen(in size: CGSize) -> (CGPoint) -> CGPoint {
        let s = baseScale(in: size) * zoom
        let cx = size.width / 2 + pan.width, cy = size.height / 2 + pan.height
        return { p in CGPoint(x: cx + p.x * s, y: cy + p.y * s) }
    }

    private func screenToWorld(_ point: CGPoint, in size: CGSize) -> CGPoint {
        let s = baseScale(in: size) * zoom
        return CGPoint(
            x: (point.x - size.width / 2 - pan.width) / s,
            y: (point.y - size.height / 2 - pan.height) / s)
    }

    /// Zooms by `factor` keeping the world point under `location` stationary.
    private func zoomBy(_ factor: CGFloat, at location: CGPoint, in size: CGSize) {
        let newZoom = min(maxZoom, max(minZoom, zoom * factor))
        guard newZoom != zoom else { return }
        let world = screenToWorld(location, in: size)
        let s = baseScale(in: size) * newZoom
        zoom = newZoom
        pan = CGSize(
            width: location.x - size.width / 2 - world.x * s,
            height: location.y - size.height / 2 - world.y * s)
    }

    private func centerOn(_ id: String) {
        guard let world = physics.positions[id] else { return }
        // The canvas fills the tab; use the pan needed to put the node at the
        // (unknown exact) center — baseScale is size-dependent, so derive it
        // from the identity: centering means pan = -world * s.
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
            pan = CGSize(width: -world.x * lastBaseScale * zoom,
                         height: -world.y * lastBaseScale * zoom)
        }
    }

    // Cached by the drag/hit-test paths (they always know the live size).
    @State private var lastBaseScale: CGFloat = 300

    // MARK: Gestures

    private func dragGesture(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                lastBaseScale = baseScale(in: size)
                if !didHitTestDrag {
                    didHitTestDrag = true
                    dragMoved = 0
                    if let id = hitTest(value.startLocation, in: size) {
                        dragNodeID = id
                        hoveredID = id
                        physics.beginDrag(id, at: screenToWorld(value.startLocation, in: size))
                    } else {
                        panAtDragStart = pan
                    }
                }
                dragMoved = max(dragMoved, hypot(
                    value.location.x - value.startLocation.x,
                    value.location.y - value.startLocation.y))
                if let id = dragNodeID {
                    physics.dragTo(id, world: screenToWorld(value.location, in: size))
                } else if let start = panAtDragStart {
                    pan = CGSize(width: start.width + value.translation.width,
                                 height: start.height + value.translation.height)
                }
            }
            .onEnded { value in
                if let id = dragNodeID {
                    physics.endDrag(id)
                    if dragMoved <= 6 {
                        selectedID = (selectedID == id) ? nil : id
                    }
                } else if dragMoved <= 6 {
                    selectedID = nil
                }
                hoveredID = hitTest(value.location, in: size)
                dragNodeID = nil
                panAtDragStart = nil
                didHitTestDrag = false
            }
    }

    private func magnifyGesture(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                if magnifyStartZoom == nil { magnifyStartZoom = zoom }
                let target = min(maxZoom, max(minZoom, (magnifyStartZoom ?? zoom) * value.magnification))
                zoomBy(target / zoom, at: value.startLocation, in: size)
            }
            .onEnded { _ in magnifyStartZoom = nil }
    }

    private func hitTest(_ point: CGPoint, in size: CGSize) -> String? {
        let transform = worldToScreen(in: size)
        let degree = physics.degree
        var best: (String, CGFloat)?
        for node in store.graphNodes {
            guard let unit = physics.positions[node.id] else { continue }
            let p = transform(unit)
            let base: CGFloat = node.kind == .topic ? 3.5 : 5
            let radius = min(13, (base + sqrt(CGFloat(degree[node.id] ?? 0)) * 1.8)) * pow(zoom, 0.35)
            let d = hypot(p.x - point.x, p.y - point.y)
            if d < radius + 10, d < (best?.1 ?? .infinity) { best = (node.id, d) }
        }
        return best?.0
    }
}

// MARK: - Scroll & pinch event catcher

/// Transparent NSView that watches scroll-wheel and pinch events via a local
/// monitor (hitTest returns nil so all clicks pass through to SwiftUI).
/// Events over other scroll views — e.g. the detail panel — are ignored.
private struct ScrollZoomCatcher: NSViewRepresentable {
    let onScroll: (CGFloat, CGPoint) -> Void      // delta, location in local (flipped) coords
    let onMagnify: (CGFloat, CGPoint) -> Void

    func makeNSView(context: Context) -> Catcher { Catcher() }

    func updateNSView(_ view: Catcher, context: Context) {
        view.onScroll = onScroll
        view.onMagnify = onMagnify
    }

    final class Catcher: NSView {
        var onScroll: ((CGFloat, CGPoint) -> Void)?
        var onMagnify: ((CGFloat, CGPoint) -> Void)?
        private var monitor: Any?

        override var isFlipped: Bool { true }     // match SwiftUI's top-left origin
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window == nil {
                if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
            } else if monitor == nil {
                monitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .magnify]) { [weak self] event in
                    self?.route(event)
                    return event
                }
            }
        }

        deinit {
            if let monitor { NSEvent.removeMonitor(monitor) }
        }

        private func route(_ event: NSEvent) {
            guard let window, event.window === window else { return }
            let local = convert(event.locationInWindow, from: nil)
            guard bounds.contains(local) else { return }
            // Don't hijack scrolling that belongs to an overlapping scroll
            // view (the node detail panel sits on top of the canvas).
            if var hit = window.contentView?.hitTest(
                window.contentView!.convert(event.locationInWindow, from: nil)) {
                while let parent = hit.superview {
                    if parent is NSScrollView { return }
                    hit = parent
                }
            }
            switch event.type {
            case .scrollWheel:
                let delta = event.hasPreciseScrollingDeltas
                    ? event.scrollingDeltaY
                    : event.scrollingDeltaY * 8
                if delta != 0 { onScroll?(delta, local) }
            case .magnify:
                onMagnify?(event.magnification, local)
            default:
                break
            }
        }
    }
}

// MARK: - Node detail panel

private struct NodeDetailPanel: View {
    let node: CCGraphNode
    let linkCount: Int
    let neighbors: [CCGraphNode]
    let onClose: () -> Void
    let onJump: (CCGraphNode) -> Void

    @State private var detail: NodeDetail = .empty

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle().fill(CCTheme.hairline).frame(height: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let headline = detail.headline {
                        Text(headline)
                            .font(.system(size: 12.5))
                            .foregroundStyle(CCTheme.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(CCTheme.cardBackground)
                                    .overlay(RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(CCTheme.hairline, lineWidth: 1))
                            )
                    }

                    if !neighbors.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            sectionLabel("CONNECTIONS")
                            WrapLayout(spacing: 6) {
                                ForEach(neighbors) { neighbor in
                                    connectionChip(neighbor)
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        sectionLabel(node.kind == .topic ? "MENTIONS" : "CONTENT")
                        Text(detail.body)
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(CCTheme.textSecondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(18)
            }
        }
        .frame(width: 360)
        .frame(maxHeight: .infinity)
        .background(CCTheme.sidebarBackground)
        .overlay(alignment: .leading) {
            Rectangle().fill(CCTheme.hairline).frame(width: 1)
        }
        .onAppear { detail = NodeDetail.load(node) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(node.label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(CCTheme.textPrimary)
                    .lineLimit(2)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(CCTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 8) {
                typeBadge
                Text("\(linkCount) link\(linkCount == 1 ? "" : "s")")
                    .font(.system(size: 10.5))
                    .foregroundStyle(CCTheme.textTertiary)
                if let meta = detail.meta {
                    Text("·").foregroundStyle(CCTheme.textTertiary)
                    Text(meta)
                        .font(.system(size: 10.5))
                        .foregroundStyle(CCTheme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 48)
        .padding(.bottom, 12)
    }

    private var typeBadge: some View {
        let (label, color): (String, Color) = {
            switch node.kind {
            case .note: return ("Note", CCTheme.accent)
            case .skill: return ("Skill", Color(hex: 0xB15EFF))
            case .topic: return ("Topic", CCTheme.textTertiary)
            }
        }()
        return HStack(spacing: 5) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(CCTheme.textSecondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(color.opacity(0.12)))
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9.5, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(CCTheme.textTertiary)
    }

    private func connectionChip(_ neighbor: CCGraphNode) -> some View {
        Button { onJump(neighbor) } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(neighbor.kind == .skill ? Color(hex: 0xB15EFF)
                          : neighbor.kind == .note ? CCTheme.accent : CCTheme.textTertiary)
                    .frame(width: 5, height: 5)
                Text(neighbor.label)
                    .font(.system(size: 11))
                    .foregroundStyle(CCTheme.textPrimary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 4.5)
            .background(
                Capsule()
                    .fill(CCTheme.cardBackground)
                    .overlay(Capsule().strokeBorder(CCTheme.hairline, lineWidth: 1))
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Detail content loading

/// What the panel shows for a node, read fresh from ~/.notch when it opens.
private struct NodeDetail {
    var headline: String?     // skill description pulled from its comment header
    var body: String
    var meta: String?         // "3d · ~/.notch/skills/foo.sh"

    static let empty = NodeDetail(headline: nil, body: "", meta: nil)

    static func load(_ node: CCGraphNode) -> NodeDetail {
        switch node.kind {
        case .topic:
            return NodeDetail(headline: nil, body: topicMentions(node), meta: nil)
        case .note, .skill:
            guard let url = node.fileURL, let text = safeRead(url) else {
                return NodeDetail(headline: nil, body: "File missing or unreadable.", meta: nil)
            }
            let headline = node.kind == .skill ? skillHeader(text) : nil
            return NodeDetail(headline: headline, body: cap(text), meta: fileMeta(url))
        }
    }

    /// Reads only inside ~/.notch so a crafted node can never escape the vault.
    private static func safeRead(_ url: URL) -> String? {
        let vault = CommandCenterData.notchDir.standardizedFileURL.path
        guard url.standardizedFileURL.path.hasPrefix(vault) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    /// The leading `#` comment block of a shell script, shebang excluded.
    private static func skillHeader(_ source: String) -> String? {
        var lines: [String] = []
        for raw in source.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#!") { continue }
            if line.hasPrefix("#") {
                lines.append(String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
            } else if line.isEmpty && lines.isEmpty {
                continue
            } else {
                break
            }
        }
        let header = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return header.isEmpty ? nil : header
    }

    /// For phantom topic nodes: every line in the vault that wikilinks them.
    private static func topicMentions(_ node: CCGraphNode) -> String {
        let fm = FileManager.default
        let dir = CommandCenterData.notchDir
        var files: [URL] = []
        if let md = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
            files += md.filter { $0.pathExtension == "md" }
        }
        let skillsDir = dir.appendingPathComponent("skills", isDirectory: true)
        if let sh = try? fm.contentsOfDirectory(at: skillsDir, includingPropertiesForKeys: nil) {
            files += sh.filter { !$0.lastPathComponent.hasPrefix(".") }
        }

        let needle = "[[\(node.id)"
        var sections: [String] = []
        for url in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard let text = safeRead(url) else { continue }
            let hits = text.components(separatedBy: "\n")
                .filter { $0.lowercased().contains(needle) }
                .map { "  " + $0.trimmingCharacters(in: .whitespaces) }
            if !hits.isEmpty {
                sections.append("◆ \(url.lastPathComponent)\n" + hits.joined(separator: "\n"))
            }
        }
        if sections.isEmpty {
            return "No file for this node — it only exists as a [[wikilink]] target."
        }
        return "This topic has no file of its own. Linked from:\n\n"
            + sections.joined(separator: "\n\n")
    }

    private static func fileMeta(_ url: URL) -> String {
        var parts: [String] = []
        if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
           let date = attrs[.modificationDate] as? Date {
            parts.append("edited \(CCFormat.relative(date))")
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var display = url.path
        if display.hasPrefix(home) { display = "~" + display.dropFirst(home.count) }
        parts.append(display)
        return parts.joined(separator: " · ")
    }

    private static func cap(_ text: String, limit: Int = 20_000) -> String {
        text.count > limit ? String(text.prefix(limit)) + "\n…\n(truncated)" : text
    }
}

// MARK: - Wrapping chip layout

/// Minimal left-to-right wrapping layout for the connection chips.
private struct WrapLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrange(width: bounds.width, subviews: subviews).frames
        for (frame, subview) in zip(frames, subviews) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (frames, CGSize(width: width.isFinite ? width : x, height: y + rowHeight))
    }
}
