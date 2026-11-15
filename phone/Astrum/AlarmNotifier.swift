// Turns the hub's alerts into local notifications. They are time-sensitive and
// make a sound, so they reach a locked phone through Focus, and a locked phone
// passes them on to the Apple Watch (there is no Watch app).
//
// The hub decides who is told: the affected crewmate first, then the Crew
// Medical Officer, then everyone. This phone announces only the alerts its
// owner is told about, once per level, so an escalation is announced again.
// A room alarm by itself sounds the room's buzzer; it reaches phones as an
// alert only when someone is in that room.
//
// Answering from the notification: a level 2 "Are you OK?" to the owner has
// "I am OK" and "I need help" (red), a level 3 has "I've seen it". None needs
// the phone unlocked, so they work from the lock screen and the Apple Watch
// mirrors them. A drill's alerts are titled "Drill:" and answer the same way.
// A recorded story's alerts are titled "Simulated:" and carry no action: they
// exist only in the recording, so nothing may look answerable.

import Foundation
import UserNotifications

@MainActor
final class AlarmNotifier {
    private static let storeKey = "notifiedAlarms"
    private static let remembered = 200

    private var notified: [String]

    /// The action buttons, by identifier. AstrumApp's delegate hands them to AppModel.
    enum Action: String, Sendable {
        case ok = "alert.ok"
        case help = "alert.help"
        case seen = "alert.seen"
    }

    private static let askCategory = "alert.ask"
    private static let dangerCategory = "alert.danger"

