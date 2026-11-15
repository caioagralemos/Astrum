// The owner's readings as Me lists them: one per signal, the current value by
// the hub's rule, judged against their own usual (the hub's evidence card
// first, then the baseline), marked when part of an alert, and the air of the
// room they are in judged against NASA's two CO2 levels.

import Foundation

/// Where a value sits, in words. Never shown by colour alone.
enum Standing: Hashable, Sendable {
    case within
    case above
    case below
    /// Not enough history to compare yet.
    case unknown
    /// CO2 under NASA's 2.8 mmHg level.
    case airOK
    /// CO2 between NASA's 2.8 and 3 mmHg.
    case airWatch
    /// CO2 over NASA's 3 mmHg limit.
    case airOver
    /// No current reading (Freshness.swift): a gap, never compared with the usual or NASA's levels.
    case notCurrent

    var isOutside: Bool { self == .above || self == .below || self == .airWatch || self == .airOver }

    /// For a row and VoiceOver: "within your usual", "over NASA's 3 mmHg limit".
    var words: String {
        switch self {
        case .within: String(localized: "within your usual")
        case .above: String(localized: "above your usual")
        case .below: String(localized: "below your usual")
        case .unknown: String(localized: "not enough history to compare yet")
        case .airOK: String(localized: "below NASA's 2.8 mmHg level")
        case .airWatch: String(localized: "between NASA's 2.8 and 3 mmHg levels")
        case .airOver: String(localized: "over NASA's 3 mmHg limit")
        case .notCurrent: String(localized: "no current reading")
        }
    }

    /// A short badge for a row, or nil when nothing needs saying.
    var badge: String? {
        switch self {
        case .above: String(localized: "Above usual")
        case .below: String(localized: "Below usual")
        case .airWatch: String(localized: "Near NASA's limit")
        case .airOver: String(localized: "Over NASA's limit")
        default: nil
        }
    }
}

struct Reading: Identifiable, Hashable, Sendable {
    let row: Row
    let region: BodyRegion?
    let baseline: SignalBaseline?
    let standing: Standing
    /// Part of an alert the owner is told about.
    let inAlert: Bool
    let stale: Bool

    var id: String { row.signal }
    var signal: String { row.signal }
    var name: String { Signals.name(row.signal) }
    var isMarked: Bool { standing.isOutside || inAlert }

    /// "Heart rate, 63 bpm, Measured, within your usual." Not current: "Heart rate, no current reading, last at 14:05."
    var spoken: String {
        var parts = stale ? [name, standing.words] : [name, Signals.text(row), Signals.kindName(row.kind), standing.words]
        if stale { parts.append(String(localized: "last reading: \(ChatTimeline.short(row.date))")) }
        // NASA's figure is said beside the usual, never left out for it.
        if !stale, signal == "exercise_minutes", let minutes = row.value {
            parts.append(String(localized: "\(Int(minutes.rounded())) of NASA's 90 minutes a day"))
        }
        if inAlert { parts.append(String(localized: "part of an alert")) }
        return parts.joined(separator: ", ")
    }
}

enum Readings {
    /// Every current reading of the owner, in list order.
    static func build(world: HubWorld, historyRows: [Row], baselines: [String: SignalBaseline], person: String, now: Double) -> [Reading] {
        guard !person.isEmpty else { return [] }
        var rows = world.currentRows(of: person, now: now)
        // A signal the hub no longer holds in `latest` still has its newest row in the history.
        let held = Set(rows.map(\.signal))
        for (signal, list) in Dictionary(grouping: historyRows, by: \.signal) where !held.contains(signal) {
            if let newest = list.max(by: { $0.t < $1.t }) { rows.append(newest) }
        }
        rows.removeAll { $0.signal == "checkin.note" }

        let evidence = world.evidence[person]
        let alerts = world.visibleAlerts(to: person).filter { $0.person == person }
        var readings = rows.map { row -> Reading in
            let baseline = baselines[row.signal]
            let stale = Signals.isStale(row, now: now)
            return Reading(
                row: row, region: Signals.region(of: row.signal), baseline: baseline,
                standing: stale ? .notCurrent : standing(of: row.signal, evidence: evidence, baseline: baseline),
                inAlert: alerts.contains { $0.signal == row.signal },
                stale: stale
            )
        }
        if let air = roomAir(world: world, person: person, now: now, alerts: alerts) { readings.append(air) }
        return readings.sorted { Signals.order(of: $0.signal) < Signals.order(of: $1.signal) }
    }

    /// The CO2 of the room the owner is in, against NASA's levels.
    private static func roomAir(world: HubWorld, person: String, now: Double, alerts: [HubAlert]) -> Reading? {
        guard let room = world.room(of: person),
              let co2 = world.currentRows(inRoom: room, now: now).first(where: { $0.signal == "co2" }),
              let value = co2.value else { return nil }
        let stale = Signals.isStale(co2, now: now)
        let standing: Standing = stale ? .notCurrent : value > Signals.co2Limit ? .airOver : value >= Signals.co2HeadacheLevel ? .airWatch : .airOK
        return Reading(
            row: co2, region: .lungs, baseline: nil, standing: standing,
            inAlert: alerts.contains { $0.reason == "room-limit" && $0.room == room },
            stale: stale
        )
    }

    /// The hub's evidence card speaks first; the baseline when it says nothing.
    static func standing(of signal: String, evidence: Evidence?, baseline: SignalBaseline?) -> Standing {
        if let found = evidence?.unusual.signals.first(where: { $0.signal == signal }) {
            if found.direction == "high" { return .above }
            if found.direction == "low" { return .below }
        }
        guard let judged = baseline?.judged else { return .unknown }
        if judged.unusual { return judged.direction == "high" ? .above : .below }
        return .within
    }

    /// The regions with something outside the usual or part of an alert.
    static func markedRegions(_ readings: [Reading], alerts: [HubAlert], person: String) -> Set<BodyRegion> {
        var marked = Set(readings.filter(\.isMarked).compactMap(\.region))
        for alert in alerts where alert.person == person {
            if alert.reason == "room-limit" { marked.insert(.lungs) }
            if let region = region(of: alert, person: person) { marked.insert(region) }
        }
        return marked
    }

    /// The regions drawn in the danger colour: a level 3 alert of the owner's belongs to them.
    /// Every other marked region is drawn in the watch colour (hub/ui/src/person/regions.ts).
    static func dangerRegions(alerts: [HubAlert], person: String) -> Set<BodyRegion> {
        Set(alerts.filter { $0.level >= 3 }.compactMap { region(of: $0, person: person) })
    }

    /// The region of the owner's body an alert belongs to: the air of a room is Lungs and air,
    /// a reading its own region, a card's match the region its card is about. None for someone
    /// else's alert or one with no reading or card behind it.
    static func region(of alert: HubAlert, person: String) -> BodyRegion? {
        guard alert.person == person else { return nil }
        if let card = AlertText.findingCard(alert) { return AlertText.region(ofCard: card) }
        return alert.reason == "room-limit" ? .lungs : Signals.region(of: alert.signal)
    }
}
