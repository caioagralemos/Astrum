// The daily check-in reminder: a quiet local notification at a time the owner
// sets in Settings. It carries no health data, only the question. When today's
// check-in is already done, today's is skipped: the next seven days are
// scheduled explicitly (one non-repeating notification each, never today's if it
// is done) and redone on launch, on coming to the front, after a check-in and
// when the setting changes. Tapping it opens the Check-in tab's flow.

import Foundation
import UserNotifications

enum CheckInReminder {
    static let enabledKey = "checkInReminderOn"
    static let minutesKey = "checkInReminderMinutes"
    static let lastDoneKey = "checkInLastDone"
    static let defaultMinutes = 9 * 60
    static let prefix = "checkin-reminder-"
    private static let days = 7

    static var isOn: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
    static var minutes: Int { UserDefaults.standard.object(forKey: minutesKey) as? Int ?? defaultMinutes }

    /// Remembers that a check-in was completed (sent or kept for sending) just now.
    static func markDone(at date: Date = .now) {
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: lastDoneKey)
    }

    /// When this phone last completed a check-in, if ever.
    static var lastDone: Date? {
        (UserDefaults.standard.object(forKey: lastDoneKey) as? Double).map { Date(timeIntervalSince1970: $0) }
    }

    /// Replaces the pending reminders. `doneToday` is true when a check-in already exists for today.
    static func reschedule(doneToday: Bool, now: Date = .now) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: (0..<days).map { prefix + String($0) })
        guard isOn else { return }
        let calendar = Calendar.current
        let minutes = Self.minutes
        for offset in 0..<days {
            guard let day = calendar.date(byAdding: .day, value: offset, to: now),
                  let fire = calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: day),
                  fire > now, !(offset == 0 && doneToday) else { continue }
            let content = UNMutableNotificationContent()
            content.title = String(localized: "How are you feeling today?")
            content.body = String(localized: "Your daily check-in takes a minute.")
            content.sound = .default
            content.interruptionLevel = .active
            content.threadIdentifier = "checkin"
            let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            center.add(UNNotificationRequest(identifier: prefix + String(offset), content: content, trigger: trigger)) { _ in }
        }
    }
}

extension AppModel {
    /// True when a check-in was completed today, on this phone or found in the hub's history.
    var checkInDoneToday: Bool {
        if let last = CheckInReminder.lastDone, Calendar.current.isDateInToday(last) { return true }
        return history.rows.contains { CheckInSummary.questions.contains($0.signal) && Calendar.current.isDateInToday($0.date) }
    }

    /// Only once notifications are allowed: never before the first run's alerts step has asked.
    func rescheduleCheckInReminder() {
        Task {
            guard await Self.notificationAccess().allowed else { return }
            CheckInReminder.reschedule(doneToday: checkInDoneToday)
        }
    }

    /// What iOS allows for notifications right now.
    static func notificationAccess() async -> NotificationAccess {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return settings.timeSensitiveSetting == .enabled ? .allowed : .allowedNotTimeSensitive
        case .denied: return .denied
        case .notDetermined: return .notAsked
        @unknown default: return .denied
        }
    }
}

/// Notifications, as the first run reports them.
enum NotificationAccess: Sendable {
    case notAsked, allowed, allowedNotTimeSensitive, denied

    var allowed: Bool { self == .allowed || self == .allowedNotTimeSensitive }
}