    /// Registers the action buttons. Called once at launch, before any notification is shown.
    static func registerCategories() {
        let ok = UNNotificationAction(identifier: Action.ok.rawValue, title: String(localized: "I am OK"), options: [])
        let help = UNNotificationAction(identifier: Action.help.rawValue, title: String(localized: "I need help"), options: [.destructive])
        let seen = UNNotificationAction(identifier: Action.seen.rawValue, title: String(localized: "I've seen it"), options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: askCategory, actions: [ok, help], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: dangerCategory, actions: [seen], intentIdentifiers: [], options: []),
        ])
    }

    init() {
        notified = UserDefaults.standard.stringArray(forKey: Self.storeKey) ?? []
    }

    func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// The permission state, in words for the settings screen.
    func permissionText() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return settings.timeSensitiveSetting == .enabled ? "Allowed, time-sensitive" : "Allowed, but not time-sensitive"
        case .denied:
            return "Off. Turn on in the Settings app"
        case .notDetermined:
            return "Not asked yet"
        @unknown default:
            return "Unknown"
        }
    }

    /// Announces every alarm in the list that nobody has silenced and that has not been announced yet.
    func handle(_ alarms: [HubAlarm], rooms: [HubRoom] = []) {
        for alarm in alarms where !alarm.acknowledged && !notified.contains(alarm.key) {
            remember(alarm.key)
            let signal = Signals.name(alarm.signal)
            let room = Signals.roomName(alarm.room, rooms: rooms)
            post(
                id: alarm.key,
                title: String(localized: "\(signal) over NASA's limit in \(room)"),
                body: String(localized: "Now \(Self.number(alarm.value)) \(alarm.unit). NASA's limit is \(Self.number(alarm.limit)) \(alarm.unit)."),
                delay: nil
            )
        }
    }

    /// The hub itself needs data from the owner: one quiet notification per asking, never for a question they started. Tapping opens Me.
    static let followUpPrefix = "followup:"
    func handle(followUp ask: FollowUpAsk?, owner: String, lang: String) {
        guard let ask, ask.origin == "hub", !owner.isEmpty, ask.person == owner else { return }
        let key = "followUp|\(ask.key)"
        guard !notified.contains(key) else { return }
        remember(key)
        post(id: Self.followUpPrefix + ask.key, title: String(localized: "Astra has a question for you"), body: lang == "pt" ? ask.text.pt : ask.text.en, delay: nil, interruption: .active)
    }

    /// Announces every alert this phone's owner is told about and has not heard at this level.
    func handle(_ alerts: [HubAlert], owner: String, crew: [CrewMember], rooms: [HubRoom] = [], now: Double = Date.now.timeIntervalSince1970 * 1000) {
        guard !owner.isEmpty else { return }
        for alert in alerts where !alert.held && alert.toldTo.includes(owner) && !notified.contains(alert.occurrenceKey) {
            remember(alert.occurrenceKey)
            // Every name through Signals.name and Signals.roomName, every sentence through AlertText.
            let who = crew.first(where: { $0.id == alert.person })?.name ?? alert.person
            let room = alert.room.map { Signals.roomName($0, rooms: rooms) } ?? ""
            let shelter = alert.declared?.shelter.map { Signals.roomName($0, rooms: rooms) }
            var (title, body) = AlertText.notification(alert, viewer: owner, name: who, room: room, shelter: shelter, now: now)
            if alert.isRecorded { title = String(localized: "Simulated: \(title)") } else if alert.isDrill { title = String(localized: "Drill: \(title)") }
            // A level rise is announced again, in place of the lower level's notification, never beside it.
            let lower = (1..<max(alert.level, 1)).map { "\(alert.id)|\($0)" }
            if !lower.isEmpty { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: lower) }
            post(id: alert.key, title: title, body: body, delay: nil, category: Self.category(of: alert, owner: owner), info: ["alertID": alert.id, "level": alert.level])
        }
        removeStale(keeping: Set(alerts.filter { Self.category(of: $0, owner: owner) != nil }.map(\.key)))
    }

    /// The action buttons an alert's notification gets, or none (a recorded story's never does).
    private static func category(of alert: HubAlert, owner: String) -> String? {
        guard !alert.isRecorded, !alert.held else { return nil }
        if alert.isNotice { return alert.seenAt == nil ? dangerCategory : nil }
        if alert.level == 2, alert.person == owner, alert.answer == nil, alert.answerBy != nil { return askCategory }
        if alert.level == 3, alert.seenAt == nil { return dangerCategory }
        return nil
    }

    /// Takes away delivered notifications whose buttons no longer apply (answered, seen, escalated or ended).
    private func removeStale(keeping live: Set<String>) {
        let categories: Set<String> = [Self.askCategory, Self.dangerCategory]
        UNUserNotificationCenter.current().getDeliveredNotifications { delivered in
            let stale = delivered.filter { categories.contains($0.request.content.categoryIdentifier) && !live.contains($0.request.identifier) }
                .map(\.request.identifier)
            if !stale.isEmpty { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: stale) }
        }
    }

    /// An answer from a notification went through: its notification goes.
    func removeDelivered(alertID: String, level: Int) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["\(alertID)|\(level)"])
    }

    /// An answer from a notification could not be sent. Tapping this opens the alert ("<id>|unsent").
    func postUnsent(alertID: String, reason: String) {
        post(id: "\(alertID)|unsent", title: reason, body: String(localized: "Your answer was not sent."), delay: nil)
    }

    /// The app went to the background with no connection: alerts cannot arrive until it reconnects.
    func postNotConnected() {
        post(
            id: "not-connected",
            title: String(localized: "Not connected to the hub"),
            body: String(localized: "Alerts cannot reach this phone until Astrum reconnects. Open Astrum near the hub."),
            delay: nil
        )
    }

    /// A sample alert, five seconds from now, so there is time to lock the phone and see it on the Watch.
    func sendTest() {
        post(
            id: "test-\(Date().timeIntervalSince1970)",
            title: String(localized: "Test: CO2 over NASA's limit in Quarters 2"),
            body: String(localized: "This is a test alert from Astrum. Nothing is wrong."),
            delay: 5
        )
    }

    private func post(id: String, title: String, body: String, delay: TimeInterval?, category: String? = nil, info: [String: any Sendable] = [:], interruption: UNNotificationInterruptionLevel = .timeSensitive) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if let category { content.categoryIdentifier = category }
        if !info.isEmpty { content.userInfo = info }
        content.sound = .default
        content.interruptionLevel = interruption
        content.threadIdentifier = "alarms"
        let trigger = delay.map { UNTimeIntervalNotificationTrigger(timeInterval: $0, repeats: false) }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { _ in }
    }

    private func remember(_ key: String) {
        notified.append(key)
        if notified.count > Self.remembered { notified.removeFirst(notified.count - Self.remembered) }
        UserDefaults.standard.set(notified, forKey: Self.storeKey)
    }

    // MARK: Words

    private static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }
}
