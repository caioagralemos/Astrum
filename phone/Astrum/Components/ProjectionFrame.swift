// The projection: the one surface the hub draws every card, sheet and panel
// with (NASA/PROJECTION-SPEC.md, the --w-* tokens in hub/ui/src/app.css), for
// the phone. A dark tint under a barely there grid, a faint full outline, and
// brighter, heavier rounded corner brackets a hair apart from it. Monochrome:
// colour lives only in the data and the status, always beside words.
//
// One drawing (ProjectionDrawing) serves both a whole card (projectionFrame)
// and the rows of a list section (ProjectionSection), where each row draws its
// slice of one tall frame, so a section reads as one card while the list keeps
// its rows, taps and VoiceOver order.

import SwiftUI

/// The hub's inks and the projection's measurements, in one place.
enum HubStyle {
    // MARK: Status and data (washed towards grey, as the hub's --soft-*)

    static let ok = Color(red: 115 / 255, green: 159 / 255, blue: 224 / 255)
    static let watch = Color(red: 212 / 255, green: 183 / 255, blue: 110 / 255)
    static let over = Color(red: 221 / 255, green: 115 / 255, blue: 108 / 255)

    // MARK: Ink (white at the hub's strengths)

    /// Quiet words: sub-labels, axis marks, units.
    static let muted = Color.white.opacity(0.86)
    /// The faintest marks.
    static let faint = Color.white.opacity(0.68)

    // MARK: The surface

    /// rgb(8 9 11) at 66 %: the tint inside every frame.
    static let fill = Color(red: 8 / 255, green: 9 / 255, blue: 11 / 255).opacity(0.66)
    /// #0f1114: the tint made solid (Reduce Transparency, Increase Contrast).
    static let solidFill = Color(red: 15 / 255, green: 17 / 255, blue: 20 / 255)
    /// The clip radius; the drawn corner arcs sit at `arcRadius` on the stroke's centre.
    static let radius: CGFloat = 11
    static let arcRadius: CGFloat = 10
    /// The full outline: 1 pt, white at 72 %, stopping `edgeStart` from each corner.
    static let edgeWidth: CGFloat = 1
    static let edgeOpacity = 0.72
    static let edgeStart: CGFloat = 18
    /// The corner brackets: 1.75 pt, white, round caps, reaching 14 along both edges.
    static let bracketWidth: CGFloat = 1.75
    static let bracketReach: CGFloat = 14
    /// The grid: 21 pt squares of 1 pt lines, white at 3.5 %, from the top-left corner.
    static let gridCell: CGFloat = 21
    static let gridOpacity = 0.035
    /// Hairlines between rows and blocks: 1 pt, white at 30 % (50 % with more contrast).
    static let hairline = 0.3
    static let hairlineStrong = 0.5
    /// Inner cards (a card inside a framed card): no fill, a 16 % outline.
    static let innerLine = 0.16
    static let innerRadius: CGFloat = 6
    /// Controls (buttons, fields): radius 4, white at 12 % (6 % for fields).
    static let controlRadius: CGFloat = 4
    static let controlFill = 0.12
    static let fieldFill = 0.06

    // MARK: Lists

    /// How far a list section's frame sits inside the row's own edges, so the
    /// brackets stay clear of the corner the system rounds inset-grouped rows with.
    static let listInset: CGFloat = 5
    /// From the frame to the row's words, sideways.
    static let rowPadding: CGFloat = 15
    /// Between rows, and the extra room under the top and over the bottom edge.
    static let rowVertical: CGFloat = 10
    static let rowCap: CGFloat = 5
}

extension EnvironmentValues {
    /// How far a list's frames sit inside its rows sideways: the inset-grouped
    /// lists keep `HubStyle.listInset`; a plain list sets its own margin.
    @Entry var projectionListInset: CGFloat = HubStyle.listInset
}

// MARK: The drawing

/// Draws the projection for `card` (in the canvas's coordinates); only what
/// falls inside the canvas shows, so a row can draw its slice of a taller card.
struct ProjectionDrawing {
    var solid = false
    var strong = false
    /// The y of a hairline across the card from padding to padding, if any.
    var divider: CGFloat?

