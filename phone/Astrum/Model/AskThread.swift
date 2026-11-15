// Ask Astra's thread: each question and what came of it, kept on the phone
// per crewmate (the last 50) so it reads offline. The hub keeps the
// conversation itself (engine/conversation.ts, 30 minutes of quiet); with each
// question the phone also sends this crewmate's last exchanges of the last
// half hour (at most 6, each text at most 600 characters), which the hub uses
// only for their topic when it has lost its own thread. Never another
// crewmate's: the thread is per person and cleared when the person changes.

import Foundation
import Observation

/// One question and what came of it.
struct AskExchange: Codable, Sendable, Hashable, Identifiable {
    enum State: Codable, Sendable, Hashable {
        /// On its way; the hub's latest stage in words.
        case pending(String)
        /// The hub's answer as it sent it, and when it came.
        case answered(AskResult, at: Date)
        /// No answer: why, and whether the hub was reached (it refused) or not.
        case failed(String, reached: Bool)
    }

    var id = UUID()
    let question: String
    let askedAt: Date
    var state: State
    /// The quick reply of the first chat pass (sent as a check-in). Read from older saved
    /// threads only, to show what was answered; replies now go through the ask call.
    var followUpReply: Bool?
    /// Not a question: the owner went through this card's steps (Done), and this is Astra's next message. No bubble of theirs.
    var afterSteps: String?
    /// "Call for help" was sent from under this reply: the hub's line for it.
    var helpSent: String?
    /// The owner went through this reply's steps (Done): "Start help" gives way to a quiet "Steps shown".
    var stepsShown: Bool?

    var isPending: Bool {
        if case .pending = state { true } else { false }
    }

    /// When it last changed: the answer's time, else the question's.
    var lastTime: Date {
        if case .answered(_, let at) = state { at } else { askedAt }
    }
}

@MainActor
@Observable
final class AskThread {
    /// The least time between a question appearing and its answer appearing, so it reads as a
    /// conversation. The hub's own time counts toward it. An urgent answer is never held.
    static let minimumReplyTime: TimeInterval = 2.0

    /// How many exchanges the phone keeps.
    static let cap = 50

    private(set) var exchanges: [AskExchange]
    private(set) var person: String
    @ObservationIgnored private var store: LocalStore?
    @ObservationIgnored private var tasks: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var saving: Task<Void, Never>?

    /// Empty until `load`; previews pass a thread and a person, and never touch the disk.
    init(person: String = "", exchanges: [AskExchange] = []) {
        self.person = person
        self.exchanges = exchanges
    }

    var isAsking: Bool { exchanges.contains(where: \.isPending) }

    /// The saved thread of `person`. A question still on its way when the app
    /// closed comes back as failed, with Retry.
    func load(person: String, store: LocalStore) async {
        guard person != self.person else { return }
        cancelAll()
        self.person = person
        self.store = store
        exchanges = []
        guard !person.isEmpty else { return }
        let saved = await store.loadAsk(person: person)
        guard self.person == person else { return }
        exchanges = saved.map { exchange in
            var exchange = exchange
            if exchange.isPending {
                exchange.state = .failed(String(localized: "The app closed before the answer came."), reached: false)
            }
            return exchange
        }
    }

    /// Sends a new question and returns its id. `finished` hears how it ended, for VoiceOver.
    @discardableResult
    func ask(_ question: String, api: HubAPI, lang: String, finished: @escaping @MainActor (AskExchange.State) -> Void) -> UUID {
        let history = self.history(before: exchanges.count, now: .now)
        let exchange = AskExchange(question: question, askedAt: .now, state: .pending(Self.sending))
        exchanges.append(exchange)
        if exchanges.count > Self.cap {
            let dropped = exchanges.prefix(exchanges.count - Self.cap)
            for old in dropped { tasks.removeValue(forKey: old.id)?.cancel() }
            exchanges.removeFirst(dropped.count)
        }
        run(exchange.id, question: question, history: history, api: api, lang: lang, finished: finished)
        save()
        return exchange.id
    }

