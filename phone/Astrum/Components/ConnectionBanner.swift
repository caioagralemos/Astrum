// A quiet line at the top of a tab when the hub is not live: out of reach
// (with the time of the data shown), restarting, or playing a simulated
// scenario. Nothing when all is well.

import SwiftUI

struct ConnectionBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let text {
            Label(text, systemImage: symbol)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
        }
    }

    private var text: String? {
        let world = model.world
        if world.restarting != nil { return String(localized: "The hub is restarting") }
        if !model.isConnected {
            guard let when = world.receivedAt, world.hasData else { return String(localized: "Not connected to the hub") }
            return String(localized: "Not connected · showing data from \(when.formatted(date: .omitted, time: .shortened))")
        }
        if world.scenario != nil { return String(localized: "Simulated scenario playing on the hub") }
        return nil
    }

    private var symbol: String {
        if model.world.restarting != nil { return "arrow.triangle.2.circlepath" }
        return model.isConnected ? "theatermasks" : "wifi.slash"
    }
}