    func draw(_ context: GraphicsContext, size: CGSize, card: CGRect) {
        var context = context
        let white = Color.white
        let clip = Path(roundedRect: card, cornerRadius: HubStyle.radius, style: .circular)
        let bounds = CGRect(origin: .zero, size: size)
        context.clip(to: Path(bounds))

        // Tint.
        context.fill(clip, with: .color(solid ? HubStyle.solidFill : HubStyle.fill))

        // Grid, only the lines in view, clipped to the card.
        if !strong {
            var grid = Path()
            let cell = HubStyle.gridCell
            let top = max(card.minY, bounds.minY), bottom = min(card.maxY, bounds.maxY)
            var x = card.minX
            while x <= card.maxX {
                grid.addRect(CGRect(x: x, y: top, width: 1, height: max(0, bottom - top)))
                x += cell
            }
            // Rows of the grid start at the card's top, or at the canvas's top for a slice.
            var y = max(card.minY, bounds.minY)
            while y <= bottom {
                grid.addRect(CGRect(x: card.minX, y: y, width: card.width, height: 1))
                y += cell
            }
            var clipped = context
            clipped.clip(to: clip)
            clipped.fill(grid, with: .color(white.opacity(HubStyle.gridOpacity)))
        }

        if let divider {
            let line = CGRect(x: card.minX + HubStyle.rowPadding, y: divider,
                              width: card.width - 2 * HubStyle.rowPadding, height: 1)
            context.fill(Path(line), with: .color(white.opacity(strong ? HubStyle.hairlineStrong : HubStyle.hairline)))
        }

        // The full outline, apart from the corners.
        let s = HubStyle.edgeStart, half = HubStyle.edgeWidth / 2
        var edges = Path()
        edges.move(to: CGPoint(x: card.minX + s, y: card.minY + half))
        edges.addLine(to: CGPoint(x: card.maxX - s, y: card.minY + half))
        edges.move(to: CGPoint(x: card.maxX - half, y: card.minY + s))
        edges.addLine(to: CGPoint(x: card.maxX - half, y: card.maxY - s))
        edges.move(to: CGPoint(x: card.maxX - s, y: card.maxY - half))
        edges.addLine(to: CGPoint(x: card.minX + s, y: card.maxY - half))
        edges.move(to: CGPoint(x: card.minX + half, y: card.maxY - s))
        edges.addLine(to: CGPoint(x: card.minX + half, y: card.minY + s))
        context.stroke(edges, with: .color(white.opacity(strong ? 1 : HubStyle.edgeOpacity)), lineWidth: HubStyle.edgeWidth)

        // The corners: a 10 arc on the stroke's centre, then a short straight, 14 along each edge.
        let w = HubStyle.bracketWidth / 2, reach = HubStyle.bracketReach
        let inner = card.insetBy(dx: w, dy: w)
        var brackets = Path()
        func corner(_ c: CGPoint, _ a: CGPoint, _ b: CGPoint) {
            brackets.move(to: a)
            brackets.addArc(tangent1End: c, tangent2End: b, radius: HubStyle.arcRadius)
            brackets.addLine(to: b)
        }
        corner(CGPoint(x: inner.minX, y: inner.minY),
               CGPoint(x: inner.minX, y: card.minY + reach), CGPoint(x: card.minX + reach, y: inner.minY))
        corner(CGPoint(x: inner.maxX, y: inner.minY),
               CGPoint(x: card.maxX - reach, y: inner.minY), CGPoint(x: inner.maxX, y: card.minY + reach))
        corner(CGPoint(x: inner.maxX, y: inner.maxY),
               CGPoint(x: inner.maxX, y: card.maxY - reach), CGPoint(x: card.maxX - reach, y: inner.maxY))
        corner(CGPoint(x: inner.minX, y: inner.maxY),
               CGPoint(x: card.minX + reach, y: inner.maxY), CGPoint(x: inner.minX, y: card.maxY - reach))
        context.stroke(brackets, with: .color(white),
                       style: StrokeStyle(lineWidth: HubStyle.bracketWidth, lineCap: .round, lineJoin: .round))
    }
}

