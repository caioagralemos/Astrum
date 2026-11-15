// How long a reading counts as current: the one rule every screen uses (Me's
// list and widgets, the body figure's marks, the summary line, the baseline),
// mirroring hub/engine/baseline.ts. Vital signs are current for one hour only,
// however rarely they arrive; older, they are a gap ("no current reading"),
// never a current value and never compared with the usual. The day's totals,
// nightly values and answers keep a day and a half, and are named with their
// time ("Sleep last night", "Steps today"). Everything else: one hour.
// Plain Foundation, so it compiles on its own (phone/Checks/FreshnessCheck.swift).

import Foundation

enum Freshness {
    static let hourMs: Double = 3_600_000
    /// A vital sign's window (the hub's liveFreshMs).
    static let liveMs: Double = hourMs
    /// A daily value's window (the hub's dailyFreshMs).
    static let dailyMs: Double = 36 * hourMs
    /// Any other reading's window (the hub's recent window).
    static let otherMs: Double = hourMs

    /// The hub's vital signs (DEFAULTS.liveSignals in baseline.ts).
    static let liveSignals: Set<String> = [
        "heart_rate", "hrv", "respiratory_rate", "breathing_rate", "blood_oxygen",
        "blood_pressure_systolic", "blood_pressure_diastolic", "body_temperature",
    ]

    static func isLive(_ signal: String) -> Bool { liveSignals.contains(signal) }

    /// The day's totals, nightly values and answers. A vital sign never is one.
    static func isDaily(_ signal: String) -> Bool {
        guard !isLive(signal) else { return false }
        return signal.hasPrefix("sleep_") || signal.hasPrefix("checkin.") || signal.hasPrefix("mood.")
            || ["steps", "exercise_minutes", "active_energy"].contains(signal)
    }

    /// How long a reading of `signal` counts as current, in milliseconds.
    static func windowMs(_ signal: String) -> Double {
        if isLive(signal) { return liveMs }
        return isDaily(signal) ? dailyMs : otherMs
    }

    /// True while a reading taken at `t` still counts as the current value at `now` (both hub milliseconds).
    static func isCurrent(signal: String, t: Double, now: Double) -> Bool {
        now - t <= windowMs(signal)
    }

    /// The longest a sparse signal's latest value may be judged against the usual (the baseline's fallback).
    static func judgeableMs(_ signal: String) -> Double {
        isLive(signal) ? liveMs : dailyMs
    }
}
