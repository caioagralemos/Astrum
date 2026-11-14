// The app's one shared state and the glue between its parts: which hub and
// whose phone, the live socket, Health readings going out through the
// on-disk queue, alarms coming in as notifications, and the keep-alive.

import Foundation
import Observation
import UIKit
import os

private let log = Logger(subsystem: "space.astrum.phone", category: "app")

@MainActor
@Observable
final class AppModel {
    /// The state of the live connection, as shown in the status strip.
    enum Link: Equatable {
        case noHub
        case connecting
        case connected
        case retrying

        var title: String {
            switch self {
            case .noHub: "Looking for the hub"
            case .connecting: "Connecting to the hub"
            case .connected: "Connected to the hub"
            case .retrying: "Hub out of reach, retrying"
            }
        }

        /// A different shape for each state, so colour is never the only cue.
        var symbol: String {
            switch self {
            case .noHub: "magnifyingglass"
            case .connecting: "arrow.triangle.2.circlepath"
            case .connected: "checkmark.circle.fill"
            case .retrying: "exclamationmark.triangle.fill"
            }
        }
    }

    enum HealthState: Equatable {
        case unavailable
        case notAsked
        case asked

        var title: String {
            switch self {
            case .unavailable: "Not available on this device"
            case .notAsked: "Not asked yet"
            case .asked: "Asked"
            }
        }
    }

    private(set) var link: Link = .noHub
    private(set) var address: HubAddress?
    private(set) var person: String
    private(set) var crew: [CrewMember]
    private(set) var lastSent: Date?
    private(set) var waitingCount = 0
    private(set) var healthState: HealthState = .notAsked
    private(set) var notificationText = "Checking"

    let finder = HubFinder()

    /// True when the address came from Bonjour, so a newer announcement may replace it.
    @ObservationIgnored private var addressIsAutomatic: Bool
    @ObservationIgnored private var isFlushing = false
    private let socket = HubSocket()
    private let queue: ReadingQueue
    private let health: HealthSync
    private let queued: AsyncStream<Void>
    private let notifier = AlarmNotifier()
    private let keepAlive = BackgroundKeepAlive()
    @ObservationIgnored private var unlockObserver: NSObjectProtocol?

    private enum Key {
        static let address = "hubAddress"
        static let automatic = "hubAddressIsAutomatic"
        static let person = "person"
        static let crew = "crew"
        static let lastSent = "lastSent"
    }

    init() {
        let defaults = UserDefaults.standard
        address = defaults.string(forKey: Key.address).flatMap { HubAddress(text: $0) }
        addressIsAutomatic = defaults.bool(forKey: Key.automatic)
        person = defaults.string(forKey: Key.person) ?? ""
        crew = defaults.data(forKey: Key.crew).flatMap { try? JSONDecoder().decode([CrewMember].self, from: $0) } ?? []
        lastSent = defaults.object(forKey: Key.lastSent) as? Date

        let readingQueue = ReadingQueue()
        let (stream, continuation) = AsyncStream.makeStream(of: Void.self)
        queue = readingQueue
        queued = stream
        health = HealthSync(queue: readingQueue, queued: continuation)

        start()
    }

    // MARK: Derived

    var pageURL: URL? { address?.pageURL(person: person) }

    var personName: String? {
        guard !person.isEmpty else { return nil }
        return crew.first(where: { $0.id == person })?.name ?? person
    }

    var needsSetup: Bool { address == nil || person.isEmpty }

    // MARK: Start

