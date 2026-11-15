// Everything the hub has told the phone, as one value. Messages are applied
// the way hub/ui/src/data.ts applies them: `state` replaces the world, deltas
// (`rows`, `stay`, `alerts`, `evidence`, `clock`...) update their part. The
// whole value is saved to disk, so the app opens on the last data offline.

import Foundation

struct HubWorld: Codable, Sendable {
    var profile: HubProfile?
    /// The newest row per source for every signal and place.
    var latest: [Row] = []
    var stays: [Stay] = []
    var alarms: [HubAlarm] = []
    var alerts: [HubAlert] = []
    var earthMessages: [EarthMessage] = []
    var asleep: [String] = []
    var activity: [String: Activity] = [:]
    var evidence: [String: Evidence] = [:]
    /// The hub's devices. Optional so a world saved before it existed still loads.
    var sources: [HubSource]?
    /// Set while what the hub sends is a simulated scenario.
    var scenario: ScenarioFlag?
    /// Set when the hub said it is restarting; cleared by its next state.
    var restarting: String?
    /// The hub's clock minus this phone's, in milliseconds.
    var clockOffset: Double = 0
    /// This phone's clock when the last message arrived, in milliseconds.
    var heardAt: Double = 0
    /// When the last message arrived, for "showing data from 14:05".
    var receivedAt: Date?

    var hasData: Bool { profile != nil }

    /// Applies one hub message. `local` is when it arrived on this phone.
    mutating func apply(_ message: HubIncoming, at local: Date) {
        let localMs = local.timeIntervalSince1970 * 1000
        heardAt = localMs
        receivedAt = local
        // Follow the hub's own clock, never a scenario's.
        if message.scenario == nil, message.type == "state" || message.type == "clock", let now = message.now {
            clockOffset = now - localMs
        }

        switch message.type {
        case "state":
            profile = message.profile ?? profile
            latest = message.latest ?? []
            stays = message.stays ?? []
            alarms = message.alarms ?? []
            alerts = message.alerts ?? []
            earthMessages = message.earthMessages ?? []
            asleep = message.asleep ?? []
            activity = message.activity ?? [:]
            evidence = message.evidenceByPerson ?? [:]
            sources = message.sources
            restarting = nil
        case "rows":
            merge(rows: message.rows ?? [])
        case "stay":
            merge(stays: message.stays ?? [])
        case "alarms":
            alarms = message.alarms ?? alarms
        case "alerts":
            alerts = message.alerts ?? alerts
        case "earth":
            earthMessages = message.earthMessages ?? earthMessages
        case "asleep":
            asleep = message.asleep ?? asleep
        case "activity":
            activity = message.activity ?? activity
        case "evidence":
            if let person = message.person, let card = message.evidence { evidence[person] = card }
        case "sources":
            sources = message.sources ?? sources
        case "restarting":
            restarting = message.to ?? ""
        default:
            break
        }
        scenario = message.scenario
    }

    private mutating func merge(rows: [Row]) {
        var byKey = Dictionary(latest.map { ("\(Timeline.scope(of: $0))|\($0.source)", $0) }, uniquingKeysWith: { $1 })
        for row in rows {
            let key = "\(Timeline.scope(of: row))|\(row.source)"
            if let held = byKey[key], row.t < held.t { continue }
            byKey[key] = row
        }
        latest = Array(byKey.values)
    }

    private mutating func merge(stays incoming: [Stay]) {
        func key(_ stay: Stay) -> String { stay.id.map(String.init) ?? "\(stay.person)|\(stay.from)" }
        var byKey = Dictionary(stays.map { (key($0), $0) }, uniquingKeysWith: { $1 })
        for stay in incoming { byKey[key(stay)] = stay }
        stays = Array(byKey.values)
    }

    /// The hub's clock at a moment on this phone's clock, in milliseconds.
    func now(at local: Date) -> Double {
        Timeline.screenNow(local: local.timeIntervalSince1970 * 1000, offset: clockOffset, scenario: scenario, heardAt: heardAt)
    }
}

// MARK: Questions the screens ask

extension HubWorld {
    var crew: [CrewMember] { profile?.crew ?? [] }

    func name(of person: String) -> String {
        crew.first { $0.id == person }?.name ?? person
    }

    /// The room a crewmate is in now: their open stay, the newest if there are several.
    func room(of person: String) -> String? {
        stays.filter { $0.person == person && $0.until == nil }.max { $0.from < $1.from }?.room
    }

    /// The room a sensor board is in: from the hub's live sources, else the profile's list of boards.
    func room(ofBoard board: String) -> String? {
        sources?.first { $0.id == "chip:\(board)" }?.room ?? profile?.chips?[board]
    }

    func occupants(of room: String) -> [String] {
        crew.map(\.id).filter { self.room(of: $0) == room }
    }

    /// The alerts this person is told about. Nothing else is ever shown on their phone.
    func visibleAlerts(to viewer: String) -> [HubAlert] {
        alerts.filter { !$0.held && $0.toldTo.includes(viewer) }
    }

    /// The current body readings of one person (blood tests have their own screen).
    func currentRows(of person: String, now: Double) -> [Row] {
        Timeline.current(latest.filter { $0.person == person && !$0.signal.hasPrefix("blood.") }, now: now)
    }

    /// The current cabin readings of one room.
    func currentRows(inRoom room: String, now: Double) -> [Row] {
        Timeline.current(latest.filter { $0.person == nil && $0.room == room }, now: now)
    }

    /// Day N of the mission, counting the start day as day 1.
    func missionDay(now: Double) -> Int? {
        // The hub writes "2026-10-01T00:00:00Z"; the date part is what counts.
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate, .withDashSeparatorInDate]
        guard let text = profile?.missionStart, let start = formatter.date(from: String(text.prefix(10))) else { return nil }
        let days = (now - start.timeIntervalSince1970 * 1000) / 86_400_000
        return days < 0 ? nil : Int(days) + 1
    }
}
