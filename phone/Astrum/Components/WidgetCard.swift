// The hub dock's widget look, for the phone (hub/ui/src/dock/widgets.tsx and
// the .dw rules in hub/ui/src/app.css): the projection frame, a clear header
// (the hub's icon and a sentence-case title on the left, how its numbers came
// to exist on the right), white light numbers, and colour only inside the
// data, always beside words. Widgets sit in a two-column grid that becomes one
// column at accessibility text sizes.

import SwiftUI

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
    @ScaledMetric(relativeTo: .subheadline) private var noteSize: CGFloat = 15

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            content
        }
        .padding(EdgeInsets(top: 14, leading: 20, bottom: 16, trailing: 20))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .projectionFrame(problem: problem)
    }

    /// The dock's header: the title wraps rather than shrinks; what is on the right drops under it when it does not fit.
    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 8) {
                ProjectionHeader(icon, title, size: .widget)
                    .lineLimit(1)
                Spacer(minLength: 6)
                right
            }
            VStack(alignment: .leading, spacing: 4) {
                ProjectionHeader(icon, title, size: .widget)
                    .lineLimit(2)
                right
            }
        }
    }

    @ViewBuilder
    private var right: some View {
        if let note {
            Text(note)
                .font(.system(size: noteSize))
                .foregroundStyle(noteTone ?? .white)
                .lineLimit(1)
        } else if !kinds.isEmpty {
            KindLegend(kinds: kinds)
                .foregroundStyle(.white)
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
        .font(.footnote)
        .lineLimit(1)
    }
}

/// The hub's big number (.dw-word, .dw-stat-value): light, white, tabular, sized with the text; its unit beside it.
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
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(text)
                .font(.system(size: size, weight: .light).monospacedDigit())
                .tracking(-0.02 * size)
                .foregroundStyle(color)
                .numericMotion(text)
            if let unit, !unit.isEmpty {
                Text(unit)
                    .font(.system(size: unitSize))
                    .foregroundStyle(HubStyle.muted)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.08))
                Capsule().fill(.white.opacity(0.75))
                    .frame(width: proxy.size.width * min(1, max(0, fraction)))
                    .animation(Motion.movement(Motion.content, reduceMotion), value: fraction)
                if midMark {
                    Rectangle().fill(HubStyle.faint)
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
