// The daily check-in as steps: one question per screen (headache, mood,
// stress, tiredness, an optional note), each a SetupPage like the first run's
// screens, with the same scales and values the form had. Nothing is sent
// until Done; then the answers go to
// /api/checkin through AppModel.submitCheckin, kept on the phone when the hub
// is out of reach. Closing midway keeps the answers for the session.

import SwiftUI

/// The questions, in the order they are asked.
enum CheckInStep: Int, CaseIterable {
    case headache, mood, stress, tiredness, note

    /// The question, as the page's headline.
    var question: String {
        switch self {
        case .headache: String(localized: "Do you have a headache?")
        case .mood: String(localized: "How is your mood?")
        case .stress: String(localized: "How stressed do you feel?")
        case .tiredness: String(localized: "How tired do you feel?")
        case .note: String(localized: "Anything else to add?")
        }
    }

    var icon: HubIconName {
        switch self {
        case .headache: .head
        case .mood: .mood
        case .stress: .stress
        case .tiredness: .tired
        case .note: .send
        }
    }

    var number: Int { rawValue + 1 }
    static let total = allCases.count
}

/// The answers being given, and where the person is. Only what the hub accepts: yes/no, 0 to 100, a text.
struct CheckInDraft: Equatable {
    var headache: Bool?
    var mood = 50.0
    var stress = 50.0
    var tiredness = 50.0
    var note = ""
    var step: CheckInStep = .headache

    init() {}

    /// Starts from answers already given (today's, to change them).
    init(rows: [Row]) {
        for row in rows {
            switch row.signal {
            case "checkin.headache": headache = row.value.map { $0 != 0 }
            case "checkin.mood": mood = row.value ?? mood
            case "checkin.stress": stress = row.value ?? stress
            case "checkin.fatigue": tiredness = row.value ?? tiredness
            case "checkin.note": note = row.text ?? ""
            default: break
            }
        }
    }

    /// What is sent, exactly as the form sent it.
    var answers: [CheckinAnswer] {
        var answers: [CheckinAnswer] = []
        if let headache { answers.append(CheckinAnswer(signal: "headache", value: headache ? 1 : 0, unit: "yes/no")) }
        answers.append(CheckinAnswer(signal: "mood", value: mood, unit: "0-100"))
        answers.append(CheckinAnswer(signal: "stress", value: stress, unit: "0-100"))
        answers.append(CheckinAnswer(signal: "fatigue", value: tiredness, unit: "0-100"))
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { answers.append(CheckinAnswer(signal: "note", value: nil, text: text, unit: "")) }
        return answers
    }

    /// The answers as Reported rows at `t`, to show them before the hub has them.
    func rows(at t: Double) -> [Row] {
        answers.map { Row(t: t, signal: "checkin.\($0.signal)", value: $0.value, text: $0.text, unit: $0.unit,
                          kind: .reported, source: "checkin") }
    }
}

/// The sheet that asks the questions one at a time, each on a page like the first run's.
struct CheckInFlow: View {
    @Binding var draft: CheckInDraft
    /// Runs once the answers are sent or kept on the phone, before the sheet closes.
    var saved: (CheckinOutcome) -> Void = { _ in }
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var sending = false
    @State private var outcome: CheckinOutcome?
    /// The answers just sent, for the end page (the draft is cleared once saved).
    @State private var given: [Row] = []
    @FocusState private var focus: CheckInField?

    private var step: CheckInStep { draft.step }

