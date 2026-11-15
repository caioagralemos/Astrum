// The app's entry point. Creates the one shared model at launch (also when iOS
// wakes the app in the background for new Health data), shows the main screen,
// lets alerts appear as banners while the app is open, and opens the alert a
// tapped notification is about.

import SwiftUI
import UserNotifications

@main
struct AstrumApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    private let presenter: NotificationPresenter

    init() {
        let model = AppModel()
        _model = State(initialValue: model)
        presenter = NotificationPresenter { identifier in model.openAlert(notification: identifier) }
        UNUserNotificationCenter.current().delegate = presenter
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.becameActive() }
        }
    }
}

/// Shows alerts even while Astrum is the app on screen, and opens the alert a tapped notification is about.
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate, Sendable {
    private let open: @MainActor @Sendable (String) -> Void

    init(open: @escaping @MainActor @Sendable (String) -> Void) {
        self.open = open
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let identifier = response.notification.request.identifier
        await open(identifier)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