    /// Sends a failed question again, in its place.
    func retry(_ id: UUID, api: HubAPI, lang: String, finished: @escaping @MainActor (AskExchange.State) -> Void) {
        guard let index = exchanges.firstIndex(where: { $0.id == id }) else { return }
        exchanges[index].state = .pending(Self.sending)
        if let card = exchanges[index].afterSteps {
            runSteps(id, card: card, api: api, lang: lang, finished: finished)
            return
        }
        run(id, question: exchanges[index].question, history: history(before: index, now: .now), api: api, lang: lang, finished: finished)
    }

    /// The owner tapped Done on `card`'s steps: the hub is told, and Astra's next message arrives after the usual typing time.
    func stepsDone(card: String, api: HubAPI, lang: String, finished: @escaping @MainActor (AskExchange.State) -> Void) {
        var exchange = AskExchange(question: "", askedAt: .now, state: .pending(Self.sending))
        exchange.afterSteps = card
        exchanges.append(exchange)
        if exchanges.count > Self.cap {
            let dropped = exchanges.prefix(exchanges.count - Self.cap)
            for old in dropped { tasks.removeValue(forKey: old.id)?.cancel() }
            exchanges.removeFirst(dropped.count)
        }
        runSteps(exchange.id, card: card, api: api, lang: lang, finished: finished)
        save()
    }

    /// Done on the steps opened from `id`'s reply: its "Start help" goes away for good.
    func markStepsShown(_ id: UUID) {
        guard let index = exchanges.firstIndex(where: { $0.id == id }) else { return }
        exchanges[index].stepsShown = true
        save()
    }

    /// "Call for help" under `id`'s reply. Throws when the hub did not raise it; otherwise keeps the hub's line there.
    func callForHelp(_ id: UUID, api: HubAPI, lang: String) async throws {
        let owner = person
        let text = try await api.askForHelp(person: owner, lang: lang)
        guard owner == person, let index = exchanges.firstIndex(where: { $0.id == id }) else { return }
        exchanges[index].helpSent = text
        save()
    }

    /// The question Astra is waiting on: the newest exchange's, while nothing came after it.
    var waitingQuestion: AskResult.PendingQuestion? {
        guard case .answered(let result, _)? = exchanges.last?.state else { return nil }
        return result.pendingQuestion
    }

    // MARK: History for the hub

    /// The hub forgets a conversation after this long without a message (THREAD_IDLE_MS).
    static let memory: TimeInterval = 30 * 60

    /// The answered exchanges before `index` that the hub would still remember at `now`,
    /// oldest first: walking back, each within half an hour of the one after it.
    func history(before index: Int, now: Date) -> [AskHistoryItem] {
        var out: [AskHistoryItem] = []
        var after = now
        for exchange in exchanges.prefix(index).reversed() {
            guard exchange.afterSteps == nil, case .answered(let result, let at) = exchange.state else { continue }
            guard after.timeIntervalSince(at) <= Self.memory else { break }
            out.append(AskHistoryItem(exchange.question, result: result))
            after = exchange.askedAt
            if out.count == AskHistoryItem.maxItems { break }
        }
        return out.reversed()
    }

    /// Deletes the thread from the phone.
    func clear() {
        cancelAll()
        exchanges = []
        save()
    }

    // MARK: Asking

    private static var sending: String { String(localized: "Sending the question…") }

