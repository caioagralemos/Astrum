// Level 2, on the affected person's phone (the owner's sketch, Case B "the
// question"), in the emergency screens' projection frame: "Astrum is checking
// on you", "Are you OK?", why (the hub's sentence for this alert), the reading,
// the countdown to the hub's `answerBy` as a ring, then the card's first
// sentence ("Meanwhile") and two answers. An answer stops the countdown at once;
// the screen goes away when the hub's state has the answer (or raises the alert
// to level 3, or ends it). In a recorded story the buttons are disabled and the
// screen says why (AlertOriginNotice). VoiceOver hears the time left when the
// screen opens and at 30 and 10 seconds, never every second.

import SwiftUI

struct AreYouOKView: View {
    @Environment(AppModel.self) private var model
    let alertID: String
    @State private var sending = false
    @State private var problem: String?
    @State private var cards: CardsReply?
    @AccessibilityFocusState private var headingFocused: Bool

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
        .task {
            guard let api = model.api else { return }
            cards = try? await api.cards(lang: model.lang)
        }
    }

    private func content(_ alert: HubAlert, now: Double) -> some View {
        let left = max(0, (alert.answerBy ?? now) - now)
        let seconds = Int((left / 1000).rounded(.up))
        let world = model.world
        let room = alert.room.map { Signals.roomName($0, rooms: world.profile?.rooms ?? []) }
        let sent = alert.answer
        let card = alert.card.flatMap { id in cards?.cards.first { $0.id == id } }
        return EmergencyFrame {
            AlertOriginNotice(alert: alert)
            VStack(alignment: .leading, spacing: 10) {
                EmergencyKicker(text: String(localized: "Astrum is checking on you"), symbol: "exclamationmark.circle")
                Text("Are you OK?")
                    .font(.largeTitle.weight(.bold))
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityFocused($headingFocused)

            Text(AlertText.headline(alert, viewer: model.person, name: world.name(of: alert.person), room: room ?? ""))
                .font(.subheadline)
                .padding(.top, 10)
            AlertReadingLine(alert: alert, room: room, mark: HubStyle.watch, now: now)
                .padding(.top, 8)

            countdown(alert, sent: sent, left: left, seconds: seconds)
                .padding(.top, 14)

            if let card, let first = card.steps.first {
                EmergencyRule()
                EmergencyFirstStep(label: "Meanwhile", step: first, full: false)
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(HubStyle.muted).padding(.top, 12)
            }
        } buttons: {
            EmergencyButtons {
                EmergencyButton("I'm OK", filled: false) { answer(alert, ok: true) }
                    .accessibilityHint(hint(alert))
                EmergencyButton("I need help", filled: true) { answer(alert, ok: false) }
                    .accessibilityHint(hint(alert))
            }
            .disabled(sending || sent != nil || alert.isRecorded)
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { headingFocused = true }
            if sent == nil, seconds > 0 { announce(seconds) }
        }
        .onChange(of: seconds) { old, new in
            guard sent == nil else { return }
            if (old > 30 && new <= 30) || (old > 10 && new <= 10) { announce(new) }
        }
    }

    /// The ring with the time left, or the answer once sent.
    @ViewBuilder
    private func countdown(_ alert: HubAlert, sent: String?, left: Double, seconds: Int) -> some View {
        if let sent {
            VStack(alignment: .leading, spacing: 8) {
                Label(sent == "ok" ? String(localized: "Answer sent: I am OK.") : String(localized: "Answer sent: I need help."), systemImage: "checkmark.circle")
                    .font(.headline)
                if sending { ProgressView("Waiting for the hub…") }
            }
        } else {
            let total = max(1, (alert.answerBy ?? 0) - (alert.askedAt ?? alert.levelSince ?? alert.since ?? 0))
            HStack(spacing: 12) {
                ZStack {
                    Circle().stroke(.white.opacity(HubStyle.hairline), lineWidth: 2.5)
                    Circle()
                        .trim(from: 0, to: min(1, left / total))
                        .stroke(.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: String(format: "%d:%02d", seconds / 60, seconds % 60))
                        .font(.title3.weight(.semibold).monospacedDigit())
                    Text(seconds > 0 ? String(localized: "If you don't answer, your crew is told.") : String(localized: "Time is up. The crew is being told."))
                        .font(.caption)
                        .foregroundStyle(HubStyle.muted)
                }
            }
            // One quiet element: read when reached, announced at the start and at 30 and 10 s.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(seconds > 0
                ? Text("\(Countdown.text(ms: left)) to answer") + Text(verbatim: ". ") + Text("If you don't answer, your crew is told.")
                : Text("Time is up. The crew is being told."))
        }
    }

    private func announce(_ seconds: Int) {
        AccessibilityNotification.Announcement(String(localized: "\(Countdown.text(ms: Double(seconds) * 1000)) to answer")).post()
    }

    /// Why the buttons do nothing in a recorded story, for VoiceOver.
    private func hint(_ alert: HubAlert) -> Text {
        alert.isRecorded ? Text(AlertWords.recordedNotSent) : Text(verbatim: "")
    }

    private func answer(_ alert: HubAlert, ok: Bool) {
        guard !alert.isRecorded else { return }
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
