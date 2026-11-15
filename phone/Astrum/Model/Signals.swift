// What the phone knows about each signal: its name (the hub's wording, from
// hub/engine/strings.ts, in the String Catalog), the body region it belongs
// to, how its value is said, and how long a reading of it stays current.
// Rooms, places and roles are named here too, from the hub's string keys.

import Foundation
#if DEBUG
import os
#endif

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
            ["breathing_rate", "respiratory_rate", "blood_oxygen", "co2"]
        case .body:
            ["exercise_minutes", "steps", "active_energy", "body_temperature", "sound_level"]
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

    /// The day's totals, nightly values and answers (Freshness.swift: vital signs never are).
    static func isDaily(_ signal: String) -> Bool { Freshness.isDaily(signal) }

    /// Not the current value any more: the one rule in Freshness.swift.
    static func isStale(_ row: Row, now: Double) -> Bool {
        !Freshness.isCurrent(signal: row.signal, t: row.t, now: now)
    }

    /// NASA's daily exercise on the ISS, 1.5 hours (hub/engine/crew.ts), in minutes.
    static let exerciseTargetMinutes = 90.0

    /// NASA's two CO2 levels (hub/engine/exposure.ts): headaches from 2.8, the 1-hour limit 3.
    static let co2HeadacheLevel = 2.8
    static let co2Limit = 3.0

    // MARK: Names

    /// The only way a signal key becomes words, on every screen, notification,
    /// widget, chat bubble and VoiceOver label: the hub's own name for it
    /// (strings.ts `signal.*`, her blood file, her follow-up questions), or,
    /// for a key nobody has named yet, plain words, never the key itself.
    static func name(_ signal: String) -> String {
        if let named = knownName(signal) { return named }
        #if DEBUG
        namesLog.debug("No name for the signal key \(signal, privacy: .public): add one to Signals.knownName")
        #endif
        return fallbackName(signal)
    }

    #if DEBUG
    private static let namesLog = Logger(subsystem: "Astrum", category: "names")
    #endif

    /// The name written for `signal`, or nil when it has none yet.
    static func knownName(_ signal: String) -> String? {
        switch signal {
        // Body (strings.ts signal.*).
        case "heart_rate": String(localized: "Heart rate")
        case "resting_heart_rate": String(localized: "Resting heart rate")
        case "hrv": String(localized: "Heart rate variability")
        case "blood_pressure_systolic": String(localized: "Blood pressure, upper")
        case "blood_pressure_diastolic": String(localized: "Blood pressure, lower")
        case "breathing_rate", "respiratory_rate": String(localized: "Breathing rate")
        case "blood_oxygen": String(localized: "Blood oxygen")
        case "body_temperature": String(localized: "Body temperature")
        case "sleep_duration": String(localized: "Sleep last night")
        case "sleep_efficiency": String(localized: "Time in bed asleep")
        case "sleep_awakenings": String(localized: "Times awake in the night")
        case "mood.stress", "stress": String(localized: "Stress")
        case "mood.fatigue": String(localized: "Tiredness")
        case "mood.sleepy": String(localized: "Sleepiness")
        case "exercise_minutes": String(localized: "Exercise today")
        case "steps": String(localized: "Steps today")
        case "active_energy": String(localized: "Active energy today")
        case "sound_level": String(localized: "Sound around you")
        // Check-ins: the daily questions, then her follow-up, fasting and symptom questions.
        case "checkin.headache": String(localized: "Headache")
        case "checkin.mood", "mood": String(localized: "Mood")
        case "checkin.stress": String(localized: "Stress (check-in)")
        case "checkin.fatigue": String(localized: "Tiredness (check-in)")
        case "checkin.note": String(localized: "Note")
        case "checkin.got_better": String(localized: "Got better (check-in)")
        case "checkin.fasting": String(localized: "Fasting (check-in)")
        case "checkin.bp_slept_well": String(localized: "Slept well (check-in)")
        case "checkin.bp_heavy_head": String(localized: "Heavy head and unwell (check-in)")
        case "checkin.bp_diagnosed": String(localized: "High blood pressure diagnosed (check-in)")
        case "checkin.bp_took_medicine": String(localized: "Took the medicine (check-in)")
        case "checkin.bp_measured": String(localized: "Blood pressure entered (check-in)")
        case "checkin.leg_colour_changed": String(localized: "Leg or arm colour changed (check-in)")
        case "checkin.leg_pain": String(localized: "Pain (check-in)")
        case "checkin.leg_inflammation": String(localized: "Signs of inflammation (check-in)")
        case "checkin.glucose_high_signs": String(localized: "Signs of high glucose (check-in)")
        case "checkin.sodium_group1": String(localized: "Confusion, headache or nausea (check-in)")
        case "checkin.sodium_group2": String(localized: "Very sleepy or a seizure (check-in)")
        case "checkin.calcium_symptoms": String(localized: "Tingling, cramps or weakness (check-in)")
        case let key where key.hasPrefix("checkin.q_"): String(localized: "Answer to a steps card question")
        // Blood (hub/medical/blood.json, stored as blood.<id> with _ for -).
        case "blood.glucose": String(localized: "Glucose")
        case "blood.sodium": String(localized: "Sodium")
        case "blood.potassium": String(localized: "Potassium")
        case "blood.ionized_calcium": String(localized: "Ionized calcium")
        case "blood.ph": String(localized: "Blood pH")
        case "blood.hematocrit": String(localized: "Hematocrit")
        case "blood.hemoglobin": String(localized: "Hemoglobin")
        // Cabin (and the card signs' cabin_ forms).
        case "co2", "cabin_co2": String(localized: "CO2")
        case "temperature", "cabin_temperature": String(localized: "Temperature")
        case "humidity", "cabin_humidity": String(localized: "Humidity")
        case "pressure", "cabin_pressure": String(localized: "Cabin pressure")
        case "oxygen", "cabin_oxygen": String(localized: "Oxygen")
        case "noise": String(localized: "Noise")
        case "light": String(localized: "Light")
        case "vibration": String(localized: "Vibration")
        case "radiation": String(localized: "Radiation")
        case "dose": String(localized: "Radiation dose")
        case "air_quality": String(localized: "Air quality")
        // The rest the hub can send in an alert or a message.
        case "earth.message": String(localized: "Message to Earth")
        case "needs-someone": String(localized: "Needs someone with them")
        case "asked-help": String(localized: "Asked for help")
        case "time_alone": String(localized: "Time alone")
        case "conflict": String(localized: "Conflict with a crewmate")
        // A base-wide event a crewmate declared: the alert's signal is "event.<kind>" (strings.ts event.*).
        case "event.dust_storm": String(localized: "Dust storm")
        case "event.solar_particle_event": String(localized: "Solar particle event")
        case "event.pressure_loss": String(localized: "Loss of pressure")
        case "event.fire": String(localized: "Fire")
        case "event.quake": String(localized: "Quake")
        case "event.meteoroid_impact": String(localized: "Meteoroid impact")
        case "event.other": String(localized: "Other event")
        default: nil
        }
    }

    /// A key nobody has named yet, as plain words: "blood.salt" becomes "Salt",
    /// "sleep_deep_minutes" "Sleep deep minutes". Never the key itself.
    static func fallbackName(_ signal: String) -> String {
        var key = Substring(signal)
        if let dot = key.lastIndex(of: "."), key.index(after: dot) < key.endIndex { key = key[key.index(after: dot)...] }
        let words = key.split(whereSeparator: { $0 == "_" || $0 == "-" || $0 == "." || $0 == " " }).joined(separator: " ")
        guard let first = words.first else { return String(localized: "A reading") }
        return first.uppercased() + words.dropFirst().lowercased()
    }

    /// A signal named inside a sentence: the hub's English words or a key with
    /// its underscores turned to spaces ("blood.glucose", "heart rate") become
    /// this language's name, lower case unless it is an acronym ("CO2").
    /// Words that are not a signal stay as the hub sent them.
    static func inSentence(_ hubWords: String) -> String {
        let key = hubWords.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "_")
        let name: String
        if let known = knownName(key) { name = known } else if key.contains(".") { name = fallbackName(key) } else { return hubWords }
        guard let first = name.first, name.prefix(2) != name.prefix(2).uppercased() || name.count == 1 else { return name }
        return first.lowercased() + name.dropFirst()
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
        if source == "istat:photo" { return String(localized: "Blood result read from a photo, \(kind)") }
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
