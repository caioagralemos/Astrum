// One answer from Ask Astra, as the hub sent it: who wrote it (Astra, the
// hub from your readings, or a fixed text), the route when it is not a plain
// answer (urgent, steps card, crisis), the hub's facts each with its
// label(s), and NASA's words quoted unchanged with source and link.

import SwiftUI

struct AskAnswerView: View {
    let result: AskResult
    let lang: String

    var body: some View {
        Section("Answer") {
            HStack(spacing: 8) {
                Text(byText)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .overlay(Capsule().strokeBorder(.secondary, lineWidth: 0.5))
                if result.urgent {
                    StatusBadge(text: String(localized: "Marked urgent"), tone: .danger)
                }
            }
            if let route = routeText {
                Text(route).foregroundStyle(.secondary)
            }
            if let answer = answerText {
                Text(answer)
            }
            if result.by == "model" && lang == "pt" {
                Text("Astra writes in English.").font(.footnote).foregroundStyle(.secondary)
            }
            if result.check?.discarded == true {
                Text("The hub set Astra's answer aside: it did not pass the checks.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let card = result.card {
                StepsCardView(card: card, otherLanguage: card.lang != lang)
            } else if result.route == "card" || result.urgent {
                Text("No steps card has been written for this yet.").foregroundStyle(.secondary)
            }
        }

        if result.route != "crisis" && result.route != "card" {
            Section("What the hub knows") {
                if facts.isEmpty {
                    Text("The hub has no facts for this question.").foregroundStyle(.secondary)
                }
                ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(fact.text)
                        HStack(spacing: 6) {
                            ForEach(fact.labels, id: \.self) { label in
                                Text(label)
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .overlay(Capsule().strokeBorder(.secondary.opacity(0.5), lineWidth: 0.5))
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            Section {
                if passages.isEmpty {
                    Text("No NASA passage came with this answer.").foregroundStyle(.secondary)
                }
                ForEach(passages, id: \.self) { passage in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: "“\(passage.text)”")
                            .italic()
                        Text("Source: \(passage.name)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let url = URL(string: passage.url), !passage.url.isEmpty {
                            Link(destination: url) {
                                Text("Open the source: \(passage.name)")
                                    .font(.footnote)
                            }
                        }
                    }
                }
            } header: {
                Text("NASA's words")
            } footer: {
                if !passages.isEmpty { Text("Quoted in English, unchanged.") }
            }
        }

        Section {
            Text("Answered in \((result.ms / 1000).formatted(.number.precision(.fractionLength(1)))) s")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Words

    private var byText: String {
        switch result.by {
        case "model": String(localized: "Written by Astra, checked by the hub")
        case "hub": String(localized: "Written by the hub from your readings")
        default: String(localized: "A fixed text")
        }
    }

    private var routeText: String? {
        switch result.route {
        case "crisis": String(localized: "This needs a person. Astra was not used.")
        case "card": String(localized: "The hub's urgent rules matched: the steps card, not Astra.")
        case "unavailable": String(localized: "Astra is off; the hub answered from your readings.")
        case "fallback": String(localized: "Astra was too slow or failed; the hub answered from your readings.")
        default: nil
        }
    }

    private struct Fact {
        let text: String
        let labels: [String]
    }

    private var facts: [Fact] {
        (result.facts?.items ?? []).compactMap { item in
            guard let text = AnswerStrings.sentence(item, lang: lang) else { return nil }
            if item.key == "answer.notExact" { return Fact(text: text, labels: []) }
            let parts = item.labels ?? []
            let labels: [String]
            if parts.count > 1 && Set(parts.map(\.kind)).count > 1 {
                labels = parts.map { "\($0.what == "CO2" ? String(localized: "CO2") : String(localized: "location")): \(Signals.kindName($0.kind))" }
            } else {
                labels = [Kind(rawValue: item.label).map(Signals.kindName) ?? String(localized: "The hub's own rule")]
            }
            return Fact(text: text, labels: labels)
        }
    }

    private var passages: [Passage] {
        if let facts = result.facts, !facts.passages.isEmpty { return facts.passages }
        return result.passages
    }

    /// A fixed text in this language; the hub's sentences are already the facts; Astra's words as written.
    private var answerText: String? {
        if let key = result.key { return Self.fixedText(key) ?? result.text }
        if result.by == "hub" && !facts.isEmpty { return nil }
        return result.text
    }

    private static func fixedText(_ key: String) -> String? {
        switch key {
        case "ai.refusal": String(localized: "I don't know. My NASA sources don't cover this, and I won't guess. Tap Ask Houston to send it to your flight surgeon. The answer takes about 40 minutes.")
        case "ai.unavailable": String(localized: "The AI isn't available right now. Here are the readings and NASA's text as they are. Tap Ask Houston to ask your flight surgeon.")
        case "ai.slow": String(localized: "I couldn't finish an answer in time. Here are the readings and NASA's text as they are. Tap Ask Houston to ask your flight surgeon.")
        case "ai.busy": String(localized: "Too many questions are waiting. Ask again in a moment, or tap Ask Houston.")
        case "ai.card": String(localized: "This needs the steps card, not an answer from me. The card is on screen.")
        case "ai.crisis": String(localized: "This needs a person, not me. Please go to a crewmate or your Crew Medical Officer now.")
        case "ai.crisisTold": String(localized: "This needs a person, not me. I've asked a crewmate to come and be with you.")
        case "ai.urgentNoCard": String(localized: "My NASA sources don't cover this, so I won't guess a treatment. Follow your onboard emergency checklist, get your Crew Medical Officer now, and message Houston.")
        default: nil
        }
    }
}

#Preview {
    Form {
        AskAnswerView(result: SampleData.answer, lang: "en")
    }
    .preferredColorScheme(.dark)
}
