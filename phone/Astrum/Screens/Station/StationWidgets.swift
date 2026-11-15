// The hub dock's station widgets on Station (hub/ui/src/dock/widgets.tsx):
// alerts, Earth, CO2 in every room, the crew, the mission and radiation, fed
// by what the hub sent this phone. A widget whose data the phone does not have
// is left out, never filled in. The sensor board widget is not here: the
// phone is not told whether a board is connected.

import SwiftUI

@MainActor
enum StationWidgets {
    /// The widgets the phone has data for, in order; empty when there are none.
    static func items(world: HubWorld, now: Double) -> [WidgetGrid.Item] {
        var items: [WidgetGrid.Item] = []
        if world.profile != nil {
            items.append(.init("alerts") { AlertsWidget() })
        }
        if let delay = world.profile?.delayToEarthSeconds {
            items.append(.init("earth") { EarthWidget(delayMs: delay * 1000, now: now) })
        }
        if let co2 = CO2Widget.Column.all(world: world, now: now), !co2.isEmpty {
            items.append(.init("co2", wide: true) { CO2Widget(columns: co2) })
        }
        if !world.crew.isEmpty {
            items.append(.init("crew", wide: true) { CrewWidget() })
        }
        if let day = world.missionDay(now: now) {
            items.append(.init("mission") { MissionWidget(day: day) })
        }
        let radiation = RadiationWidget.rows(world: world, now: now)
        if !radiation.isEmpty {
            items.append(.init("radiation") { RadiationWidget(rows: radiation) })
        }
        return items
    }
}

private extension HubWorld {
    func roomName(_ id: String) -> String { Signals.roomName(id, rooms: profile?.rooms ?? []) }
}

// MARK: Alerts

/// Room alarms and the alerts at level 2 or 3 this phone is told about.
private struct AlertsWidget: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let world = model.world
        let shared = model.visibleAlerts.filter { $0.level >= 2 }
        let open = world.alarms.count + shared.count
        let first = shared.first
        let danger = shared.first { $0.level == 3 }
        let tone: Color = open == 0 ? HubStyle.ok : (!world.alarms.isEmpty || first?.level == 3 ? HubStyle.over : HubStyle.watch)
        let sub = open == 0 ? String(localized: "All quiet on board") : String(localized: "open now")
        let line: String = {
            if let first {
                let room = first.room.map(world.roomName)
                let who = room.map { String(localized: "\(world.name(of: first.person)), \($0)") } ?? world.name(of: first.person)
                return String(localized: "\(who): \(levelName(first.level))")
            }
            if let alarm = world.alarms.first { return String(localized: "\(world.roomName(alarm.room)): \(String(localized: "Over the limit"))") }
            return String(localized: "No room over a limit")
        }()

        let card = WidgetCard(icon: .alerts, title: String(localized: "Alerts"), problem: open > 0) {
            VStack(alignment: .leading, spacing: 4) {
                BigNumber("\(open)", color: open == 0 ? .white : tone, size: 48)
                Text(sub)
                    .font(open == 0 ? .subheadline.weight(.semibold) : .caption)
                    .foregroundStyle(open == 0 ? tone : HubStyle.muted)
                Spacer(minLength: 0)
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(first == nil && world.alarms.isEmpty ? 0.5 : 0.7))
            }
        }
        let spoken = [String(localized: "Alerts"), open == 0 ? sub : "\(open) \(sub)", line].joined(separator: ", ")

        if let danger {
            Button { model.openedAlertID = danger.id } label: { card }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(spoken))
                .accessibilityHint(Text("Opens the alert"))
        } else {
            card
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(spoken))
        }
    }

    private func levelName(_ level: Int) -> String {
        level >= 3 ? String(localized: "Dangerous") : String(localized: "Concerning")
    }
}

// MARK: Earth

/// The delay to Earth, or the countdown to the earliest reply to the newest message on its way.
private struct EarthWidget: View {
    @Environment(AppModel.self) private var model
    @Environment(\.widgetIsWide) private var wide
    let delayMs: Double
    let now: Double
    @State private var composing = false

    var body: some View {
        let world = model.world
        let inFlight = world.earthMessages.filter { $0.replyAt > now }.max { $0.sentAt < $1.sentAt }
        let (content, spoken) = parts(inFlight)
        Button { composing = true } label: {
            WidgetCard(icon: .earth, title: String(localized: "Earth")) { content }
        }
        .buttonStyle(.plain)
        .disabled(!model.isConnected || model.person.isEmpty)
        .accessibilityLabel(Text([String(localized: "Earth"), spoken].joined(separator: ", ")))
        .accessibilityHint(Text("Opens Contact Earth"))
        .sheet(isPresented: $composing) { ContactEarthView() }
    }

