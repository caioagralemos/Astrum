// The daily check-in as steps: one question per screen (headache, mood,
// stress, tiredness, an optional note), the same questions, scales and
// values the form had. Nothing is sent until Done; then the answers go to
// /api/checkin through AppModel.submitCheckin, kept on the phone when the hub
// is out of reach. Closing midway keeps the answers for the session.

import SwiftUI

/// The questions, in the order they are asked.
enum CheckInStep: Int, CaseIterable {
    case headache, mood, stress, tiredness, note

    var title: LocalizedStringKey {
        switch self {
        case .headache: "Headache"
        case .mood: "Mood"
        case .stress: "Stress"
        case .tiredness: "Tiredness"
        case .note: "Note (optional)"
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

/// The sheet that asks the questions one at a time.
struct CheckInFlow: View {
    @Binding var draft: CheckInDraft
    /// Runs once the answers are sent or kept on the phone, before the sheet closes.
    var saved: (CheckinOutcome) -> Void = { _ in }
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var forward = true
    @State private var sending = false
    @State private var outcome: CheckinOutcome?
    @FocusState private var focus: CheckInField?
    @AccessibilityFocusState private var questionFocused: Bool

    private var step: CheckInStep { draft.step }

    var body: some View {
        NavigationStack {
            ScrollView {
                Group {
                    if let outcome, isFinished {
                        confirmation(outcome)
                            .transition(.astrumRise(reduceMotion: reduceMotion))
                    } else {
                        question
                            .id(step)
                            .transition(slide)
                    }
                }
                .padding(16)
            }
            .scrollBounceBehavior(.basedOnSize)
            .safeAreaInset(edge: .top, spacing: 0) { if !isFinished { progress } }
            .safeAreaInset(edge: .bottom, spacing: 0) { if !isFinished { controls } }
            .keyboardFields($focus, order: [.note])
            .tint(.white)
            .navigationTitle("Today's check-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .accessibilityHint(Text("Your answers are kept until you send them"))
                }
            }
        }
        .sensoryFeedback(.success, trigger: outcome) { _, new in new == .sent }
        .onAppear(perform: focusQuestion)
        .onChange(of: step) { focusQuestion() }
        .interactiveDismissDisabled(sending)
    }

    private var isFinished: Bool {
        if let outcome, case .refused = outcome { return false }
        return outcome != nil
    }

    // MARK: The step

    private var question: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
                HubIcon(step.icon, size: 30, weight: 1.75, relativeTo: .title)
                Text(step.title)
                    .font(.title.weight(.light))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Question \(step.number) of \(CheckInStep.total): \(Text(step.title))"))
            .accessibilityAddTraits(.isHeader)
            .accessibilityFocused($questionFocused)

            answer

            if let outcome, case .refused(let words) = outcome {
                Text("The hub refused it: \(words)")
                    .foregroundStyle(HubStyle.muted)
            }
        }
        .padding(.vertical, 8)
        .projectionCard()
    }

    @ViewBuilder private var answer: some View {
        switch step {
        case .headache:
            HStack(spacing: 12) {
                choice("Yes", value: true)
                choice("No", value: false)
            }
            .sensoryFeedback(.selection, trigger: draft.headache)
        case .mood: scale("Mood", value: $draft.mood)
        case .stress: scale("Stress", value: $draft.stress)
        case .tiredness: scale("Tiredness", value: $draft.tiredness)
        case .note:
            TextField("Note (optional)", text: $draft.note, axis: .vertical)
                .lineLimit(3...8)
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

    /// 0 to 100, as the form had it: the number large, both ends labelled.
    private func scale(_ title: LocalizedStringKey, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(Int(value.wrappedValue)) of 100")
                .font(.largeTitle.weight(.light).monospacedDigit())
                .numericMotion(Int(value.wrappedValue))
                .accessibilityHidden(true)
            Slider(value: value, in: 0...100, step: 1) {
                Text(title)
            } minimumValueLabel: {
                Text(verbatim: "0").font(.callout)
            } maximumValueLabel: {
                Text(verbatim: "100").font(.callout)
            }
            .frame(minHeight: 44)
            .accessibilityValue(Text("\(Int(value.wrappedValue)) of 100"))
            // A tick every ten, not on every step, so dragging stays calm.
            .sensoryFeedback(.selection, trigger: Int(value.wrappedValue) / 10)
        }
    }

    // MARK: Progress and controls

    private var progress: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(step.number) of \(CheckInStep.total)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(HubStyle.muted)
                .numericMotion(step.number)
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(HubStyle.controlFill))
                    Capsule().fill(.white)
                        .frame(width: geometry.size.width * Double(step.number) / Double(CheckInStep.total))
                }
            }
            .frame(height: 3)
            .animation(Motion.movement(Motion.content, reduceMotion), value: step)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.background)
        // The question says where the person is.
        .accessibilityHidden(true)
    }

    private var controls: some View {
        HStack(spacing: 12) {
            if step != .headache {
                Button("Back") { move(by: -1) }
                    .buttonStyle(.projection)
            }
            Button(action: next) {
                if sending { ProgressView().tint(HubStyle.solidFill) } else { Text(nextTitle) }
            }
            .buttonStyle(.projectionProminent)
            .accessibilityLabel(sending ? Text("Sending…") : Text(nextTitle))
        }
        .disabled(sending)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.background)
    }

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
        forward = offset > 0
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

    private func focusQuestion() {
        Task {
            // After the slide has started, so VoiceOver reads the new question.
            try? await Task.sleep(for: .milliseconds(100))
            questionFocused = true
        }
    }

    private var slide: AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                           removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity))
    }

    // MARK: Sending

    private func send() {
        focus = nil
        sending = true
        let answers = draft.answers
        Task {
            let result = await model.submitCheckin(answers)
            sending = false
            withAnimation(Motion.reduced(Motion.appear, reduceMotion)) { outcome = result }
            if case .refused = result { return }
            saved(result)
            AccessibilityNotification.Announcement(words(for: result)).post()
            try? await Task.sleep(for: .seconds(result == .sent ? 1.2 : 3))
            dismiss()
        }
    }

    private func confirmation(_ outcome: CheckinOutcome) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: outcome == .sent ? "checkmark.circle" : "clock")
                .font(.largeTitle.weight(.light))
                .accessibilityHidden(true)
            Text(words(for: outcome))
                .font(.title3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
        .projectionCard()
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
