// The line that sums up a region of Me (or all of them), by rule from the
// phone's own data: no model, no advice, no diagnosis. In order: what is
// outside a stated range or the usual, with its number and what it is judged
// against; what misses an external reference the app carries (NASA's 90
// minutes of exercise a day, NASA's CO2 levels) even when it is usual for the
// person; then what is within, grouped; then what has no current reading.
// "Within your usual" is never the only thing said where a reference is missed.

import Foundation

enum RegionSummary {
    /// One thing the summary can say about a reading or a blood result.
    struct Fact: Hashable, Sendable {
        enum State: Hashable, Sendable {
            /// Outside a stated range, the usual, or part of a warning: its sentence, number and reference included.
            case outside(String)
            /// Misses an external reference (whatever the usual says): its sentence.
            case missesReference(String)
            /// A neutral sentence about a reference that is met.
            case note(String)
            case withinUsual
            case withinRange
            case notEnoughHistory
            case missing
        }
        let name: String
        let state: State
    }

    struct Line: Hashable, Sendable {
        let sentences: [String]
        /// True when something is outside or misses a reference: the warning mark.
        let warns: Bool
        var text: String { sentences.joined(separator: " ") }
    }

    /// The chosen region's line.
    static func line(_ facts: [Fact]) -> Line {
        var sentences: [String] = []
        var warns = false
        var withinUsual: [String] = [], withinRange: [String] = [], unknown: [String] = [], missing: [String] = [], notes: [String] = []
        for fact in facts {
            switch fact.state {
            case .outside(let s), .missesReference(let s): sentences.append(s); warns = true
            case .note(let s): notes.append(s)
            case .withinUsual: withinUsual.append(fact.name)
            case .withinRange: withinRange.append(fact.name)
            case .notEnoughHistory: unknown.append(fact.name)
            case .missing: missing.append(fact.name)
            }
        }
        sentences += notes
        if let list = list(withinRange) {
            sentences.append(withinRange.count == 1 ? String(localized: "\(list) is within range.") : String(localized: "\(list) are within range."))
        }
        if let list = list(withinUsual) {
            sentences.append(withinUsual.count == 1 ? String(localized: "\(list) is within your usual.") : String(localized: "\(list) are within your usual."))
        }
        if let list = list(unknown) { sentences.append(String(localized: "Not enough history yet to compare \(lowered(list)).")) }
        if let list = list(missing) { sentences.append(String(localized: "No current reading for \(lowered(list)).")) }
        return Line(sentences: sentences, warns: warns)
    }

    /// "All": the first warning of each region that has one, then one sentence for the rest.
    static func all(_ regions: [[Fact]]) -> Line {
        let first = regions.map(line).filter(\.warns).compactMap(\.sentences.first)
        let any = regions.contains { !$0.isEmpty }
        guard any else { return Line(sentences: [String(localized: "No readings from the hub yet.")], warns: false) }
        if first.isEmpty { return Line(sentences: [String(localized: "Everything is within your usual or its range.")], warns: false) }
        return Line(sentences: first + [String(localized: "Everything else is within your usual or its range.")], warns: true)
    }

    // MARK: Facts

    /// NASA's exercise figure against a day's total that may still be running (before 18:00 at the reading's time).
    static func exercise(minutes: Double, at date: Date, usual: Standing, calendar: Calendar = .current) -> Fact.State {
        let n = Int(minutes.rounded())
        let target = Signals.exerciseTargetMinutes
        if minutes >= target { return .note(String(localized: "Exercise today is \(n) minutes, at or above NASA's 90 minutes a day.")) }
        if calendar.component(.hour, from: date) < 18 {
            return .missesReference(String(localized: "Exercise so far today: \(n) of NASA's 90 minutes."))
        }
        let gap = minutes < target / 2 ? String(localized: "far below NASA's figure") : String(localized: "below NASA's figure")
        let usualWords: String? = switch usual {
        case .within: String(localized: "usual for you")
        case .above: String(localized: "above your usual")
        case .below: String(localized: "below your usual")
        default: nil
        }
        if let usualWords {
            return .missesReference(String(localized: "Exercise today is \(n) of NASA's 90 minutes a day: \(usualWords), and \(gap)."))
        }
        return .missesReference(String(localized: "Exercise today is \(n) of NASA's 90 minutes a day, \(gap)."))
    }

    /// A reading of the owner's (or the room's air), with the alert about it if there is one.
    static func fact(_ reading: Reading, alert: HubAlert?) -> Fact {
        let name = reading.name
        if reading.stale { return Fact(name: name, state: .missing) }
        let value = Signals.text(reading.row)
        if let alert, let limit = alert.limit {
            return Fact(name: name, state: .outside(String(localized: "\(name) is \(value), past the medical lead's limit of \(Signals.number(limit)).")))
        }
        switch reading.standing {
        case .airOver: return Fact(name: name, state: .outside(String(localized: "CO2 in your room is \(value), over NASA's 3 mmHg limit.")))
        case .airWatch: return Fact(name: name, state: .outside(String(localized: "CO2 in your room is \(value), between NASA's 2.8 and 3 mmHg levels.")))
        case .airOK: return Fact(name: name, state: .note(String(localized: "CO2 in your room is \(value), below NASA's 2.8 mmHg level.")))
        default: break
        }
        if reading.signal == "exercise_minutes", let minutes = reading.row.value, minutes < Signals.exerciseTargetMinutes {
            return Fact(name: name, state: exercise(minutes: minutes, at: reading.row.date, usual: reading.standing))
        }
        switch reading.standing {
        case .above: return Fact(name: name, state: .outside(String(localized: "\(name) is \(value), above your usual.")))
        case .below: return Fact(name: name, state: .outside(String(localized: "\(name) is \(value), below your usual.")))
        case .within: return Fact(name: name, state: reading.inAlert ? .outside(String(localized: "\(name) is \(value), part of an alert.")) : .withinUsual)
        default: return Fact(name: name, state: reading.inAlert ? .outside(String(localized: "\(name) is \(value), part of an alert.")) : .notEnoughHistory)
        }
    }

    /// A blood result against the medical lead's range (hub/medical/blood.json).
    static func fact(_ result: BloodResult, entry: BloodEntry?, name: String) -> Fact? {
        guard result.unitMatches || entry == nil else { return nil }
        let value = Signals.text(result.row)
        let low = entry?.reference_range.low.map(Signals.number) ?? ""
        let high = entry?.reference_range.high.map(Signals.number) ?? ""
        switch result.judgement {
        case "in-range": return Fact(name: name, state: .withinRange)
        case "above", "urgent-above":
            return Fact(name: name, state: .outside(high.isEmpty ? String(localized: "\(name) is \(value), above the medical lead's range.")
                                                     : String(localized: "\(name) is \(value), above the medical lead's range, which ends at \(high).")))
        case "below", "urgent-below":
            return Fact(name: name, state: .outside(low.isEmpty ? String(localized: "\(name) is \(value), below the medical lead's range.")
                                                    : String(localized: "\(name) is \(value), below the medical lead's range, which starts at \(low).")))
        default: return nil
        }
    }

    // MARK: Words

    /// "Hematocrit, potassium and sodium": the first name as written, the rest lower case unless an acronym.
    private static func list(_ names: [String]) -> String? {
        guard let first = names.first else { return nil }
        return ([first] + names.dropFirst().map(lowered)).formatted(.list(type: .and))
    }

    static func lowered(_ name: String) -> String {
        guard let first = name.first, name.prefix(2) != name.prefix(2).uppercased() || name.count == 1 else { return name }
        return first.lowercased() + name.dropFirst()
    }
}
