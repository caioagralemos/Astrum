// The app's entry point. Creates the one shared model at launch (also when iOS
// wakes the app in the background for new Health data), shows the main screen,
// and lets alerts appear as banners while the app is open.

import SwiftUI
import UserNotifications

@main
struct AstrumApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    private let presenter = NotificationPresenter()

    init() {
        _model = State(initialValue: AppModel())
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

/// Shows alerts even while Astrum is the app on screen.
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate, Sendable {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
