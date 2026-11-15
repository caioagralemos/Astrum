// The freshness rule's checks, compiled on their own for macOS (no app, no simulator).
// From phone/:
//   swiftc -swift-version 5 Astrum/Model/Freshness.swift Astrum/Model/Baseline.swift Astrum/Model/HubTypes.swift Checks/Freshness/main.swift -o /tmp/freshness-check && /tmp/freshness-check
// Mirrors hub/engine/baseline.ts: vital signs current for one hour, daily values for 36 hours.

import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String) {
    if !ok { failures += 1; print("FAIL: \(what)") }
}

let hour = Freshness.hourMs
let now = 1_800_000_000_000.0

// Vital signs: one hour, however sparse.
for signal in ["heart_rate", "hrv", "breathing_rate", "respiratory_rate", "blood_oxygen", "blood_pressure_systolic", "blood_pressure_diastolic", "body_temperature"] {
    check(Freshness.isLive(signal), "\(signal) is a vital sign")
    check(!Freshness.isDaily(signal), "\(signal) is never daily")
    check(Freshness.isCurrent(signal: signal, t: now - 59 * 60_000, now: now), "\(signal) 59 min old is current")
    check(Freshness.isCurrent(signal: signal, t: now - hour, now: now), "\(signal) exactly 1 h old is current")
    check(!Freshness.isCurrent(signal: signal, t: now - hour - 1, now: now), "\(signal) past 1 h is a gap")
    check(!Freshness.isCurrent(signal: signal, t: now - 5 * hour, now: now), "\(signal) 5 h old is a gap")
}

// Daily values: 36 hours.
for signal in ["sleep_duration", "sleep_efficiency", "steps", "exercise_minutes", "active_energy", "checkin.headache", "mood.stress"] {
    check(Freshness.isDaily(signal), "\(signal) is daily")
    check(Freshness.isCurrent(signal: signal, t: now - 30 * hour, now: now), "\(signal) 30 h old is current")
    check(!Freshness.isCurrent(signal: signal, t: now - 37 * hour, now: now), "\(signal) 37 h old is a gap")
}

// Anything else (cabin air, sound): one hour.
check(!Freshness.isCurrent(signal: "co2", t: now - 2 * hour, now: now), "co2 2 h old is a gap")
check(Freshness.isCurrent(signal: "co2", t: now - 10 * 60_000, now: now), "co2 10 min old is current")

// The baseline: a sparse blood oxygen with plenty of history, its latest value low.
func rows(_ signal: String, values: [(hoursAgo: Double, value: Double)]) -> [Row] {
    values.map { Row(t: now - $0.hoursAgo * hour, signal: signal, value: $0.value, unit: "%", kind: .measured, source: "watch") }
}
let history = (0..<10).map { (hoursAgo: 24.0 + Double($0) * 6, value: 97.0 + Double($0 % 2)) }

let staleLow = rows("blood_oxygen", values: history + [(hoursAgo: 3, value: 85)])
if case .noRecent = Baseline.judge(staleLow, now: now) {} else {
    check(false, "a 3 h old blood oxygen is not judged (no recent)")
}
let freshLow = rows("blood_oxygen", values: history + [(hoursAgo: 0.5, value: 85)])
check(Baseline.judge(freshLow, now: now).judged?.unusual == true, "a 30 min old low blood oxygen is judged unusual")

// A daily value 20 h old is still judged.
let sleep = rows("sleep_duration", values: [(hoursAgo: 116, value: 420), (hoursAgo: 92, value: 430), (hoursAgo: 68, value: 410), (hoursAgo: 44, value: 425), (hoursAgo: 20, value: 300)])
check(Baseline.judge(sleep, now: now).judged != nil, "last night's sleep (20 h old) is judged")
let oldSleep = rows("sleep_duration", values: [(hoursAgo: 140, value: 420), (hoursAgo: 116, value: 430), (hoursAgo: 92, value: 410), (hoursAgo: 40, value: 300)])
if case .noRecent = Baseline.judge(oldSleep, now: now) {} else {
    check(false, "a 40 h old sleep value is not judged")
}

print(failures == 0 ? "freshness: all checks passed" : "freshness: \(failures) failed")
exit(failures == 0 ? 0 : 1)
