// The thin native bar above the hub's page: whether the hub is connected,
// whose phone this is, and when a reading last went out. VoiceOver reads it
// as one sentence; at the largest text sizes it stacks instead of squeezing.

import SwiftUI

struct StatusStrip: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let openSettings: () -> Void

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))

        layout {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: model.link.symbol)
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.link.title)
                        .font(.subheadline.weight(.semibold))
                    Text(details.joined(separator: " · "))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spokenStatus)

            if !stacked { Spacer(minLength: 0) }

            Button(action: openSettings) {
                if stacked {
                    Label("Settings", systemImage: "gearshape")
                } else {
                    Label("Settings", systemImage: "gearshape")
                        .labelStyle(.iconOnly)
                        .padding(6)
                }
            }
            .accessibilityHint("Hub address, crewmate, Health access and alerts")
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.link)
    }

    private var tint: Color {
        switch model.link {
        case .connected: .green
        case .retrying: .orange
        case .connecting, .noHub: .secondary
        }
    }

    private var ownerText: String {
        model.personName.map { "\($0)'s phone" } ?? "No crewmate chosen"
    }

    private var sentText: String {
        guard let lastSent = model.lastSent else { return "Nothing sent yet" }
        return "Last sent \(lastSent.formatted(date: .omitted, time: .shortened))"
    }

    private var details: [String] {
        var parts = [ownerText, sentText]
        if model.waitingCount > 0 { parts.append("\(model.waitingCount) waiting") }
        return parts
    }

    private var spokenStatus: String {
        var sentence = "\(model.link.title). \(ownerText). \(sentText)."
        if model.waitingCount > 0 { sentence += " \(model.waitingCount) readings waiting to send." }
        return sentence
    }
}
