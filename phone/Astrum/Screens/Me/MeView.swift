// Me, the home tab: the owner's body. The figure on top (tap a region to
// filter; a region with a warning or a reading outside the usual is marked),
// the regions again as a plain list, then for the chosen region (or all):
// its warnings, one line that sums it up, its widgets, and every reading with
// its label and where it sits against their usual. Tapping a reading opens its detail.

import SwiftUI

struct MeView: View {
    @Environment(AppModel.self) private var model
    @State private var region: BodyRegion?
    @State private var showingSettings = false
    @State private var blood: BloodReply?
    @State private var cards: [CardView] = []
    /// The card a card's match opened (its id).
    @State private var openCard: CardID?
    @State private var router = ReadingRouter()
    @Namespace private var zoom
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                // Opened from a widget card: it zooms out of the card. From a row: a plain push.
                ZoomDestination(zooms: router.zoomSource == signal, sourceID: signal, namespace: zoom) {
                    // A blood result lives in the blood results, not among the body's readings.
                    if signal.hasPrefix("blood.") {
                        BloodResultDetailView(signal: signal, reply: blood)
                    } else {
                        ReadingDetailView(signal: signal)
                    }
                }
            }
            .environment(router)
            .environment(\.zoomNamespace, zoom)
            .onChange(of: router.path) { old, new in
                if new.count < old.count { router.zoomSource = nil }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
            .sheet(item: $openCard) { MatchedCardSheet(cardID: $0.id, cards: cards) }
            .task(id: "\(model.person)|\(model.isConnected)") { await keepFresh() }
        }
    }

    private func content(readings: [Reading]) -> some View {
        let marked = Readings.markedRegions(readings, alerts: model.visibleAlerts, person: model.person)
        let danger = Readings.dangerRegions(alerts: model.visibleAlerts, person: model.person)
        let shown = region.map { r in readings.filter { $0.region == r } } ?? readings
        let widgets = MeWidgets.items(readings: readings, world: model.world, person: model.person, region: region)
        return List {
            // Nothing above the body: warnings sit under the region buttons, for the chosen region.
            Section {
                AvatarView(marked: marked, danger: danger, selected: $region) { status(of: $0, in: readings) }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                RegionPicker(selected: $region, marked: marked) { status(of: $0, in: readings) }
                ConnectionBanner()
                // The medical lead's question for the owner, first among what asks for attention, under every region.
                FollowUpCard()
                MeAlertBanners(region: region, cards: cards) { openCard = CardID(id: $0) }
                TodayLine(readings: readings, region: region, blood: blood)
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

            // The whole body's, not a region's: under "All" only, last. Hidden from a hub that sends no dose.
            if region == nil, let doses = model.world.dose {
                ProjectionSection {
                    DoseCard(dose: doses[model.person])
                } header: {
                    ProjectionHeader(.radiation, String(localized: "Radiation dose"))
                }
            }
        }
        // The region's warnings, widgets and readings change as rows inserted and removed, keyed on
        // the region alone (never on the 10-second refresh); so do banners arriving or leaving.
        .animation(Motion.reduced(Motion.content, reduceMotion), value: region)
        .animation(Motion.reduced(Motion.content, reduceMotion), value: MeAlertBanners.alerts(in: region, model: model, cards: cards).map(\.id))
        .animation(Motion.reduced(Motion.content, reduceMotion), value: model.isConnected)
        .animation(Motion.reduced(Motion.content, reduceMotion), value: model.world.followUp?.key)
        .sensoryFeedback(.selection, trigger: region)
    }

    private var emptyText: String {
        if region != nil { return String(localized: "No readings here yet.") }
        return model.world.hasData ? String(localized: "The hub has no readings for you yet.") : String(localized: "No data from the hub yet.")
    }

    /// What a region holds now, for VoiceOver: its warnings first, then its readings.
    private func status(of region: BodyRegion, in readings: [Reading]) -> String {
        let sentences = MeAlertBanners.alerts(in: region, model: model, cards: cards)
            .filter { Readings.region(of: $0, person: model.person) == region }
            .compactMap { MeAlertBanners.text(for: $0, model: model, cards: cards) }
        let warnings = sentences.isEmpty ? nil
            : sentences.count == 1 ? String(localized: "1 warning: \(sentences[0])")
            : String(localized: "\(sentences.count) warnings: \(sentences.joined(separator: ", "))")
        return [warnings, readingStatus(of: region, in: readings)].compactMap { $0 }.joined(separator: ". ")
    }

    private func readingStatus(of region: BodyRegion, in readings: [Reading]) -> String {
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
            if let api = model.api {
                blood = (try? await api.blood()) ?? blood
                cards = (try? await api.cards(lang: model.lang))?.cards ?? cards
            }
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
    /// What each region holds now, for VoiceOver: "1 warning: sleep last night above your usual".
    let status: (BodyRegion) -> String
    @Namespace private var chips
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(nil, title: String(localized: "All"))
                ForEach(BodyRegion.allCases) { region in
                    chip(region, title: region.title)
                }
            }
            // The white fill slides to the chosen chip (from a chip or the figure); under Reduce Motion it moves at once.
            .animation(Motion.movement(Motion.select, reduceMotion), value: selected)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Regions"))
    }

    private func chip(_ region: BodyRegion?, title: String) -> some View {
        let isSelected = selected == region
        let isMarked = region.map(marked.contains) ?? !marked.isEmpty
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
                        .matchedGeometryEffect(id: "selection", in: chips)
                } else {
                    shape.fill(HubStyle.fill)
                        .overlay(shape.strokeBorder(.white.opacity(0.5), lineWidth: 1))
                }
            }
            .padding(.vertical, 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityValue(value(of: region, isMarked: isMarked))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// A marked region says what it holds; "All" names the marked regions.
    private func value(of region: BodyRegion?, isMarked: Bool) -> Text {
        guard isMarked else { return Text(verbatim: "") }
        guard let region else { return Text(BodyRegion.markedList(marked)) }
        return Text(status(region))
    }
}

