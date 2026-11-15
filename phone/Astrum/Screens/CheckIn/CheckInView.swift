// Check-in, where the owner enters things: the daily check-in (headache,
// mood, stress and tiredness, an optional note) posted to /api/checkin and
// shown back as Reported, past check-ins, and the blood test section.
// Offline, a check-in is kept on the phone and sent when the hub is back.

import SwiftUI

struct CheckInView: View {
    @Environment(AppModel.self) private var model
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            Form {
                ConnectionBanner()
                CheckInForm()
                PastCheckIns()
                BloodSection()
            }
            .navigationTitle("Check-in")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SettingsButton { showingSettings = true }
                }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
            .task(id: model.person) { await model.refreshHistory() }
        }
    }
}

/// Today's questions. Only what the hub accepts: yes/no, 0 to 100, a text.
private struct CheckInForm: View {
    @Environment(AppModel.self) private var model
    @State private var headache: Bool?
    @State private var mood = 50.0
    @State private var stress = 50.0
    @State private var tiredness = 50.0
    @State private var note = ""
    @State private var sending = false
    @State private var outcome: CheckinOutcome?

    var body: some View {
        Section {
            Picker("Headache", selection: $headache) {
                Text("Not answered").tag(Bool?.none)
                Text("Yes").tag(Bool?.some(true))
                Text("No").tag(Bool?.some(false))
            }
            slider("Mood", value: $mood)
            slider("Stress", value: $stress)
            slider("Tiredness", value: $tiredness)
            TextField("Note (optional)", text: $note, axis: .vertical)
                .lineLimit(1...5)
            Button(action: send) {
                if sending {
                    ProgressView()
                } else {
                    Text("Send check-in")
                }
            }
            .disabled(sending || model.person.isEmpty)
            if let outcome {
                Text(words(for: outcome))
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Today")
        } footer: {
            Text("Your answers are stored as Reported: said by you, not measured.")
        }
    }

    private func slider(_ title: LocalizedStringKey, value: Binding<Double>) -> some View {
        VStack(alignment: .leading) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(value.wrappedValue)) of 100")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: 0...100, step: 1) {
                Text(title)
            } minimumValueLabel: {
                Text(verbatim: "0").font(.caption)
            } maximumValueLabel: {
                Text(verbatim: "100").font(.caption)
            }
            .accessibilityValue(Text("\(Int(value.wrappedValue)) of 100"))
        }
    }

    private func send() {
        var answers: [CheckinAnswer] = []
        if let headache { answers.append(CheckinAnswer(signal: "headache", value: headache ? 1 : 0, unit: "yes/no")) }
        answers.append(CheckinAnswer(signal: "mood", value: mood, unit: "0-100"))
        answers.append(CheckinAnswer(signal: "stress", value: stress, unit: "0-100"))
        answers.append(CheckinAnswer(signal: "fatigue", value: tiredness, unit: "0-100"))
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { answers.append(CheckinAnswer(signal: "note", value: nil, text: text, unit: "")) }

        sending = true
        Task {
            outcome = await model.submitCheckin(answers)
            sending = false
            if outcome == .sent {
                note = ""
                headache = nil
                await model.refreshHistory()
            }
        }
    }

    private func words(for outcome: CheckinOutcome) -> String {
        switch outcome {
        case .sent: String(localized: "Sent. The hub stored it as Reported.")
        case .queued: String(localized: "The hub is out of reach. Kept on this phone; it is sent when the hub is back.")
        case .refused(let words): String(localized: "The hub refused it: \(words)")
        }
    }
}

/// Earlier check-ins from the history, newest first, grouped by when they were answered.
private struct PastCheckIns: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let groups = Dictionary(grouping: model.history.rows.filter { $0.signal.hasPrefix("checkin.") }, by: \.t)
            .sorted { $0.key > $1.key }
            .prefix(10)
        Section("Earlier check-ins") {
            if model.pendingCheckins > 0 {
                Label("\(model.pendingCheckins) waiting to send", systemImage: "clock")
            }
            if groups.isEmpty {
                Text(model.history.state == .failed ? String(localized: "History needs the hub") : String(localized: "No check-ins yet."))
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(groups), id: \.key) { t, rows in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(Date(timeIntervalSince1970: t / 1000).formatted(date: .abbreviated, time: .shortened))
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        if let kind = rows.first?.kind { KindBadge(kind: kind) }
                    }
                    ForEach(rows.sorted { Signals.order(of: $0.signal) < Signals.order(of: $1.signal) }, id: \.self) { row in
                        Text(verbatim: "\(Signals.name(row.signal)): \(Signals.text(row))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

#Preview {
    CheckInView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
