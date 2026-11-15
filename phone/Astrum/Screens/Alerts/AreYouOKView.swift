// Level 2, on the affected person's phone: "Are you OK?" with the countdown
// to the hub's `answerBy` and two large answers. The screen goes away when
// the hub has the answer (or raises the alert to level 3).

import SwiftUI

struct AreYouOKView: View {
    @Environment(AppModel.self) private var model
    let alertID: String
    @State private var sending = false
    @State private var problem: String?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = model.hubNow(context.date)
            if let alert = model.visibleAlerts.first(where: { $0.id == alertID }) {
                content(alert, now: now)
            } else {
                ContentUnavailableView("This alert has ended", systemImage: "checkmark.circle")
            }
        }
        .background(Color.black)
    }

    private func content(_ alert: HubAlert, now: Double) -> some View {
        let left = (alert.answerBy ?? now) - now
        let world = model.world
        let room = alert.room.map { Signals.roomName($0, rooms: world.profile?.rooms ?? []) } ?? ""
        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                StatusBadge(text: String(localized: "Concerning"), tone: .watch)

                Text(alert.askKey == "alert.enteredOverLimit"
                     ? String(localized: "You entered a room over the limit. Are you OK?")
                     : String(localized: "Are you OK?"))
                    .font(.largeTitle.weight(.bold))
                    .accessibilityAddTraits(.isHeader)

                Text(left > 0 ? String(localized: "\(Countdown.text(ms: left)) to answer") : String(localized: "Time is up. The crew is being told."))
                    .font(.title2.monospacedDigit())
                    .accessibilityAddTraits(.updatesFrequently)

                VStack(alignment: .leading, spacing: 8) {
                    Text("\(Signals.name(alert.signal)) in \(room) is over NASA's limit.")
                    if let value = alert.value, let limit = alert.limit, let unit = alert.unit {
                        Text("\(Signals.number(value)) \(unit), limit \(Signals.number(limit)) \(unit)")
                            .font(.headline.monospacedDigit())
                    }
                    if let kind = alert.kind { KindBadge(kind: kind) }
                }
                .accessibilityElement(children: .combine)

                VStack(spacing: 12) {
                    Button { answer(alert, ok: true) } label: {
                        Text("I am OK").frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.bordered)
                    .tint(.white)

                    Button { answer(alert, ok: false) } label: {
                        Text("I need help").frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                .font(.title3.weight(.semibold))
                .disabled(sending)

                if sending { ProgressView("Sending…") }
                if let problem {
                    Text(problem).foregroundStyle(.secondary)
                }
            }
            .padding(24)
        }
    }

    private func answer(_ alert: HubAlert, ok: Bool) {
        sending = true
        problem = nil
        Task {
            problem = await model.answer(alert, ok: ok)
            sending = false
        }
    }
}

#Preview {
    AreYouOKView(alertID: SampleData.askAlert.id)
        .environment(SampleData.model(alerts: [SampleData.askAlert]))
        .preferredColorScheme(.dark)
}
