// Level 3, on every phone (the owner's sketch, phone-emergency-step1.html), in one
// projection frame. About someone else (Case A): "Emergency", the alert's name,
// the room and who is there, the reading with its kind, limit and age, why it is
// level 3, Earth's reply time, then the card's first step word for word, and
// pinned at the bottom "I've seen it" and "Start help" (the steps). About this
// phone's owner (Case B, after): the same layout turned around: "Your crew has
// been told", who and when, the reading, the reason, Earth, "What you can do
// now" and "Start help"; no "I've seen it". A privacy-restricted alert shows only
// what the hub sent. In a recorded story the screen can be closed at any time.

import SwiftUI

struct DangerView: View {
    @Environment(AppModel.self) private var model
    let alertID: String
    @State private var cards: CardsReply?
    @State private var otherCards: CardsReply?
    @State private var sending = false
    @State private var problem: String?
    @State private var openCard: CardView?
    /// The person has acted on it here ("I've seen it", or back from the steps): the screen can be closed.
    @State private var seen = false
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
        .accessibilityHidden(openCard != nil)
        .task { await loadCards() }
        .stepsModal(item: $openCard) { _ in returnedFromSteps() }
    }

    private func content(_ alert: HubAlert, now: Double) -> some View {
        let card = card(for: alert)
        let mine = isMine(alert)
        return EmergencyFrame {
            if alert.isRecorded { AlertOriginNotice(alert: alert).padding(.bottom, 12) }
            heading(alert, card: card, mine: mine)
            AlertReadingLine(alert: alert, room: mine ? roomName(alert.room) : nil, mark: HubStyle.over,
                             reason: reason(alert, mine: mine), now: now)
                .padding(.top, 10)
            earth(alert, now: now)
                .padding(.top, 10)
            EmergencyRule()
            firstAction(alert, card: card, mine: mine)
        } buttons: {
            actions(alert, card: card, mine: mine)
        }
        .accessibilityAction(.escape) { if closable(alert, mine: mine) { close(alert) } }
        .onAppear {
            // Into the screen at once, on its name and room (the cover's own focus lands on the first element otherwise).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { headingFocused = true }
        }
    }

    // MARK: Parts

    /// The small line, the title and where (or who was told): one heading, announced first.
    private func heading(_ alert: HubAlert, card: CardView?, mine: Bool) -> some View {
        let top = ([alert.isDrill ? String(localized: "Drill") : nil, String(localized: "Emergency"),
                    mine ? String(localized: "about you") : nil] as [String?]).compactMap { $0 }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 10) {
            EmergencyKicker(text: top, symbol: "exclamationmark.triangle")
            Text(mine ? String(localized: "Your crew has been told.") : name(alert, card: card))
                .font(.title.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            if mine {
                told(alert)
            } else if let where_ = place(alert) {
                Label(where_, systemImage: "mappin.and.ellipse")
                    .font(.callout)
            }
            if let event = alert.declared {
                ForEach(Array(eventDetails(alert, event).enumerated()), id: \.offset) { _, line in
                    Text(line).font(.footnote).foregroundStyle(HubStyle.muted)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityFocused($headingFocused)
    }

    /// Who was told and when: the others' initials in small outlined circles, their names (or "Everyone"), the time.
    private func told(_ alert: HubAlert) -> some View {
        let crew = (model.world.profile?.crew ?? []).filter { $0.id != model.person }
        let others: [CrewMember] = switch alert.toldTo {
        case .everyone: crew
        case .people(let ids): crew.filter { ids.contains($0.id) }
        }
        let names: String = if case .everyone = alert.toldTo {
            String(localized: "Everyone")
        } else {
            others.map(\.name).formatted(.list(type: .and))
        }
        let time = (alert.levelSince ?? alert.since).map { Self.clock($0) }
        return HStack(spacing: 8) {
            HStack(spacing: -6) {
                ForEach(others.prefix(5), id: \.id) { person in
                    Text(verbatim: String(person.name.prefix(1)))
                        .font(.caption2.weight(.semibold))
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Color.black))
                        .overlay(Circle().strokeBorder(.white, lineWidth: 1))
                }
            }
            .accessibilityHidden(true)
            Text([names, time].compactMap { $0 }.joined(separator: " · "))
                .font(.footnote)
                .foregroundStyle(HubStyle.muted)
        }
    }

    /// Why it is level 3 when a person's answer made it so, in the viewer's own voice.
    private func reason(_ alert: HubAlert, mine: Bool) -> String? {
        let name = model.world.name(of: alert.person)
        if alert.signal != "asked-help", alert.answer == "help" {
            return mine ? String(localized: "You asked for help.") : String(localized: "\(name) asked for help.")
        } else if alert.answer == nil, alert.answerBy != nil, alert.stationWide != true {
            return mine ? String(localized: "You did not answer in time.") : String(localized: "\(name) did not answer in time.")
        }
        return nil
    }

    /// When Earth's reply can be back, in whole minutes, or the reply itself.
    @ViewBuilder
    private func earth(_ alert: HubAlert, now: Double) -> some View {
        let message = model.world.earthMessages.first { $0.id == alert.earthId }
        if let report = message?.report {
            VStack(alignment: .leading, spacing: 2) {
                if let text = message?.text { Text(text).font(.footnote).foregroundStyle(HubStyle.muted) }
                IncidentReportLink(report: report)
            }
        }
        if let reply = message?.reply {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Earth replied").font(.footnote.weight(.semibold))
                    if let label = message?.simulatedLabel {
                        Text(label)
                            .font(.caption)
                            .foregroundStyle(HubStyle.muted)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .overlay(RoundedRectangle(cornerRadius: 3, style: .circular)
                                .strokeBorder(.white.opacity(HubStyle.hairline), lineWidth: 1))
                    }
                }
                Text(verbatim: "“\(reply.shownText)”")
                    .font(.footnote)
            }
            .accessibilityElement(children: .combine)
        } else if let dueAt = message?.replyAt ?? alert.earth?.replyAt {
            let due = Int(((dueAt - now) / 60_000).rounded(.up))
            let countdown = due > 0 ? String(localized: "A reply from Earth can be back in \(due) min.") : String(localized: "A reply can be here now")
            Text(message?.simulatedDelay == true ? "\(countdown) · \(String(localized: "simulated delay"))" : countdown)
                .font(.footnote)
                .foregroundStyle(HubStyle.muted)
        }
    }

    /// The card's first step, word for word: its first sentence large, the rest under it.
    @ViewBuilder
    private func firstAction(_ alert: HubAlert, card: CardView?, mine: Bool) -> some View {
        if let card, let first = card.steps.first {
            EmergencyFirstStep(label: mine ? "What you can do now" : "First action", step: first, full: true)
        } else if cards == nil && model.isConnected && alert.card != nil {
            ProgressView("Loading the steps card…")
        } else {
            Text("No steps card is approved for this yet.")
                .font(.headline)
        }
    }

    /// Pinned under the scroll: the quiet action at its own width on the left, "Start help" filling the rest.
    private func actions(_ alert: HubAlert, card: CardView?, mine: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !mine, let by = alert.seenBy {
                Text("Seen by \(model.world.name(of: by))")
                    .font(.footnote)
                    .foregroundStyle(HubStyle.muted)
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(HubStyle.muted)
            }
            EmergencyButtons {
                if !mine, alert.seenBy == nil, !alert.isRecorded {
                    EmergencyButton("I've seen it", filled: false, natural: card != nil) { acknowledge(alert) }
                        .disabled(sending || !model.isConnected)
                        .accessibilityHint(Text("Tells the crew you have seen it. The alert stays until it ends."))
                }
                if closable(alert, mine: mine) {
                    EmergencyButton("Close", filled: false, natural: card != nil) { close(alert) }
                        .accessibilityHint(Text("Puts this screen away. The emergency stays open."))
                }
                if let card {
                    EmergencyButton("Start help", filled: true) { StepsPresentation.open { openCard = card } }
                        .accessibilityHint(Text("Opens the card's steps, one at a time"))
                }
            }
        }
    }

    // MARK: Words

    private func isMine(_ alert: HubAlert) -> Bool { !alert.person.isEmpty && alert.person == model.person }

    private func restricted(_ alert: HubAlert) -> Bool { alert.signal == "needs-someone" }

    /// The same name the hub's panel gives it: the card's title, else the event's kind or the signal's name;
    /// a privacy-restricted alert only as the hub sent it.
    private func name(_ alert: HubAlert, card: CardView?) -> String {
        if restricted(alert) {
            return AlertText.headline(alert, viewer: model.person, name: model.world.name(of: alert.person), room: "")
        }
        return card?.title ?? Signals.name(alert.signal)
    }

    /// Where: "Go to <room>" for a base-wide event with a shelter, "Station-wide event", the room (and who is
    /// there, when the alert is about a person in that room and privacy allows), or the person.
    private func place(_ alert: HubAlert) -> String? {
        if let shelter = alert.declared?.shelter { return String(localized: "Go to \(roomName(shelter))") }
        if alert.stationWide == true { return String(localized: "Station-wide event") }
        if let room = alert.room {
            let name = roomName(room)
            guard alert.reason == "room-limit", !alert.person.isEmpty, !restricted(alert) else { return name }
            return String(localized: "\(name) · \(model.world.name(of: alert.person)) is there")
        }
        return restricted(alert) || alert.person.isEmpty ? nil : model.world.name(of: alert.person)
    }

    /// A declared event's note and who declared it (its "when" and "where" are said above).
    private func eventDetails(_ alert: HubAlert, _ event: HubAlert.Declared) -> [String] {
        let shelter = event.shelter.map { roomName($0) }
        let lines = AlertText.eventLines(event, by: model.world.name(of: alert.person), shelter: shelter, now: model.hubNow())
        let goTo = shelter.map { String(localized: "Go to \($0)") }
        return lines.dropFirst().filter { $0 != goTo }
    }

    private func card(for alert: HubAlert) -> CardView? {
        guard let id = alert.card else { return nil }
        return cards?.cards.first { $0.id == id } ?? otherCards?.cards.first { $0.id == id }
    }

    /// A time as the hub writes it: 24-hour HH:MM.
    static func clock(_ ms: Double) -> String {
        let format = DateFormatter()
        format.dateFormat = "HH:mm"
        return format.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    // MARK: Data

    private func roomName(_ id: String?) -> String {
        id.map { Signals.roomName($0, rooms: model.world.profile?.rooms ?? []) } ?? String(localized: "an unknown room")
    }

    /// Every state has a way out: your own emergency at once (the crew is told), someone else's once it has
    /// been seen (by anyone, or by you here), and always in a recorded story.
    private func closable(_ alert: HubAlert, mine: Bool) -> Bool {
        mine || seen || alert.seenBy != nil || alert.seenAt != nil || alert.isRecorded
    }

    private func close(_ alert: HubAlert) {
        model.closedAlerts.insert(alert.closeKey)
    }

    private func acknowledge(_ alert: HubAlert) {
        seen = true
        guard !alert.isRecorded else { return }
        sending = true
        Task {
            problem = await model.acknowledge(alert)
            sending = false
        }
    }

    /// Back from the steps (Done) counts as seen: the same acknowledge the button sends.
    private func returnedFromSteps() {
        guard let alert = model.visibleAlerts.first(where: { $0.id == alertID }) else { return }
        seen = true
        if !isMine(alert), alert.seenBy == nil, !sending { acknowledge(alert) }
    }

    private func loadCards() async {
        guard let api = model.api else { return }
        cards = try? await api.cards(lang: model.lang)
        if let cards, !cards.otherLanguageOnly.isEmpty {
            otherCards = try? await api.cards(lang: model.lang == "pt" ? "en" : "pt")
        }
    }
}

