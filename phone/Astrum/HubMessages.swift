// The hub's wire format as the phone reads it (hub/engine/types.ts).
// Incoming: every socket message (state, rows, stay, alarms, alerts, earth,
// asleep, activity, evidence, clock, restarting), decoded into typed models.
// Outgoing: the `hello` the phone sends on connecting and the readings it posts.

import Foundation

/// Any message from the hub's socket. Each message type fills only its own
/// fields; the rest stay nil. Fields the phone never reads are skipped, and a
/// part that fails to decode is dropped on its own rather than losing the message.
struct HubIncoming: Decodable, Sendable {
    let type: String
    /// The hub's clock (state and clock).
    let now: Double?
    let profile: HubProfile?
    /// state: the newest row per source for every signal and place.
    let latest: [Row]?
    /// state and stay.
    let stays: [Stay]?
    /// rows: new rows since the last message.
    let rows: [Row]?
    let alarms: [HubAlarm]?
    let alerts: [HubAlert]?
    let earthMessages: [EarthMessage]?
    let asleep: [String]?
    let activity: [String: Activity]?
    /// state: every evidence card so far, by crew id.
    let evidenceByPerson: [String: Evidence]?
    /// evidence: one crewmate's new card.
    let evidence: Evidence?
    let person: String?
    /// restarting: the mission file the hub is restarting on.
    let to: String?
    let scenario: ScenarioFlag?
    /// state and sources: the hub's devices, each with the room it is in.
    let sources: [HubSource]?

    private enum CodingKeys: String, CodingKey {
        case type, now, profile, latest, stays, rows, alarms, alerts, earthMessages, asleep, activity, evidence, person, to, scenario, sources
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        now = try? c.decodeIfPresent(Double.self, forKey: .now)
        profile = try? c.decodeIfPresent(HubProfile.self, forKey: .profile)
        latest = try? c.decodeIfPresent([Row].self, forKey: .latest)
        stays = try? c.decodeIfPresent([Stay].self, forKey: .stays)
        rows = try? c.decodeIfPresent([Row].self, forKey: .rows)
        alarms = try? c.decodeIfPresent([HubAlarm].self, forKey: .alarms)
        let decodedAlerts = try? c.decodeIfPresent([HubAlert].self, forKey: .alerts)
        earthMessages = try? c.decodeIfPresent([EarthMessage].self, forKey: .earthMessages)
        asleep = try? c.decodeIfPresent([String].self, forKey: .asleep)
        activity = try? c.decodeIfPresent([String: Activity].self, forKey: .activity)
        person = try? c.decodeIfPresent(String.self, forKey: .person)
        to = try? c.decodeIfPresent(String.self, forKey: .to)
        scenario = try? c.decodeIfPresent(ScenarioFlag.self, forKey: .scenario)
        // An alert inside a recorded story exists only in the recording: marked, so nothing offers to answer it.
        alerts = scenario == nil ? decodedAlerts : decodedAlerts?.map { alert in
            var recorded = alert
            recorded.recorded = true
            return recorded
        }
        sources = try? c.decodeIfPresent([HubSource].self, forKey: .sources)
        // `evidence` is a map in `state` and a single card in `evidence`.
        if type == "state" {
            evidenceByPerson = try? c.decodeIfPresent([String: Evidence].self, forKey: .evidence)
            evidence = nil
        } else {
            evidenceByPerson = nil
            evidence = try? c.decodeIfPresent(Evidence.self, forKey: .evidence)
        }
    }
}

/// The environment the hub is installed in (Profile in types.ts).
struct HubProfile: Codable, Sendable, Hashable {
    let crew: [CrewMember]
    let id: String?
    /// A key in the hub's string table, e.g. "place.base-moon".
    let place: String?
    /// Mission start, ISO date.
    let missionStart: String?
    /// One-way delay to Earth in seconds.
    let delayToEarthSeconds: Double?
    let rooms: [HubRoom]?
    let mission: MissionFacts?
    /// Each sensor board's id and the room it is in.
    let chips: [String: String]?
}

/// One of the hub's devices (SourceStatus in types.ts), as far as the phone needs it.
struct HubSource: Codable, Sendable, Hashable {
    /// "chip:cabin-1" for a sensor board.
    let id: String
    let connected: Bool
    let room: String?
}

