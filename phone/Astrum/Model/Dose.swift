// One crewmate's radiation dose as the hub works it out (PersonDose in
// hub/engine/dose.ts): from each room's radiation rate and the time spent
// there, never measured on the body. Only the parts a screen shows are read.

import Foundation

struct PersonDose: Codable, Sendable, Hashable {
    /// One quantity's amounts, in its own unit (absorbed in Gy, equivalent in Sv; never added together).
    struct Amount: Codable, Sendable, Hashable {
        /// "absorbed" or "equivalent".
        let quantity: String
        /// The dose unit, as the hub writes it: "mSv", "uGy"...
        let unit: String
        let today: Double
        let mission: Double
        /// At the planned mission end, at the average rate so far; nil when there is no end or too little to go on.
        let projected: Double?
        let ratePerDay: Double
    }

    /// The time in a window the dose could not count.
    struct Coverage: Codable, Sendable, Hashable {
        /// Nobody knew which room they were in.
        let unplacedMs: Double
        /// Their room had no radiation reading.
        let noRateMs: Double
    }

    /// NASA's career limit (NASA-STD-3001 V1 4030).
    struct Limit: Codable, Sendable, Hashable {
        let value: Double
        let unit: String
    }

    /// The share of the career limit, 0 to 1.
    struct OfLimit: Codable, Sendable, Hashable {
        let mission: Double
        let projected: Double?
    }

    /// estimated, replayed or simulated.
    let kind: Kind
    let amounts: [Amount]
    let today: Coverage
    let mission: Coverage
    /// True only when the whole dose is dose equivalent, so it may sit beside NASA's limit.
    let comparable: Bool
    /// Why it is not comparable: "absorbed" or "mixed"; nil when it is.
    let reason: String?
    let limit: Limit?
    let ofLimit: OfLimit?
}
