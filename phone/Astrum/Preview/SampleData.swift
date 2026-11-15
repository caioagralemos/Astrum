// Sample data for Xcode's canvas only, so every screen can be previewed
// without a hub. Shaped like the hub's real payloads (a Moon base, four crew,
// Marina's phone). Never used at runtime: the app shows only what the hub sent.

import Foundation

@MainActor
enum SampleData {
    static let me = "reyes"
    static let now = Date().timeIntervalSince1970 * 1000
    private static let minute = 60_000.0
    private static let hour = 3_600_000.0
    private static let day = 86_400_000.0

    /// A model that starts nothing, holding the sample world and history.
    static func model(alerts: [HubAlert] = []) -> AppModel {
        let model = AppModel(running: false)
        var sample = world
        sample.alerts = alerts
        model.world = sample
        model.choose(person: me)
        model.history.replace(with: history, now: now)
        return model
    }

    static var world: HubWorld {
        var world = HubWorld()
        world.profile = profile
        world.latest = latest
        world.stays = [
            Stay(id: 1, person: "reyes", room: "greenhouse", from: now - 2 * hour, until: nil, kind: .simulated, source: "sim:crew"),
            Stay(id: 2, person: "leo", room: "lab", from: now - 3 * hour, until: nil, kind: .simulated, source: "sim:crew"),
            Stay(id: 3, person: "okafor", room: "medical", from: now - 3 * hour, until: nil, kind: .simulated, source: "sim:crew"),
            Stay(id: 4, person: "tanaka", room: "command", from: now - hour, until: nil, kind: .simulated, source: "sim:crew"),
        ]
        world.activity = [
            "leo": Activity(what: "exercising", kind: .simulated, since: now - 20 * minute),
            "okafor": Activity(what: "none", kind: .simulated, since: now - hour),
        ]
        world.earthMessages = [earthMessage]
        world.evidence = [me: evidence]
        world.heardAt = now
        world.receivedAt = Date()
        return world
    }

    static let profile = HubProfile(
        crew: [
            CrewMember(id: "reyes", name: "Marina", role: "role.engineer", pronouns: "they"),
            CrewMember(id: "leo", name: "Matthias", role: "role.scientist", pronouns: "they"),
            CrewMember(id: "okafor", name: "Franz", role: "role.cmo", pronouns: "they"),
            CrewMember(id: "tanaka", name: "Peggy", role: "role.commander", pronouns: "they"),
        ],
        id: "base-moon", place: "place.base-moon", missionStart: "2026-10-01T00:00:00Z", delayToEarthSeconds: 1.3,
        rooms: ["commons", "command", "lab", "medical", "greenhouse", "quarters-2"].map { HubRoom(id: $0, name: "room.\($0)") },
        mission: MissionFacts(id: "base-moon", kind: "base", where: .init(body: "moon", situation: "surface"),
                              gravity: 0.166, plannedDays: 180, destination: nil, nameText: nil)
    )

    private static func body(_ signal: String, _ value: Double?, _ unit: String, _ kind: Kind = .measured, ago: Double = 0, text: String? = nil) -> Row {
        let source = kind == .reported ? "checkin:reyes" : kind == .measured ? "phone:reyes" : "sim:crew"
        return Row(t: now - ago, signal: signal, value: value, text: text, unit: unit, kind: kind, source: source, person: me, room: "greenhouse")
    }

    private static func cabin(_ signal: String, _ value: Double, _ unit: String, _ kind: Kind) -> Row {
        Row(t: now - 5_000, signal: signal, value: value, unit: unit, kind: kind,
            source: kind == .replayed ? "nasa:osdr-rr1" : "chip:cabin-1", room: "greenhouse")
    }

    static var latest: [Row] {
        [
            body("heart_rate", 84, "bpm", ago: 10_000),
            body("resting_heart_rate", 58, "bpm", ago: 6 * hour),
            body("hrv", 41, "ms", ago: 2 * hour),
            body("breathing_rate", 15, "breaths/min", ago: 40 * minute),
            body("blood_oxygen", 97, "%", ago: 3 * hour),
            body("sleep_duration", 412, "min", .simulated, ago: 9 * hour),
            body("exercise_minutes", 35, "min", ago: hour),
            body("steps", 4_210, "count", ago: hour),
            body("checkin.headache", 1, "yes/no", .reported, ago: 8 * hour),
            body("checkin.mood", 55, "0-100", .reported, ago: 8 * hour),
            cabin("co2", 2.9, "mmHg", .replayed),
            cabin("temperature", 22.4, "C", .measured),
            cabin("pressure", 1013, "hPa", .measured),
            cabin("humidity", 46, "%", .replayed),
        ]
    }