/// The surface behind a whole card.
private struct ProjectionCanvas: View {
    var problem = false
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        let strong = contrast == .increased
        Canvas { context, size in
            ProjectionDrawing(solid: strong || reduceTransparency, strong: strong)
                .draw(context, size: size, card: CGRect(origin: .zero, size: size))
        }
        .overlay {
            // The hub outlines a card that is showing a problem.
            if problem {
                RoundedRectangle(cornerRadius: HubStyle.radius - 3, style: .circular)
                    .strokeBorder(HubStyle.over.opacity(0.55), lineWidth: 1)
                    .padding(3)
            }
        }
        .accessibilityHidden(true)
    }
}

extension View {
    /// Draws the projection behind and around this view. Padding is the caller's.
    func projectionFrame(problem: Bool = false) -> some View {
        background(ProjectionCanvas(problem: problem))
            .contentShape(RoundedRectangle(cornerRadius: HubStyle.radius, style: .circular))
    }

    /// A card's content in the frame with the hub's card padding (14 top, 20 sides, 16 bottom).
    func projectionCard(problem: Bool = false) -> some View {
        padding(EdgeInsets(top: 14, leading: 20, bottom: 16, trailing: 20))
            .frame(maxWidth: .infinity, alignment: .leading)
            .projectionFrame(problem: problem)
    }

    /// A card inside a framed card: no fill, a faint outline.
    func projectionInnerCard() -> some View {
        padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: HubStyle.innerRadius, style: .circular)
                .strokeBorder(.white.opacity(HubStyle.innerLine), lineWidth: 1))
    }

    /// A text field as the hub draws one: a faint fill, radius 4.
    func projectionField() -> some View {
        padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: HubStyle.controlRadius, style: .circular)
                .fill(.white.opacity(HubStyle.fieldFill)))
    }
}

// MARK: Lists

/// Where a row sits in its framed section.
enum ProjectionRowPosition {
    case only, first, middle, last

    var isFirst: Bool { self == .only || self == .first }
    var isLast: Bool { self == .only || self == .last }
}

/// A row's slice of its section's frame: the top edge and corners on the
/// first row, the bottom ones on the last, the sides and a hairline between.
struct ProjectionRowBackground: View {
    let position: ProjectionRowPosition
    @Environment(\.projectionListInset) private var inset
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        let strong = contrast == .increased
        Canvas { context, size in
            // Past the row's ends, far enough that a row only ever sees the card's sides there.
            let beyond: CGFloat = 40
            let top = position.isFirst ? HubStyle.rowCap : -beyond
            let bottom = position.isLast ? size.height - HubStyle.rowCap : size.height + beyond
            let card = CGRect(x: inset, y: top, width: size.width - 2 * inset, height: bottom - top)
            ProjectionDrawing(solid: strong || reduceTransparency, strong: strong, divider: position.isFirst ? nil : 0)
                .draw(context, size: size, card: card)
        }
        .accessibilityHidden(true)
    }
}

extension View {
    /// This row as part of a framed section (or a framed card on its own):
    /// the frame behind it, the hub's hairline in place of the separator, and
    /// its words kept clear of the frame.
    func projectionRow(_ position: ProjectionRowPosition = .only) -> some View {
        modifier(ProjectionRow(position: position))
    }
}

private struct ProjectionRow: ViewModifier {
    let position: ProjectionRowPosition
    @Environment(\.projectionListInset) private var inset

    func body(content: Content) -> some View {
        let side = inset + HubStyle.rowPadding
        content
            .listRowInsets(EdgeInsets(
                top: HubStyle.rowVertical + (position.isFirst ? HubStyle.rowCap + 2 : 0),
                leading: side,
                bottom: HubStyle.rowVertical + (position.isLast ? HubStyle.rowCap + 2 : 0),
                trailing: side))
            .listRowBackground(ProjectionRowBackground(position: position))
            .listRowSeparator(.hidden)
    }
}

/// A list section drawn as one projection card: every row it holds (however
/// they are built: ForEach, conditions, nested views) takes its slice of the frame.
struct ProjectionSection<Content: View, Header: View, Footer: View>: View {
    @ViewBuilder let content: Content
    @ViewBuilder let header: Header
    @ViewBuilder let footer: Footer
    @Environment(\.projectionListInset) private var inset

