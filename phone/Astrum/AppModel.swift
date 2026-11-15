// The app's one shared state and the glue between its parts: which hub and
// whose phone, the live socket, Health readings going out through the
// on-disk queue, alarms coming in as notifications, and the keep-alive.
// The hub's messages are applied to `world`, which the screens read; the
// owner's history, check-ins and alert answers go through here too
// (AppModel+Companion.swift).

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
            case .noHub: String(localized: "Looking for the hub")
            case .connecting: String(localized: "Connecting to the hub")
            case .connected: String(localized: "Connected to the hub")
            case .retrying: String(localized: "Hub out of reach, retrying")
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
            case .unavailable: String(localized: "Not available on this device")
            case .notAsked: String(localized: "Not asked yet")
            case .asked: String(localized: "Asked")
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

    /// Everything the hub has told the phone; saved to disk for offline.
    var world = HubWorld()
    /// The owner's own recent rows and how each signal compares with their usual.
    let history = PersonHistory()
    var selectedTab: AppTab = .me
    /// An alert a notification was tapped for, to open on Me.
    var openedAlertID: String?
    var onboarded: Bool
    /// Check-ins answered offline, waiting for the hub.
    var pendingCheckins = 0
    /// Today's check-in is showing (CheckInView); opened with `startTodaysCheckIn()`.
    var checkInOpen = false
    /// Level 3 alerts (by key) the owner has closed after they were seen; shown as a banner instead.
    var closedAlerts: Set<String> = []
    /// Answers sent to "Are you OK?" (alert id to "ok" or "help"), shown at once until the hub's state confirms them.
    var pendingAnswers: [String: String] = [:]
    /// When the socket last connected; nil while it is not connected.
    private(set) var connectedSince: Date?
    /// The "alerts cannot reach this phone" notice was posted for this disconnection.
    @ObservationIgnored private var warnedOffline = false
    @ObservationIgnored let store = LocalStore()
    @ObservationIgnored var saveTask: Task<Void, Never>?

    let finder = HubFinder()

    /// True when the address came from Bonjour, so a newer announcement may replace it.
    @ObservationIgnored private var addressIsAutomatic: Bool
    @ObservationIgnored private var isFlushing = false
    private let socket = HubSocket()
    private let queue: ReadingQueue
    private let health: HealthSync
    private let queued: AsyncStream<Void>
    let notifier = AlarmNotifier()
    private let keepAlive = BackgroundKeepAlive()
    /// Which board's room the owner is near, from its Bluetooth beacon (AppModel+Room.swift).
    let roomLocator = RoomLocator()
    @ObservationIgnored let stayOutbox = StayOutbox()
    @ObservationIgnored var isSendingStays = false
    @ObservationIgnored private var unlockObserver: NSObjectProtocol?

    private enum Key {
        static let address = "hubAddress"
        static let automatic = "hubAddressIsAutomatic"
        static let person = "person"
        static let crew = "crew"
        static let lastSent = "lastSent"
        static let onboarded = "onboarded"
    }

    /// `running: false` starts nothing (no socket, Bonjour, Health or audio): for previews.
    init(running: Bool = true) {
        let defaults = UserDefaults.standard
        // Locals: reading an observed property before every stored one is set is not allowed.
        let savedAddress = defaults.string(forKey: Key.address).flatMap { HubAddress(text: $0) }
        let savedPerson = defaults.string(forKey: Key.person) ?? ""
        address = savedAddress
        addressIsAutomatic = defaults.bool(forKey: Key.automatic)
        person = savedPerson
        crew = defaults.data(forKey: Key.crew).flatMap { try? JSONDecoder().decode([CrewMember].self, from: $0) } ?? []
        lastSent = defaults.object(forKey: Key.lastSent) as? Date
        // A phone set up before the first run existed has done its steps already.
        onboarded = defaults.bool(forKey: Key.onboarded) || (savedAddress != nil && !savedPerson.isEmpty)

        let readingQueue = ReadingQueue()
        let (stream, continuation) = AsyncStream.makeStream(of: Void.self)
        queue = readingQueue
        queued = stream
        health = HealthSync(queue: readingQueue, queued: continuation)

        if running { start() }
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
        startRoomLocation()

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
        Task { await loadSaved() }
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
        flushCheckins()
        flushStays()
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
        personChanged()
        startRoomLocation()
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

    func finishOnboarding() {
        onboarded = true
        UserDefaults.standard.set(true, forKey: Key.onboarded)
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

    /// Asks the hub for its whole state again, as this phone's owner may see it (a fresh hello).
    func refreshFromHub() {
        if let hello = helloText { socket.update(hello: hello) }
    }

    /// The app is going to the background. Alerts are local notifications made from the socket's
    /// messages, so with no connection none can arrive: say so once per disconnection.
    func wentToBackground() {
        guard !needsSetup, link != .connected, !warnedOffline else { return }
        warnedOffline = true
        notifier.postNotConnected()
    }

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
        } else if hub.address == address && link != .connected {
            // The hub is announcing itself again (it restarted): connect now, not after the socket's backoff.
            connect()
        }
    }

    private func socketChanged(_ state: HubSocket.State) {
        switch state {
        case .connecting:
            link = .connecting
            connectedSince = nil
        case .connected:
            link = .connected
            connectedSince = Date()
            warnedOffline = false
            flush()
            flushCheckins()
        case .retrying:
            link = .retrying
            connectedSince = nil
        }
    }

    private func received(_ message: HubIncoming) {
        if let crew = message.profile?.crew, crew != self.crew {
            self.crew = crew
            if let data = try? JSONEncoder().encode(crew) { UserDefaults.standard.set(data, forKey: Key.crew) }
        }
        // Room alarms sound the room's buzzer. Phones announce alerts, which carry who is told.
        if let alerts = message.alerts { notifier.handle(alerts, owner: person, crew: crew, rooms: message.profile?.rooms ?? world.profile?.rooms ?? []) }
        apply(message)
        // The hub's view of where everyone is just arrived: send waiting room changes, then check it against ours.
        if message.type == "state", message.scenario == nil { flushStays() }
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
