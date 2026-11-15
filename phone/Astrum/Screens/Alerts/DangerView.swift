// Level 3, on every phone: who, where, why it is level 3, the number against
// the limit with its label, the steps card word for word (or that none is
// approved), the message to Earth with its countdown, and "I've seen it".
// Several rooms over the same limit are one event. A drill says so at the
// top and works like any alert; in a recorded story "I've seen it" is
// disabled, says why, and the screen can be closed at any time.

import SwiftUI

struct DangerView: View {
    @Environment(AppModel.self) private var model
    let alertID: String
    @State private var cards: CardsReply?
    @State private var otherCards: CardsReply?
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
        .task { await loadCards() }
    }

    private func content(_ alert: HubAlert, now: Double) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                AlertOriginNotice(alert: alert)
                StatusBadge(text: String(localized: "Dangerous"), tone: .danger)
                    .font(.title3)
                    .accessibilityAddTraits(.isHeader)

                whoAndWhere(alert)
                number(alert, now: now)
                    .projectionCard()
                steps(alert)
                    .projectionCard()
                earth(alert, now: now)
                seen(alert)
            }
            .padding(24)
        }
    }

    // MARK: Parts

    private func whoAndWhere(_ alert: HubAlert) -> some View {
        let world = model.world
        let name = alert.person == model.person ? String(localized: "You") : world.name(of: alert.person)
        let room = roomName(alert.room)
        let signal = Signals.name(alert.signal)
        let event = model.visibleAlerts.filter { $0.stationWide == true && $0.signal == alert.signal && $0.level == 3 }
        return VStack(alignment: .leading, spacing: 8) {
            if alert.stationWide == true {
                let rooms = Set(event.compactMap(\.room)).count
                let people = event.map { world.name(of: $0.person) }.joined(separator: ", ")
                Text("Station-wide: \(signal) is over NASA's limit in \(rooms) rooms. In them: \(people).")
                    .font(.title2.weight(.bold))
                if let lowest = alert.lowestRoom {
                    Text("Lowest reading: \(roomName(lowest.room)), \(Signals.number(lowest.value)) \(alert.unit ?? "").")
                } else {
                    Text("No room is under the limit.")
                }
            } else {
                Text(alert.person == model.person
                     ? String(localized: "You are in \(room), where \(signal) is over NASA's limit.")
                     : String(localized: "\(name) is in \(room), where \(signal) is over NASA's limit."))
                    .font(.title2.weight(.bold))
            }
            if alert.answer == "help" {
                Text("\(name) asked for help.")
            } else if alert.answer == nil, alert.answerBy != nil, alert.stationWide != true {
                Text("\(name) did not answer in time.")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func number(_ alert: HubAlert, now: Double) -> some View {
        let alarm = model.world.alarms.first { $0.room == alert.room && $0.signal == alert.signal }
        return VStack(alignment: .leading, spacing: 6) {
            if let value = alert.value, let unit = alert.unit, let limit = alert.limit {
                Text("\(Signals.number(value)) \(unit), limit \(Signals.number(limit)) \(unit)")
                    .font(.title3.monospacedDigit().weight(.semibold))
                if let over = alert.over {
                    Text("\(Signals.number(over)) \(unit) over the limit")
                }
            }
            HStack(spacing: 8) {
                if let kind = alert.kind { KindBadge(kind: kind) }
                Text(alert.limitSource == "crew" ? String(localized: "A level set by the crew") : String(localized: "NASA's limit"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let alarm, alarm.stale == true, let last = alarm.lastReading {
                let minutes = Int(((now - last.t) / 60_000).rounded())
                Text("Sensor quiet: last reading \(Signals.number(last.value)) \(alarm.unit), \(minutes) minutes ago")
                    .foregroundStyle(.secondary)
            }
            if let since = alert.levelSince {
                Text("Dangerous for \(Countdown.text(ms: now - since))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func steps(_ alert: HubAlert) -> some View {
        if let id = alert.card, let card = cards?.cards.first(where: { $0.id == id }) {
            StepsCardView(card: card)
        } else if let id = alert.card, let card = otherCards?.cards.first(where: { $0.id == id }) {
            StepsCardView(card: card, otherLanguage: true)
        } else if cards == nil && model.isConnected && alert.card != nil {
            ProgressView("Loading the steps card…")
        } else {
            Text("No steps card is approved for this yet.")
                .font(.headline)
        }
    }

    @ViewBuilder
    private func earth(_ alert: HubAlert, now: Double) -> some View {
        if let message = model.world.earthMessages.first(where: { $0.id == alert.earthId }) {
            VStack(alignment: .leading, spacing: 6) {
                ProjectionHeader(.earth, "Earth")
                    .accessibilityAddTraits(.isHeader)
                if alert.isDrill { Text("Drill: a simulated message to Earth.") }
                if now < message.replyAt {
                    Text("Message to Earth sent. A reply can arrive in \(Countdown.minutes(ms: message.replyAt - now)).")
                } else {
                    Text("Earth's reply can be here now.")
                }
                if let seconds = alert.actWithinSeconds, let inTime = alert.earthInTime {
                    Text(inTime
                         ? String(localized: "Earth's reply can arrive within the \(Countdown.text(ms: seconds * 1000)) this card gives.")
                         : String(localized: "This card says act within \(Countdown.text(ms: seconds * 1000)): act on board now."))
                }
            }
            .projectionCard()
            .accessibilityElement(children: .combine)
        } else if let sent = alert.earth {
            Text("Message to Earth sent. A reply can arrive in \(Countdown.minutes(ms: sent.replyAt - now)).")
                .projectionCard()
        }
    }

    @ViewBuilder
    private func seen(_ alert: HubAlert) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let by = alert.seenBy {
                Text("Seen by \(model.world.name(of: by))")
                    .foregroundStyle(.secondary)
            } else {
                Button { acknowledge(alert) } label: {
                    Text("I've seen it").frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: HubStyle.controlRadius))
                .tint(.red)
                .font(.title3.weight(.semibold))
                .disabled(sending || !model.isConnected || alert.isRecorded)
                .accessibilityHint(alert.isRecorded ? Text(AlertWords.recordedNotSent) : Text(verbatim: ""))
            }
            if alert.seenAt != nil || alert.isRecorded {
                Button { model.closedAlerts.insert(alert.key) } label: {
                    Text("Close").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.projection)
                .accessibilityHint(Text("The alert stays on Me until it ends"))
            }
            if let problem {
                Text(problem).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Data

    private func roomName(_ id: String?) -> String {
        id.map { Signals.roomName($0, rooms: model.world.profile?.rooms ?? []) } ?? String(localized: "an unknown room")
    }

    private func acknowledge(_ alert: HubAlert) {
        guard !alert.isRecorded else { return }
        sending = true
        Task {
            problem = await model.acknowledge(alert)
            sending = false
        }
    }

    private func loadCards() async {
        guard let api = model.api else { return }
        cards = try? await api.cards(lang: model.lang)
        if let cards, !cards.otherLanguageOnly.isEmpty {
            otherCards = try? await api.cards(lang: model.lang == "pt" ? "en" : "pt")
        }
    }
}

#Preview {
    DangerView(alertID: SampleData.dangerAlert.id)
        .environment(SampleData.model(alerts: [SampleData.dangerAlert]))
        .preferredColorScheme(.dark)
}
