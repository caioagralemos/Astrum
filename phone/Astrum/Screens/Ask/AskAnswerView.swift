// One answer from Ask Astra, as the hub sent it, as an incoming run of
// Messages bubbles: Astra's or the hub's words, then the hub's facts in one
// quiet bubble (each line ending in its kind mark), the steps card, then the
// question Astra asks back, if any, with its answers as quick-reply chips
// (only the newest question's are live; a tap sends the label as the next
// message). Under the run: NASA's passages as numbered source circles (a tap
// opens the passage), then one caption line where Messages says "Delivered":
// the time, the kinds in this answer as mark and word, and an info button
// holding who wrote it, how the hub understood a follow-up, the route and the
// checks. The hub's own conversation sentences (small talk, "which one?",
// "Thank you, noted.") and fixed texts have only their time under them.

import SwiftUI

struct AskAnswerView: View {
    /// The quick replies to the question Astra asked back, if she asked one.
    enum Replies: Equatable {
        /// The newest question: buttons, enabled while asking is possible.
        case live(enabled: Bool)
        /// An older one: its options as plain text, with what was sent after it.
        case past(next: String?)
    }

    let result: AskResult
    let answeredAt: Date
    let lang: String
    var replies: Replies = .past(next: nil)
    /// Sends a quick reply's label as the next message.
    var onReply: (String) -> Void = { _ in }
    /// "Call for help" was sent from under this reply: the hub's line for it.
    var helpSent: String? = nil
    /// Whether the hub can be reached for "Call for help".
    var canCall = false
    /// The owner already went through this reply's steps: "Steps shown" in place of "Start help".
    var stepsShown = false
    /// The owner tapped Done on the last page of a card's steps (its id); only the first time.
    var onStepsDone: (String) -> Void = { _ in }
    /// Sends "Call for help"; throws when it was not sent.
    var onCallHelp: () async throws -> Void = {}
    @State private var openCard: CardView?
    @State private var confirmingHelp = false
    @State private var calling = false
    @State private var callFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            let pieces = self.pieces
            ForEach(Array(pieces.enumerated()), id: \.offset) { index, piece in
                if case .card(let card) = piece {
                    startHelp(card)
                } else {
                    ChatRow(isMine: false) {
                        view(for: piece, hasTail: index == pieces.count - 1)
                    }
                }
            }
            if let pending = result.pendingQuestion, !pending.options.isEmpty, helpSent == nil {
                quickReplies(pending)
            }
            callForHelp
            caption
                .padding(.leading, 12)
                .padding(.top, 3)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(summary))
        .stepsModal(item: $openCard, onDone: { card in if !stepsShown { onStepsDone(card) } })
        .alert("Call everyone for help?", isPresented: $confirmingHelp) {
            Button("Cancel", role: .cancel) {}
            Button("Call") { call() }
        }
    }

    // MARK: Pieces

    private enum Piece {
        case text(String)
        case facts([Fact])
        case card(CardView)
    }

    /// The hub's own conversation sentences: small talk and the turns around her questions.
    /// A turn of talk (small talk, a remark, the conversation's own questions): a plain bubble, nothing attached.
    private var isConversation: Bool { result.smallTalk != nil || result.remark != nil || result.key == "ai.conversation" }

    private var pieces: [Piece] {
        var out: [Piece] = []
        // The hub's facts drawn instead of `text`: Astra's opening sentence goes above them.
        let drawsFacts = answerText == nil && showsFacts && !facts.isEmpty
        if drawsFacts, let lead = result.lead?.text, !lead.isEmpty { out.append(.text(lead)) }
        if let answer = answerText {
            let paragraphs = answer.components(separatedBy: "\n\n")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            out += paragraphs.map(Piece.text)
        }
        if showsFacts && !facts.isEmpty {
            out.append(.facts(facts))
        }
        if let card = result.card { out.append(.card(card)) }
        // The quiet help line after a crisis phrase: `text` holds it already, facts and fixed texts do not.
        if let aside = result.aside, !aside.isEmpty, answerText.map({ !$0.contains(aside) }) ?? true { out.append(.text(aside)) }
        if let pending = result.pendingQuestion {
            // Her ask-first intro before her first question; the question itself unless the words already hold it.
            if pending.purpose == "askFirst", let intro = result.askFirst?.intro, !isConversation {
                out.append(.text(lang == "pt" ? intro.pt : intro.en))
            }
            if !result.text.contains(pending.text) { out.append(.text(pending.text)) }
        } else {
            // A thread saved before the hub kept conversations: the question back as it came, without buttons.
            if let intro = result.askFirst?.intro { out.append(.text(lang == "pt" ? intro.pt : intro.en)) }
            if let question = followUpQuestion { out.append(.text(question)) }
        }
        // Never an empty run: say plainly that nothing came.
        if out.isEmpty && !isConversation { out.append(.text(String(localized: "The hub has no facts for this question."))) }
        return out
    }

    @ViewBuilder
    private func view(for piece: Piece, hasTail: Bool) -> some View {
        switch piece {
        case .text(let text):
            ChatTextBubble(text: text, isMine: false, hasTail: hasTail)
                .accessibilityLabel(Text("Astra: \(text)"))
        case .facts(let facts):
            FactsBubble(facts: facts, hasTail: hasTail)
        case .card:
            EmptyView()
        }
    }

    // MARK: Start help

    /// A steps card is not laid out in the chat: Astra's words are above, and this opens the steps one at a time.
    /// Urgent: the same button, filled, the strongest thing in the run.
    @ViewBuilder
    private func startHelp(_ card: CardView) -> some View {
        if stepsShown {
            stepsShownCaption(card)
        } else {
            startHelpChip(card)
        }
    }

    /// After Done: one quiet caption where the chip was, still opening the steps, so the help is never lost.
    private func stepsShownCaption(_ card: CardView) -> some View {
        Button { StepsPresentation.open { openCard = card } } label: {
            Text("Steps shown")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.leading, 12)
        .padding(.vertical, -8)
        .keepsKeyboard()
        .accessibilityLabel(Text("Steps shown: \(card.title)"))
        .accessibilityHint(Text("Opens the steps again"))
    }

    private func startHelpChip(_ card: CardView) -> some View {
        let urgent = AskThread.isUrgent(result)
        return VStack(alignment: .leading, spacing: 6) {
            Text(card.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if card.lang != lang {
                Text("This card is only written in another language.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            // A reply chip, like Yes and No under a question: the chat's own scale, never a banner.
            Button { StepsPresentation.open { openCard = card } } label: {
                Label("Start help", systemImage: "list.number")
                    .font(.callout.weight(urgent ? .semibold : .regular))
                    .foregroundStyle(ChatBubbleShape.outgoingFill)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .modifier(ComposerPill(cornerRadius: 16))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .keepsKeyboard()
            .accessibilityLabel(Text("Start help: \(card.title)"))
            .accessibilityHint(Text("Opens the steps one at a time"))
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Call for help

    /// Offered only after a "no" to "Are you feeling better?": a reply chip like Yes and No, which tells everyone,
    /// as "I need help" does. A standard dialog confirms first. Once sent, the hub's line takes its place.
    @ViewBuilder
    private var callForHelp: some View {
        if let helpSent {
            ChatRow(isMine: false) {
                ChatTextBubble(text: helpSent, isMine: false, hasTail: true)
                    .accessibilityLabel(Text("Astra: \(helpSent)"))
            }
            .padding(.top, 4)
        } else {
            // A typed "yes" to the offer: the chip alone, under the hub's line.
            if result.offerHelp == true, case .live(let enabled) = replies {
                helpChip(String(localized: "Call for help"), enabled: enabled)
                    .padding(.leading, 4)
                    .padding(.top, 2)
            }
            if callFailed {
                Text("Not sent. Try again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 12)
            }
        }
    }

    /// "Call for help" as a reply chip: it opens the confirmation instead of sending its words.
    private func helpChip(_ label: String, enabled: Bool) -> some View {
        let live = enabled && canCall && !calling
        return Button { confirmingHelp = true } label: { chipLabel(label, enabled: live) }
            .buttonStyle(.plain)
            .disabled(!live)
            .keepsKeyboard()
            .accessibilityLabel(Text(label))
            .accessibilityHint(Text("Tells everyone on the crew. You confirm first."))
    }

    private func chipLabel(_ label: String, enabled: Bool) -> some View {
        Text(label)
            .font(.callout)
            .foregroundStyle(enabled ? AnyShapeStyle(ChatBubbleShape.outgoingFill) : AnyShapeStyle(.secondary))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .modifier(ComposerPill(cornerRadius: 16))
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
    }

    private func call() {
        calling = true
        callFailed = false
        Task {
            do { try await onCallHelp() } catch { callFailed = true }
            calling = false
        }
    }

    // MARK: Quick replies

    /// Messages' suggestion chips under the question: live on the newest one, plain text on older ones.
    @ViewBuilder
    private func quickReplies(_ pending: AskResult.PendingQuestion) -> some View {
        switch replies {
        case .live(let enabled):
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { chips(pending, enabled: enabled) }
                VStack(alignment: .leading, spacing: 4) { chips(pending, enabled: enabled) }
            }
            .padding(.leading, 4)
            .padding(.top, 2)
        case .past(let next):
            let labels = Self.replyOptions(pending).map(\.label)
            Group {
                if let next, let chosen = labels.first(where: { $0.caseInsensitiveCompare(next.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame }) {
                    Text("Replied: \(chosen)")
                } else {
                    Text("Replies offered: \(labels.formatted(.list(type: .or)))")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, 12)
        }
    }

    /// A single offer ("Want to see your heart rate?") is answered Yes or No, which the hub reads in both
    /// languages; any other question keeps the hub's own options.
    private static func replyOptions(_ pending: AskResult.PendingQuestion) -> [AskResult.PendingQuestion.Option] {
        guard pending.options.count == 1 else { return pending.options }
        return [.init(value: "yes", label: String(localized: "Yes")), .init(value: "no", label: String(localized: "No"))]
    }

    @ViewBuilder
    private func chips(_ pending: AskResult.PendingQuestion, enabled: Bool) -> some View {
        ForEach(Self.replyOptions(pending), id: \.value) { option in
            // "Do you want to call for help?": its "Call for help" confirms and calls; it is never sent as words.
            if pending.purpose == "offerHelp" && option.value == "help" {
                helpChip(option.label, enabled: enabled)
            } else {
                Button { onReply(option.label) } label: { chipLabel(option.label, enabled: enabled) }
                    .buttonStyle(.plain)
                    .disabled(!enabled)
                    .keepsKeyboard()
                    .accessibilityLabel(Text("Reply: \(option.label)"))
                    .accessibilityHint(Text("Sends this as your answer"))
            }
        }
    }

    // MARK: Under the run

    @State private var showingAbout = false

    /// One quiet line under the run, in the register of Messages' "Delivered": the time, the kinds in
    /// this answer, then the sources and the rest one tap away. Two lines only when one cannot hold it.
    private var caption: some View {
        VStack(alignment: .leading, spacing: 4) {
            if result.urgent {
                StatusBadge(text: String(localized: "Marked urgent"), tone: .danger)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    timeAndKinds
                    sourcesPill
                    aboutButton
                }
                .lineLimit(1)
                VStack(alignment: .leading, spacing: 6) {
                    timeAndKinds
                    HStack(spacing: 8) {
                        sourcesPill
                        aboutButton
                    }
                }
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var timeAndKinds: some View {
        HStack(spacing: 5) {
            Text(ChatTimeline.short(answeredAt))
                .monospacedDigit()
            if !kinds.isEmpty {
                Text(verbatim: "·").accessibilityHidden(true)
                legend
            }
        }
    }

    @ViewBuilder
    private var sourcesPill: some View {
        if showsFacts && !passages.isEmpty {
            SourcesPill(passages: passages)
        }
    }

    /// The kinds that appear in this answer, each its mark and its word; one element for VoiceOver.
    private var legend: some View {
        LabelsLayout {
            ForEach(kinds, id: \.self) { kind in
                HStack(spacing: 4) {
                    KindMark(kind: kind)
                    Text(Signals.kindName(kind))
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(kinds.map { Signals.kindName($0).lowercased() }.formatted(.list(type: .and)).capitalizedFirst) values"))
    }

    private var kinds: [Kind] {
        guard showsFacts else { return [] }
        return Set(facts.flatMap { $0.labels.compactMap(\.kind) }).sorted()
    }

    /// Who wrote it and how it was checked, kept one tap away. Not for conversation turns or fixed texts.
    @ViewBuilder
    private var aboutButton: some View {
        if !isConversation && (result.by == "model" || result.by == "hub") {
            Button { showingAbout = true } label: {
                Image(systemName: "info.circle")
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .padding(.vertical, -14)
            .padding(.horizontal, -12)
            .accessibilityLabel(Text("About this answer"))
            .popover(isPresented: $showingAbout) {
                aboutText
                    .presentationCompactAdaptation(.popover)
            }
        }
    }

    private var aboutText: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About this answer").font(.subheadline.weight(.semibold))
            Group {
                Text(Self.byText(result.by))
                if let understood = result.understoodAs {
                    Text("Understood as: \(understood)")
                }
                if let route = routeText { Text(route) }
                if result.by == "model" && lang == "pt" {
                    Text("Astra writes in English.")
                }
                if result.check?.discarded == true, result.reason == nil || result.reason == "setAside" {
                    Text("The hub set Astra's answer aside: it did not pass the checks.")
                }
                if result.card == nil && (result.route == "card" || result.urgent) {
                    Text("No steps card has been written for this yet.")
                }
                if !passages.isEmpty && showsFacts {
                    Text("NASA's words are quoted in English, unchanged.")
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(idealWidth: 280, alignment: .leading)
        .padding(16)
        .accessibilityElement(children: .combine)
    }

    // MARK: Words

    static func byText(_ by: String) -> String {
        switch by {
        case "model": String(localized: "Astra's words, checked by the hub")
        case "hub": String(localized: "Written by the hub from your readings")
        default: String(localized: "A fixed text")
        }
    }

    /// What VoiceOver hears when an answer arrives.
    static func arrivalText(_ result: AskResult) -> String {
        if result.smallTalk != nil || result.remark != nil || result.key == "ai.conversation" { return String(localized: "Astra answered.") }
        return String(localized: "Astra answered. \(byText(result.by))")
    }

    /// For VoiceOver on entering the run: when, who wrote it, the labels in words.
    private var summary: String {
        var parts = [String(localized: "Astra's answer, \(ChatTimeline.short(answeredAt))")]
        if !isConversation { parts.append(Self.byText(result.by)) }
        if let understood = result.understoodAs { parts.append(String(localized: "Understood as: \(understood)")) }
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
    /// Small talk and the conversation's turns come in the asker's language already, varied: as sent.
    private var answerText: String? {
        if let key = result.key, result.smallTalk == nil, result.remark == nil { return Self.fixedText(key) ?? (result.text.isEmpty ? nil : result.text) }
        if result.by == "hub" && !facts.isEmpty { return nil }
        return result.text.isEmpty ? nil : result.text
    }

    /// The hub's question back in a thread saved before conversations ("Did it get better?" in this language).
    private var followUpQuestion: String? {
        guard let question = result.followUp?.question else { return nil }
        return question == "Did it get better?" ? String(localized: "Did it get better?") : question
    }

    private static func fixedText(_ key: String) -> String? {
        switch key {
        case "ai.refusal": String(localized: "That's one I can't answer from your readings or NASA's text, and I won't guess at it. Tap Contact Earth and your question goes to your flight surgeon.")
        case "ai.unavailable": String(localized: "I can't put an answer into words right now, so here are the readings and NASA's text as they are. Tap Contact Earth to ask your flight surgeon.")
        case "ai.slow": String(localized: "I couldn't finish my answer in time, so here are the readings and NASA's text as they are. Tap Contact Earth to ask your flight surgeon.")
        case "ai.busy": String(localized: "A few questions are ahead of yours. Ask me again in a moment, or tap Contact Earth.")
        case "ai.card": String(localized: "This needs the steps card, not an answer from me. The card is on screen.")
        case "ai.crisis": String(localized: "This needs a person, not me. Please go to a crewmate or your Crew Medical Officer now.")
        case "ai.crisisTold": String(localized: "This needs a person, not me. I've asked a crewmate to come and be with you.")
        case "ai.urgentNoCard": String(localized: "No steps card fits this, and I won't guess a treatment. Use your onboard emergency checklist, call your Crew Medical Officer now, and message Earth.")
        default: nil
        }
    }
}

// MARK: Facts and sources

/// The hub's facts in one bubble, a short line each, every line ending in
/// its kind mark(s); the words for the marks are in the caption. More than
/// four: the first three and "N more", which opens in place.
private struct FactsBubble: View {
    let facts: [AskAnswerView.Fact]
    let hasTail: Bool
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// From a line's baseline up to its mark's centre, so the mark sits on the first line's x-height.
    @ScaledMetric(relativeTo: .subheadline) private var markRise: CGFloat = 4.5

    var body: some View {
        let shown = expanded || facts.count <= 4 ? facts : Array(facts.prefix(3))
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(shown.enumerated()), id: \.offset) { _, fact in
                line(fact)
            }
            if shown.count < facts.count {
                let hidden = facts.count - shown.count
                Button {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { expanded = true }
                } label: {
                    Text("\(hidden) more")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ChatBubbleShape.outgoingFill)
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .padding(.vertical, -10)
                .accessibilityLabel(Text("Show \(hidden) more facts"))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(ChatBubbleShape(isMine: false, hasTail: hasTail).fill(ChatBubbleShape.incomingFill))
        .contextMenu {
            Button("Copy", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = facts.map(\.text).joined(separator: "\n")
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func line(_ fact: AskAnswerView.Fact) -> some View {
        let marks = fact.labels.compactMap(\.kind)
        // The marks follow the last word, so the eye reads sentence then label; never a column at the edge.
        let tail = marks.reduce(Text(verbatim: marks.isEmpty ? "" : "\u{00A0}")) { text, kind in
            text + Text(verbatim: "\u{00A0}") + Text(Image(systemName: Self.symbol(kind))).font(.system(size: 8, weight: .semibold)).foregroundStyle(.secondary).baselineOffset(2)
        }
        return (Text(fact.text) + tail)
            .font(.subheadline)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: fact.labels.isEmpty ? fact.text
                : "\(fact.text.hasSuffix(".") ? String(fact.text.dropLast()) : fact.text), \(fact.labels.map(\.text).formatted(.list(type: .and)))"))
    }

    /// The kind marks as glyphs that can sit inside a line of text; the same shapes as KindMark.
    private static func symbol(_ kind: Kind) -> String {
        switch kind {
        case .measured: "circle.fill"
        case .replayed: "circle.lefthalf.filled"
        case .estimated: "circle.dotted"
        case .reported: "square.fill"
        case .simulated: "circle"
        }
    }
}

/// Labels side by side, stacked at accessibility sizes so none is cut.
private struct LabelsLayout<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 8))
        layout { content }
    }
}

/// NASA's passages behind one small pill in the caption line: overlapped numbered dots and the count.
/// A tap opens the passages in a sheet, one page each.
private struct SourcesPill: View {
    let passages: [Passage]
    @State private var open = false
    @State private var page = 0
    @ScaledMetric(relativeTo: .caption2) private var dot: CGFloat = 15

    var body: some View {
        Button { page = 0; open = true } label: {
            HStack(spacing: 5) {
                HStack(spacing: -dot * 0.3) {
                    ForEach(0..<min(passages.count, 3), id: \.self) { index in
                        Text(verbatim: "\(index + 1)")
                            .font(.system(size: dot * 0.6, weight: .semibold).monospacedDigit())
                            .foregroundStyle(.black)
                            .frame(width: dot, height: dot)
                            .background(Circle().fill(.white.opacity(0.85)))
                            .overlay(Circle().strokeBorder(.black, lineWidth: 1))
                            .zIndex(Double(3 - index))
                    }
                }
                Text(passages.count == 1 ? String(localized: "1 source") : String(localized: "\(passages.count) sources"))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.primary.opacity(0.85))
            }
            .padding(.leading, 4)
            .padding(.trailing, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(.white.opacity(0.1)))
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.vertical, -14)
        .accessibilityLabel(Text(passages.count == 1 ? String(localized: "1 source: \(passages[0].name)") : String(localized: "\(passages.count) sources: \(passages[0].name)")))
        .accessibilityHint(Text("Opens NASA's passages."))
        .sheet(isPresented: $open) {
            TabView(selection: $page) {
                ForEach(Array(passages.enumerated()), id: \.offset) { index, passage in
                    PassageSheet(passage: passage, number: index + 1, count: passages.count)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: passages.count > 1 ? .always : .never))
            .presentationDetents([.medium, .large])
            // The sheet inherits the caption line's one-line limit and small grey type: give it its own.
            .lineLimit(nil)
            .font(.body)
            .foregroundStyle(.primary)
        }
    }
}

/// One passage of NASA's text, in full, unchanged, with the link to its source.
private struct PassageSheet: View {
    let passage: Passage
    let number: Int
    let count: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(passage.name)
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: "“\(passage.text)”")
                        .italic()
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                    Text("NASA's words are quoted in English, unchanged.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let url = URL(string: passage.url), !passage.url.isEmpty {
                        Link(destination: url) {
                            Label("Open the source", systemImage: "arrow.up.right.square")
                                .frame(minHeight: 44)
                        }
                        .accessibilityHint(Text(verbatim: url.host() ?? passage.url))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .navigationTitle(Text("Source \(number) of \(count)"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private extension String {
    /// "measured, replayed and simulated" → "Measured, replayed and simulated".
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            AskAnswerView(result: SampleData.answer, answeredAt: .now, lang: "en")
            AskAnswerView(result: SampleData.pendingAnswer, answeredAt: .now, lang: "en", replies: .live(enabled: true))
            AskAnswerView(result: SampleData.smallTalkAnswer, answeredAt: .now, lang: "en")
        }
        .padding(16)
    }
    .preferredColorScheme(.dark)
}