    private func parts(_ message: EarthMessage?) -> (AnyView, String) {
        if delayMs < 60_000 && message == nil {
            let view = VStack(alignment: .leading, spacing: 6) {
                BigNumber(String(localized: "Live"), size: 36)
                label(String(localized: "No delay: Earth answers at once"))
            }
            return (AnyView(view), [String(localized: "Live"), String(localized: "No delay: Earth answers at once")].joined(separator: ", "))
        }
        if let message {
            let progress = (now - message.sentAt) / max(message.replyAt - message.sentAt, 1)
            let from = message.from.map { model.world.name(of: $0) }
            let view = VStack(alignment: .leading, spacing: 6) {
                label(String(localized: "A reply can arrive in"))
                BigNumber(Self.clock(message.replyAt - now), size: 44)
                WidgetTrack(fraction: progress, midMark: true)
                if wide {
                    HStack {
                        Text("Sent")
                        Spacer()
                        Text("At Earth")
                        Spacer()
                        Text("Reply")
                    }
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.45))
                    .accessibilityHidden(true)
                    if let from { foot(String(localized: "Last message from \(from)")) }
                }
            }
            return (AnyView(view), [String(localized: "A reply can arrive in"), Countdown.text(ms: message.replyAt - now)].joined(separator: " "))
        }
        let minutes = Int((delayMs / 60_000).rounded())
        let view = VStack(alignment: .leading, spacing: 6) {
            BigNumber("\(minutes)", unit: "min", size: 44)
            label(String(localized: "for a message to reach Earth"))
            if wide { foot(String(localized: "A reply takes at least \(Int((2 * delayMs / 60_000).rounded())) min")) }
        }
        return (AnyView(view), String(localized: "A message takes \(Countdown.text(ms: delayMs)) to reach Earth."))
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(HubStyle.muted)
    }

    private func foot(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.white.opacity(0.6))
    }

    /// The hub's countdown: minutes and seconds, "4:05".
    static func clock(_ ms: Double) -> String {
        let seconds = max(0, Int((ms / 1000).rounded()))
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}

// MARK: CO2 in every room

/// Every room's CO2 as a column against NASA's two levels.
private struct CO2Widget: View {
    struct Column: Identifiable {
        let room: String
        let name: String
        let row: Row?

        var id: String { room }
        var value: Double? { row?.value }

        /// One column per room of the station; nil when the hub has not said which rooms there are.
        static func all(world: HubWorld, now: Double) -> [Column]? {
            guard let rooms = world.profile?.rooms else { return nil }
            let columns = rooms.map { room in
                Column(room: room.id, name: world.roomName(room.id),
                       row: world.currentRows(inRoom: room.id, now: now).first { $0.signal == "co2" && $0.value != nil })
            }
            // No reading in any room: nothing to draw.
            return columns.contains { $0.row != nil } ? columns : []
        }
    }

    let columns: [Column]
    @ScaledMetric(relativeTo: .body) private var chartHeight: CGFloat = 120

    private static let low = 1.5
    private static let high = 3.6

