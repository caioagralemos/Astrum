// Check-in, where the owner enters things. Today's check-in first: Start
// opens the questions one at a time (CheckInFlow), or, once done today by the
// hub's clock, when and what was answered. Then the blood test, which is not
// daily, and earlier check-ins by day. Offline, a check-in is kept on the
// phone and sent when the hub is back.

import SwiftUI

/// The tab's fields, in screen order, for the keyboard's previous / next.
enum CheckInField: Hashable {
    case note
    case blood(String)
}

extension AppModel {
    /// Opens today's check-in on the Check-in tab, where it was left if it was started.
    /// The one way in, for a reminder to open later.
    func startTodaysCheckIn() {
        selectedTab = .checkIn
        checkInOpen = true
    }
}

struct CheckInView: View {
    @Environment(AppModel.self) private var model
    @State private var showingSettings = false
    @FocusState private var focus: CheckInField?
    @State private var bloodIDs: [String] = []
    /// The answers being given; kept for the session until they are sent.
    @State private var draft = CheckInDraft()
    /// What was saved in this session, shown until the hub's history has it (always, when kept offline).
    @State private var savedHere: [Row] = []

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    ConnectionBanner()
                    TodayCheckIn(today: todaysAnswers, start: model.startTodaysCheckIn) {
                        draft = CheckInDraft(rows: todaysAnswers)
                        model.startTodaysCheckIn()
                    }
                    BloodSection(focus: $focus, ids: $bloodIDs)
                    PastCheckIns()
                }
                .keyboardFields($focus, order: bloodIDs.map(CheckInField.blood))
                .scrollsToFocus(focus, with: proxy)
            }
            .tint(.white)
            .navigationTitle("Check-in")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SettingsButton { showingSettings = true }
                }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
            .sheet(isPresented: $model.checkInOpen) {
                CheckInFlow(draft: $draft) { _ in
                    savedHere = draft.rows(at: model.hubNow())
                    draft = CheckInDraft()
                    Task { await model.refreshHistory() }
                }
            }
            .task(id: model.person) { await model.refreshHistory() }
        }
    }

    /// The newest check-in answered today, by the hub's clock; empty when there is none yet.
    private var todaysAnswers: [Row] {
        let today = Date(timeIntervalSince1970: model.hubNow() / 1000)
        let rows = (model.history.rows + savedHere).filter {
            CheckInSummary.questions.contains($0.signal) && Calendar.current.isDate($0.date, inSameDayAs: today)
        }
        guard let newest = rows.map(\.t).max() else { return [] }
        return rows.filter { $0.t == newest }
    }
}

/// Today's card: Start, or done at a time with the answers in a line or two.
private struct TodayCheckIn: View {
    let today: [Row]
    let start: () -> Void
    let change: () -> Void

    var body: some View {
        ProjectionSection {
            if let first = today.first {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Done today at \(first.date.formatted(date: .omitted, time: .shortened))")
                        .font(.title3)
                    Text(verbatim: CheckInSummary.line(today))
                        .foregroundStyle(HubStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                Button("Change my answers", action: change)
                    .buttonStyle(.projection)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Today's check-in")
                        .font(.title3)
                    Text("About a minute. Five questions.")
                        .foregroundStyle(HubStyle.muted)
                }
                .accessibilityElement(children: .combine)
                Button("Start", action: start)
                    .buttonStyle(.projectionProminent)
                    .accessibilityLabel(Text("Start today's check-in"))
            }
        } header: {
            ProjectionHeader(.mood, "Today")
        } footer: {
            Text("Your answers are stored as Reported: said by you, not measured.")
        }
    }
}

/// A check-in's answers in one line, with the questions' own names.
enum CheckInSummary {
    static let questions: Set<String> = ["checkin.headache", "checkin.mood", "checkin.stress", "checkin.fatigue", "checkin.note"]

    static func line(_ rows: [Row]) -> String {
        rows.filter { $0.signal != "checkin.note" }
            .sorted { Signals.order(of: $0.signal) < Signals.order(of: $1.signal) }
            .map { "\(name($0.signal)): \(Signals.text($0))" }
            .joined(separator: " · ")
    }

    private static func name(_ signal: String) -> String {
        switch signal {
        case "checkin.headache": String(localized: "Headache")
        case "checkin.mood": String(localized: "Mood")
        case "checkin.stress": String(localized: "Stress")
        case "checkin.fatigue": String(localized: "Tiredness")
        default: Signals.name(signal)
        }
    }
}

/// Earlier check-ins from the history, newest first, by day.
private struct PastCheckIns: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let answered = Dictionary(grouping: model.history.rows.filter { $0.signal.hasPrefix("checkin.") }, by: \.t)
            .sorted { $0.key > $1.key }
            .prefix(10)
        let days = Dictionary(grouping: answered) { Calendar.current.startOfDay(for: Date(timeIntervalSince1970: $0.key / 1000)) }
            .sorted { $0.key > $1.key }
        ProjectionSection {
            if model.pendingCheckins > 0 {
                Label("\(model.pendingCheckins) waiting to send", systemImage: "clock")
            }
            if days.isEmpty {
                Text(model.history.state == .failed ? String(localized: "History needs the hub") : String(localized: "No check-ins yet."))
                    .foregroundStyle(.secondary)
            }
            ForEach(days, id: \.key) { day, checkins in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(day.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        if let kind = checkins.first?.value.first?.kind { KindBadge(kind: kind) }
                    }
                    ForEach(checkins, id: \.key) { t, rows in
                        let time = Date(timeIntervalSince1970: t / 1000).formatted(date: .omitted, time: .shortened)
                        Text(verbatim: "\(time) · \(CheckInSummary.line(rows))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let note = rows.first(where: { $0.signal == "checkin.note" })?.text {
                            Text(verbatim: "\(Signals.name("checkin.note")): \(note)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            ProjectionHeader(.clock, "Earlier check-ins")
        }
    }
}

#Preview("Check-in") {
    CheckInView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}

#Preview("Today: not done") {
    Form { TodayCheckIn(today: [], start: {}, change: {}) }
        .preferredColorScheme(.dark)
}

#Preview("Today: done") {
    var draft = CheckInDraft()
    draft.headache = false
    draft.mood = 70
    draft.stress = 35
    draft.tiredness = 40
    return Form { TodayCheckIn(today: draft.rows(at: Date.now.timeIntervalSince1970 * 1000), start: {}, change: {}) }
        .preferredColorScheme(.dark)
}