extension BodyRegion {
    /// "Marked: Head, Blood", in the regions' order, for VoiceOver.
    static func markedList(_ marked: Set<BodyRegion>) -> String {
        let names = allCases.filter(marked.contains).map(\.title).formatted(.list(type: .and))
        return String(localized: "Marked: \(names)")
    }
}

/// The line that sums up the chosen region (or all), by rule (RegionSummary): what is outside a
/// range or the usual, what misses NASA's figures, what is within, what has no current reading.
/// Alerts are never the summary: they have their own rows above it.
private struct TodayLine: View {
    @Environment(AppModel.self) private var model
    /// Every reading of the owner; the line picks the region's.
    let readings: [Reading]
    let region: BodyRegion?
    let blood: BloodReply?

    var body: some View {
        let line = region.map { RegionSummary.line(facts(in: $0)) } ?? RegionSummary.all(BodyRegion.allCases.map(facts))
        if !line.sentences.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: line.warns ? "exclamationmark.triangle.fill" : "circle.fill")
                    .imageScale(line.warns ? .medium : .small)
                    .foregroundStyle(line.warns ? HubStyle.watch : HubStyle.muted)
                    .accessibilityHidden(true)
                Text(line.text)
                    .font(.headline)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        }
    }

    private func facts(in region: BodyRegion) -> [RegionSummary.Fact] {
        let person = model.person
        if region == .blood, let reply = blood, let results = reply.latest[person], !results.isEmpty {
            return results.compactMap { result in
                let entry = reply.entries.first { $0.id == result.id }
                return RegionSummary.fact(result, entry: entry, name: BloodResultRow.name(of: result, entry: entry))
            }
        }
        let limits = model.visibleAlerts.filter { $0.person == person && $0.limit != nil && $0.reason != "room-limit" }
        return readings.filter { $0.region == region }.map { reading in
            RegionSummary.fact(reading, alert: limits.first { $0.signal == reading.signal })
        }
    }
}

/// A card's id, to open its sheet.
private struct CardID: Identifiable {
    let id: String
}

/// The card a card's match names, word for word, or that the phone does not have it.
private struct MatchedCardSheet: View {
    let cardID: String
    let cards: [CardView]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let card = cards.first(where: { $0.id == cardID }) {
                    ScrollView {
                        StepsCardView(card: card)
                            .projectionCard()
                            .padding(24)
                    }
                } else {
                    ContentUnavailableView("This card needs the hub", systemImage: "rectangle.on.rectangle.slash")
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
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
        .environment(SampleData.model(alerts: SampleData.meWarnings))
        .preferredColorScheme(.dark)
}