    var body: some View {
        let over = columns.filter { ($0.value ?? 0) > Signals.co2Limit }.count
        let kinds = Array(Set(columns.compactMap { $0.row?.kind }))
        let problem = columns.contains { ($0.value ?? 0) >= Signals.co2HeadacheLevel }
        WidgetCard(icon: .co2, title: String(localized: "CO2 in every room"), kinds: kinds,
                   note: over > 0 ? String(localized: "\(over) over the limit") : nil, noteTone: HubStyle.over, problem: problem) {
            chart(showKinds: kinds.count > 1)
                .frame(height: chartHeight)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spoken(over: over)))
    }

    private func chart(showKinds: Bool) -> some View {
        VStack(spacing: 3) {
            HStack(spacing: 8) {
                ForEach(columns) { column in
                    GeometryReader { proxy in
                        ZStack(alignment: .bottom) {
                            RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.white.opacity(0.05))
                            if let value = column.value {
                                RoundedRectangle(cornerRadius: 5, style: .continuous)
                                    .fill(tone(value))
                                    .frame(height: proxy.size.height * Self.y(value))
                            }
                        }
                        .frame(width: min(24, proxy.size.width * 0.7))
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .overlay { levels }
            HStack(spacing: 8) {
                ForEach(columns) { column in
                    HStack(spacing: 3) {
                        Text(column.value.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "–")
                        if showKinds, let kind = column.row?.kind { KindMark(kind: kind).foregroundStyle(HubStyle.muted) }
                    }
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: 8) {
                ForEach(columns) { column in
                    Text(column.name)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.5))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private struct Level: Identifiable {
        let value: Double
        let words: String
        let color: Color
        let strength: Double
        var id: Double { value }
    }

    /// NASA's limit and the headache level as dashed lines across the columns.
    private var levels: some View {
        let levels = [
            Level(value: Signals.co2Limit, words: String(localized: "NASA limit \(Signals.number(Signals.co2Limit))"), color: HubStyle.over, strength: 0.5),
            Level(value: Signals.co2HeadacheLevel, words: String(localized: "headaches \(Signals.number(Signals.co2HeadacheLevel))"), color: HubStyle.watch, strength: 0.4),
        ]
        return GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                ForEach(levels) { level in
                    let top = proxy.size.height * (1 - Self.y(level.value))
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: top))
                        path.addLine(to: CGPoint(x: proxy.size.width, y: top))
                    }
                    .stroke(level.color.opacity(level.strength), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    // The limit's words above its line, the headache level's below its own.
                    Text(level.words)
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.45))
                        .fixedSize()
                        .offset(y: level.value == Signals.co2Limit ? top - 14 : top + 3)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topTrailing)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static func y(_ value: Double) -> Double {
        (min(high, max(low, value)) - low) / (high - low)
    }

    private func tone(_ value: Double) -> Color {
        value > Signals.co2Limit ? HubStyle.over : value >= Signals.co2HeadacheLevel ? HubStyle.watch : .white.opacity(0.75)
    }

    private func spoken(over: Int) -> String {
        var parts = [String(localized: "CO2 in every room")]
        if over > 0 { parts.append(String(localized: "\(over) over the limit")) }
        for column in columns {
            guard let row = column.row, let value = row.value else {
                parts.append("\(column.name), \(String(localized: "No air reading"))")
                continue
            }
            let standing: Standing = value > Signals.co2Limit ? .airOver : value >= Signals.co2HeadacheLevel ? .airWatch : .airOK
            parts.append([column.name, "\(Signals.number(value)) \(row.unit)", standing.words, Signals.kindName(row.kind)].joined(separator: ", "))
        }
        return parts.joined(separator: ". ")
    }
}

// MARK: Crew

/// The crew by name, the room each is in and what the hub shares about them.
private struct CrewWidget: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let world = model.world
        let rows = world.crew.map { member in
            (id: member.id,
             name: member.id == model.person ? String(localized: "\(member.name) (you)") : member.name,
             room: world.room(of: member.id).map(world.roomName),
             state: state(of: member.id),
             help: needsHelp(member.id))
        }
        WidgetCard(icon: .crew, title: String(localized: "Crew"), note: String(localized: "\(world.crew.count) on board"),
                   problem: rows.contains { $0.help }) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            name(row.name)
                            Spacer(minLength: 0)
                            room(row.room)
                            state(row.state, help: row.help)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            name(row.name)
                            room(row.room)
                            state(row.state, help: row.help)
                        }
                    }
                    .frame(minHeight: 28)
                    .padding(.vertical, 2)
                    .overlay(alignment: .top) {
                        if index > 0 { Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5) }
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(([String(localized: "Crew"), String(localized: "\(world.crew.count) on board")]
            + rows.map { [$0.name, $0.room ?? String(localized: "Room unknown"), $0.state].compactMap { $0 }.joined(separator: ", ") })
            .joined(separator: ". ")))
    }

    private func name(_ text: String) -> some View {
        Text(text).font(.subheadline.weight(.medium)).foregroundStyle(.white).lineLimit(1)
    }

    private func room(_ text: String?) -> some View {
        Text(text ?? "–").font(.footnote).foregroundStyle(HubStyle.muted).lineLimit(1)
    }

    @ViewBuilder
    private func state(_ text: String?, help: Bool) -> some View {
        if let text {
            Text(text)
                .font(.caption.weight(help ? .semibold : .regular))
                .foregroundStyle(help ? HubStyle.over : HubStyle.muted)
                .lineLimit(1)
        }
    }

    private func needsHelp(_ person: String) -> Bool {
        model.visibleAlerts.contains { $0.person == person && $0.level == 3 }
    }

    private func state(of person: String) -> String? {
        if needsHelp(person) { return String(localized: "Needs help") }
        switch model.world.activity[person]?.what {
        case "sleeping": return String(localized: "Asleep")
        case "exercising": return String(localized: "Exercising")
        case "eating": return String(localized: "Eating")
        default: return model.world.asleep.contains(person) ? String(localized: "Asleep") : nil
        }
    }
}

