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

    /// The alerts the owner is told about. Nothing else is ever shown. An answer just sent shows at
    /// once (the countdown stops), until the hub's own state confirms it.
    var visibleAlerts: [HubAlert] {
        guard !person.isEmpty else { return [] }
        let alerts = world.visibleAlerts(to: person)
        guard !pendingAnswers.isEmpty else { return alerts }
        return alerts.map { alert in
            guard alert.answer == nil, alert.level == 2, let sent = pendingAnswers[alert.id] else { return alert }
            var answered = alert
            answered.answer = sent
            return answered
        }
    }

    /// The owner's current readings, as Me lists them.
    func readings(now: Double) -> [Reading] {
        Readings.build(world: world, historyRows: history.rows, baselines: history.baselines, person: person, now: now)
    }

    // MARK: The hub's messages

    func apply(_ message: HubIncoming) {
        world.apply(message, at: Date())
        // An answer is confirmed once the hub's alert has one, has moved on from level 2, or has ended.
        if !pendingAnswers.isEmpty, message.alerts != nil {
            pendingAnswers = pendingAnswers.filter { id, _ in
                world.alerts.contains { $0.id == id && $0.level == 2 && $0.answer == nil }
            }
        }
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
        rescheduleCheckInReminder()
    }

    // MARK: Check-in

    func submitCheckin(_ answers: [CheckinAnswer]) async -> CheckinOutcome {
        guard !person.isEmpty, !answers.isEmpty else { return .refused(String(localized: "Choose who you are in Settings first.")) }
        if let api {
            do {
                try await api.checkin(person: person, answers: answers)
                CheckInReminder.markDone()
                rescheduleCheckInReminder()
                return .sent
            } catch HubError.refused(let words) {
                return .refused(words)
            } catch {
                // Out of reach: kept below.
            }
        }
        await store.add(PendingCheckin(person: person, t: Date().timeIntervalSince1970 * 1000, answers: answers))
        pendingCheckins = await store.pendingCheckins().count
        CheckInReminder.markDone()
        rescheduleCheckInReminder()
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

    /// "I am OK" or "I need help". Shown at once; returns a plain sentence if it could not be sent
    /// (never the hub's own words). If the hub no longer has the question, the screen follows the
    /// hub's state instead of showing an error.
    func answer(_ alert: HubAlert, ok: Bool) async -> String? {
        await answer(alertID: alert.id, recorded: alert.isRecorded, ok: ok)
    }

    func answer(alertID: String, recorded: Bool, ok: Bool) async -> String? {
        if recorded { return AlertWords.recordedNotSent }
        guard let api else { return AlertWords.outOfReach }
        pendingAnswers[alertID] = ok ? "ok" : "help"
        do {
            try await api.answerAlert(id: alertID, answer: ok ? "ok" : "help")
            refreshFromHub()
            return nil
        } catch HubError.notWaiting {
            pendingAnswers[alertID] = nil
            refreshFromHub()
            return nil
        } catch HubError.recorded {
            pendingAnswers[alertID] = nil
            return AlertWords.recordedNotSent
        } catch HubError.refused {
            pendingAnswers[alertID] = nil
            return AlertWords.answerRefused
        } catch {
            pendingAnswers[alertID] = nil
            return AlertWords.outOfReach
        }
    }

    /// "I've seen it" on a level 3. Returns a plain sentence if it could not be sent.
    func acknowledge(_ alert: HubAlert) async -> String? {
        await acknowledge(alertID: alert.id, recorded: alert.isRecorded)
    }

    func acknowledge(alertID: String, recorded: Bool) async -> String? {
        if recorded { return AlertWords.recordedNotSent }
        guard let api, !person.isEmpty else { return AlertWords.outOfReach }
        do {
            try await api.acknowledgeAlert(id: alertID, by: person)
            refreshFromHub()
            return nil
        } catch HubError.notWaiting {
            // Someone saw it first, or it ended: the hub's state says which.
            refreshFromHub()
            return nil
        } catch HubError.recorded {
            return AlertWords.recordedNotSent
        } catch HubError.refused {
            return AlertWords.seenRefused
        } catch {
            return AlertWords.outOfReach
        }
    }

    /// An action button on an alert notification (AlarmNotifier), possibly with the app just woken
    /// in the background. On success the notification goes; if the hub cannot be reached, a
    /// follow-up notification says so rather than failing silently.
    func handleNotificationAction(_ action: AlarmNotifier.Action, alertID: String, level: Int, recorded: Bool) async {
        let problem: String? = switch action {
        case .ok: await answer(alertID: alertID, recorded: recorded, ok: true)
        case .help: await answer(alertID: alertID, recorded: recorded, ok: false)
        case .seen: await acknowledge(alertID: alertID, recorded: recorded)
        }
        if let problem {
            notifier.postUnsent(alertID: alertID, reason: problem == AlertWords.outOfReach ? AlertWords.unreachableOpen : AlertWords.refusedOpen)
        } else {
            notifier.removeDelivered(alertID: alertID, level: level)
        }
    }

    /// From a tapped notification. Its identifier is "<alert id>|<level>" (AlarmNotifier).
    func openAlert(notification identifier: String) {
        if identifier.hasPrefix(CheckInReminder.prefix) { startTodaysCheckIn(); return }
        if identifier.hasPrefix(AlarmNotifier.followUpPrefix) { selectedTab = .me; return }
        if identifier.hasPrefix(AlarmNotifier.earthPrefix) { selectedTab = .station; return }
        guard let bar = identifier.lastIndex(of: "|") else { return }
        openedAlertID = String(identifier[..<bar])
        selectedTab = .me
    }
}

/// The plain sentences the alert screens and notifications use. The hub's own words never reach them.
enum AlertWords {
    static var recordedNotSent: String { String(localized: "Simulated scenario: a recorded story is playing. Your answers are not sent.") }
    static var outOfReach: String { String(localized: "The hub is out of reach.") }
    static var answerRefused: String { String(localized: "The hub did not take your answer. If you need help, tell the crew directly.") }
    static var seenRefused: String { String(localized: "The hub did not take this. Try again.") }
    static var unreachableOpen: String { String(localized: "Could not reach the hub: open Astrum to answer.") }
    static var refusedOpen: String { String(localized: "The hub did not take your answer: open Astrum to answer.") }
    static var drillNotice: String { String(localized: "Drill: the reading is simulated. The alert and your answers are real.") }
}
