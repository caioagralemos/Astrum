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
        default:
            return finding(alert, mine: mine, name: name, signal: signal)
        }
    }

    /// The medical lead's findings: her limits, "needs someone", "did not get better", a card's rule.
    private static func finding(_ alert: HubAlert, mine: Bool, name: String, signal: String) -> String {
        switch alert.signal {
        case "needs-someone":
            return mine ? String(localized: "You need someone with you.") : String(localized: "\(name) needs someone with them.")
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

    // MARK: Notifications

    /// A notification's title and body for an alert.
    static func notification(_ alert: HubAlert, viewer: String, name: String, room: String) -> (title: String, body: String) {
        let mine = alert.person == viewer
        let signal = Signals.name(alert.signal)
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
