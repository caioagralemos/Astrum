// The hub dock's personal widgets on Me (hub/ui/src/dock/widgets.tsx): sleep
// last night, exercise today and CO2 exposure. The dock shows every crewmate
// on a shared screen; the phone shows only its owner. Each is there only while
// the hub has a current value for it, and opens the same detail as its row.

import SwiftUI

@MainActor
enum MeWidgets {
    /// The widgets the owner has data for, in order, in the region (nil: all); empty when there are none.
    static func items(readings: [Reading], world: HubWorld, person: String, region: BodyRegion?) -> [WidgetGrid.Item] {
        let all = allItems(readings: readings, world: world, person: person)
        guard let region else { return all }
        // Sleep is the head's, exercise the body's, CO2 exposure the air's.
        let regions: [String: BodyRegion] = ["sleep": .head, "exercise": .body, "exposure": .lungs]
        return all.filter { regions[$0.id] == region }
    }

    private static func allItems(readings: [Reading], world: HubWorld, person: String) -> [WidgetGrid.Item] {
        func current(_ signal: String) -> Reading? {
            readings.first { $0.signal == signal && !$0.stale && $0.row.value != nil }
        }
        var items: [WidgetGrid.Item] = []
        if let sleep = current("sleep_duration") {
            items.append(.init("sleep") { SleepWidget(reading: sleep) })
        }
        if let exercise = current("exercise_minutes") {
            items.append(.init("exercise") { ExerciseWidget(reading: exercise) })
        }
        if let exposure = ExposureWidget.Hours(evidence: world.evidence[person], person: person) {
            let opens = readings.contains { $0.signal == "co2" }
            items.append(.init("exposure") { ExposureWidget(hours: exposure, opensDetail: opens) })
        }
        return items
    }
}

/// The detail screens open on Me, so a widget can open one without being a link.
@MainActor @Observable
final class ReadingRouter {
    var path: [String] = []
    /// The widget a detail was opened from, so that detail zooms out of its card; nil from a row.
    var zoomSource: String?
}

extension EnvironmentValues {
    /// Me's namespace for the zoom from a widget card into its detail.
    @Entry var zoomNamespace: Namespace.ID?
}

/// A detail that zooms out of the widget it was opened from, or pushes plainly.
struct ZoomDestination<Content: View>: View {
    /// Fixed when the detail first opens, so its way back matches its way in.
    @State private var zooms: Bool
    let sourceID: String
    let namespace: Namespace.ID
    @ViewBuilder let content: Content

    init(zooms: Bool, sourceID: String, namespace: Namespace.ID, @ViewBuilder content: () -> Content) {
        _zooms = State(initialValue: zooms)
        self.sourceID = sourceID
        self.namespace = namespace
        self.content = content()
    }

    var body: some View {
        if zooms {
            content.navigationTransition(.zoom(sourceID: sourceID, in: namespace))
        } else {
            content
        }
    }
}

/// A widget that opens a reading's detail, as its row in the list does.
private struct DetailLink<Content: View>: View {
    let signal: String
    let spoken: String
    @ViewBuilder let content: Content
    @Environment(ReadingRouter.self) private var router
    @Environment(\.zoomNamespace) private var zoom

    var body: some View {
        // A button, not a NavigationLink: inside a List a link draws a disclosure arrow beside the card.
        Button {
            router.zoomSource = signal
            router.path.append(signal)
        } label: {
            content
        }
            .buttonStyle(.pressable)
            .modifier(ZoomSource(id: signal, namespace: zoom))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(spoken))
            .accessibilityAddTraits(.isButton)
    }
}

/// Marks a card as where its detail zooms out from, when Me provides the namespace.
private struct ZoomSource: ViewModifier {
    let id: String
    let namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let namespace {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

// MARK: Sleep

private struct SleepWidget: View {
    let reading: Reading

    var body: some View {
        let minutes = reading.row.value ?? 0
        DetailLink(signal: reading.signal, spoken: spoken) {
            WidgetCard(icon: .moon, title: String(localized: "Sleep last night"), kinds: [reading.row.kind]) {
                BigNumber("\(Int(minutes) / 60):\(String(format: "%02d", Int(minutes.rounded()) % 60))")
            }
        }
    }

    private var spoken: String {
        [String(localized: "Sleep last night"), Signals.text(reading.row), Signals.kindName(reading.row.kind)].joined(separator: ", ")
    }
}

// MARK: Exercise

private struct ExerciseWidget: View {
    let reading: Reading

    var body: some View {
        let minutes = reading.row.value ?? 0
        DetailLink(signal: reading.signal, spoken: spoken) {
            WidgetCard(icon: .dumbbell, title: String(localized: "Exercise today"), kinds: [reading.row.kind]) {
                VStack(alignment: .leading, spacing: 6) {
                    BigNumber("\(Int(minutes.rounded()))′")
                    WidgetTrack(fraction: minutes / Signals.exerciseTargetMinutes)
                    Text("of NASA's 90 minutes a day")
                        .font(.caption)
                        .foregroundStyle(HubStyle.muted)
                }
            }
        }
    }

    private var spoken: String {
        [String(localized: "Exercise today"), Signals.text(reading.row), String(localized: "of NASA's 90 minutes a day"),
         Signals.kindName(reading.row.kind)].joined(separator: ", ")
    }
}

// MARK: CO2 exposure

/// Hours the owner spent at or above NASA's 2.8 mmHg over the evidence card's longest window.
private struct ExposureWidget: View {
    struct Hours {
        let window: Double
        let hours: Double
        let kind: Kind

        /// Nil when the hub's card has no window, or no label for the owner's time in it.
        init?(evidence: Evidence?, person: String) {
            guard let window = evidence?.whereBeen?.windows.max(by: { $0.ms < $1.ms }),
                  let mine = window.people.first(where: { $0.person == person }),
                  let kind = mine.kind else { return nil }
            self.window = window.ms / 3_600_000
            self.hours = (mine.above.first { $0.level == Signals.co2HeadacheLevel }?.ms ?? 0) / 3_600_000
            self.kind = kind
        }
    }

    let hours: Hours
    let opensDetail: Bool

    var body: some View {
        let title = String(localized: "CO2 exposure, \(Int(hours.window.rounded())) h")
        let what = String(localized: "Hours you spent at or above \(Signals.number(Signals.co2HeadacheLevel)) mmHg")
        let value = hours.hours.formatted(.number.precision(.fractionLength(1)))
        let card = WidgetCard(icon: .exposure, title: title, kinds: [hours.kind]) {
            VStack(alignment: .leading, spacing: 6) {
                BigNumber(value, unit: "h", color: hours.hours > 0 ? HubStyle.watch : .white)
                Text(what)
                    .font(.caption)
                    .foregroundStyle(HubStyle.muted)
            }
        }
        let spoken = [title, String(localized: "\(value) hours"), what, Signals.kindName(hours.kind)].joined(separator: ", ")
        if opensDetail {
            DetailLink(signal: "co2", spoken: spoken) { card }
        } else {
            card
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(spoken))
        }
    }
}