    var body: some View {
        NavigationStack {
            Group {
                if let outcome, isFinished {
                    finish(outcome)
                } else {
                    question
                        .disabled(sending)
                }
            }
            .id(isFinished ? CheckInStep.total : step.rawValue)
            .transition(.astrumRise(reduceMotion: reduceMotion))
            .environment(\.setupNav, nav)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.ignoresSafeArea())
            .foregroundStyle(.white)
            .tint(.white)
            .keyboardFields($focus, order: [.note])
            .toolbar(.hidden, for: .navigationBar)
        }
        .sensoryFeedback(.success, trigger: outcome) { _, new in new == .sent }
        .interactiveDismissDisabled(sending)
    }

    private var isFinished: Bool {
        if let outcome, case .refused = outcome { return false }
        return outcome != nil
    }

    /// The page's progress, Back (after the first question) and Close.
    private var nav: SetupNav {
        var nav = SetupNav(step: isFinished ? CheckInStep.total - 1 : step.rawValue, total: CheckInStep.total)
        if !isFinished && step != .headache { nav.back = { move(by: -1) } }
        nav.close = { dismiss() }
        nav.closeHint = isFinished ? nil : String(localized: "Your answers are kept until you send them")
        return nav
    }

    // MARK: The step

    private var question: some View {
        SetupPage(
            icon: step.icon,
            title: step.question,
            titleLabel: Text("Question \(step.number) of \(CheckInStep.total): \(step.question)"),
            centered: true
        ) {
            answer
                .padding(.top, 28)
            if let outcome, case .refused(let words) = outcome {
                Text("The hub refused it: \(words)")
                    .font(.callout)
                    .foregroundStyle(HubStyle.muted)
                    .padding(.top, 12)
            }
        } buttons: {
            SetupButton(sending ? Text("Sending…") : Text(nextTitle), .filled, action: next)
        }
    }

    @ViewBuilder private var answer: some View {
        switch step {
        case .headache:
            HStack(spacing: 12) {
                choice("Yes", value: true)
                choice("No", value: false)
            }
            .sensoryFeedback(.selection, trigger: draft.headache)
        case .mood: scale("Mood", low: "Low", high: "Good", value: $draft.mood)
        case .stress: scale("Stress", low: "Not at all", high: "Very", value: $draft.stress)
        case .tiredness: scale("Tiredness", low: "Not at all", high: "Very", value: $draft.tiredness)
        case .note:
            TextField("Note (optional)", text: $draft.note, axis: .vertical)
                .lineLimit(3...8)
                .multilineTextAlignment(.leading)
                .projectionField()
                .focused($focus, equals: .note)
        }
    }

    /// Yes or No: a large button, filled when chosen and marked with a check, so colour is never the only cue.
    private func choice(_ title: LocalizedStringKey, value: Bool) -> some View {
        let chosen = draft.headache == value
        return Button {
            // A second tap on the chosen answer takes it back: the question may stay unanswered.
            draft.headache = chosen ? nil : value
            if !chosen { advanceSoon(from: .headache) }
        } label: {
            HStack(spacing: 8) {
                if chosen { Image(systemName: "checkmark").fontWeight(.semibold).accessibilityHidden(true) }
                Text(title).font(.title3)
            }
            .frame(maxWidth: .infinity, minHeight: 72)
        }
        .buttonStyle(ProjectionButtonStyle(prominent: chosen))
        .animation(Motion.reduced(Motion.select, reduceMotion), value: chosen)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    /// 0 to 100, as the form had it: the number large, and under each end of the slider what that end means.
    private func scale(_ title: LocalizedStringKey, low: LocalizedStringKey, high: LocalizedStringKey,
                       value: Binding<Double>) -> some View {
        VStack(spacing: 16) {
            Text("\(Int(value.wrappedValue)) of 100")
                .font(.largeTitle.weight(.light).monospacedDigit())
                .numericMotion(Int(value.wrappedValue))
                .accessibilityHidden(true)
            VStack(spacing: 6) {
                Slider(value: value, in: 0...100, step: 1) {
                    Text(title)
                }
                .frame(minHeight: 44)
                .accessibilityValue(Text("\(Int(value.wrappedValue)) of 100"))
                .accessibilityHint(Text("0 is \(Text(low)), 100 is \(Text(high))"))
                // A tick every ten, not on every step, so dragging stays calm.
                .sensoryFeedback(.selection, trigger: Int(value.wrappedValue) / 10)
                HStack(alignment: .firstTextBaseline) {
                    Text(low).multilineTextAlignment(.leading)
                    Spacer(minLength: 12)
                    Text(high).multilineTextAlignment(.trailing)
                }
                .font(.footnote)
                .foregroundStyle(HubStyle.muted)
                .accessibilityHidden(true)
            }
        }
    }

    // MARK: Moving

    /// Next; Skip where a step may be left unanswered and is; Done on the last step.
    private var nextTitle: LocalizedStringKey {
        switch step {
        case .headache where draft.headache == nil: "Skip"
        case .note: draft.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Skip" : "Done"
        default: "Next"
        }
    }

    private func next() {
        if step == .note { send() } else { move(by: 1) }
    }

    private func move(by offset: Int) {
        guard let target = CheckInStep(rawValue: step.rawValue + offset) else { return }
        focus = nil
        withAnimation(Motion.reduced(Motion.content, reduceMotion)) {
            if case .refused = outcome { outcome = nil }
            draft.step = target
        }
    }

    /// After a single choice: a short beat to see it, then the next question (not under
    /// VoiceOver, where the person moves on when they have heard it).
    private func advanceSoon(from origin: CheckInStep) {
        guard !voiceOver else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            if draft.step == origin, draft.headache != nil { move(by: 1) }
        }
    }

    // MARK: Sending

    private func send() {
        focus = nil
        sending = true
        let answers = draft.answers
        let rows = draft.rows(at: 0)
        Task {
            let result = await model.submitCheckin(answers)
            sending = false
            if case .refused = result {
                withAnimation(Motion.reduced(Motion.appear, reduceMotion)) { outcome = result }
                return
            }
            given = rows
            withAnimation(Motion.reduced(Motion.appear, reduceMotion)) { outcome = result }
            saved(result)
            AccessibilityNotification.Announcement(words(for: result)).post()
            // Long enough to read the answers listed on the finish screen.
            try? await Task.sleep(for: .seconds(3))
            dismiss()
        }
    }

    /// The end: what happened, and the answers just given, one per line.
    private func finish(_ outcome: CheckinOutcome) -> some View {
        SetupPage(
            symbol: outcome == .sent ? "checkmark.circle" : "clock",
            title: outcome == .sent ? String(localized: "Saved.") : words(for: outcome),
            centered: true
        ) {
            VStack(spacing: 6) {
                ForEach(Array(CheckInSummary.lines(given).enumerated()), id: \.offset) { _, line in
                    Text(verbatim: line)
                }
            }
            .font(.callout)
            .foregroundStyle(HubStyle.muted)
            .padding(.top, 16)
        } buttons: {
            EmptyView()
        }
    }

    private func words(for outcome: CheckinOutcome) -> String {
        switch outcome {
        case .sent: String(localized: "Saved. Thank you.")
        case .queued: String(localized: "The hub is out of reach. Kept on this phone; it is sent when the hub is back.")
        case .refused(let words): String(localized: "The hub refused it: \(words)")
        }
    }
}

#Preview("Step") {
    @Previewable @State var draft: CheckInDraft = {
        var draft = CheckInDraft()
        draft.step = .mood
        draft.mood = 70
        return draft
    }()
    CheckInFlow(draft: $draft)
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
