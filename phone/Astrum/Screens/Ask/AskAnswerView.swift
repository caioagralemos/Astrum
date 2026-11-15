// One answer from Ask Astra, as the hub sent it, as an incoming run of
// Messages bubbles: Astra's or the hub's words, then the attachments (the
// hub's facts each with its label, the steps card, NASA's words quoted
// unchanged with a link to the source), then any question the hub asks back
// with Yes / No when it takes one. Under the run, where Messages says
// "Delivered": who wrote it, the route when it is not a plain answer, and
// when it was answered, so an old answer is never taken for a current one.

import SwiftUI

struct AskAnswerView: View {
    let result: AskResult
    let answeredAt: Date
    let lang: String
    /// The owner's quick reply to the follow-up, once sent.
    var reply: Bool?
    /// Why the quick reply could not be sent, if it could not.
    var replyProblem: String?
    /// Sends a quick reply; nil when replying is off (hub out of reach, previews).
    var onReply: ((Bool) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            let pieces = self.pieces
            ForEach(Array(pieces.enumerated()), id: \.offset) { index, piece in
                ChatRow(isMine: false) {
                    view(for: piece, hasTail: index == pieces.count - 1)
                }
            }
            caption
                .padding(.leading, 12)
                .padding(.top, 2)
            if let signal = yesNoSignal, reply == nil {
                quickReplies(signal)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(summary))
    }

    // MARK: Pieces

    private enum Piece {
        case text(String)
        case fact(Fact)
        case card(CardView)
        case passage(Passage)
    }

    private var pieces: [Piece] {
        var out: [Piece] = []
        if let answer = answerText {
            let paragraphs = answer.components(separatedBy: "\n\n")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            out += paragraphs.map(Piece.text)
        }
        if showsFacts {
            out += facts.map(Piece.fact)
        }
        if let card = result.card { out.append(.card(card)) }
        if showsFacts {
            out += passages.map(Piece.passage)
        }
        if let intro = result.askFirst?.intro { out.append(.text(lang == "pt" ? intro.pt : intro.en)) }
        if let question = followUpQuestion { out.append(.text(question)) }
        // Never an empty run: say plainly that nothing came.
        if out.isEmpty { out.append(.text(String(localized: "The hub has no facts for this question."))) }
        return out
    }

    @ViewBuilder
    private func view(for piece: Piece, hasTail: Bool) -> some View {
        switch piece {
        case .text(let text):
            ChatTextBubble(text: text, isMine: false, hasTail: hasTail)
                .accessibilityLabel(Text("Astra: \(text)"))
        case .fact(let fact):
            FactAttachment(fact: fact, hasTail: hasTail)
        case .card(let card):
            StepsCardView(card: card, otherLanguage: card.lang != lang)
                .padding(12)
                .background(ChatBubbleShape(isMine: false, hasTail: hasTail).fill(ChatBubbleShape.incomingFill))
                .accessibilityElement(children: .contain)
        case .passage(let passage):
            PassageAttachment(passage: passage, hasTail: hasTail)
        }
    }

    // MARK: Under the run

