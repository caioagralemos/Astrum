// Earth, on Station, under the Earth widget (which shows the delay):
// "Contact Earth", and every message still listed, each counting down to its
// arrival and to the earliest reply.
// The only reply there can be is the hub's simulated one, marked Simulated.

import SwiftUI

struct EarthSection: View {
    @Environment(AppModel.self) private var model
    let now: Double
    @State private var composing = false

    var body: some View {
        let world = model.world
        ProjectionSection {
            Button("Contact Earth") { composing = true }
                .buttonStyle(.projectionProminent)
                .disabled(!model.isConnected || model.person.isEmpty)
            if !model.isConnected {
                Text("Messages to Earth go through the hub, and the hub is out of reach.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if world.earthMessages.isEmpty {
                Text("No messages yet.").foregroundStyle(.secondary)
            }
            ForEach(world.earthMessages.sorted { $0.sentAt > $1.sentAt }) { message in
                EarthMessageRow(message: message, now: now)
            }
        } header: {
            ProjectionHeader(.earth, "Earth")
        }
        .sheet(isPresented: $composing) {
            ContactEarthView()
        }
    }
}

private struct EarthMessageRow: View {
    @Environment(AppModel.self) private var model
    let message: EarthMessage
    let now: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            if let text = message.text {
                Text(text)
            }
            Text("Sent \(Date(timeIntervalSince1970: message.sentAt / 1000).formatted(date: .omitted, time: .shortened))")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(message.delivered || now >= message.arrivesAt
                 ? String(localized: "Delivered")
                 : String(localized: "Reaches Earth in \(Countdown.minutes(ms: message.arrivesAt - now))"))
                .font(.footnote)
            if let reply = message.reply {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text("Reply").font(.footnote.weight(.semibold))
                        if reply.simulated { KindBadge(kind: .simulated) }
                    }
                    Text(reply.key == "earth.simReply" ? String(localized: "Houston: message received. Your flight surgeon is reviewing it. (Simulated reply: there is no ground station in this demo.)") : reply.text)
                        .font(.footnote)
                }
                .padding(.top, 2)
            } else {
                Text(now >= message.replyAt
                     ? String(localized: "A reply can be here now")
                     : String(localized: "A reply can be back in \(Countdown.minutes(ms: message.replyAt - now))"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if message.resolvedAt != nil {
                Text("The alert has ended; the reply is still on its way.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        if message.kind == "crew" {
            return String(localized: "From \(model.world.name(of: message.from ?? message.about.person))")
        }
        return String(localized: "Automatic message about \(model.world.name(of: message.about.person)): \(Signals.name(message.about.signal))")
    }
}
