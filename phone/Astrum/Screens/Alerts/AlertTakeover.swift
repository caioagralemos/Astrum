// Full-screen alerts over any tab (NASA/EMERGENCY-SPEC.md). Only alerts the
// owner is told about are ever considered:
//   level 2, mine, not answered yet  -> "Are you OK?" (AreYouOKView)
//   level 3, anyone                   -> who, where, the steps (DangerView)
// A level 3 can be closed once someone has seen it; it stays on Me as a
// banner until it ends. Level 1 is never full screen.
//
// A drill's alerts are real and fully answerable; they say "Drill" at the top.
// A recorded story's alerts are the exception: they look exactly like the real
// screens (so they can be shown), say plainly that a recorded story is playing,
// and their buttons are disabled, since nothing in a recording can be answered.

import SwiftUI

struct AlertPresentation: Identifiable, Hashable {
    enum Style: Hashable {
        case ask
        case danger
    }

    let alertID: String
    let style: Style
    /// Changes when the alert escalates, so the right screen is shown.
    var id: String { "\(alertID)|\(style)" }
}

extension AppModel {
    /// The alert that should be on screen now, if any. A question to the owner comes first.
    var takeover: AlertPresentation? {
        let alerts = visibleAlerts
        // An answer just sent keeps the question on screen, countdown stopped, until the hub confirms it.
        if let ask = alerts.first(where: { $0.person == person && $0.level == 2 && ($0.answer == nil || pendingAnswers[$0.id] != nil) && $0.answerBy != nil }) {
            return AlertPresentation(alertID: ask.id, style: .ask)
        }
        let open = alerts.filter { $0.level == 3 && !closedAlerts.contains($0.key) }
        // The owner's own first, then the rest in a stable order.
        if let danger = open.first(where: { $0.person == person }) ?? open.min(by: { $0.id < $1.id }) {
            return AlertPresentation(alertID: danger.id, style: .danger)
        }
        return nil
    }
}

struct AlertTakeover: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        // Read here, so the cover follows the alerts as they change.
        let presented = model.takeover
        content
            .fullScreenCover(item: .constant(presented)) { presentation in
                switch presentation.style {
                case .ask: AreYouOKView(alertID: presentation.alertID)
                case .danger: DangerView(alertID: presentation.alertID)
                }
            }
            .onChange(of: model.openedAlertID) { _, id in
                // A tapped notification opens a closed level 3 again.
                guard let id, let alert = model.visibleAlerts.first(where: { $0.id == id }) else { return }
                model.closedAlerts.remove(alert.key)
                model.openedAlertID = nil
            }
    }
}

/// The first thing on an alert screen when the alert is not a plain live one: a drill (real,
/// answerable, on a simulated reading) or a recorded story (nothing can be answered).
struct AlertOriginNotice: View {
    let alert: HubAlert

    var body: some View {
        if alert.isRecorded {
            notice(title: String(localized: "Simulated scenario"), text: AlertWords.recordedNotSent, symbol: "play.rectangle")
        } else if alert.isDrill {
            notice(title: String(localized: "Drill"), text: AlertWords.drillNotice, symbol: "figure.run")
        }
    }

    private func notice(title: String, text: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: symbol)
                .font(.title3.weight(.bold))
                .textCase(.uppercase)
            Text(text)
                .font(.subheadline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: HubStyle.controlRadius).strokeBorder(.white.opacity(0.6), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
