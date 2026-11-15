// Station, the companion's small window on the hub: the hub dock's widgets
// (alerts, Earth, CO2 in every room, the crew by name, room and shared status
// only, the mission, radiation), then the rest of the air where I am, and
// the messages to Earth. Never anyone else's readings.

import SwiftUI

struct StationView: View {
    @Environment(AppModel.self) private var model
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let now = model.hubNow(context.date)
                let widgets = StationWidgets.items(world: model.world, now: now)
                List {
                    ConnectionBanner()
                    if !widgets.isEmpty {
                        Section {
                            // As wide as the list's frames.
                            WidgetGrid(items: widgets)
                                .listRowInsets(EdgeInsets(top: 4, leading: HubStyle.listInset, bottom: 4, trailing: HubStyle.listInset))
                                .listRowBackground(Color.clear)
                        }
                    }
                    if model.world.crew.isEmpty {
                        Text("Connect to the hub to see the crew.").foregroundStyle(.secondary)
                            .projectionRow()
                    }
                    RoomAirSection(now: now)
                    EarthSection(now: now)
                }
                .tint(.white)
            }
            .navigationTitle("Station")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SettingsButton { showingSettings = true }
                }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
        }
    }
}

/// The rest of the air in the room I am in (its CO2 is in the CO2 widget):
/// temperature, pressure, humidity, and a CO2 sensor gone quiet while over the limit.
private struct RoomAirSection: View {
    @Environment(AppModel.self) private var model
    let now: Double

    private let shown = ["temperature", "pressure", "humidity"]

    var body: some View {
        let world = model.world
        let room = world.room(of: model.person)
        ProjectionSection {
            if let room {
                let all = world.currentRows(inRoom: room, now: now)
                let rows = all
                    .filter { shown.contains($0.signal) }
                    .sorted { (shown.firstIndex(of: $0.signal) ?? 0) < (shown.firstIndex(of: $1.signal) ?? 0) }
                if all.isEmpty {
                    Text("No air reading").foregroundStyle(.secondary)
                }
                ForEach(rows, id: \.self) { row in
                    AirRow(row: row, now: now, alarm: world.alarms.first { $0.room == room && $0.signal == row.signal })
                }
                if let alarm = world.alarms.first(where: { $0.room == room && $0.signal == "co2" && $0.stale == true }),
                   let last = alarm.lastReading {
                    let minutes = Int(((now - last.t) / 60_000).rounded())
                    Text("Sensor quiet: last reading \(Signals.number(last.value)) \(alarm.unit), \(minutes) minutes ago")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("The hub does not know which room you are in.").foregroundStyle(.secondary)
            }
        } header: {
            if let room {
                ProjectionHeader(.home, "Where you are: \(Signals.roomName(room, rooms: world.profile?.rooms ?? []))")
            } else {
                ProjectionHeader(.home, "Where you are")
            }
        }
    }
}

private struct AirRow: View {
    let row: Row
    let now: Double
    let alarm: HubAlarm?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(Signals.name(row.signal))
                Spacer()
                Text(Signals.text(row))
                    .font(.body.monospacedDigit().weight(.light))
            }
            HStack(spacing: 8) {
                KindBadge(kind: row.kind)
                if let alarm, alarm.stale == true, let last = alarm.lastReading {
                    let minutes = Int(((now - last.t) / 60_000).rounded())
                    Text("Sensor quiet: last reading \(Signals.number(last.value)) \(alarm.unit), \(minutes) minutes ago")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if Signals.isStale(row, now: now) {
                    Text("Not current · \(row.date.formatted(date: .omitted, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    StationView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