    private func run(_ id: UUID, question: String, history: [AskHistoryItem], api: HubAPI, lang: String, finished: @escaping @MainActor (AskExchange.State) -> Void) {
        let person = self.person
        tasks[id] = Task {
            var outcome = AskExchange.State.failed(String(localized: "The hub ended without an answer."), reached: true)
            let started = ContinuousClock.now
            do {
                for try await event in api.ask(person: person, question: question, lang: lang, history: history) {
                    switch event {
                    case .queued(let position): update(id, .pending(String(localized: "Waiting in line: position \(position)")))
                    case .working(let seconds): update(id, .pending(String(localized: "Astra is working: \(seconds) s")))
                    case .result(let answer): outcome = .answered(answer, at: .now)
                    }
                }
            } catch HubError.refused(let words) {
                outcome = .failed(String(localized: "The hub refused it: \(words)"), reached: true)
            } catch {
                outcome = .failed(String(localized: "The hub is out of reach."), reached: false)
            }
            if case .answered(let answer, _) = outcome, !Self.isUrgent(answer) {
                let wait = Self.minimumReplyTime - (ContinuousClock.now - started).seconds
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                if case .answered(let answer, _) = outcome { outcome = .answered(answer, at: .now) }
            }
            guard !Task.isCancelled else { return }
            update(id, outcome)
            tasks[id] = nil
            save()
            finished(outcome)
        }
    }

    private func runSteps(_ id: UUID, card: String, api: HubAPI, lang: String, finished: @escaping @MainActor (AskExchange.State) -> Void) {
        let person = self.person
        tasks[id] = Task {
            var outcome: AskExchange.State
            let started = ContinuousClock.now
            do {
                outcome = .answered(try await api.stepsDone(person: person, card: card, lang: lang), at: .now)
            } catch HubError.refused(let words) {
                outcome = .failed(String(localized: "The hub refused it: \(words)"), reached: true)
            } catch {
                outcome = .failed(String(localized: "The hub is out of reach."), reached: false)
            }
            if case .answered(let answer, _) = outcome {
                let wait = Self.minimumReplyTime - (ContinuousClock.now - started).seconds
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                outcome = .answered(answer, at: .now)
            }
            guard !Task.isCancelled else { return }
            update(id, outcome)
            tasks[id] = nil
            save()
            finished(outcome)
        }
    }

    /// Safety first: an urgent answer, or one with an urgent card, shows at once.
    static func isUrgent(_ answer: AskResult) -> Bool {
        answer.urgent || answer.card?.level == "dangerous"
    }

    private func update(_ id: UUID, _ state: AskExchange.State) {
        guard let index = exchanges.firstIndex(where: { $0.id == id }) else { return }
        exchanges[index].state = state
    }

    private func cancelAll() {
        for task in tasks.values { task.cancel() }
        tasks = [:]
    }

    /// Writes the thread after any earlier write has finished, so the newest wins.
    private func save() {
        guard let store, !person.isEmpty else { return }
        let snapshot = exchanges, owner = person, previous = saving
        saving = Task {
            await previous?.value
            await store.save(ask: snapshot, person: owner)
        }
    }
}

/// One earlier exchange as the hub's `history` takes it (HistoryItem in
/// engine/conversation.ts): every text at most 600 UTF-16 units, as JavaScript counts.
struct AskHistoryItem: Encodable, Sendable, Hashable {
    static let maxItems = 6
    static let maxText = 600

    let question: String
    let route: String?
    let card: String?
    let understoodAs: String?

    init(_ question: String, result: AskResult) {
        self.question = Self.clipped(question)
        route = Self.clipped(result.route)
        card = result.card.map { Self.clipped($0.id) }
        understoodAs = result.understoodAs.map { Self.clipped($0) }
    }

    /// Cut at a character boundary, never inside one, to at most `limit` UTF-16 units.
    static func clipped(_ text: String, to limit: Int = maxText) -> String {
        guard text.utf16.count > limit else { return text }
        var out = ""
        var used = 0
        for character in text {
            let size = character.utf16.count
            if used + size > limit { break }
            out.append(character)
            used += size
        }
        return out
    }
}

private extension Duration {
    var seconds: Double { Double(components.seconds) + Double(components.attoseconds) / 1e18 }
}
