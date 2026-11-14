// The parts of the hub's wire format the phone uses (hub/engine/types.ts).
// Incoming: the crew list from the `state` message and the room alarms.
// Outgoing: the `hello` the phone sends on connecting and the readings it posts.

import Foundation

/// Any message from the hub's socket. Only the fields the phone needs are read;
/// everything else in the message is skipped.
struct HubIncoming: Decodable, Sendable {
    let type: String
    let profile: HubProfile?
    let alarms: [HubAlarm]?
    let alerts: [HubAlert]?
}

struct HubProfile: Decodable, Sendable {
    let crew: [CrewMember]
}

struct CrewMember: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    /// A key in the hub's string table, e.g. "role.cmo".
    let role: String
}

/// One room over a NASA limit (RoomAlarm in hub/engine/cabin.ts).
struct HubAlarm: Decodable, Sendable {
    let room: String
    let signal: String
    let value: Double
    let unit: String
    let limit: Double
    /// When it started, in milliseconds since 1970.
    let since: Double
    let acknowledged: Bool

    /// Identifies one alarm across messages, so it is announced once.
    var key: String { "\(room)|\(signal)|\(Int64(since))" }
}

/// One alert about a person (Alert in hub/engine/alerts.ts). The hub decides
/// who is told: the person first, then the Crew Medical Officer, then everyone.
struct HubAlert: Decodable, Sendable {
    let id: String
    let person: String
    /// 1 unusual, 2 concerning, 3 dangerous.
    let level: Int
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

    enum Audience: Decodable, Sendable {
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