    private func start() {
        socket.onState = { [weak self] state in self?.socketChanged(state) }
        socket.onMessage = { [weak self] message in self?.received(message) }
        finder.onFound = { [weak self] hub in self?.found(hub) }

        keepAlive.start()
        finder.start()
        connect()

        // Health data cannot be read while the phone is locked; catch up on unlock.
        unlockObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.catchUpHealth() }
        }

        Task {
            for await _ in queued { flush() }
        }
        // A safety net for a send that failed while the socket stayed up.
        Task {
            while true {
                try? await Task.sleep(for: .seconds(30))
                if waitingCount > 0 { flush() }
            }
        }
        Task {
            waitingCount = await queue.count
            await notifier.requestPermission()
            await refreshPermissions()
            if healthState == .asked { await health.start(person: person) }
        }
    }

    /// Called when the app comes to the front: reconnect at once rather than wait out the backoff.
    func becameActive() {
        keepAlive.start()
        if link != .connected { connect() }
        flush()
        Task { await refreshPermissions() }
    }

    private func catchUpHealth() {
        Task { await health.syncAll() }
    }

    // MARK: Choices

    func choose(address: HubAddress, automatic: Bool) {
        self.address = address
        addressIsAutomatic = automatic
        UserDefaults.standard.set(address.display, forKey: Key.address)
        UserDefaults.standard.set(automatic, forKey: Key.automatic)
        connect()
        flush()
    }

    func choose(person: String) {
        guard person != self.person else { return }
        self.person = person
        UserDefaults.standard.set(person, forKey: Key.person)
        if let hello = helloText { socket.update(hello: hello) }
        Task {
            if healthState == .asked { await health.start(person: person) }
        }
    }

    func requestHealthAccess() {
        Task {
            do {
                try await health.requestAccess()
            } catch {
                log.error("Health permission failed: \(error.localizedDescription, privacy: .public)")
            }
            await refreshPermissions()
            if healthState == .asked { await health.start(person: person) }
        }
    }

    func sendTestAlert() {
        notifier.sendTest()
    }

    func refreshPermissions() async {
        if !HealthSync.isAvailable {
            healthState = .unavailable
        } else {
            healthState = await health.hasAsked() ? .asked : .notAsked
        }
        notificationText = await notifier.permissionText()
    }

    // MARK: Hub

    private var helloText: String? {
        let hello = HubHello(person: person.isEmpty ? nil : person)
        guard let data = try? JSONEncoder().encode(hello) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    private func connect() {
        guard let url = address?.webSocketURL else {
            link = .noHub
            return
        }
        socket.connect(to: url, hello: helloText)
    }

    private func found(_ hub: DiscoveredHub) {
        // Take the announced address on first run, or when the hub has moved
        // (a new address from the router) and the old one came from Bonjour too.
        if address == nil || (addressIsAutomatic && link != .connected && hub.address != address) {
            choose(address: hub.address, automatic: true)
        }
    }

    private func socketChanged(_ state: HubSocket.State) {
        switch state {
        case .connecting: link = .connecting
        case .connected:
            link = .connected
            flush()
        case .retrying: link = .retrying
        }
    }

    private func received(_ message: HubIncoming) {
        if let crew = message.profile?.crew, crew != self.crew {
            self.crew = crew
            if let data = try? JSONEncoder().encode(crew) { UserDefaults.standard.set(data, forKey: Key.crew) }
        }
        // Room alarms sound the room's buzzer. Phones announce alerts, which carry who is told.
        if let alerts = message.alerts { notifier.handle(alerts, owner: person, crew: crew) }
    }

    // MARK: Sending readings

    /// Sends everything queued, oldest first, 500 at a time. Stops at the first
    /// network failure; the next connection or new reading tries again.
    func flush() {
        guard !isFlushing, let url = address?.readingsURL else { return }
        isFlushing = true
        Task {
            defer { isFlushing = false }
            while let batch = await queue.nextBatch(limit: 500) {
                do {
                    let accepted = try await post(batch, to: url)
                    if !accepted { log.error("The hub refused a batch of \(batch.readings.count) readings; dropped.") }
                    await queue.removeFirst(batch.readings.count)
                    if accepted {
                        lastSent = Date()
                        UserDefaults.standard.set(lastSent, forKey: Key.lastSent)
                    }
                } catch {
                    break
                }
            }
            waitingCount = await queue.count
        }
    }

    /// True if the hub stored the batch, false if it refused it as malformed
    /// (sending it again would fail the same way). Throws if the hub is out of reach.
    private func post(_ batch: ReadingBatch, to url: URL) async throws -> Bool {
        let body = ReadingsBody(
            source: "phone:\(batch.person)",
            rows: batch.readings.map {
                WireRow(t: $0.t, signal: $0.signal, value: $0.value, unit: $0.unit, kind: "measured", person: $0.person)
            }
        )
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 200 { return true }
        if status == 400 {
            log.error("Hub said: \(String(decoding: data, as: UTF8.self), privacy: .public)")
            return false
        }
        throw URLError(.badServerResponse)
    }
}