// MARK: Mission

/// The mission day, against the days planned, with the gravity and the delay to Earth.
private struct MissionWidget: View {
    @Environment(AppModel.self) private var model
    @Environment(\.widgetIsWide) private var wide
    let day: Int

    var body: some View {
        let profile = model.world.profile
        let planned = profile?.mission?.plannedDays
        let gravity = profile?.mission?.gravity ?? 0
        let gravityText = gravity == 0 ? String(localized: "Weightless") : String(localized: "Gravity \(gravity.formatted()) g")
        let delay = profile?.delayToEarthSeconds
        let delayText = delay.map { $0 < 60 ? String(localized: "Live") : String(localized: "\(Int(($0 / 60).rounded())) min to Earth") }
        let dayText = planned.map { String(localized: "day, of \($0) planned") } ?? String(localized: "day")

        WidgetCard(icon: .mission, title: Self.title(profile)) {
            VStack(alignment: .leading, spacing: 6) {
                BigNumber("\(day)", size: 44)
                Text(dayText).font(.caption).foregroundStyle(HubStyle.muted)
                if let planned, planned > 0 {
                    WidgetTrack(fraction: Double(day) / Double(planned))
                }
                Spacer(minLength: 0)
                HStack {
                    Text(gravityText)
                    if wide, let delayText {
                        Spacer(minLength: 10)
                        Text(delayText)
                    }
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.6))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text([Self.title(profile), "\(day)", dayText, gravityText, delayText].compactMap { $0 }.joined(separator: ", ")))
    }

    /// The mission's own name, else the place's short name (the hub's `place.….short`).
    static func title(_ profile: HubProfile?) -> String {
        if let typed = profile?.mission?.nameText, !typed.isEmpty { return typed }
        switch profile?.place {
        case "place.iss": return String(localized: "Low Earth orbit")
        case "place.base-moon": return String(localized: "Moon base")
        case "place.base-mars": return String(localized: "Mars base")
        case "place.mars-orbit": return String(localized: "Mars orbit")
        default: return Signals.placeName(profile) ?? String(localized: "Mission")
        }
    }
}

// MARK: Radiation

/// The station's average dose rate and each room's, with the label the hub gives it.
private struct RadiationWidget: View {
    struct RoomRow {
        let room: String
        let row: Row?
    }

    let rows: [RoomRow]
    @ScaledMetric(relativeTo: .body) private var barsHeight: CGFloat = 28

    /// Every room's current radiation; empty when no room has one.
    static func rows(world: HubWorld, now: Double) -> [RoomRow] {
        let rows = (world.profile?.rooms ?? []).map { room in
            RoomRow(room: room.id, row: world.currentRows(inRoom: room.id, now: now).first { $0.signal == "radiation" && $0.value != nil })
        }
        return rows.contains { $0.row != nil } ? rows : []
    }

    var body: some View {
        let known = rows.compactMap(\.row)
        let values = known.compactMap(\.value)
        let average = values.reduce(0, +) / Double(max(values.count, 1))
        let top = values.max() ?? 1
        let unit = known.first?.unit == "uGy/day" ? "µGy/d" : known.first?.unit ?? ""
        let kinds = Array(Set(known.map(\.kind)))
        WidgetCard(icon: .radiation, title: String(localized: "Radiation"), kinds: kinds) {
            VStack(alignment: .leading, spacing: 6) {
                BigNumber("\(Int(average.rounded()))", unit: unit)
                Text("station average").font(.caption).foregroundStyle(HubStyle.muted)
                HStack(alignment: .bottom, spacing: 5) {
                    ForEach(rows, id: \.room) { item in
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(.white.opacity(0.4))
                            .frame(height: item.row?.value.map { barsHeight * (0.2 + 0.8 * $0 / max(top, .ulpOfOne)) } ?? 0)
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: barsHeight, alignment: .bottom)
                .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text([String(localized: "Radiation"), "\(Int(average.rounded())) \(unit)", String(localized: "station average"),
                                  kinds.sorted().map(Signals.kindName).joined(separator: ", ")].joined(separator: ", ")))
    }
}
