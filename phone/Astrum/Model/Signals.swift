// What the phone knows about each signal: its name (the hub's wording, from
// hub/engine/strings.ts, in the String Catalog), the body region it belongs
// to, how its value is said, and how long a reading of it stays current.
// Rooms, places and roles are named here too, from the hub's string keys.

import Foundation

/// The regions of the body figure on Me, each tied to the readings that belong to it.
enum BodyRegion: String, CaseIterable, Identifiable, Sendable {
    case head, heart, lungs, body, blood

    var id: String { rawValue }

    var title: String {
        switch self {
        case .head: String(localized: "Head")
        case .heart: String(localized: "Heart")
        case .lungs: String(localized: "Lungs and air")
        case .body: String(localized: "Body and activity")
        case .blood: String(localized: "Blood")
        }
    }

    /// What the region holds, for VoiceOver hints and the plain list.
    var contents: String {
        switch self {
        case .head: String(localized: "Sleep, headache, mood, stress and tiredness")
        case .heart: String(localized: "Heart rate, resting heart rate, heart rate variability and blood pressure")
        case .lungs: String(localized: "Breathing rate, blood oxygen and the air of the room you are in")
        case .body: String(localized: "Exercise, steps and active energy")
        case .blood: String(localized: "Your latest blood test")
        }
    }
}

enum Signals {
    /// The signals of each region, in the order they are listed.
    static func signals(in region: BodyRegion) -> [String] {
        switch region {
        case .head:
            ["sleep_duration", "sleep_efficiency", "sleep_awakenings", "checkin.headache", "checkin.mood",
             "checkin.stress", "checkin.fatigue", "mood.stress", "mood.fatigue", "mood.sleepy"]
        case .heart:
            ["heart_rate", "resting_heart_rate", "hrv", "blood_pressure_systolic", "blood_pressure_diastolic"]
        case .lungs:
            ["breathing_rate", "blood_oxygen", "co2"]
        case .body:
            ["exercise_minutes", "steps", "active_energy", "sound_level"]
        case .blood:
            []
        }
    }

    static func region(of signal: String) -> BodyRegion? {
        if signal.hasPrefix("blood.") { return .blood }
        return BodyRegion.allCases.first { signals(in: $0).contains(signal) }
    }

    /// Position in the reading list: region order, then the order above; anything else last.
    static func order(of signal: String) -> Int {
        for (r, region) in BodyRegion.allCases.enumerated() {
            if let i = signals(in: region).firstIndex(of: signal) { return r * 100 + i }
        }
        return 10_000
    }

    /// The day's totals, nightly values and answers: current for a day and a half
    /// (the baseline's dailyFreshMs). Everything else: for an hour (its recent window).
    static func isDaily(_ signal: String) -> Bool {
        signal.hasPrefix("sleep_") || signal.hasPrefix("checkin.") || signal.hasPrefix("mood.") || signal.hasPrefix("blood_pressure")
            || ["steps", "exercise_minutes", "active_energy"].contains(signal)
    }

    static func isStale(_ row: Row, now: Double) -> Bool {
        let limit = isDaily(row.signal) ? Baseline.dailyFreshMs : Baseline.recentMs
        return now - row.t > limit
    }

    /// NASA's daily exercise on the ISS, 1.5 hours (hub/engine/crew.ts), in minutes.
    static let exerciseTargetMinutes = 90.0

    /// NASA's two CO2 levels (hub/engine/exposure.ts): headaches from 2.8, the 1-hour limit 3.
    static let co2HeadacheLevel = 2.8
    static let co2Limit = 3.0

    // MARK: Names

    static func name(_ signal: String) -> String {
        switch signal {
        case "heart_rate": String(localized: "Heart rate")
        case "resting_heart_rate": String(localized: "Resting heart rate")
        case "hrv": String(localized: "Heart rate variability")
        case "blood_pressure_systolic": String(localized: "Blood pressure, upper")
        case "blood_pressure_diastolic": String(localized: "Blood pressure, lower")
        case "breathing_rate": String(localized: "Breathing rate")
        case "blood_oxygen": String(localized: "Blood oxygen")
        case "sleep_duration": String(localized: "Sleep last night")
        case "sleep_efficiency": String(localized: "Time in bed asleep")
        case "sleep_awakenings": String(localized: "Times awake in the night")
        case "mood.stress": String(localized: "Stress")
        case "mood.fatigue": String(localized: "Tiredness")
        case "mood.sleepy": String(localized: "Sleepiness")
        case "exercise_minutes": String(localized: "Exercise today")
        case "steps": String(localized: "Steps today")
        case "active_energy": String(localized: "Active energy today")
        case "sound_level": String(localized: "Sound around you")
        case "checkin.headache": String(localized: "Headache")
        case "checkin.mood": String(localized: "Mood")
        case "checkin.stress": String(localized: "Stress (check-in)")
        case "checkin.fatigue": String(localized: "Tiredness (check-in)")
        case "checkin.note": String(localized: "Note")
        case "co2": String(localized: "CO2")
        case "temperature": String(localized: "Temperature")
        case "humidity": String(localized: "Humidity")
        case "pressure": String(localized: "Cabin pressure")
        case "oxygen": String(localized: "Oxygen")
        case "noise": String(localized: "Noise")
        case "light": String(localized: "Light")
        case "vibration": String(localized: "Vibration")
        case "radiation": String(localized: "Radiation")
        case "air_quality": String(localized: "Air quality")
        default: plain(signal)
        }
    }

