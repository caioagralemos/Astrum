// The medical lead's follow-up question, on Me, for the one person it is for
// (the hub sends it to their own socket only: hub/engine/privacy.ts followUpFor).
// Her words as the hub gives them, in the app's language, never rewritten; the
// answer goes through the check-in route like any other, 1 yes, 0 no, or a
// typed reading in her unit (hub/ui/src/person/FollowUp.tsx on the hub's screen).
// Announced politely when it arrives. While a recorded story plays it stays
// visible and cannot be answered.

import SwiftUI

struct FollowUpCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The asking (FollowUpAsk.key) answered from here, so "saved" shows and the question goes at once.
    @State private var answered: String?
    @State private var sending = false
    @State private var failed = false
    @State private var typed = ""

    /// The question still to answer, when it is this phone owner's.
    private var open: FollowUpAsk? {
        guard let ask = model.world.followUp, !model.person.isEmpty, ask.person == model.person, ask.key != answered else { return nil }
        return ask
    }

    private var recorded: Bool { model.world.scenario != nil }

    var body: some View {
        if open != nil || answered != nil {
            card.projectionRow()
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 10) {
            if answered != nil {
                Text("Your answer is saved.")
                    .font(.subheadline)
                    .transition(.astrumRise(reduceMotion: reduceMotion))
            }
            if let ask = open {
                VStack(alignment: .leading, spacing: 4) {
                    Text("A question for you")
                        .font(.footnote)
                        .foregroundStyle(HubStyle.muted)
                    Text(verbatim: words(ask))
                        .font(.body.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                if recorded { note("A recorded story is playing. You can answer when it ends.") }
                if failed { note("Your answer did not reach the hub. Try again.") }
                if ask.kind == "value" {
                    reading(ask)
                } else {
                    yesNo(ask)
                }
            }
        }
        .padding(.vertical, 4)
        .animation(Motion.reduced(Motion.appear, reduceMotion), value: answered)
        .onChange(of: open?.key) { _, key in
            typed = ""
            failed = false
            if key != nil, let ask = open { announce(String(localized: "A question for you") + ". " + words(ask)) }
        }
        .onChange(of: model.person) { answered = nil }
    }

    // MARK: Answers

    private func yesNo(_ ask: FollowUpAsk) -> some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            Button("Yes") { send(ask, value: 1, text: nil) }
                .accessibilityHint(Text(verbatim: words(ask)))
            Button("No") { send(ask, value: 0, text: nil) }
                .accessibilityHint(Text(verbatim: words(ask)))
        }
        .buttonStyle(.projection)
        .disabled(recorded || sending)
    }

    private func reading(_ ask: FollowUpAsk) -> some View {
        let answer = Self.typedAnswer(typed)
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return VStack(alignment: .leading, spacing: 8) {
            layout {
                TextField("Your answer", text: $typed)
                    .keyboardType(.numbersAndPunctuation)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.send)
                    .onSubmit { if let answer { send(ask, value: answer.value, text: answer.text) } }
                    .projectionField()
                    .disabled(recorded)
                    .accessibilityLabel(Text(verbatim: words(ask)))
                    .accessibilityHint(ask.unit.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
                if let unit = ask.unit {
                    Text(verbatim: unit)
                        .font(.subheadline)
                        .foregroundStyle(HubStyle.muted)
                        .accessibilityHidden(true)
                }
            }
            Button("Send") { if let answer { send(ask, value: answer.value, text: answer.text) } }
                .buttonStyle(.projectionProminent)
                .disabled(recorded || sending || answer == nil)
        }
    }

    private func note(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func words(_ ask: FollowUpAsk) -> String {
        model.lang == "pt" ? ask.text.pt : ask.text.en
    }

    /// A typed answer as a check-in value: a plain number is a number, anything else (120/80) is text.
    static func typedAnswer(_ text: String) -> (value: Double?, text: String?)? {
        let v = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return nil }
        let plain = v.first?.isASCII == true && v.first?.isNumber == true && v.last?.isASCII == true && v.last?.isNumber == true
            && v.allSatisfy { $0.isASCII && ($0.isNumber || $0 == "." || $0 == ",") }
        if plain, let number = Double(v.replacingOccurrences(of: ",", with: ".")) { return (number, nil) }
        return (nil, String(v.prefix(80)))
    }

    private func send(_ ask: FollowUpAsk, value: Double?, text: String?) {
        guard !recorded, !sending else { return }
        guard let api = model.api else {
            failed = true
            announce(String(localized: "Your answer did not reach the hub. Try again."))
            return
        }
        sending = true
        failed = false
        let person = model.person
        let answer = CheckinAnswer(signal: ask.signal, value: value, text: text, unit: ask.unit ?? "")
        Task {
            do {
                try await api.checkin(person: person, answers: [answer])
                answered = ask.key
                announce(String(localized: "Your answer is saved."))
            } catch {
                failed = true
                announce(String(localized: "Your answer did not reach the hub. Try again."))
            }
            sending = false
        }
    }

    /// Spoken after what VoiceOver is saying now, never over it.
    private func announce(_ text: String) {
        var words = AttributedString(text)
        words[AttributeScopes.AccessibilityAttributes.AnnouncementPriorityAttribute.self] = .low
        AccessibilityNotification.Announcement(words).post()
    }
}
