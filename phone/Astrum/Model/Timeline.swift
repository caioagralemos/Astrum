// The hub's rules over rows, ported from hub/engine/timeline.ts so the phone
// picks the same current value the hub's screens show.

import Foundation

enum Timeline {
    /// A reading older than this no longer counts as the current value (FRESH_MS).
    static let freshMs: Double = 30_000
    /// A reading stamped a moment ahead of the viewer's clock still counts (CLOCK_SLACK_MS).
    static let clockSlackMs: Double = 2_000
    /// The furthest a scenario's clock runs past its last message (SCENARIO_GAP_MS).
    static let scenarioGapMs: Double = 30_000

    /// Where a reading belongs: one person's body or one room.
    static func scope(of row: Row) -> String {
        let place = row.person.map { "p:\($0)" } ?? "r:\(row.room ?? "")"
        return "\(place)|\(row.signal)"
    }

    /// The current value of every signal in every scope. Among fresh readings
    /// measured beats estimated beats reported beats replayed beats simulated,
    /// ties to the newest. If nothing is fresh, the newest reading is returned,
    /// so the screen can show it as stale.
    static func current(_ rows: [Row], now: Double, freshMs: Double = Timeline.freshMs) -> [Row] {
        var best: [String: Row] = [:]
        for row in rows where row.t <= now + clockSlackMs {
            let key = scope(of: row)
            if let held = best[key], !better(row, than: held, now: now, freshMs: freshMs) { continue }
            best[key] = row
        }
        return Array(best.values)
    }

    private static func better(_ a: Row, than b: Row, now: Double, freshMs: Double) -> Bool {
        let aFresh = now - a.t <= freshMs
        let bFresh = now - b.t <= freshMs
        if aFresh != bFresh { return aFresh }
        if aFresh && a.kind != b.kind { return a.kind < b.kind }
        return a.t >= b.t
    }

    /// The time a screen shows: its own clock plus the offset to the hub's, or,
    /// during a scenario, the scenario's moment run on at its speed.
    static func screenNow(local: Double, offset: Double, scenario: ScenarioFlag?, heardAt: Double) -> Double {
        if let scenario {
            return scenario.at + min((local - heardAt) * scenario.speed, scenarioGapMs)
        }
        return local + offset
    }
}