    init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Header, @ViewBuilder footer: () -> Footer) {
        self.content = content()
        self.header = header()
        self.footer = footer()
    }

    var body: some View {
        Section {
            Group(subviews: content) { rows in
                ForEach(rows) { row in
                    row.projectionRow(position(of: row.id, in: rows))
                }
            }
        } header: {
            // Lined up with the rows' words (the system already does so in an inset-grouped list).
            header.padding(.leading, max(0, inset + HubStyle.rowPadding - 20))
        } footer: {
            footer
        }
    }

    private func position(of id: Subview.ID, in rows: SubviewsCollection) -> ProjectionRowPosition {
        let first = rows.first?.id == id, last = rows.last?.id == id
        return first && last ? .only : first ? .first : last ? .last : .middle
    }
}

extension ProjectionSection where Footer == EmptyView {
    init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Header) {
        self.init(content: content, header: header, footer: { EmptyView() })
    }
}

extension ProjectionSection where Header == EmptyView, Footer == EmptyView {
    init(@ViewBuilder content: () -> Content) {
        self.init(content: content, header: { EmptyView() }, footer: { EmptyView() })
    }
}

extension ProjectionSection where Header == EmptyView {
    init(@ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.init(content: content, header: { EmptyView() }, footer: footer)
    }
}

// MARK: Headers

/// A header in the hub's anatomy: its icon, then a clear title in sentence case.
/// `.widget` is the dock's (24 icon, 21 title); `.section` the sheets' (18, 16).
struct ProjectionHeader: View {
    enum Size { case widget, section }

    let icon: HubIconName
    let title: Text
    @ScaledMetric private var titleSize: CGFloat
    private let size: Size

    init(_ icon: HubIconName, _ title: LocalizedStringKey, size: Size = .section) {
        self.init(icon, text: Text(title), size: size)
    }

    init<S: StringProtocol>(_ icon: HubIconName, _ title: S, size: Size = .section) {
        self.init(icon, text: Text(title), size: size)
    }

    private init(_ icon: HubIconName, text: Text, size: Size) {
        self.icon = icon
        self.title = text
        self.size = size
        _titleSize = ScaledMetric(wrappedValue: size == .widget ? 21 : 16, relativeTo: size == .widget ? .title3 : .callout)
    }

    var body: some View {
        HStack(spacing: size == .widget ? 10 : 8) {
            HubIcon(icon, size: size == .widget ? 24 : 18, weight: size == .widget ? 1.75 : 1.6,
                    relativeTo: size == .widget ? .title3 : .callout)
            title
                .font(.system(size: titleSize))
        }
        .foregroundStyle(.white)
        .textCase(nil)
    }
}

// MARK: Controls

/// A button as the hub draws one: radius 4; white at 12 %, or solid white with dark words.
struct ProjectionButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        Control(configuration: configuration, prominent: prominent)
    }

    private struct Control: View {
        let configuration: Configuration
        let prominent: Bool
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .foregroundStyle(prominent ? HubStyle.solidFill : .white)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: HubStyle.controlRadius, style: .circular)
                    .fill(prominent ? Color.white : Color.white.opacity(HubStyle.controlFill)))
                .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
                .contentShape(RoundedRectangle(cornerRadius: HubStyle.controlRadius, style: .circular))
                // Pressed: a slight give, then it settles back (only the dim under Reduce Motion).
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
                .animation(Motion.press, value: configuration.isPressed)
        }
    }
}

extension ButtonStyle where Self == ProjectionButtonStyle {
    static var projection: ProjectionButtonStyle { ProjectionButtonStyle() }
    static var projectionProminent: ProjectionButtonStyle { ProjectionButtonStyle(prominent: true) }
}

#Preview("Projection") {
    ScrollView {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                ProjectionHeader(.crew, "Crew", size: .widget)
                Text(verbatim: "Tanaka · Reyes · Okafor · Leo").foregroundStyle(HubStyle.muted)
            }
            .projectionCard()
            Button("Send check-in") {}.buttonStyle(.projectionProminent)
            Button("Send a test alert") {}.buttonStyle(.projection)
        }
        .padding(16)
    }
    .background(Color.black)
    .preferredColorScheme(.dark)
}
