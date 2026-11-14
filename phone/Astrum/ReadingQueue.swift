// Readings waiting to reach the hub, kept on disk so nothing is lost when the
// hub is out of reach or the app is closed. First in, first out; sent in
// batches of one crewmate at a time.

import Foundation

/// One body reading, as stored until the hub has it.
struct QueuedReading: Codable, Sendable {
    let person: String
    /// Milliseconds since 1970.
    let t: Int64
    let signal: String
    let value: Double
    let unit: String
}

struct ReadingBatch: Sendable {
    let person: String
    let readings: [QueuedReading]
}

actor ReadingQueue {
    /// A safety cap: past this, the oldest readings are dropped.
    private static let maxStored = 100_000

    private var items: [QueuedReading]
    private let fileURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("Astrum", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        fileURL = folder.appendingPathComponent("queue.json")
        items = (try? JSONDecoder().decode([QueuedReading].self, from: Data(contentsOf: fileURL))) ?? []
    }

    var count: Int { items.count }

    func append(_ readings: [QueuedReading]) {
        guard !readings.isEmpty else { return }
        items.append(contentsOf: readings.sorted { $0.t < $1.t })
        if items.count > Self.maxStored { items.removeFirst(items.count - Self.maxStored) }
        save()
    }

    /// The oldest readings, up to `limit`, all belonging to the same crewmate.
    func nextBatch(limit: Int) -> ReadingBatch? {
        guard let first = items.first else { return nil }
        let run = items.prefix(limit).prefix(while: { $0.person == first.person })
        return ReadingBatch(person: first.person, readings: Array(run))
    }

    func removeFirst(_ count: Int) {
        items.removeFirst(min(count, items.count))
        save()
    }

    private func save() {
        do {
            try JSONEncoder().encode(items).write(to: fileURL, options: .atomic)
        } catch {
            // Kept in memory; the next change tries to save again.
        }
    }
}