struct CrewMember: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    /// A key in the hub's string table, e.g. "role.cmo".
    let role: String
    /// "she", "he" or "they". Unset means they/them.
    var pronouns: String? = nil
}

/// One room over a limit (RoomAlarm in hub/engine/cabin.ts).
struct HubAlarm: Codable, Sendable, Hashable {
    struct LastReading: Codable, Sendable, Hashable {
        let value: Double
        let t: Double
    }

    let room: String
    let signal: String
    let value: Double
    let unit: String
    let limit: Double
    /// When it started, in milliseconds since 1970.
    let since: Double
    let acknowledged: Bool
    var over: Double? = nil
    /// NASA's words and document, or "crew" for a level the crew set.
    var limitSource: String? = nil
    var kind: Kind? = nil
    var source: String? = nil
    /// The source went quiet while over the limit: never show it as live.
    var stale: Bool? = nil
    var lastReading: LastReading? = nil
    /// Raised by a drill's simulated reading (hub/core/drill.ts), never by the room's air.
    var drill: Bool? = nil

    /// Identifies one alarm across messages, so it is announced once.
    var key: String { "\(room)|\(signal)|\(Int64(since))" }
}

/// One alert about a person (Alert in hub/engine/alerts.ts). The hub decides
/// who is told: the person first, then the Crew Medical Officer, then everyone.
struct HubAlert: Codable, Sendable, Hashable, Identifiable {
    struct Earth: Codable, Sendable, Hashable {
        let sentAt: Double
        let arrivesAt: Double
        let replyAt: Double
    }

    struct LowestRoom: Codable, Sendable, Hashable {
        let room: String
        let value: Double
    }

    let id: String
    let person: String
    /// 1 unusual, 2 concerning, 3 dangerous.
    let level: Int
    /// "room-limit" or "unusual".
    let reason: String
    let room: String?
    let signal: String
    let value: Double?
    let unit: String?
    let limit: Double?
    let held: Bool
    let stationWide: Bool?
    /// Crew ids, or everyone.
    let toldTo: Audience
    var over: Double? = nil
    var limitSource: String? = nil
    /// "high" or "low".
    var direction: String? = nil
    var kind: Kind? = nil
    var since: Double? = nil
    var levelSince: Double? = nil
    var askedAt: Double? = nil
    /// When the "Are you OK?" countdown ends.
    var answerBy: Double? = nil
    /// "ok" or "help".
    var answer: String? = nil
    /// "alert.areYouOk" or "alert.enteredOverLimit".
    var askKey: String? = nil
    /// The steps card id, at level 3. Chosen by rule, never by the model.
    var card: String? = nil
    var lowestRoom: LowestRoom? = nil
    var earth: Earth? = nil
    var earthId: String? = nil
    var textKey: String? = nil
    var seenBy: String? = nil
    var seenAt: Double? = nil
    var actWithinSeconds: Double? = nil
    var earthInTime: Bool? = nil
    /// A drill (hub/core/drill.ts): the hub's real alert engine on a simulated reading. It is answered like any alert.
    var drill: Bool? = nil
    /// Set on this phone when the alert came inside a recorded story (the message carried `scenario`).
    /// It exists only in the recording, so it cannot be answered or acknowledged.
    var recorded: Bool? = nil

    var isDrill: Bool { drill == true }
    var isRecorded: Bool { recorded == true }

    enum Audience: Codable, Sendable, Hashable {
        case everyone
        case people([String])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let list = try? container.decode([String].self) {
                self = .people(list)
            } else {
                self = .everyone
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .everyone: try container.encode("everyone")
            case .people(let list): try container.encode(list)
            }
        }

        func includes(_ person: String) -> Bool {
            switch self {
            case .everyone: return true
            case .people(let list): return list.contains(person)
            }
        }
    }

    /// Identifies one alert at one level, so an escalation is announced again.
    var key: String { "\(id)|\(level)" }
}

struct HubHello: Encodable {
    let type = "hello"
    let role = "phone"
    let person: String?
}

/// The body of POST /api/readings.
struct ReadingsBody: Encodable {
    let source: String
    let rows: [WireRow]
}

struct WireRow: Encodable {
    let t: Int64
    let signal: String
    let value: Double
    let unit: String
    let kind: String
    let person: String
}
