// The app's entry point. Creates the one shared model at launch (also when iOS
// wakes the app in the background for new Health data), shows the main screen,
// lets alerts appear as banners while the app is open, opens the alert a
// tapped notification is about, and sends the answer given with a
// notification's button (AlarmNotifier), even when iOS wakes the app for it.

import SwiftUI
import UIKit
import UserNotifications

@main
struct AstrumApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    private let presenter: NotificationPresenter

    init() {
        let model = AppModel()
        _model = State(initialValue: model)
        presenter = NotificationPresenter(
            open: { identifier in model.openAlert(notification: identifier) },
            act: { action, alertID, level in
                // Keeps the app running until the hub has answered, if iOS woke it in the background for this.
                let task = UIApplication.shared.beginBackgroundTask(withName: "Alert answer", expirationHandler: nil)
                await model.handleNotificationAction(action, alertID: alertID, level: level, recorded: false)
                UIApplication.shared.endBackgroundTask(task)
            }
        )
        AlarmNotifier.registerCategories()
        UNUserNotificationCenter.current().delegate = presenter
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.becameActive() }
            if phase == .background { model.wentToBackground() }
        }
    }
}

/// Shows alerts even while Astrum is the app on screen, opens the alert a tapped notification is
/// about, and hands a notification's action button to the model.
// On the main actor: iOS calls an `async` delegate method off the main thread and then finishes the
// notification response there, which UIKit refuses ("call must be made on main thread").
@MainActor
final class NotificationPresenter: NSObject, @preconcurrency UNUserNotificationCenterDelegate, Sendable {
    private let open: @MainActor @Sendable (String) -> Void
    private let act: @MainActor @Sendable (AlarmNotifier.Action, String, Int) async -> Void

    init(open: @escaping @MainActor @Sendable (String) -> Void, act: @escaping @MainActor @Sendable (AlarmNotifier.Action, String, Int) async -> Void) {
        self.open = open
        self.act = act
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let request = response.notification.request
        let info = request.content.userInfo
        if let action = AlarmNotifier.Action(rawValue: response.actionIdentifier), let alertID = info["alertID"] as? String {
            // iOS keeps the app running until this returns.
            await act(action, alertID, info["level"] as? Int ?? 0)
        } else {
            open(request.identifier)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
