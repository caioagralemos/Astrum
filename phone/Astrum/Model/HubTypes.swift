// The hub's shapes the native screens use (hub/engine/types.ts, alerts.ts,
// evidence.ts, activity.ts). Times are milliseconds since 1970 on the hub's
// clock, kept as Double. Every field the hub may leave out is optional, and
// fields the screens never read are skipped when decoding.

import Foundation

/// How a value came to exist. Shown beside every reading: a rule of the product.
enum Kind: String, Codable, Sendable, CaseIterable, Comparable {
    case measured, estimated, reported, replayed, simulated

    /// Lower wins where sources compete (KIND_RANK in types.ts).
    var rank: Int {
        switch self {
        case .measured: 0
        case .estimated: 1
        case .reported: 2
        case .replayed: 3
        case .simulated: 4
        }
    }

    static func < (lhs: Kind, rhs: Kind) -> Bool { lhs.rank < rhs.rank }

    /// An unknown kind is treated as the weakest, so it is never shown as better than it is.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Kind(rawValue: raw) ?? .simulated
    }
}

/// One row of the timeline: a body reading, a cabin reading, a check-in answer.
struct Row: Codable, Sendable, Hashable {
    var id: Int?
    var t: Double
    var signal: String
    var value: Double?
    var text: String?
    var unit: String
    var kind: Kind
    var source: String
    var person: String?
    var room: String?

    var date: Date { Date(timeIntervalSince1970: t / 1000) }
}

/// Where one crewmate was, from when until when. Open stays have no `until`.
struct Stay: Codable, Sendable, Hashable {
    var id: Int?
    var person: String
    var room: String
    var from: Double
    var until: Double?
    var kind: Kind
    var source: String
}

struct HubRoom: Codable, Sendable, Hashable, Identifiable {
    let id: String
    /// A key in the hub's string table, e.g. "room.quarters-2".
    let name: String
}

/// The mission the hub runs (MissionFacts in types.ts).
struct MissionFacts: Codable, Sendable, Hashable {
    struct Where: Codable, Sendable, Hashable {
        let body: String?
        let situation: String
    }

    let id: String
    let kind: String
    let `where`: Where?
    let gravity: Double?
    let plannedDays: Int?
    let destination: String?
    let nameText: String?
}

/// What the hub knows a crewmate is doing (engine/activity.ts).
struct Activity: Codable, Sendable, Hashable {
    /// "sleeping", "exercising", "eating" or "none".
    let what: String
    let kind: Kind
    let since: Double
}

/// Carried by every message of a simulated scenario, so the screen can say so.
struct ScenarioFlag: Codable, Sendable, Hashable {
    let id: String
    let label: String
    let at: Double
    let speed: Double
}

/// A message to Earth (EarthMessage in alerts.ts).
struct EarthMessage: Codable, Sendable, Hashable, Identifiable {
    struct About: Codable, Sendable, Hashable {
        let person: String
        let room: String?
        let signal: String
        let level: Int?
        let stationWide: Bool?
    }

    struct Reply: Codable, Sendable, Hashable {
        let text: String
        let at: Double
        let simulated: Bool
        let key: String?
    }

    let id: String
    /// "alert" (sent by a level 3) or "crew" (written by a crewmate).
    let kind: String
    let about: About
    let from: String?
    let text: String?
    let sentAt: Double
    let arrivesAt: Double
    let replyAt: Double
    let delivered: Bool
    let reply: Reply?
    let resolvedAt: Double?
}

// MARK: Evidence

/// One crewmate's evidence card, as much of it as the phone shows (evidence.ts).
struct Evidence: Codable, Sendable, Hashable {
    struct Unusual: Codable, Sendable, Hashable {
        let signals: [UnusualSignal]
        let score: Double
    }

    let person: String
    let now: Double
    let unusual: Unusual
    /// "room", "person", "sensor" or "unknown". Never a cause.
    let pointsTo: String
    let focusRoom: String?
    let reasons: [EvidenceReason]
    let computedAt: Double?
    /// Time spent at each CO2 level over the card's windows (24 and 72 hours).
    var whereBeen: WhereBeen? = nil
}

/// The part of the card's `whereBeen` the phone shows: hours at NASA's CO2 levels.
struct WhereBeen: Codable, Sendable, Hashable {
    struct Window: Codable, Sendable, Hashable {
        let ms: Double
        /// The person first, then each crewmate.
        let people: [PersonExposure]
    }

    struct PersonExposure: Codable, Sendable, Hashable {
        struct Above: Codable, Sendable, Hashable {
            let level: Double
            let ms: Double
        }

        let person: String
        let above: [Above]
        let kind: Kind?
    }

    let windows: [Window]
}

struct UnusualSignal: Codable, Sendable, Hashable {
    let signal: String
    let direction: String?
    let z: Double
    let recent: Double
    let usual: Double
    let mode: String
    let baselineCount: Int
    let kind: Kind
}

/// A reason behind `pointsTo`, as data. Only the fields the phone words are kept.
struct EvidenceReason: Codable, Sendable, Hashable {
    struct Problem: Codable, Sendable, Hashable {
        /// "no-reading", "stale", "stuck" or "contradicted".
        let problem: String
        let room: String
        let signal: String
        let t: Double?
    }

    /// "exposure-stands-out", "crewmates-same", "crewmates-normal" or "sensor".
    let code: String
    let room: String?
    let level: Double?
    let ms: Double?
    let kind: Kind?
    let signal: String?
    let people: [String]?
    let problem: Problem?
}
