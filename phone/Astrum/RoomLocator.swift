// Which board's room the owner is in, from the cabin boards' Bluetooth
// beacons (chip/README.md). Each board advertises the Astrum service UUID and
// its id as the local name. The phone smooths each board's signal strength
// (the median of its recent readings) and decides with two thresholds and a
// minimum dwell, so it does not flap at a doorway.
//
// What it can tell: the phone is close to a board. Not that it is inside the
// room: a strong signal can come through a wall or an open hatch. With one
// board it can only say "near <the board>" or "not seen"; when not seen it says
// nothing at all and never guesses another room. With several, the nearest wins.
//
// Every threshold below is untuned until someone walks around the cabin with
// the phone and the board.
//
// It scans in the background too (the bluetooth-central background mode,
// filtered on the service UUID). iOS hands a backgrounded app far fewer
// readings, so the scan is restarted every few seconds to get fresh ones.

import CoreBluetooth
import Foundation
import Observation
import os

private let log = Logger(subsystem: "space.astrum.phone", category: "room")

@MainActor
@Observable
final class RoomLocator: NSObject {
    /// The Astrum beacon service. The same UUID is in chip/astrum_chip/astrum_chip.ino.
    static let serviceUUID = "A5A273B7-39C1-4BF4-B86C-5D4BB3B06B1F"

    // MARK: Tuning (untuned: set these after walking around with the phone)

    /// The smoothed signal must reach this to count as entering a board's room, in dBm.
    static let enterRSSI = -65
    /// Once in, the smoothed signal must fall below this to count as leaving, in dBm.
    static let exitRSSI = -78
    /// A change must hold this long before it is believed.
    static let minimumDwell: TimeInterval = 20
    /// How many of a board's latest readings the median is taken over.
    static let medianOf = 7
    /// Fewer fresh readings than this and the board does not count as seen.
    static let minimumReadings = 3
    /// Readings older than this are forgotten; a board with none left is not seen.
    static let readingWindow: TimeInterval = 30
    /// How often the scan is restarted (iOS reports a backgrounded peripheral once per scan).
    static let rescanEvery: Duration = .seconds(8)
    /// How often the decision is looked at again when no reading arrives.
    static let tickEvery: Duration = .seconds(2)

    enum State: Equatable {
        case unavailable
        case notAllowed
        case bluetoothOff
        case notSeen
        /// Near this board (its id, e.g. "cabin-1").
        case near(board: String)
    }

    private(set) var state: State = .notSeen

    /// Told when the owner enters a board's room (its id) or leaves for nowhere known (nil),
    /// with the moment the change began, not the moment it was believed.
    @ObservationIgnored var onChange: ((String?, Date) -> Void)?

    @ObservationIgnored private var central: CBCentralManager?
    @ObservationIgnored private var readings: [String: [(at: Date, rssi: Int)]] = [:]
    @ObservationIgnored private var current: String?
    @ObservationIgnored private var pending: (board: String?, since: Date)?
    @ObservationIgnored private var loops: [Task<Void, Never>] = []

    /// Starts Bluetooth (asking permission the first time). Safe to call again.
    func start() {
        guard central == nil else { return }
        central = CBCentralManager(delegate: self, queue: nil)
        loops = [
            Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.rescanEvery)
                    self?.rescan()
                }
            },
            Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.tickEvery)
                    self?.decide(now: Date())
                }
            },
        ]
    }

    // MARK: Scanning

    private func rescan() {
        guard let central, central.state == .poweredOn else { return }
        central.stopScan()
        // Duplicates give a steady stream of readings in the foreground; iOS ignores it in the background.
        central.scanForPeripherals(withServices: [CBUUID(string: Self.serviceUUID)], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    private func powerChanged(_ power: CBManagerState) {
        switch power {
        case .poweredOn:
            state = current.map { .near(board: $0) } ?? .notSeen
            rescan()
            return
        case .unauthorized: state = .notAllowed
        case .poweredOff: state = .bluetoothOff
        case .unsupported: state = .unavailable
        default: return
        }
        // Without Bluetooth the board cannot be heard: the owner's place becomes unknown.
        readings = [:]
        pending = nil
        if let board = current {
            log.info("Bluetooth unusable; leaving \(board, privacy: .public)")
            current = nil
            onChange?(nil, Date())
        }
    }

    private func heard(board: String, rssi: Int, at now: Date) {
        // 127 means iOS could not read the strength; very low values are noise.
        guard rssi < 0, rssi > -110 else { return }
        var list = readings[board, default: []]
        list.append((now, rssi))
        readings[board] = Array(list.suffix(Self.medianOf))
        decide(now: now)
    }

    // MARK: Deciding

    /// The median of a board's fresh readings, or nil when it is not seen.
    private func smoothed(_ board: String, now: Date) -> Int? {
        let fresh = (readings[board] ?? []).filter { now.timeIntervalSince($0.at) <= Self.readingWindow }.map(\.rssi).sorted()
        guard fresh.count >= Self.minimumReadings else { return nil }
        return fresh[fresh.count / 2]
    }

    private func decide(now: Date) {
        guard central?.state == .poweredOn else { return }
        // Hysteresis: a board the owner is in only has to stay above the exit level; any other must reach the entry level.
        let candidate = readings.keys
            .compactMap { board in smoothed(board, now: now).map { (board, $0) } }
            .filter { board, rssi in rssi >= (board == current ? Self.exitRSSI : Self.enterRSSI) }
            .max { $0.1 < $1.1 }?.0

        guard candidate != current else {
            pending = nil
            return
        }
        guard let held = pending, held.board == candidate else {
            pending = (candidate, now)
            return
        }
        guard now.timeIntervalSince(held.since) >= Self.minimumDwell else { return }
        pending = nil
        current = candidate
        state = candidate.map { .near(board: $0) } ?? .notSeen
        log.info("Room board now \(candidate ?? "none", privacy: .public)")
        onChange?(candidate, held.since)
    }
}

extension RoomLocator: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let power = central.state
        MainActor.assumeIsolated { powerChanged(power) }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any], rssi RSSI: NSNumber
    ) {
        // The board's id is its advertised local name; iOS's cached name is the fallback.
        guard let board = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name else { return }
        let rssi = RSSI.intValue
        let now = Date()
        MainActor.assumeIsolated { heard(board: board, rssi: rssi, at: now) }
    }
}

// MARK: Telling the hub

/// One "entered" or "left" for POST /api/stays, kept on disk until the hub has it.
struct StayEvent: Codable, Sendable, Hashable {
    let person: String
    /// The board whose room it is; nil when the owner left for nowhere known.
    let board: String?
    /// The room, once known. Resolved from the hub's sources when sent, if not when made.
    var room: String?
    /// The hub's clock when it happened, in milliseconds.
    let t: Int64
}

/// Room changes waiting for the hub, oldest first.
actor StayOutbox {
    private static let maxStored = 500
    private var items: [StayEvent]
    private let fileURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("Astrum", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        fileURL = folder.appendingPathComponent("stays.json")
        items = (try? JSONDecoder().decode([StayEvent].self, from: Data(contentsOf: fileURL))) ?? []
    }

    var first: StayEvent? { items.first }

    func append(_ event: StayEvent) {
        items.append(event)
        if items.count > Self.maxStored { items.removeFirst(items.count - Self.maxStored) }
        save()
    }

    func removeFirst() {
        guard !items.isEmpty else { return }
        items.removeFirst()
        save()
    }

    private func save() {
        try? JSONEncoder().encode(items).write(to: fileURL, options: .atomic)
    }
}
