// An alert in words, the same on the lock screen, the alert screens, Me's
// banners and its summary line. Every signal is named by Signals.name, never
// by its key. The hub's sentences (strings.ts alert.*) where it has them: a
// room over NASA's limit is "Leo is in the Lab, where CO2 is over NASA's
// limit" (only cabin signals have room limits, all singular nouns). Anything
// about a person's own reading is "<Name>: <state>", which reads right for
// every name in both languages ("Steps today: unusual for you", "Glicose:
// 250 mg/dL, além do limite da responsável médica de 180").

import Foundation

enum AlertText {
    /// The alert's one sentence, from the viewer's side (`name`: the person's name; `room`: the room's).
    static func headline(_ alert: HubAlert, viewer: String, name: String, room: String) -> String {
        let mine = alert.person == viewer
        let signal = Signals.name(alert.signal)
        switch alert.reason {
        case "room-limit":
            if alert.stationWide == true { return String(localized: "Station-wide: \(signal) is over NASA's limit.") }
            return mine
                ? String(localized: "You are in \(room), where \(signal) is over NASA's limit.")
                : String(localized: "\(name) is in \(room), where \(signal) is over NASA's limit.")
        case "unusual":
            guard mine else { return String(localized: "\(signal): unusual for \(name)") }
            switch alert.direction {
            case "high": return String(localized: "\(signal): above your usual")
            case "low": return String(localized: "\(signal): below your usual")
            default: return String(localized: "\(signal): unusual for you")
            }
        case "declared":
            // A base-wide event: its kind's name ("Dust storm"); eventLines say the rest.
            return signal
        default:
            return finding(alert, mine: mine, name: name, signal: signal)
        }
    }

    /// The medical lead's findings: her limits, "needs someone", "did not get better", a card's rule.
    private static func finding(_ alert: HubAlert, mine: Bool, name: String, signal: String) -> String {
        switch alert.signal {
        case "needs-someone":
            return mine ? String(localized: "You need someone with you.") : String(localized: "\(name) needs someone with them.")
        case "asked-help":
            return mine ? String(localized: "You asked for help.") : String(localized: "\(name) asked for help.")
        case "checkin.got_better":
            return mine ? String(localized: "You said it did not get better.") : String(localized: "\(name) said it did not get better.")
        case "":
            return mine
                ? String(localized: "The medical lead's rules matched what you reported.")
                : String(localized: "The medical lead's rules matched what \(name) reported.")
        default:
            if let value = alert.value, let limit = alert.limit {
                let reading = [Signals.number(value), alert.unit ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
                let past = Signals.number(limit)
                return mine
                    ? String(localized: "\(signal): \(reading), past the medical lead's limit of \(past)")
                    : String(localized: "\(signal) for \(name): \(reading), past the medical lead's limit of \(past)")
            }
            return mine
                ? String(localized: "\(signal): flagged by the medical lead's rules")
                : String(localized: "\(signal) for \(name): flagged by the medical lead's rules")
        }
    }

    // MARK: A card's match

    /// The card a finding of hers was raised from: the alert's card, else its id ("<person>|finding|card:<id>").
    static func findingCard(_ alert: HubAlert) -> String? {
        guard alert.reason == "finding" else { return nil }
        if let card = alert.card { return card }
        guard let range = alert.id.range(of: "|finding|card:") else { return nil }
        return alert.id[range.upperBound...].split(separator: "+").first.map(String.init)
    }

    /// The region a card is about, from its id: the air's cards are Lungs and air, the headache card the head's.
    /// The hub's CardView carries no signals, so anything else belongs to no region (it shows under All only).
    static func region(ofCard id: String) -> BodyRegion? {
        switch id {
        case "high-co2", "low-oxygen": .lungs
        case "headache": .head
        default: nil
        }
    }

    /// A card's match, by rule: which card applies (its title when the phone has it) and who has been told.
    static func cardMatch(_ alert: HubAlert, viewer: String, name: String, cardTitle: String?) -> String {
        let mine = alert.person == viewer
        guard let cardTitle else {
            return mine ? String(localized: "Something you reported matched one of the medical lead's cards. Open it to see which.")
                        : String(localized: "Something \(name) reported matched one of the medical lead's cards. Open it to see which.")
        }
        let applies = mine ? String(localized: "The medical lead's card “\(cardTitle)” applies to what you reported.")
                           : String(localized: "The medical lead's card “\(cardTitle)” applies to what \(name) reported.")
        let told: String?
        switch alert.toldTo {
        case .everyone: told = String(localized: "Everyone on board has been told.")
        case .people(let ids): told = ids.contains { $0 != alert.person } ? String(localized: "The medical officer has been told.") : nil
        }
        return [applies, told].compactMap { $0 }.joined(separator: " ")
    }

    // MARK: A declared event

    /// A base-wide event in the hub's own sentences (strings.ts event.*, as ui/src/panels/Events.tsx puts them),
    /// one line each: when, where to go, the crewmate's note, who declared it. `by`: the declarer's name;
    /// `shelter`: the room's name; `now`: the hub's clock, for the warning's "in about N h".
    static func eventLines(_ event: HubAlert.Declared, by: String, shelter: String?, now: Double) -> [String] {
        let kind = Signals.name("event.\(event.kind)")
        var lines: [String] = []
        if event.stage == "warning", let expected = event.expectedAt {
            lines.append(String(localized: "\(kind) expected at \(clock(expected)), in about \(hoursAhead(expected - now)) h."))
        } else if let expected = event.expectedAt {
            lines.append(String(localized: "Now") + ". " + String(localized: "Expected at \(clock(expected))"))
        } else {
            lines.append(String(localized: "Now"))
        }
        if let shelter { lines.append(String(localized: "Go to \(shelter)")) }
        // event.quoted is the same in both languages: the note in curly quotes, as the crewmate wrote it.
        if let note = event.note, !note.isEmpty { lines.append("“\(note)”") }
        lines.append(event.source == "earth"
            ? String(localized: "Forecast from Earth") + ". " + String(localized: "Entered by \(by) at \(clock(event.at))")
            : String(localized: "Declared by \(by) at \(clock(event.at))"))
        return lines
    }

    /// A time on the hub's clock, as the phone shows times.
    private static func clock(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .shortened)
    }

