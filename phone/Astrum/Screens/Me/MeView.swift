// Me, the home tab: the owner's body. The figure on top (tap a region to
// filter), the regions again as a plain list, one line that sums up today,
// then every reading with its label and where it sits against their usual.
// Tapping a reading opens its detail.

import SwiftUI

struct MeView: View {
    @Environment(AppModel.self) private var model
    @State private var region: BodyRegion?
    @State private var showingSettings = false
    @State private var blood: BloodReply?
    @State private var router = ReadingRouter()

    var body: some View {
        NavigationStack(path: $router.path) {
            TimelineView(.periodic(from: .now, by: 10)) { context in
                let now = model.hubNow(context.date)
                content(readings: model.readings(now: now))
            }
            .listStyle(.plain)
            // The frames line up with the widgets (16 from the screen's edges); controls are white.
            .environment(\.projectionListInset, 16)
            .tint(.white)
            // The title names the screen for VoiceOver and the back button; it is not drawn.
            .navigationTitle(String(localized: "Me"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { Color.clear.accessibilityHidden(true) }
                ToolbarItem(placement: .topBarTrailing) {
                    SettingsButton { showingSettings = true }
                }
            }
            .navigationDestination(for: String.self) { signal in
                ReadingDetailView(signal: signal)
            }
            .environment(router)
            .sheet(isPresented: $showingSettings) { SettingsView() }
            .task(id: "\(model.person)|\(model.isConnected)") { await keepFresh() }
        }
    }

    private func content(readings: [Reading]) -> some View {
        let marked = Readings.markedRegions(readings, alerts: model.visibleAlerts, person: model.person)
        let shown = region.map { r in readings.filter { $0.region == r } } ?? readings
        let widgets = MeWidgets.items(readings: readings, world: model.world, person: model.person)
        return List {
            Section {
                ConnectionBanner()
                MeAlertBanners()
                AvatarView(marked: marked, selected: $region) { status(of: $0, in: readings) }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                RegionPicker(selected: $region, marked: marked)
                TodayLine(readings: readings)
            }
            .listRowSeparator(.hidden)

            if !widgets.isEmpty {
                Section {
                    WidgetGrid(items: widgets)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }

            ProjectionSection {
                if region == .blood {
                    BloodResultsList(reply: blood, person: model.person)
                } else if shown.isEmpty {
                    Text(emptyText)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(shown) { reading in
                        NavigationLink(value: reading.signal) {
                            ReadingRow(reading: reading)
                        }
                    }
                }
            } header: {
                ProjectionHeader(region?.icon ?? .vibration, region?.title ?? String(localized: "All readings"))
            }
        }
    }

    private var emptyText: String {
        if region != nil { return String(localized: "No readings here yet.") }
        return model.world.hasData ? String(localized: "The hub has no readings for you yet.") : String(localized: "No data from the hub yet.")
    }

    private func status(of region: BodyRegion, in readings: [Reading]) -> String {
        if region == .blood {
            let count = blood?.latest[model.person]?.count ?? 0
            return count == 0 ? String(localized: "No blood test yet") : String(localized: "\(count) results")
        }
        let mine = readings.filter { $0.region == region }
        if mine.isEmpty { return String(localized: "No readings yet") }
        let outside = mine.filter(\.isMarked).count
        return outside == 0 ? String(localized: "Within your usual") : String(localized: "\(outside) readings outside your usual")
    }

    /// Refreshes the history now (and on reconnecting) and every five minutes while Me is on screen.
    private func keepFresh() async {
        while !Task.isCancelled {
            await model.refreshHistory()
            if let api = model.api { blood = (try? await api.blood()) ?? blood }
            try? await Task.sleep(for: .seconds(300))
        }
    }
}

private extension BodyRegion {
    /// The hub's icon for the region, beside its name in the list's header.
    var icon: HubIconName {
        switch self {
        case .head: .head
        case .heart: .heart
        case .lungs: .air
        case .body: .dumbbell
        case .blood: .humidity
        }
    }
}

/// The regions as a plain row of choices: the figure's regions without the figure.
private struct RegionPicker: View {
    @Binding var selected: BodyRegion?
    let marked: Set<BodyRegion>

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(nil, title: String(localized: "All"))
                ForEach(BodyRegion.allCases) { region in
                    chip(region, title: region.title)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Regions"))
    }

    private func chip(_ region: BodyRegion?, title: String) -> some View {
        let isSelected = selected == region
        let isMarked = region.map(marked.contains) ?? false
        return Button {
            selected = region
        } label: {
            // The hub's labels: outlined on the tint; the chosen one solid white with dark words.
            HStack(spacing: 4) {
                Text(title)
                if isMarked {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(HubStyle.watch)
                        .accessibilityHidden(true)
                }
            }
            .font(.subheadline)
            .foregroundStyle(isSelected ? HubStyle.solidFill : .white)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background {
                let shape = RoundedRectangle(cornerRadius: HubStyle.controlRadius, style: .circular)
                if isSelected {
                    shape.fill(.white)
                } else {
                    shape.fill(HubStyle.fill)
                        .overlay(shape.strokeBorder(.white.opacity(0.5), lineWidth: 1))
                }
            }
            .padding(.vertical, 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityValue(isMarked ? Text("Something outside your usual") : Text(verbatim: ""))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The one line that sums up today: an alert first, then the readings.
private struct TodayLine: View {
    @Environment(AppModel.self) private var model
    let readings: [Reading]

    var body: some View {
        let (text, tone) = summary
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if tone != .quiet {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(.headline)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var summary: (String, StatusTone) {
        let world = model.world
        if let alert = model.visibleAlerts.filter({ $0.person == model.person && $0.level >= 2 }).max(by: { $0.level < $1.level }) {
            let room = alert.room.map { Signals.roomName($0, rooms: world.profile?.rooms ?? []) } ?? ""
            let signal = Signals.name(alert.signal)
            return (String(localized: "In \(room), where \(signal) is over NASA's limit"), alert.level >= 3 ? .danger : .watch)
        }
        if readings.isEmpty { return (String(localized: "No readings from the hub yet"), .quiet) }
        let outside = readings.filter(\.isMarked).count
        if outside > 0 { return (String(localized: "\(outside) readings outside your usual"), .watch) }
        if !readings.contains(where: { $0.baseline?.judged != nil }) { return (String(localized: "Not enough history to compare yet"), .quiet) }
        return (String(localized: "Everything within your usual"), .quiet)
    }
}

/// The toolbar's settings button, shared by the tabs.
struct SettingsButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Settings", systemImage: "gearshape")
        }
        .accessibilityHint(Text("Hub, crewmate, Health access, alerts and language"))
    }
}

#Preview {
    MeView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
