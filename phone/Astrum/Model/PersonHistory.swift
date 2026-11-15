// The owner's own history: the last fifteen days of their rows from
// /api/rows (the window the hub's person view asks for), each signal judged
// against it (Baseline). Live rows from the socket are added as they come;
// the judgement is redone on each refresh.

import Foundation
import Observation

@MainActor
@Observable
final class PersonHistory {
    enum State: Equatable {
        case idle
        case loading
        case ready
        case failed
    }

    static let windowMs: Double = 15 * 86_400_000

    private(set) var rows: [Row] = []
    private(set) var baselines: [String: SignalBaseline] = [:]
    private(set) var state: State = .idle
    /// When the rows were last fetched from the hub (or saved, for rows read from disk).
    private(set) var fetchedAt: Date?

    /// Shows rows saved on disk until the hub answers.
    func show(saved: [Row], now: Double) async {
        guard rows.isEmpty, !saved.isEmpty else { return }
        rows = saved
        baselines = await Self.judge(saved, now: now)
        state = .ready
    }

    /// Fetches the window again. Returns the rows, for saving, or nil if the hub did not answer.
    func refresh(api: HubAPI, person: String, now: Double) async -> [Row]? {
        if rows.isEmpty { state = .loading }
        do {
            let fetched = try await api.rows(person: person, from: now - Self.windowMs - 86_400_000)
            let mine = fetched.filter { $0.person == person && !$0.signal.hasPrefix("blood.") }
            rows = mine
            baselines = await Self.judge(mine, now: now)
            fetchedAt = Date()
            state = .ready
            return mine
        } catch {
            if rows.isEmpty { state = .failed }
            return nil
        }
    }

    /// Adds this person's new rows from the socket.
    func append(_ new: [Row]) {
        guard !new.isEmpty else { return }
        rows.append(contentsOf: new)
    }

    func clear() {
        rows = []
        baselines = [:]
        state = .idle
        fetchedAt = nil
    }

    func rows(for signal: String) -> [Row] {
        rows.filter { $0.signal == signal && $0.value != nil }.sorted { $0.t < $1.t }
    }

    @concurrent
    private nonisolated static func judge(_ rows: [Row], now: Double) async -> [String: SignalBaseline] {
        Baseline.summary(of: rows, now: now)
    }
}

extension PersonHistory {
    /// Shows rows at once, judged on the spot. For previews.
    func replace(with rows: [Row], now: Double) {
        self.rows = rows
        baselines = Baseline.summary(of: rows, now: now)
        state = .ready
    }
}
