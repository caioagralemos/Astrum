// The companion's side of the model: applying the hub's messages to the
// world, the owner's history, the offline copy on disk, check-ins (queued
// when the hub is out of reach) and alert answers.

import Foundation

enum CheckinOutcome: Equatable {
    case sent
    /// Kept on the phone; sent when the hub is back.
    case queued
    case refused(String)
}

extension AppModel {
    var api: HubAPI? { address.map(HubAPI.init) }

    var isConnected: Bool { link == .connected }

    /// The language the app is showing, for the hub's routes that take one.
    var lang: String {
        Bundle.main.preferredLocalizations.first?.hasPrefix("pt") == true ? "pt" : "en"
    }

    /// The hub's clock at a moment on this phone, in milliseconds.
    func hubNow(_ date: Date = .now) -> Double { world.now(at: date) }

    /// The alerts the owner is told about. Nothing else is ever shown.
    var visibleAlerts: [HubAlert] { person.isEmpty ? [] : world.visibleAlerts(to: person) }

    /// The owner's current readings, as Me lists them.
    func readings(now: Double) -> [Reading] {
        Readings.build(world: world, historyRows: history.rows, baselines: history.baselines, person: person, now: now)
    }

    // MARK: The hub's messages

    func apply(_ message: HubIncoming) {
        world.apply(message, at: Date())
        if let rows = message.rows, !person.isEmpty {
            history.append(rows.filter { $0.person == person && !$0.signal.hasPrefix("blood.") })
        }
        scheduleSave(soon: message.type == "state")
    }

    /// Saves the world a few seconds after it changes, at most once per burst.
    private func scheduleSave(soon: Bool) {
        guard saveTask == nil else { return }
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(soon ? 1 : 15))
            guard let self else { return }
            await self.store.save(self.world)
            self.saveTask = nil
        }
    }

    /// Opens on the last saved world and rows, until the hub answers.
    func loadSaved() async {
        if !world.hasData, let saved = await store.loadWorld() { world = saved }
        pendingCheckins = await store.pendingCheckins().count
        guard !person.isEmpty else { return }
        await history.show(saved: await store.loadRows(person: person), now: hubNow())
    }

    func personChanged() {
        history.clear()
        Task {
            await history.show(saved: await store.loadRows(person: person), now: hubNow())
            await refreshHistory()
        }
    }

    // MARK: History

    func refreshHistory() async {
        guard let api, !person.isEmpty else { return }
        let owner = person
        if let rows = await history.refresh(api: api, person: owner, now: hubNow()) {
            await store.save(rows: rows, person: owner)
        }
    }

    // MARK: Check-in

    func submitCheckin(_ answers: [CheckinAnswer]) async -> CheckinOutcome {
        guard !person.isEmpty, !answers.isEmpty else { return .refused(String(localized: "Choose who you are in Settings first.")) }
        if let api {
            do {
                try await api.checkin(person: person, answers: answers)
                return .sent
            } catch HubError.refused(let words) {
                return .refused(words)
            } catch {
                // Out of reach: kept below.
            }
        }
        await store.add(PendingCheckin(person: person, t: Date().timeIntervalSince1970 * 1000, answers: answers))
        pendingCheckins = await store.pendingCheckins().count
        return .queued
    }

    /// Sends check-ins answered offline, oldest first, keeping the time they were answered.
    func flushCheckins() {
        guard let api, pendingCheckins > 0 else { return }
        Task {
            for checkin in await store.pendingCheckins() {
                do {
                    try await api.readings(source: "checkin:\(checkin.person)", rows: checkin.rows)
                    await store.removeCheckin(id: checkin.id)
                } catch HubError.refused {
                    // Malformed: sending it again would fail the same way.
                    await store.removeCheckin(id: checkin.id)
                } catch {
                    break
                }
            }
            pendingCheckins = await store.pendingCheckins().count
        }
    }

    // MARK: Alerts

    /// "I am OK" or "I need help". Returns the hub's words if it refused, or a reason it could not be sent.
    func answer(_ alert: HubAlert, ok: Bool) async -> String? {
        guard let api else { return String(localized: "The hub is out of reach.") }
        do {
            try await api.answerAlert(id: alert.id, answer: ok ? "ok" : "help")
            return nil
        } catch HubError.refused(let words) {
            return words
        } catch {
            return String(localized: "The hub is out of reach.")
        }
    }

    /// "I've seen it" on a level 3.
    func acknowledge(_ alert: HubAlert) async -> String? {
        guard let api, !person.isEmpty else { return String(localized: "The hub is out of reach.") }
        do {
            try await api.acknowledgeAlert(id: alert.id, by: person)
            return nil
        } catch HubError.refused(let words) {
            return words
        } catch {
            return String(localized: "The hub is out of reach.")
        }
    }

    /// From a tapped notification. Its identifier is "<alert id>|<level>" (AlarmNotifier).
    func openAlert(notification identifier: String) {
        guard let bar = identifier.lastIndex(of: "|") else { return }
        openedAlertID = String(identifier[..<bar])
        selectedTab = .me
    }
}
