// The hub dock's widget look, for the phone (hub/ui/src/dock/widgets.tsx and
// the .widget-card / .dw rules in hub/ui/src/app.css): a neutral rounded card,
// a grey small-caps header (what it is on the left, how its numbers came to
// exist on the right), white light numbers, and colour only inside the data,
// always beside words. Widgets sit in a two-column grid that becomes one
// column at accessibility text sizes.

import SwiftUI

/// The hub's colours for the dock (app.css): the washed status tones and the greys.
enum HubStyle {
    /// --soft-ok, --soft-watch, --soft-over: the status colours mixed towards grey.
    static let ok = Color(red: 115 / 255, green: 159 / 255, blue: 224 / 255)
    static let watch = Color(red: 212 / 255, green: 183 / 255, blue: 110 / 255)
    static let over = Color(red: 221 / 255, green: 115 / 255, blue: 108 / 255)
    /// rgb(235 235 245 / 0.55): headers, labels, the secondary words.
    static let muted = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.55)
    /// rgb(28 28 30): the card.
    static let card = Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255)
}

extension EnvironmentValues {
    /// Set when the widget spans the whole width, so it can show what the hub
    /// shows only on larger cards (.dw-not-quarter).
    @Entry var widgetIsWide = false
}

/// One widget: the card and its header, the content under it.
struct WidgetCard<Content: View>: View {
    let icon: HubIconName
    let title: String
    /// How the numbers came to exist, as the hub's marks with their words.
    var kinds: [Kind] = []
    /// Said in place of the kinds, e.g. "4 on board".
    var note: String?
    var noteTone: Color?
    /// The hub outlines a widget that is showing a problem.
    var problem = false
    @ViewBuilder let content: Content

    private let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            content
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(shape.fill(HubStyle.card))
        .overlay(shape.strokeBorder(problem ? HubStyle.over.opacity(0.55) : .white.opacity(0.12), lineWidth: problem ? 1 : 0.5))
        .contentShape(shape)
    }

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                titleLine
                Spacer(minLength: 6)
                right
            }
            VStack(alignment: .leading, spacing: 4) {
                titleLine
                right
            }
        }
        .foregroundStyle(HubStyle.muted)
    }

    private var titleLine: some View {
        HStack(spacing: 6) {
            HubIcon(icon, size: 14.4, weight: 2, relativeTo: .caption2)
            Text(title)
                .font(.caption2.weight(.semibold))
                .tracking(0.44)
                .textCase(.uppercase)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    @ViewBuilder
    private var right: some View {
        if let note {
            Text(note)
                .font(.caption2.weight(.medium))
                .foregroundStyle(noteTone ?? HubStyle.muted)
                .lineLimit(1)
        } else if !kinds.isEmpty {
            KindLegend(kinds: kinds)
        }
    }
}

/// The hub's kind mark: a small shape for each way a value came to exist
/// (.kind-mark in app.css). Always shown with its word, never alone.
struct KindMark: View {
    let kind: Kind
    @ScaledMetric(relativeTo: .caption2) private var side: CGFloat = 7

    var body: some View {
        mark
            .frame(width: side, height: side)
            .opacity(0.85)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var mark: some View {
        let line = 1.5 * side / 7
        switch kind {
        case .measured:
            Circle().fill()
        case .replayed:
            Circle().strokeBorder(lineWidth: line)
                .background(Circle().fill().mask(HStack(spacing: 0) { Color.black; Color.clear }))
        case .estimated:
            Circle().strokeBorder(style: StrokeStyle(lineWidth: line, dash: [line * 1.2, line]))
        case .reported:
            RoundedRectangle(cornerRadius: 1).fill()
        case .simulated:
            Circle().strokeBorder(lineWidth: line)
        }
    }
}

/// The kinds on a widget, each its mark and its word (the hub's KindKey).
struct KindLegend: View {
    let kinds: [Kind]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(kinds.sorted(), id: \.self) { kind in
                HStack(spacing: 4) {
                    KindMark(kind: kind)
                    Text(Signals.kindName(kind))
                }
            }
        }
        .font(.caption2.weight(.medium))
        .lineLimit(1)
    }
}

/// The hub's big number (.dw-big): light, white, tabular, sized with the text.
struct BigNumber: View {
    let text: String
    var unit: String?
    var color: Color = .white
    @ScaledMetric private var size: CGFloat
    @ScaledMetric(relativeTo: .subheadline) private var unitSize: CGFloat = 14

    init(_ text: String, unit: String? = nil, color: Color = .white, size: CGFloat = 40) {
        self.text = text
        self.unit = unit
        self.color = color
        _size = ScaledMetric(wrappedValue: size, relativeTo: .largeTitle)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(text)
                .font(.system(size: size, weight: .ultraLight).monospacedDigit())
                .tracking(-0.04 * size)
                .foregroundStyle(color)
            if let unit, !unit.isEmpty {
                Text(unit)
                    .font(.system(size: unitSize))
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

/// A thin track filled from the left (.dw-track).
struct WidgetTrack: View {
    let fraction: Double
    var midMark = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.1))
                Capsule().fill(.white.opacity(0.8))
                    .frame(width: proxy.size.width * min(1, max(0, fraction)))
                if midMark {
                    Rectangle().fill(.white.opacity(0.35))
                        .frame(width: 1, height: 8)
                        .position(x: proxy.size.width / 2, y: 2)
                }
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// The widgets of a screen: two columns, one at accessibility text sizes.
/// A wide widget takes a whole row, as does a half one left without a partner.
struct WidgetGrid: View {
    struct Item: Identifiable {
        let id: String
        let wide: Bool
        let view: AnyView

        init<V: View>(_ id: String, wide: Bool = false, @ViewBuilder _ view: () -> V) {
            self.id = id
            self.wide = wide
            self.view = AnyView(view())
        }
    }

    let items: [Item]
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(spacing: 12) {
            ForEach(rows, id: \.first?.id) { row in
                HStack(alignment: .top, spacing: 12) {
                    ForEach(row) { item in
                        item.view
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .environment(\.widgetIsWide, row.count == 1)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var rows: [[Item]] {
        if typeSize.isAccessibilitySize { return items.map { [$0] } }
        var rows: [[Item]] = []
        var waiting: Item?
        for item in items {
            if item.wide {
                if let first = waiting { rows.append([first]) }
                waiting = nil
                rows.append([item])
            } else if let first = waiting {
                rows.append([first, item])
                waiting = nil
            } else {
                waiting = item
            }
        }
        if let waiting { rows.append([waiting]) }
        return rows
    }
}
