// Ask Astra: a Messages-style thread of questions about yourself to the
// hub's model (POST /api/ask). Your questions on the right in blue, Astra's
// answers on the left as the hub sent them (AskAnswerView), the composer
// pinned at the bottom. The hub holds the conversation for 30 minutes
// (follow-ups like "and yesterday?", replies to the questions Astra asks
// back); every answer is still checked on its own. A quick reply is sent as
// the next message, through the same call. The model runs on the hub, never
// on the phone: out of reach, asking is off and says why, and the saved
// thread stays readable.

import SwiftUI

struct AskView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var thread: AskThread
    @State private var draft = ""
    @State private var status: AskStatus?
    @State private var showingSettings = false
    @State private var confirmingClear = false
    /// Questions sent while this screen was open: only they arrive with motion.
    @State private var sent: Set<UUID> = []
    @FocusState private var typing: Bool

    private static let bottom = "bottom"

    private let examples: [String] = [
        String(localized: "Why do I keep waking up with a headache?"),
        String(localized: "Is the CO2 in my room dangerous?"),
        String(localized: "How much should I exercise?"),
    ]

    init(thread: AskThread = AskThread()) {
        _thread = State(initialValue: thread)
    }

    var body: some View {
        NavigationStack {
            transcript
                .safeAreaInset(edge: .bottom, spacing: 0) { composer }
                .navigationTitle("Astra")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) { header }
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Clear") { confirmingClear = true }
                            .disabled(thread.exchanges.isEmpty)
                            .accessibilityHint(Text("Deletes the thread saved on this phone"))
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        SettingsButton { showingSettings = true }
                    }
                }
                .confirmationDialog("Clear the thread?", isPresented: $confirmingClear, titleVisibility: .visible) {
                    Button("Clear the thread", role: .destructive) {
                        thread.clear()
                    }
                } message: {
                    Text("This deletes the questions and answers saved on this phone.")
                }
                .sheet(isPresented: $showingSettings) { SettingsView() }
                .task(id: model.person) { await thread.load(person: model.person, store: model.store) }
                .task(id: model.isConnected) { await pollStatus() }
        }
    }

    // MARK: Header

    /// As Messages heads a thread: Astra's mark (the orbit light, no face),
    /// her name, and her state. The light runs while she is working.
    private var header: some View {
        VStack(spacing: 0) {
            AstraMark(width: 28, working: isWorking)
                .padding(.bottom, 1)
            Text("Astra").font(.caption.bold())
            Text(statusText)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    // MARK: Transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Eager, not lazy: lazy rows are laid out from estimated
                // heights, and "the bottom" moves under a scroll to it.
                VStack(alignment: .leading, spacing: 0) {
                    ConnectionBanner()
                        .padding(.bottom, 8)
                    if thread.exchanges.isEmpty {
                        emptyState
                    } else {
                        // Said once a conversation exists: how much she remembers, and that each answer is still checked.
                        Text("Astra remembers what this conversation is about for 30 minutes, so you can ask follow-ups like 'and yesterday?'. Each answer is still checked on its own.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 24)
                    }
                    ForEach(Array(thread.exchanges.enumerated()), id: \.element.id) { index, _ in
                        exchangeView(at: index)
                    }
                }
                .animation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.82), value: thread.exchanges.count)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                // Past the padding, so the newest message keeps its breathing room.
                Color.clear.frame(height: 1).id(Self.bottom)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onAppear { scrollToBottom(proxy, animated: false) }
            .onChange(of: thread.exchanges.count) { scrollToBottom(proxy) }
            .onChange(of: thread.exchanges.last?.isPending) { scrollToBottom(proxy) }
            .onChange(of: typing) { _, typing in
                if typing { scrollToBottom(proxy) }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
        } else {
            proxy.scrollTo(Self.bottom, anchor: .bottom)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text("Astra").font(.title3.weight(.semibold))
            Text("Astra answers from your readings and NASA's text. She cannot diagnose.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if model.lang == "pt" {
                Text("Astra writes in English.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 40)
        .accessibilityElement(children: .combine)
    }

    // MARK: One exchange

    @ViewBuilder
    private func exchangeView(at index: Int) -> some View {
        let exchange = thread.exchanges[index]
        let previous = index > 0 ? thread.exchanges[index - 1].lastTime : nil
        VStack(alignment: .leading, spacing: 0) {
            if ChatTimeline.startsSection(exchange.askedAt, after: previous) {
                ChatTimeLabel(date: exchange.askedAt)
                    .padding(.bottom, 2)
            }
            question(exchange)
            Group {
                switch exchange.state {
                case .pending(let stage):
                    pending(stage)
                case .answered(let result, let at):
                    AskAnswerView(
                        result: result, answeredAt: at, lang: model.lang,
                        replies: replies(at: index), onReply: { label in send(label) }
                    )
                    .padding(.top, 12)
                case .failed(let reason, let reached):
                    notDelivered(exchange, reason: reason, reached: reached)
                }
            }
            .animation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.8), value: exchange.isPending)
            // A quick reply from the first chat pass, kept in older saved threads.
            if let yes = exchange.followUpReply {
                ChatRow(isMine: true) {
                    ChatTextBubble(text: yes ? String(localized: "Yes") : String(localized: "No"), isMine: true, hasTail: true)
                        .accessibilityLabel(Text("You answered: \(yes ? String(localized: "Yes") : String(localized: "No"))"))
                }
                .padding(.top, 12)
            }
        }
        .padding(.top, 12)
        .id(exchange.id)
        .transition(arrival(for: exchange.id))
    }

    /// The owner's question: a blue bubble, with Messages' red mark beside it when it failed.
    private func question(_ exchange: AskExchange) -> some View {
        ChatRow(isMine: true) {
            HStack(alignment: .center, spacing: 6) {
                ChatTextBubble(text: exchange.question, isMine: true, hasTail: true)
                    .accessibilityLabel(Text("You asked, \(ChatTimeline.short(exchange.askedAt)): \(exchange.question)"))
                if case .failed = exchange.state {
                    Button { retry(exchange.id) } label: {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.red)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(!canAsk)
                    .accessibilityLabel(Text("Try Again"))
                }
            }
        }
    }

    /// The typing dots, honest about what is happening: the hub's real stage under them.
    private func pending(_ stage: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ChatRow(isMine: false) {
                TypingIndicator().chatBubble(isMine: false, hasTail: true)
            }
            Text(stage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
        }
        .padding(.top, 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Astra is preparing an answer: \(stage)"))
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// Messages' "Not Delivered", under the question, with the reason and Try Again.
    private func notDelivered(_ exchange: AskExchange, reason: String, reached: Bool) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(reached ? String(localized: "Not Answered") : String(localized: "Not Delivered"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.red)
            Text(reason)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
            Button("Try Again") { retry(exchange.id) }
                .font(.caption.weight(.semibold))
                .frame(minHeight: 44)
                .disabled(!canAsk)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.top, 2)
        .accessibilityElement(children: .combine)
    }

    /// A sent question rises out of the composer, as a sent iMessage does.
    /// History appears as it is; Reduce Motion: no motion at all.
    private func arrival(for id: UUID) -> AnyTransition {
        guard sent.contains(id), !reduceMotion else { return .identity }
        return AnyTransition.scale(scale: 0.55, anchor: .bottomTrailing)
            .combined(with: .offset(y: 70))
            .combined(with: .opacity)
            .animation(.spring(response: 0.45, dampingFraction: 0.7))
    }

    // MARK: Composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if thread.exchanges.isEmpty && draft.isEmpty && canAsk {
                suggestions
            }
            HStack(alignment: .bottom, spacing: 4) {
                TextField(composerPrompt, text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    // A value Astra asked for: numbers first, letters one key away, so free text still works.
                    .keyboardType(thread.waitingQuestion?.kind == "value" ? .numbersAndPunctuation : .default)
                    .focused($typing)
                    .padding(.leading, 14)
                    .padding(.vertical, 10)
                    .accessibilityLabel(Text("Your question to Astra"))
                Button(action: { send(draft) }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, canSend ? ChatBubbleShape.outgoingFill : Color.secondary.opacity(0.4))
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(!canSend)
                .keepsKeyboard()
                .accessibilityLabel(Text("Send"))
            }
            .padding(.trailing, 2)
            .modifier(ComposerPill(cornerRadius: 22))
            .disabled(!canAsk)
            if let reason = disabledReason {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .modifier(ComposerBackdrop())
    }

    /// The example questions above an empty thread, as Messages' suggestions; a tap sends one.
    private var suggestions: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(examples, id: \.self) { example in
                    Button { send(example) } label: {
                        Text(example)
                            .font(.callout)
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .modifier(ComposerPill(cornerRadius: 14))
                            .frame(minHeight: 44)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("Sends this question"))
                }
            }
            // Room for the glass's edge inside the scroll view's clip.
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        // Edge to edge, as system rows of chips are: the first chip starts on the composer's margin
        // and the rest scroll out under the screen's edges, never cut off inside the margin.
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .padding(.horizontal, -16)
    }

    // MARK: State

    private var canAsk: Bool { model.isConnected && !model.person.isEmpty }

    /// The field's placeholder, with the unit when Astra asked for a value.
    private var composerPrompt: String {
        if let waiting = thread.waitingQuestion, waiting.kind == "value", let unit = waiting.unit, !unit.isEmpty {
            return String(localized: "Reply in \(unit), or ask Astra…")
        }
        return String(localized: "Ask Astra…")
    }

    /// The newest question Astra asked back has live chips; older ones show what was sent after them.
    private func replies(at index: Int) -> AskAnswerView.Replies {
        let exchanges = thread.exchanges
        if index == exchanges.count - 1 { return .live(enabled: canAsk && !thread.isAsking) }
        return .past(next: exchanges[index + 1].question)
    }

    private var canSend: Bool {
        canAsk && !thread.isAsking && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var disabledReason: String? {
        if !model.isConnected { return String(localized: "Astra runs on the hub, and the hub is out of reach. Nothing runs on this phone.") }
        if model.person.isEmpty { return String(localized: "Choose who you are in Settings first.") }
        return nil
    }

    /// A question of yours on its way, or her model still starting.
    private var isWorking: Bool {
        thread.isAsking || (model.isConnected && status?.state == "loading")
    }

    private var statusText: String {
        guard let status, model.isConnected else { return String(localized: "Out of reach") }
        let state = if thread.isAsking {
            String(localized: "Working…")
        } else {
            switch status.state {
            case "ready": String(localized: "Ready")
            case "loading": String(localized: "Starting")
            default: String(localized: "Not available")
            }
        }
        return status.waiting > 0 ? String(localized: "\(state) · \(status.waiting) in line") : state
    }

    // MARK: Actions

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canAsk, !thread.isAsking, !text.isEmpty, let api = model.api else { return }
        // The keyboard stays up, as in Messages.
        draft = ""
        let id = thread.ask(text, api: api, lang: model.lang, finished: announce)
        sent.insert(id)
    }

    private func retry(_ id: UUID) {
        guard canAsk, !thread.isAsking, let api = model.api else { return }
        thread.retry(id, api: api, lang: model.lang, finished: announce)
    }

    /// Tells VoiceOver an answer came, politely: after what it is saying.
    private func announce(_ state: AskExchange.State) {
        let words: String
        switch state {
        case .pending: return
        case .answered(let result, _): words = AskAnswerView.arrivalText(result)
        case .failed(let reason, let reached):
            words = "\(reached ? String(localized: "Not Answered") : String(localized: "Not Delivered")). \(reason)"
        }
        var text = AttributedString(words)
        text[AttributeScopes.AccessibilityAttributes.AnnouncementPriorityAttribute.self] = .low
        AccessibilityNotification.Announcement(text).post()
    }

    /// The model's state, every five seconds while this tab is open.
    private func pollStatus() async {
        while !Task.isCancelled {
            if let api = model.api, model.isConnected { status = try? await api.askStatus() }
            try? await Task.sleep(for: .seconds(5))
        }
    }
}

/// Behind the composer: nothing where the pill is glass (the thread scrolls
/// under it, as in Messages); the system's bar material on earlier systems.
private struct ComposerBackdrop: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
        } else {
            content.background(.bar)
        }
    }
}

#Preview {
    AskView(thread: SampleData.askThread)
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}

#Preview("Waiting for an answer") {
    AskView(thread: SampleData.askThreadWaiting)
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