    private var caption: some View {
        VStack(alignment: .leading, spacing: 3) {
            if result.urgent {
                StatusBadge(text: String(localized: "Marked urgent"), tone: .danger)
            }
            if let route = routeText { Text(route) }
            Text(Self.byText(result.by))
            if result.by == "model" && lang == "pt" {
                Text("Astra writes in English.")
            }
            if result.check?.discarded == true {
                Text("The hub set Astra's answer aside: it did not pass the checks.")
            }
            if result.card == nil && (result.route == "card" || result.urgent) {
                Text("No steps card has been written for this yet.")
            }
            if !passages.isEmpty && showsFacts {
                Text("NASA's words are quoted in English, unchanged.")
            }
            Text("Answered at \(ChatTimeline.short(answeredAt)) in \(seconds) s, from the readings then")
            if let replyProblem {
                Text(replyProblem).foregroundStyle(.red)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func quickReplies(_ signal: String) -> some View {
        HStack(spacing: 8) {
            ForEach([true, false], id: \.self) { yes in
                Button {
                    onReply?(yes)
                } label: {
                    Text(yes ? String(localized: "Yes") : String(localized: "No"))
                        .font(.callout)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .modifier(ComposerPill(cornerRadius: 16))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(onReply == nil)
                .accessibilityHint(Text("Answers the hub's question"))
            }
        }
        .padding(.leading, 4)
    }

    private var seconds: String { (result.ms / 1000).formatted(.number.precision(.fractionLength(1))) }

    // MARK: Words

    static func byText(_ by: String) -> String {
        switch by {
        case "model": String(localized: "Astra's words, checked by the hub")
        case "hub": String(localized: "Written by the hub from your readings")
        default: String(localized: "A fixed text")
        }
    }

    /// For VoiceOver on entering the run: when, who wrote it, the labels in words.
    private var summary: String {
        var parts = [String(localized: "Astra's answer, \(ChatTimeline.short(answeredAt))"), Self.byText(result.by)]
        if result.urgent { parts.append(String(localized: "Marked urgent")) }
        var seen = Set<String>()
        let labels = (showsFacts ? facts.flatMap { $0.labels.map(\.text) } : []).filter { seen.insert($0).inserted }
        if !labels.isEmpty { parts.append(String(localized: "Labels: \(labels.formatted(.list(type: .and)))")) }
        if showsFacts && !passages.isEmpty { parts.append(String(localized: "\(passages.count) NASA quotes")) }
        return parts.joined(separator: ". ")
    }

    private var showsFacts: Bool { result.route != "crisis" && result.route != "card" }

    private var routeText: String? {
        switch result.route {
        case "crisis": String(localized: "This needs a person. Astra was not used.")
        case "card": String(localized: "The hub's urgent rules matched: the steps card, not Astra.")
        case "unavailable": String(localized: "Astra is off; the hub answered from your readings.")
        case "fallback": String(localized: "Astra was too slow or failed; the hub answered from your readings.")
        default: nil
        }
    }

    fileprivate struct Fact {
        struct Label { let kind: Kind?; let text: String }
        let text: String
        let labels: [Label]
    }

    private var facts: [Fact] {
        (result.facts?.items ?? []).compactMap { item in
            guard let text = AnswerStrings.sentence(item, lang: lang) else { return nil }
            if item.key == "answer.notExact" { return Fact(text: text, labels: []) }
            let parts = item.labels ?? []
            let labels: [Fact.Label]
            if parts.count > 1 && Set(parts.map(\.kind)).count > 1 {
                labels = parts.map { Fact.Label(kind: $0.kind, text: "\($0.what == "CO2" ? String(localized: "CO2") : String(localized: "location")): \(Signals.kindName($0.kind))") }
            } else if let kind = Kind(rawValue: item.label) {
                labels = [Fact.Label(kind: kind, text: Signals.kindName(kind))]
            } else {
                labels = [Fact.Label(kind: nil, text: String(localized: "The hub's own rule"))]
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
        return result.text.isEmpty ? nil : result.text
    }

    /// The hub's question back, as it sent it ("Did it get better?" in this language).
    private var followUpQuestion: String? {
        guard let question = result.followUp?.question else { return nil }
        return question == "Did it get better?" ? String(localized: "Did it get better?") : question
    }

    /// The follow-up's signal when it takes a yes or a no.
    private var yesNoSignal: String? {
        guard let signal = result.followUp?.signal else { return nil }
        if signal == "checkin.got_better" { return signal }
        return result.askFirst?.questions.first(where: { $0.signal == signal })?.kind == "yes_no" ? signal : nil
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

// MARK: Attachments

/// The top of an attachment: the bubble's grey with only its top corners
/// rounded, over the footer band that fills the rest of the outline.
private let attachmentTop = UnevenRoundedRectangle(topLeadingRadius: 17, topTrailingRadius: 17, style: .continuous)

/// One of the hub's facts, as Messages shows a rich link: the sentence, then
/// its label(s) in the band under it. Every number keeps its label.
private struct FactAttachment: View {
    let fact: AskAnswerView.Fact
    let hasTail: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(fact.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(attachmentTop.fill(ChatBubbleShape.incomingFill))
            if !fact.labels.isEmpty {
                LabelsLayout {
                    ForEach(Array(fact.labels.enumerated()), id: \.offset) { _, label in
                        HStack(spacing: 4) {
                            if let kind = label.kind { KindMark(kind: kind) }
                            Text(label.text)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(ChatBubbleShape(isMine: false, hasTail: hasTail)
            .fill(fact.labels.isEmpty ? ChatBubbleShape.incomingFill : ChatBubbleShape.bandFill))
        .contextMenu {
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = fact.text }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(fact.labels.isEmpty ? fact.text
            : String(localized: "\(fact.text) Label: \(fact.labels.map(\.text).formatted(.list(type: .and)))")))
    }
}

/// Labels side by side, stacked at accessibility sizes so none is cut.
private struct LabelsLayout<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 10))
        layout { content }
    }
}

/// NASA's words as Messages shows a link: the quote, then the source's name
/// and site in the band; a tap opens the source.
private struct PassageAttachment: View {
    let passage: Passage
    let hasTail: Bool

    var body: some View {
        if let url = URL(string: passage.url), !passage.url.isEmpty {
            Link(destination: url) { preview(host: url.host()) }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Opens the source"))
        } else {
            preview(host: nil)
        }
    }

    private func preview(host: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: "“\(passage.text)”")
                .italic()
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(attachmentTop.fill(ChatBubbleShape.incomingFill))
            VStack(alignment: .leading, spacing: 1) {
                Text(passage.name)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.primary)
                if let host {
                    Text(verbatim: host)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(ChatBubbleShape(isMine: false, hasTail: hasTail).fill(ChatBubbleShape.bandFill))
        .contentShape(.rect)
        .contextMenu {
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = passage.text }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("NASA's words, quoted unchanged: \(passage.text). Source: \(passage.name)"))
        .accessibilityAddTraits(host == nil ? [] : .isLink)
    }
}

#Preview {
    ScrollView {
        AskAnswerView(result: SampleData.answer, answeredAt: .now, lang: "en", onReply: { _ in })
            .padding(16)
    }
    .preferredColorScheme(.dark)
}
