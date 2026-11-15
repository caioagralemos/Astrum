// Many looks at the same analyser screen (camera frames, or several prepared
// versions of one photo), turned into one reading per hub entry. A value is
// taken only when the same number was read in `needed` looks and no look ever
// read a different clean number for it; any disagreement leaves it for the
// person. A flag seen twice wins over any number. Pure, tested with BloodScan.

import Foundation

extension BloodScan {
    struct Tally: Sendable {
        /// How many looks must agree on a number before it is taken.
        let needed: Int
        /// Only the latest `window` readings of an entry are weighed (nil: all of them).
        let window: Int?
        private(set) var looks = 0
        /// Every reading of each entry so far, except "not found".
        private var seen: [String: [Reading]] = [:]
        private(set) var locked: [String: Reading] = [:]

        init(needed: Int = 3, window: Int? = nil) { self.needed = needed; self.window = window }

        mutating func add(_ look: [String: Reading]) {
            looks += 1
            for (id, reading) in look where reading != .notFound && locked[id] == nil {
                seen[id, default: []].append(reading)
                let recent = window.map { Array(seen[id]!.suffix($0)) } ?? seen[id]!
                if let decided = decide(recent) { locked[id] = decided }
            }
        }

        /// Entries whose label has been read at least once.
        var started: Set<String> { Set(seen.keys) }

        /// Every entry seen has settled (taken, flagged, another unit or in disagreement).
        var settled: Bool {
            !locked.isEmpty && seen.keys.allSatisfy { locked[$0] != nil || disagrees($0) }
        }

        func disagrees(_ id: String) -> Bool {
            let readings = seen[id] ?? []
            let recent = window.map { Array(readings.suffix($0)) } ?? readings
            return Set(recent.compactMap(Self.number)).count > 1
        }

        /// The reading of each wanted entry: what was taken, or why nothing was.
        func result(_ ids: [String]) -> [String: Reading] {
            var out: [String: Reading] = [:]
            for id in ids {
                if let reading = locked[id] {
                    out[id] = reading
                } else if disagrees(id) {
                    out[id] = .unclear(.disagree)
                } else if let last = seen[id]?.last {
                    // Not steady: a number read too few times is not offered.
                    switch last {
                    case .read(_, let text, _), .readWithoutUnit(_, let text): out[id] = .unclear(.notSteady(shown: text))
                    default: out[id] = last
                    }
                } else {
                    out[id] = .notFound
                }
            }
            return out
        }

        private func decide(_ readings: [Reading]) -> Reading? {
            let flags = readings.compactMap { if case .flagged(let shown) = $0 { shown } else { nil } }
            if flags.count >= 2 { return .flagged(shown: Self.common(flags)) }
            if !flags.isEmpty { return nil }
            // A different clean number at any time: never decided here.
            let numbers = readings.compactMap(Self.number)
            if Set(numbers).count > 1 { return nil }
            let others = readings.compactMap { if case .otherUnit(let shown, let unit) = $0 { "\(shown) \(unit)" } else { nil } }
            if others.count >= 2, Set(others).count == 1, case .otherUnit(let shown, let unit)? = readings.last(where: {
                if case .otherUnit = $0 { true } else { false } }) {
                return .otherUnit(shown: shown, unit: unit)
            }
            guard numbers.count >= needed else { return nil }
            // The unit read in any look counts; otherwise the number stays "unit not read".
            let withUnit = readings.compactMap { if case .read(let v, let t, let u) = $0 { Reading.read(value: v, text: t, unitSeen: u) } else { nil } }
            if let exact = withUnit.first(where: { if case .read(_, _, nil) = $0 { true } else { false } }) { return exact }
            if let close = withUnit.first { return close }
            return readings.first { if case .readWithoutUnit = $0 { true } else { false } }
        }

        private static func number(_ reading: Reading) -> String? {
            switch reading {
            case .read(_, let text, _), .readWithoutUnit(_, let text): text
            default: nil
            }
        }

        private static func common(_ texts: [String]) -> String {
            Dictionary(grouping: texts, by: { $0 }).max { $0.value.count < $1.value.count }!.key
        }
    }
}