// MARK: - The emergency screens' shared parts (DangerView, AreYouOKView)

/// One projection frame filling the screen: the content scrolls, the buttons stay pinned at the bottom.
/// `centered`: the content sits in the middle of the space above the buttons (it still scrolls when it is taller).
struct EmergencyFrame<Content: View, Buttons: View>: View {
    var centered = false
    @ViewBuilder let content: Content
    @ViewBuilder let buttons: Buttons

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { content }
                        .frame(maxWidth: .infinity, minHeight: centered ? max(0, proxy.size.height - 32) : nil, alignment: centered ? .leading : .topLeading)
                        .padding(EdgeInsets(top: 20, leading: 18, bottom: 12, trailing: 18))
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            buttons
                .padding(EdgeInsets(top: 8, leading: 18, bottom: 18, trailing: 18))
        }
        .foregroundStyle(.white)
        .projectionFrame()
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }
}

/// The small line at the top: an outlined symbol and a few words.
struct EmergencyKicker: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.footnote)
            .foregroundStyle(HubStyle.muted)
    }
}

/// The thin rule between what happened and what to do.
struct EmergencyRule: View {
    var body: some View {
        Rectangle()
            .fill(.white.opacity(HubStyle.hairline))
            .frame(height: 1)
            .padding(.top, 16)
            .padding(.bottom, 14)
            .accessibilityHidden(true)
    }
}