    /// Three days of heart rate every ten minutes, and two weeks of nights and exercise.
    static var history: [Row] {
        var rows: [Row] = []
        var t = now - 3 * day
        while t < now - hour {
            let value = 62 + 4 * sin(t / (6 * hour)) + Double(Int(t / minute) % 3)
            rows.append(body("heart_rate", value.rounded(), "bpm", ago: now - t))
            t += 10 * minute
        }
        for n in 1...14 {
            rows.append(body("sleep_duration", Double(400 + (n * 37) % 60), "min", .simulated, ago: Double(n) * day + 9 * hour))
            rows.append(body("exercise_minutes", Double(70 + (n * 13) % 30), "min", ago: Double(n) * day))
        }
        rows.append(body("checkin.headache", 1, "yes/no", .reported, ago: 8 * hour))
        rows.append(body("checkin.mood", 55, "0-100", .reported, ago: 8 * hour))
        return rows + latest.filter { $0.person == me }
    }

    static let evidence = Evidence(
        person: me, now: now,
        unusual: .init(signals: [UnusualSignal(signal: "heart_rate", direction: "high", z: 4.2, recent: 84, usual: 63,
                                               mode: "dense", baselineCount: 420, kind: .measured)], score: 0.7),
        pointsTo: "room", focusRoom: "greenhouse",
        reasons: [EvidenceReason(code: "exposure-stands-out", room: "greenhouse", level: 2.8, ms: 3.5 * hour,
                                 kind: .replayed, signal: nil, people: nil, problem: nil)],
        computedAt: now,
        whereBeen: WhereBeen(windows: [
            .init(ms: 72 * hour, people: [
                .init(person: me, above: [.init(level: 2.8, ms: 3.5 * hour), .init(level: 3, ms: 0.5 * hour)], kind: .replayed),
                .init(person: "leo", above: [.init(level: 2.8, ms: 0.4 * hour), .init(level: 3, ms: 0)], kind: .replayed),
            ]),
        ])
    )

    static let earthMessage = EarthMessage(
        id: "earth|crew|1", kind: "crew",
        about: .init(person: me, room: nil, signal: "earth.message", level: nil, stationWide: false),
        from: me, text: "Slept badly two nights running. Anything to check?",
        sentAt: now - 10_000, arrivesAt: now - 8_700, replyAt: now + 20_000, delivered: true,
        reply: .init(text: "Houston: message received.", at: now - 5_000, simulated: true, key: "earth.simReply"),
        resolvedAt: nil
    )

    static let askAlert = HubAlert(
        id: "reyes|room-limit|greenhouse|co2", person: me, level: 2, reason: "room-limit", room: "greenhouse",
        signal: "co2", value: 3.2, unit: "mmHg", limit: 3, held: false, stationWide: false, toldTo: .people([me, "okafor"]),
        over: 0.2, limitSource: "NASA", kind: .replayed, since: now - minute, levelSince: now - minute,
        askedAt: now - 15_000, answerBy: now + 45_000, askKey: "alert.areYouOk"
    )

    static let dangerAlert = HubAlert(
        id: "leo|room-limit|lab|co2", person: "leo", level: 3, reason: "room-limit", room: "lab",
        signal: "co2", value: 3.6, unit: "mmHg", limit: 3, held: false, stationWide: false, toldTo: .everyone,
        over: 0.6, limitSource: "NASA", kind: .replayed, since: now - 3 * minute, levelSince: now - minute,
        askedAt: now - 3 * minute, answerBy: now - 2 * minute, card: "high-co2",
        earth: .init(sentAt: now - minute, arrivesAt: now - minute + 1_300, replyAt: now - minute + 2_600)
    )

    static var answer: AskResult {
        let json = """
        {"type":"result","route":"answer","by":"hub","text":"","key":null,"source":null,"passages":[],"card":null,"urgent":false,"check":null,"ms":2400,
         "facts":{"factsText":"","items":[
           {"key":"answer.limit.under","vars":{"signal":"CO2","value":2.4,"unit":"mmHg","window":"1-hour average","diff":0.6,"limit":3},"label":"replayed"}
         ],"passages":[{"name":"NASA OCHMO-TB-004","url":"https://www.nasa.gov/","text":"The 1-hour average CO2 is to be no more than 3 mmHg."}]}}
        """
        return try! JSONDecoder().decode(AskResult.self, from: Data(json.utf8))
    }
}
