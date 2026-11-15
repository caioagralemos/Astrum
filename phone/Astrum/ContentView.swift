// The app's frame: the short first run until a hub and a crewmate are
// chosen, then four tabs (Me, Check-in, Ask Astra, Station), with alerts
// taking over the screen above any of them.

import SwiftUI

enum AppTab: Hashable {
    case me, checkIn, ask, station
}

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            if !model.onboarded || model.needsSetup {
                OnboardingView()
            } else {
                TabView(selection: $model.selectedTab) {
                    Tab("Me", systemImage: "figure.stand", value: AppTab.me) {
                        MeView()
                    }
                    Tab("Check-in", systemImage: "square.and.pencil", value: AppTab.checkIn) {
                        CheckInView()
                    }
                    Tab("Ask Astra", systemImage: "text.bubble", value: AppTab.ask) {
                        AskView()
                    }
                    Tab("Station", systemImage: "circle.hexagongrid", value: AppTab.station) {
                        StationView()
                    }
                }
                .modifier(AlertTakeover())
                // Nothing to show yet (no hub data, not even saved): the hub's loading mark.
                .modifier(HubLoadingCover(waiting: !model.world.hasData, message: model.link.title))
            }
        }
        .preferredColorScheme(.dark)
        .dismissesKeyboardOnTapOutside()
    }
}

#Preview {
    ContentView()
        .environment(SampleData.model())
}
