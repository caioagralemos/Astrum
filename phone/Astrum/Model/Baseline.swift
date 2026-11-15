// Is a reading unusual FOR THIS PERSON? Ported from hub/engine/baseline.ts,
// the same rule the hub's person view runs on the person's own history:
// the recent value against the median of their earlier readings taken in the
// same state (rest or exercise), counted in units of their usual spread
// (scaled MAD). No trained model.

import Foundation

enum SignalBaseline: Sendable, Hashable {
    /// Compared with enough history.
    case judged(Judged)
    /// Has a recent value but not enough history to compare it with yet.
    case notEnoughHistory(recent: Double, needed: Int, have: Int)
    /// History, but nothing recent: a gap, never a flag.
    case noRecent

    struct Judged: Sendable, Hashable {
        let recent: Double
        /// Median of the baseline.
        let usual: Double
        /// Scaled MAD of the baseline.
        let spread: Double
        let z: Double
        let unusual: Bool
        /// "high", "low" or nil.
        let direction: String?
        let baselineCount: Int
        /// True when the recent value is the latest daily value, false for a dense median.
        let daily: Bool

        /// The person's usual range as the hub's person view draws it: usual ± 2 spreads.
        var band: ClosedRange<Double>? {
            spread > 0 ? (usual - 2 * spread)...(usual + 2 * spread) : nil
        }
    }

    var judged: Judged? {
        if case .judged(let judged) = self { return judged }
        return nil
    }
}

enum Baseline {
    static let madScale = 1.4826
    static let meanADScale = 1.2533
    static let zCap = 10.0
    static let baselineMs: Double = 14 * 86_400_000
    static let recentMs: Double = 3_600_000
    static let denseMin = 2
    static let minDense = 30
    static let minDaily = 3
    static let dailyFreshMs: Double = 36 * 3_600_000
    static let threshold = 3.0

    /// The hub's default state: the gym is exercise, the rest is rest.
    static func state(of row: Row) -> String { row.room == "gym" ? "exercise" : "rest" }

    static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let mid = sorted.count / 2
        return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    static func robust(_ values: [Double]) -> (usual: Double, spread: Double) {
        let usual = median(values)
        let deviations = values.map { abs($0 - usual) }
        var spread = median(deviations) * madScale
        if spread == 0 { spread = deviations.reduce(0, +) / Double(deviations.count) * meanADScale }
        return (usual, spread)
    }

    /// Every numeric signal in `rows` (one person's), each judged against their own history.
    static func summary(of rows: [Row], now: Double) -> [String: SignalBaseline] {
        let numeric = rows.filter { $0.value != nil }
        let bySignal = Dictionary(grouping: numeric, by: \.signal)
        return bySignal.mapValues { judge($0, now: now) }
    }

    /// One signal (`rows` are all that signal's rows for one person).
    static func judge(_ rows: [Row], now: Double) -> SignalBaseline {
        let all = rows.filter { $0.t <= now && $0.t >= now - baselineMs }.sorted { $0.t < $1.t }
        let recentStart = now - recentMs
        let inRecent = all.filter { $0.t > recentStart }

        let daily: Bool
        let recentRows: [Row]
        let before: [Row]
        if inRecent.count >= denseMin, let last = inRecent.last {
            daily = false
            let state = state(of: last)
            recentRows = inRecent.filter { self.state(of: $0) == state }
            before = all.filter { $0.t <= recentStart }
        } else {
            let older = all.filter { $0.t <= recentStart }
            let windows = older.first.map { max(1, (recentStart - $0.t) / recentMs) } ?? 1
            let usuallyDense = Double(older.count) / windows >= Double(denseMin)
            guard let latest = all.last, !usuallyDense, now - latest.t <= dailyFreshMs else { return .noRecent }
            daily = true
            recentRows = [latest]
            before = Array(all.dropLast())
        }

        guard let lastRecent = recentRows.last else { return .noRecent }
        let state = state(of: lastRecent)
        let baseline = before.filter { self.state(of: $0) == state }.compactMap(\.value)
        let recent = median(recentRows.compactMap(\.value))
        let needed = daily ? minDaily : minDense
        guard baseline.count >= needed else {
            return .notEnoughHistory(recent: recent, needed: needed, have: baseline.count)
        }

        let (usual, spread) = robust(baseline)
        let diff = recent - usual
        var z = spread == 0 ? (diff == 0 ? 0 : (diff > 0 ? zCap : -zCap)) : diff / spread
        z = max(-zCap, min(zCap, z))
        let unusual = abs(z) >= threshold
        return .judged(.init(
            recent: recent, usual: usual, spread: spread, z: z, unusual: unusual,
            direction: unusual ? (z > 0 ? "high" : "low") : nil,
            baselineCount: baseline.count, daily: daily
        ))
    }
}