    static func kindName(_ kind: Kind) -> String {
        switch kind {
        case .measured: String(localized: "Measured")
        case .estimated: String(localized: "Estimated")
        case .reported: String(localized: "Reported")
        case .replayed: String(localized: "Replayed")
        case .simulated: String(localized: "Simulated")
        }
    }

    /// Where a reading came from, in words: "Apple Watch, measured", "NASA, ISS record, replayed".
    static func sourceText(_ row: Row) -> String {
        let kind = kindName(row.kind).lowercased()
        let source = row.source
        if source.hasPrefix("phone:") { return String(localized: "Apple Watch, \(kind)") }
        if source.hasPrefix("checkin:") { return String(localized: "Your check-in, \(kind)") }
        if source.hasPrefix("chip:") { return String(localized: "Station sensor board, \(kind)") }
        if source.hasPrefix("nasa:osdr-inspiration4") { return String(localized: "NASA, Inspiration4 record, \(kind)") }
        if source.hasPrefix("nasa:") { return String(localized: "NASA, ISS record, \(kind)") }
        if source.hasPrefix("istat:") { return String(localized: "Typed blood result, \(kind)") }
        if source.hasPrefix("sim:") { return String(localized: "The hub's simulation, \(kind)") }
        return "\(source), \(kind)"
    }

    // MARK: Values

    /// A reading as people say it, split so the unit can be set smaller.
    static func display(_ row: Row) -> (value: String, unit: String) {
        guard let v = row.value else { return (row.text ?? "", "") }
        switch row.unit {
        case "yes/no": return (v != 0 ? String(localized: "Yes") : String(localized: "No"), "")
        case "min" where v >= 90:
            let hours = Int(v) / 60
            let minutes = Int(v.rounded()) % 60
            return ("\(hours) h \(String(format: "%02d", minutes))", "")
        case "min": return ("\(Int(v.rounded()))", "min")
        case "%": return ("\(Int(v.rounded()))", "%")
        case "count", "0-100", "index", "raw": return ("\(Int(v.rounded()))", row.unit == "0-100" ? String(localized: "of 100") : "")
        case "C": return (number(v), "°C")
        default: return (number(v), row.unit)
        }
    }

    static func text(_ row: Row) -> String {
        let (value, unit) = display(row)
        if unit.isEmpty { return value }
        return unit == "%" ? "\(value)%" : "\(value) \(unit)"
    }

    /// A number with the hub's precision: two decimals under 10, none above.
    static func number(_ v: Double) -> String {
        v.formatted(.number.precision(.fractionLength(0...(abs(v) < 10 ? 2 : 0))))
    }

    // MARK: Rooms, places, roles

    static func roomName(_ id: String, rooms: [HubRoom]) -> String {
        let key = rooms.first { $0.id == id }?.name ?? "room.\(id)"
        switch key {
        case "room.commons": return String(localized: "Commons")
        case "room.command": return String(localized: "Command")
        case "room.lab": return String(localized: "Lab")
        case "room.medical": return String(localized: "Medical bay")
        case "room.quarters-1": return String(localized: "Quarters 1")
        case "room.quarters-2": return String(localized: "Quarters 2")
        case "room.quarters-3": return String(localized: "Quarters 3")
        case "room.quarters-4": return String(localized: "Quarters 4")
        case "room.airlock": return String(localized: "Airlock")
        case "room.greenhouse": return String(localized: "Greenhouse")
        case "room.galley": return String(localized: "Galley")
        case "room.gym": return String(localized: "Exercise bay")
        default: return plain(id.replacingOccurrences(of: "-", with: " "))
        }
    }

    static func placeName(_ profile: HubProfile?) -> String? {
        if let typed = profile?.mission?.nameText, !typed.isEmpty { return typed }
        switch profile?.place {
        case "place.iss": return String(localized: "International Space Station")
        case "place.base-moon": return String(localized: "Base on the Moon")
        case "place.base-mars": return String(localized: "Base on Mars")
        case "place.mars-orbit": return String(localized: "Station in Mars orbit")
        case let key?: return plain(key.replacingOccurrences(of: "place.", with: "").replacingOccurrences(of: "-", with: " "))
        case nil: return nil
        }
    }

    static func roleName(_ key: String) -> String {
        switch key {
        case "role.commander": String(localized: "Commander")
        case "role.cmo": String(localized: "Crew Medical Officer")
        case "role.engineer": String(localized: "Flight engineer")
        case "role.scientist": String(localized: "Mission specialist")
        default: plain(key.replacingOccurrences(of: "role.", with: ""))
        }
    }

    /// "sleep_duration" becomes "Sleep duration".
    private static func plain(_ id: String) -> String {
        let text = id.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }
}