/// The reading on one line: the small status mark, the value, its kind, the limit and how fresh it is
/// (a stale one is never shown as live); then the reason, if any. Nothing for a privacy-restricted alert.
struct AlertReadingLine: View {
    @Environment(AppModel.self) private var model
    let alert: HubAlert
    /// Put first on the line ("Quarters 2 · 3.5 mmHg …") when the title does not already say it.
    var room: String?
    let mark: Color
    var reason: String?
    let now: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let line = line {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle().fill(mark).frame(width: 7, height: 7)
                        .accessibilityHidden(true)
                    line
                }
            }
            if let reason { Text(reason) }
        }
        .font(.footnote.monospacedDigit())
        .foregroundStyle(HubStyle.muted)
        .accessibilityElement(children: .combine)
    }

    private var line: Text? {
        guard alert.signal != "needs-someone", let value = alert.value else { return nil }
        let unit = alert.unit ?? ""
        let alarm = model.world.alarms.first { $0.room == alert.room && $0.signal == alert.signal }
        let last = alarm?.lastReading
        let minutes = last.map { max(0, Int(((now - $0.t) / 60_000).rounded(.down))) }
        let stale = alarm?.stale == true
        let shown: String = if stale, let last {
            String(localized: "Last reading \(Signals.number(last.value)) \(unit), \(minutes ?? 0) minutes ago")
        } else {
            [Signals.number(value), unit].filter { !$0.isEmpty }.joined(separator: " ")
        }
        let limit: String? = alert.limit.map {
            alert.limitSource == "crew"
                ? String(localized: "Crew level \(Signals.number($0)) \(unit)")
                : String(localized: "NASA limit \(Signals.number($0)) \(unit)")
        }
        let fresh: String? = if stale { nil } else if let minutes {
            minutes < 1 ? String(localized: "Updated just now")
                : minutes < 60 ? String(localized: "Updated \(minutes) min ago")
                : String(localized: "Updated \(minutes / 60) h ago")
        } else { nil }
        var text = Text([room, shown].compactMap { $0 }.joined(separator: " · "))
        if let kind = alert.kind {
            text = text + Text(verbatim: " ") + Text(Signals.kindName(kind)).foregroundColor(.white.opacity(0.55))
        }
        let rest = [limit, fresh].compactMap { $0 }
        if !rest.isEmpty { text = text + Text(verbatim: " · " + rest.joined(separator: " · ")) }
        if alert.stationWide == true {
            text = text + Text(verbatim: "\n") + (alert.lowestRoom.map {
                Text("Lowest reading: \(Signals.roomName($0.room, rooms: model.world.profile?.rooms ?? [])), \(Signals.number($0.value)) \(unit).")
            } ?? Text("No room is under the limit."))
        }
        return text
    }
}

