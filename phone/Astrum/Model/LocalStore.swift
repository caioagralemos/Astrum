// What the phone keeps on disk besides the reading queue: the last world the
// hub sent and the owner's recent rows (so Me opens offline), and check-ins
// answered while the hub was out of reach (sent on reconnect), and Ask
// Astra's thread, per crewmate.

import Foundation

actor LocalStore {
    private let folder: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        folder = base.appendingPathComponent("Astrum", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    // MARK: The last world and rows

    func loadWorld() -> HubWorld? { load(HubWorld.self, from: "world.json") }

    func save(_ world: HubWorld) { save(world, to: "world.json") }

    func loadRows(person: String) -> [Row] { load([Row].self, from: rowsFile(person)) ?? [] }

    func save(rows: [Row], person: String) { save(rows, to: rowsFile(person)) }

    private func rowsFile(_ person: String) -> String { "rows-\(person).json" }

    // MARK: Check-ins waiting for the hub

    func pendingCheckins() -> [PendingCheckin] { load([PendingCheckin].self, from: "checkins.json") ?? [] }

    func add(_ checkin: PendingCheckin) {
        save(pendingCheckins() + [checkin], to: "checkins.json")
    }

    func removeCheckin(id: UUID) {
        save(pendingCheckins().filter { $0.id != id }, to: "checkins.json")
    }

    // MARK: Ask Astra's thread

    func loadAsk(person: String) -> [AskExchange] { load([AskExchange].self, from: askFile(person)) ?? [] }

    func save(ask: [AskExchange], person: String) { save(ask, to: askFile(person)) }

    private func askFile(_ person: String) -> String { "ask-\(person).json" }

    // MARK: Files

    private func load<T: Decodable>(_ type: T.Type, from name: String) -> T? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func save<T: Encodable>(_ value: T, to name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: folder.appendingPathComponent(name), options: .atomic)
    }
}

/// A check-in answered while the hub was out of reach.
struct PendingCheckin: Codable, Sendable, Hashable, Identifiable {
    var id = UUID()
    let person: String
    /// When it was answered, milliseconds since 1970.
    let t: Double
    let answers: [CheckinAnswer]

    /// As rows for /api/readings, keeping the time it was answered.
    var rows: [ReportedRow] {
        answers.map { answer in
            ReportedRow(
                t: Int64(t),
                signal: answer.signal.hasPrefix("checkin.") ? answer.signal : "checkin.\(answer.signal)",
                value: answer.value, text: answer.text, unit: answer.unit, person: person
            )
        }
    }
}
