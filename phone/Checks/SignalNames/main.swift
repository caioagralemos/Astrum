// Every signal key the hub can send has a written name on the phone, never the
// fallback and never the key. Reads the hub's own files, so a key added there
// fails here until it is named in Signals.knownName. Compiled on its own for macOS.
// From phone/:
//   swiftc -swift-version 5 Astrum/Model/Signals.swift Astrum/Model/Freshness.swift Astrum/Model/HubTypes.swift Astrum/HubMessages.swift Checks/SignalNames/main.swift -o /tmp/signal-names && /tmp/signal-names ../hub

import Foundation

let hub = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "../hub")
var failures = 0
func check(_ ok: Bool, _ what: String) {
    if !ok { failures += 1; print("FAIL: \(what)") }
}
func text(_ path: String) -> String {
    guard let s = try? String(contentsOf: hub.appendingPathComponent(path), encoding: .utf8) else {
        print("FAIL: cannot read \(path)"); exit(1)
    }
    return s
}
func json(_ path: String) -> Any {
    (try? JSONSerialization.jsonObject(with: Data(text(path).utf8))) ?? [:]
}
func matches(_ pattern: String, in s: String) -> [String] {
    let re = try! NSRegularExpression(pattern: pattern)
    return re.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { Range($0.range(at: 1), in: s).map { String(s[$0]) } }
}

var keys = Set<String>()
// strings.ts: signal.<key> (not the .short forms).
for key in matches(#"'signal\.([a-z0-9_.\-]+)'\s*:"#, in: text("engine/strings.ts")) where !key.hasSuffix(".short") { keys.insert(key) }
// blood.json: blood.<id> with _ for - (engine/blood.ts bloodSignal); its symptom questions as checkin.<key>.
if let entries = json("medical/blood.json") as? [[String: Any]] {
    for entry in entries {
        if let id = entry["id"] as? String { keys.insert("blood." + id.replacingOccurrences(of: "-", with: "_")) }
        for q in entry["symptom_questions"] as? [[String: Any]] ?? [] { if let k = q["key"] as? String { keys.insert("checkin." + k) } }
    }
}
// follow-up.json: her questions, stored as checkin.<key>.
if let file = json("medical/follow-up.json") as? [String: Any] {
    for rule in file["follow_ups"] as? [[String: Any]] ?? [] {
        for q in rule["questions"] as? [[String: Any]] ?? [] { if let k = q["key"] as? String { keys.insert("checkin." + k) } }
    }
}
// cards.json: the signals her signs name.
for key in matches(#""signal"\s*:\s*"([a-z0-9_.\-]+)""#, in: text("medical/cards.json")) { keys.insert(key) }
// The hub's live signals, its own check-in signals and the alert-only keys.
keys.formUnion(["respiratory_rate", "body_temperature", "checkin.got_better", "checkin.fasting", "needs-someone", "dose",
                "resting_heart_rate", "hrv", "breathing_rate", "blood_oxygen", "steps", "active_energy", "sound_level"])
// The rows the hub's sources write (non-test code): signal: '<key>'.
for file in ["core/main.ts", "core/nasa.ts", "core/chip.ts", "core/sensors.ts", "core/dose.ts", "core/drill.ts", "engine/medical.ts"] {
    for key in matches(#"signal: ?'([a-z0-9_.\-]+)'"#, in: (try? String(contentsOf: hub.appendingPathComponent(file), encoding: .utf8)) ?? "") { keys.insert(key) }
}

for key in keys.sorted() {
    let named = Signals.knownName(key)
    check(named != nil, "\(key) has no name")
    check(named != key, "\(key) is named by its key")
}
check(Signals.knownName("checkin.q_is_the_skin_cold_1a2b3c") != nil, "a card question's answer has a name")

// The fallback: plain words, never the key.
check(Signals.fallbackName("blood.salt") == "Salt", "blood.salt falls back to Salt")
check(Signals.fallbackName("sleep_deep_minutes") == "Sleep deep minutes", "underscores become spaces")
check(Signals.fallbackName("checkin.leg-swelling") == "Leg swelling", "the namespace goes, - becomes a space")
check(!Signals.name("blood.glucose").contains("."), "blood.glucose is never shown with its dot")
check(Signals.name("blood.glucose") == "Glucose", "blood.glucose is Glucose, as her file names it")
// Inside the chat's sentences: the hub's key with spaces, or its English words.
check(Signals.inSentence("blood.glucose") == "glucose", "a raw key in a chat sentence becomes words")
check(Signals.inSentence("heart rate") == "heart rate", "the hub's English words map to the name")
check(Signals.inSentence("CO2") == "CO2", "an acronym keeps its case")
check(Signals.inSentence("sleep last night") == "sleep last night", "other words stay as sent")

print(failures == 0 ? "signal names: all \(keys.count) hub keys named" : "signal names: \(failures) failed")
exit(failures == 0 ? 0 : 1)