/// The card's first step under a small label: its first sentence bold, the rest smaller (or not, on the
/// question screen), and where it comes from. The card's words, in order; nothing added.
struct EmergencyFirstStep: View {
    let label: LocalizedStringKey
    let step: String
    /// The rest of the step under its first sentence (the question screen shows the first sentence only).
    var full = true

    var body: some View {
        let parts = StepsModal.sentences(step)
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.caption)
                .foregroundStyle(HubStyle.muted)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 8) {
                Text(parts.first ?? step)
                    .font(full ? .title3.weight(.bold) : .headline)
                if full, parts.count > 1 {
                    Text(parts.dropFirst().joined(separator: " "))
                        .font(.footnote)
                        .foregroundStyle(HubStyle.muted)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 6)
            .accessibilityElement(children: .combine)
            Text("From the approved guidance card.")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.55))
                .padding(.top, 8)
        }
    }
}

/// The emergency screens' buttons, in the steps modal's language: 48 high, radius 8, a 1.5 white outline;
/// filled white for the main one. `natural`: as wide as its words, beside a filled one taking the rest.
struct EmergencyButton: View {
    let title: LocalizedStringKey
    let filled: Bool
    var natural = false
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    init(_ title: LocalizedStringKey, filled: Bool, natural: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.filled = filled
        self.natural = natural
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .lineLimit(1)
                .padding(.horizontal, 16)
                .frame(maxWidth: natural ? nil : .infinity, minHeight: 48)
                .foregroundStyle(filled ? Color.black : Color.white)
                .background {
                    let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
                    if filled { shape.fill(.white) } else { shape.strokeBorder(.white, lineWidth: 1.5) }
                }
                .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.pressable)
        .font(.subheadline.weight(.semibold))
        .opacity(isEnabled ? 1 : 0.4)
    }
}

/// One row of buttons pinned at the bottom; stacked only when the words no longer fit (the largest text sizes).
struct EmergencyButtons<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { content }
            VStack(spacing: 10) { content }
        }
    }
}

#Preview {
    DangerView(alertID: SampleData.dangerAlert.id)
        .environment(SampleData.model(alerts: [SampleData.dangerAlert]))
        .preferredColorScheme(.dark)
}
