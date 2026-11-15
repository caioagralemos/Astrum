// The quiet side of alerts, on Me: a level 1 (mine only, never full screen),
// a level 2 already answered, someone else's level 2 when this phone's owner
// is the Crew Medical Officer, and a level 3 closed after it was seen (tap to
// open it again). A drill's and a recorded story's banners say so first.
// They sit under the region buttons: all of them, or the chosen region's
// (someone else's, and one with no region, show under every region; a card's
// match shows under All and the region its card is about, if any).

import SwiftUI

struct MeAlertBanners: View {
    @Environment(AppModel.self) private var model
    /// The chosen region; nil shows every banner.
    var region: BodyRegion?
    /// The medical lead's cards, to name the one a finding matched.
    var cards: [CardView] = []
    /// Opens a matched card's steps (its id).
    var openCard: (String) -> Void = { _ in }

    var body: some View {
        // Each banner is a framed card of its own; an alert with no banner here takes no row.
        ForEach(Self.alerts(in: region, model: model, cards: cards)) { alert in
            banner(for: alert)
                .projectionRow()
        }
    }

    /// The alerts with a banner, in the region (nil: all). An alert about no region of the owner's body shows in every region.
    static func alerts(in region: BodyRegion?, model: AppModel, cards: [CardView] = []) -> [HubAlert] {
        model.visibleAlerts.filter { alert in
            guard text(for: alert, model: model, cards: cards) != nil else { return false }
            guard let region else { return true }
            guard let own = Readings.region(of: alert, person: model.person) else { return AlertText.findingCard(alert) == nil }
            return own == region
        }
    }

    /// The banner's sentence, or nil when the alert has no banner here (the takeover screens show it instead).
    static func text(for alert: HubAlert, model: AppModel, cards: [CardView] = []) -> String? {
        let mine = alert.person == model.person
        let world = model.world
        let signal = Signals.name(alert.signal)
        let room = alert.room.map { Signals.roomName($0, rooms: world.profile?.rooms ?? []) } ?? ""
        let headline = AlertText.headline(alert, viewer: model.person, name: world.name(of: alert.person), room: room)
        let text: String
        if alert.isSettled {
            // "Emergency settled": the alert stays listed with who and when, as on the hub.
            let time = settledTime(alert.settledAt ?? model.hubNow())
            let settled = alert.settledBy.map { String(localized: "Settled by \(world.name(of: $0)) at \(time)") }
                ?? String(localized: "Settled at the shared screen at \(time)")
            text = (alert.declared != nil ? signal : headline) + "\n" + settled
        } else if let event = alert.declared, alert.level < 3 || model.closedAlerts.contains(alert.closeKey) {
            // A base-wide event, for everyone: a warning's notice, or the event itself once closed (tap to open it again).
            let shelter = event.shelter.map { Signals.roomName($0, rooms: world.profile?.rooms ?? []) }
            let lines = AlertText.eventLines(event, by: world.name(of: alert.person), shelter: shelter, now: model.hubNow())
            let first = event.stage == "warning" ? [] : [alert.level == 3 ? String(localized: "Dangerous: \(signal)") : signal]
            text = (first + lines).joined(separator: "\n")
        } else if let card = AlertText.findingCard(alert), alert.level < 3 || model.closedAlerts.contains(alert.closeKey) {
            let match = AlertText.cardMatch(alert, viewer: model.person, name: world.name(of: alert.person),
                                            cardTitle: cards.first { $0.id == card }?.title)
            text = alert.level == 3 ? String(localized: "Dangerous: \(match) Open") : match
        } else if alert.level == 1 && mine {
            text = headline
        } else if alert.level == 2 && mine && alert.answer == "ok" {
            text = String(localized: "Answered: OK. \(signal) is still over NASA's limit in \(room).")
        } else if alert.level == 2 && mine && model.closedAlerts.contains(alert.closeKey) {
            text = headline
        } else if alert.level == 2 && !mine {
            text = headline
        } else if alert.level == 3 && model.closedAlerts.contains(alert.closeKey) {
            text = alert.reason == "room-limit" ? String(localized: "Dangerous: \(world.name(of: alert.person)) in \(room). Open")
                                                : String(localized: "Dangerous: \(headline) Open")
        } else {
            return nil
        }
        // A drill's banner starts "Drill:", a recorded story's "Simulated scenario:".
        if alert.isRecorded { return String(localized: "Simulated scenario: \(text)") }
        if alert.isDrill { return String(localized: "Drill: \(text)") }
        return text
    }

    @ViewBuilder
    private func banner(for alert: HubAlert) -> some View {
        let mine = alert.person == model.person
        let text = Self.text(for: alert, model: model, cards: cards) ?? ""

        if alert.isSettled {
            row(text, mark: .symbol("checkmark.circle"), tone: .quiet, kind: alert.kind)
        } else if let card = AlertText.findingCard(alert), alert.level < 3 {
            // A card's match has no reading behind it: it opens the card it names.
            Button { openCard(card) } label: {
                row(text, mark: .symbol("exclamationmark.triangle.fill"), tone: .watch, kind: alert.kind)
            }
            .buttonStyle(.plain)
        } else if alert.level == 1 && mine && Signals.region(of: alert.signal) != nil {
            NavigationLink(value: alert.signal) {
                row(text, mark: .trend(alert.direction == "low" ? .down : .up), tone: .quiet, kind: alert.kind)
            }
        } else if alert.level == 1 && mine {
            // Nothing behind it to open ("needs someone"): a plain row.
            row(text, mark: .symbol("exclamationmark.triangle.fill"), tone: .watch, kind: alert.kind)
        } else if alert.declared != nil && alert.level < 3 {
            row(text, mark: .symbol("exclamationmark.triangle.fill"), tone: .watch, kind: alert.kind)
        } else if alert.level == 2 && mine {
            row(text, mark: .symbol("checkmark.circle"), tone: .watch, kind: alert.kind)
        } else if alert.level == 2 {
            row(text, mark: .symbol("exclamationmark.triangle.fill"), tone: .watch, kind: alert.kind)
        } else {
            Button {
                model.closedAlerts.remove(alert.closeKey)
            } label: {
                row(text, mark: .symbol("exclamationmark.octagon.fill"), tone: .danger, kind: alert.kind)
            }
            .buttonStyle(.plain)
        }
    }

    /// A settled time as the hub writes it: 24-hour HH:MM.
    private static func settledTime(_ ms: Double) -> String {
        let format = DateFormatter()
        format.dateFormat = "HH:mm"
        return format.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// A status sign, or the hub's trend arrow for a reading above or below the usual.
    private enum Mark {
        case symbol(String)
        case trend(HubIconName)
    }

    private func row(_ text: String, mark: Mark, tone: StatusTone, kind: Kind?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Group {
                switch mark {
                case .symbol(let name): Image(systemName: name)
                case .trend(let name):
                    HubIcon(name, size: 16, weight: 2.2, relativeTo: .subheadline)
                        .alignmentGuide(.firstTextBaseline) { $0.height * 0.8 }
                }
            }
            .foregroundStyle(tone.color)
            .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
            Spacer(minLength: 0)
            if let kind { KindBadge(kind: kind) }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
