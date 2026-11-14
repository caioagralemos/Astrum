// The one screen: a native status strip on top of the hub's interface. Until a
// hub is known it explains that it is searching. Opens settings by itself on
// first run, when there is no hub or no crewmate chosen yet.

import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var showingSettings = false
    @State private var checkedSetup = false

    var body: some View {
        VStack(spacing: 0) {
            StatusStrip { showingSettings = true }
            Divider()
            if let url = model.pageURL {
                HubWebView(url: url, hubReachable: model.link == .connected)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                ContentUnavailableView {
                    Label("Looking for the hub", systemImage: "antenna.radiowaves.left.and.right")
                } description: {
                    Text("Astrum searches this Wi-Fi network for the hub. You can also type its address in Settings.")
                } actions: {
                    Button("Open Settings") { showingSettings = true }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxHeight: .infinity)
            }
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        .onAppear {
            guard !checkedSetup else { return }
            checkedSetup = true
            if model.needsSetup { showingSettings = true }
        }
    }
}
