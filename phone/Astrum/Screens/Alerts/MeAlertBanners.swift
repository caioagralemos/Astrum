// The quiet side of alerts, on Me: a level 1 (mine only, never full screen),
// a level 2 already answered, someone else's level 2 when this phone's owner
// is the Crew Medical Officer, and a level 3 closed after it was seen (tap to
// open it again). A drill's and a recorded story's banners say so first.

import SwiftUI

struct MeAlertBanners: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        // Each banner is a framed card of its own; an alert with no banner here takes no row.
        ForEach(model.visibleAlerts.filter(hasBanner)) { alert in
            banner(for: alert)
                .projectionRow()
        }
    }

    private func hasBanner(_ alert: HubAlert) -> Bool {
        let mine = alert.person == model.person
        return (alert.level == 1 && mine) || (alert.level == 2 && mine && alert.answer == "ok")
            || (alert.level == 2 && !mine) || (alert.level == 3 && model.closedAlerts.contains(alert.key))
    }

    @ViewBuilder
    private func banner(for alert: HubAlert) -> some View {
        let mine = alert.person == model.person
        let world = model.world
        let signal = Signals.name(alert.signal)
        let room = alert.room.map { Signals.roomName($0, rooms: world.profile?.rooms ?? []) } ?? ""

        if alert.level == 1 && mine {
            NavigationLink(value: alert.signal) {
                row(alert.direction == "low" ? String(localized: "\(signal) is below your usual") : String(localized: "\(signal) is above your usual"),
                    mark: .trend(alert.direction == "low" ? .down : .up), tone: .quiet, kind: alert.kind, alert: alert)
            }
        } else if alert.level == 2 && mine && alert.answer == "ok" {
            row(String(localized: "Answered: OK. \(signal) is still over NASA's limit in \(room)."), mark: .symbol("checkmark.circle"), tone: .watch, kind: alert.kind, alert: alert)
        } else if alert.level == 2 && !mine {
            row(String(localized: "\(world.name(of: alert.person)) is in \(room), where \(signal) is over NASA's limit"),
                mark: .symbol("exclamationmark.triangle.fill"), tone: .watch, kind: alert.kind, alert: alert)
        } else if alert.level == 3 && model.closedAlerts.contains(alert.key) {
            Button {
                model.closedAlerts.remove(alert.key)
            } label: {
                row(String(localized: "Dangerous: \(world.name(of: alert.person)) in \(room). Open"), mark: .symbol("exclamationmark.octagon.fill"), tone: .danger, kind: alert.kind, alert: alert)
            }
            .buttonStyle(.plain)
        }
    }

    /// A status sign, or the hub's trend arrow for a reading above or below the usual.
    private enum Mark {
        case symbol(String)
        case trend(HubIconName)
    }

    /// A drill's banner starts "Drill:", a recorded story's "Simulated scenario:".
    private func labelled(_ text: String, _ alert: HubAlert) -> String {
        if alert.isRecorded { return String(localized: "Simulated scenario: \(text)") }
        if alert.isDrill { return String(localized: "Drill: \(text)") }
        return text
    }

    private func row(_ text: String, mark: Mark, tone: StatusTone, kind: Kind?, alert: HubAlert) -> some View {
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
            Text(labelled(text, alert))
                .font(.subheadline)
            Spacer(minLength: 0)
            if let kind { KindBadge(kind: kind) }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