    /// Hours ahead as the hub rounds them: one decimal under an hour, whole hours after.
    private static func hoursAhead(_ ms: Double) -> String {
        let hours = max(0, ms / 3_600_000)
        return Signals.number(hours < 1 ? (hours * 10).rounded() / 10 : hours.rounded())
    }

    // MARK: Notifications

    /// A notification's title and body for an alert. `shelter`: a declared event's room name; `now`: the hub's clock.
    static func notification(_ alert: HubAlert, viewer: String, name: String, room: String,
                             shelter: String? = nil, now: Double = Date.now.timeIntervalSince1970 * 1000) -> (title: String, body: String) {
        let mine = alert.person == viewer
        let signal = Signals.name(alert.signal)
        if let event = alert.declared {
            // Never "Are you OK?": a warning is a notice to acknowledge, the event itself is level 3 for everyone.
            let body = eventLines(event, by: name, shelter: shelter, now: now).joined(separator: "\n")
            return (alert.level >= 3 ? String(localized: "Dangerous: \(signal)") : signal, body)
        }
        switch alert.reason {
        case "room-limit":
            if alert.stationWide == true {
                return (String(localized: "Dangerous: \(signal) over NASA's limit in several rooms"), String(localized: "\(signal) is over NASA's limit there."))
            }
            let title: String
            if alert.level >= 3 {
                title = mine ? String(localized: "Dangerous: you are in \(room)") : String(localized: "Dangerous: \(name) is in \(room)")
            } else {
                title = mine ? String(localized: "You are in \(room): \(signal) over NASA's limit") : String(localized: "\(name) is in \(room): \(signal) over NASA's limit")
            }
            var body = String(localized: "\(signal) is over NASA's limit there.")
            if let value = alert.value, let limit = alert.limit, let unit = alert.unit {
                body = String(localized: "\(signal) has averaged \(Signals.number(value)) \(unit). NASA's limit is \(Signals.number(limit)) \(unit).")
            }
            if alert.level == 2 && mine { body += " " + String(localized: "Are you OK? Open Astrum to answer.") }
            return (title, body)
        case "unusual":
            return (headline(alert, viewer: viewer, name: name, room: room), String(localized: "Open Astrum to see what changed."))
        default:
            let words = headline(alert, viewer: viewer, name: name, room: room)
            return (alert.level >= 3 ? String(localized: "Dangerous: \(words)") : words, String(localized: "Open Astrum to see it."))
        }
    }
}
