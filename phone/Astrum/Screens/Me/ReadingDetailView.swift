// One reading in full: its value and time (or that it is not current), the
// label and source in words, where it sits against the person's usual (median
// and spread), its history, and, where the hub's evidence card says so, what
// it points to, with the reasons as facts. "Points to", never "caused by".

import SwiftUI

struct ReadingDetailView: View {
    @Environment(AppModel.self) private var model
    let signal: String
    @State private var roomRows: [Row]?

    private static let denseWindow: Double = 12 * 3_600_000
    private static let dailyWindow: Double = 14 * 86_400_000

    var body: some View {
        TimelineView(.periodic(from: .now, by: 10)) { context in
            let now = model.hubNow(context.date)
            if let reading = model.readings(now: now).first(where: { $0.signal == signal }) {
                details(reading, now: now)
            } else {
                ContentUnavailableView {
                    Label {
                        Text("No current reading")
                    } icon: {
                        HubIcon(signal: signal, size: 48, relativeTo: .largeTitle)
                    }
                } description: {
                    Text("The hub has not sent this reading.")
                }
            }
        }
        .navigationTitle(Signals.name(signal))
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadRoomHistory() }
    }

    private func details(_ reading: Reading, now: Double) -> some View {
        List {
            ProjectionSection {
                value(reading)
            }
            ProjectionSection {
                usual(reading)
            } header: {
                ProjectionHeader(.dot, "Your usual")
            }
            ProjectionSection {
                history(reading, now: now)
            } header: {
                ProjectionHeader(.clock, "History")
            }
            if let evidence = relevantEvidence(for: reading) {
                ProjectionSection {
                    EvidenceLines(evidence: evidence, now: now)
                } header: {
                    ProjectionHeader(.up, "Where it points")
                }
            }
        }
        .tint(.white)
    }

    // MARK: Parts

    private func value(_ reading: Reading) -> some View {
        let (number, unit) = Signals.display(reading.row)
        return VStack(alignment: .leading, spacing: 8) {
            // Not current: a gap, never the old number in the current value's place.
            if reading.stale {
                Text("No current reading")
                    .font(.title2.weight(.light))
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(number)
                        .font(.largeTitle.weight(.light).monospacedDigit())
                    if !unit.isEmpty {
                        Text(unit).foregroundStyle(.secondary)
                    }
                }
            }
            if reading.stale {
                Text("Not current. Last reading: \(Signals.text(reading.row)) at \(reading.row.date.formatted(date: .abbreviated, time: .shortened)).")
                    .foregroundStyle(.secondary)
            } else {
                Text("At \(reading.row.date.formatted(date: .omitted, time: .shortened))")
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                KindBadge(kind: reading.row.kind)
                Text(Signals.sourceText(reading.row))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text(sentence(reading))
                .font(.headline)
                .padding(.top, 4)
        }
        .accessibilityElement(children: .combine)
    }

    private func sentence(_ reading: Reading) -> String {
        let name = reading.name
        switch reading.standing {
        case .above: return String(localized: "\(name) is above your usual")
        case .below: return String(localized: "\(name) is below your usual")
        case .within: return String(localized: "\(name) is within your usual")
        case .unknown: return String(localized: "\(name): not enough history to compare yet")
        case .notCurrent: return String(localized: "\(name): no current reading")
        case .airOK, .airWatch, .airOver:
            let room = reading.row.room.map { Signals.roomName($0, rooms: model.world.profile?.rooms ?? []) } ?? ""
            return String(localized: "Air in \(room): \(reading.standing.words)")
        }
    }

    @ViewBuilder
    private func usual(_ reading: Reading) -> some View {
        if reading.signal == "co2" {
            Text("NASA's levels: headaches reported from 2.8 mmHg; the 1-hour average is to be no more than 3 mmHg.")
        } else if reading.signal == "exercise_minutes", let value = reading.row.value {
            Text("NASA's crews on the ISS exercise 1.5 hours a day. Today: \(Int(value)) of 90 minutes.")
        }
        switch reading.baseline {
        case .judged(let judged):
            let usual = Signals.text(Row(t: 0, signal: reading.signal, value: judged.usual, unit: reading.row.unit, kind: reading.row.kind, source: ""))
            Text("Usually \(usual), give or take \(Signals.number(judged.spread))")
            Text("Compared with \(judged.baselineCount) earlier readings")
                .foregroundStyle(.secondary)
        case .notEnoughHistory(_, let needed, let have):
            Text("Not enough history to compare yet: \(have) of \(needed) earlier readings.")
                .foregroundStyle(.secondary)
        case .noRecent:
            Text("Nothing recent to compare.")
                .foregroundStyle(.secondary)
        case nil:
            if reading.signal != "co2" {
                Text(model.history.state == .loading ? String(localized: "Loading history…") : String(localized: "History needs the hub"))
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func history(_ reading: Reading, now: Double) -> some View {
        let all = reading.signal == "co2" ? (roomRows ?? []) : model.history.rows(for: reading.signal)
        let daily = reading.baseline?.judged?.daily ?? (all.filter { $0.t > now - Self.denseWindow }.count < 4)
        let from = now - (daily ? Self.dailyWindow : Self.denseWindow)
        let rows = all.filter { $0.t >= from }
        if rows.count < 2 {
            Text(model.isConnected ? String(localized: "Not enough history to draw yet.") : String(localized: "History needs the hub"))
                .foregroundStyle(.secondary)
        } else {
            HistoryChart(
                rows: rows, daily: daily, band: reading.baseline?.judged?.band,
                levels: reading.signal == "co2" ? [Signals.co2HeadacheLevel, Signals.co2Limit] : [],
                unit: reading.row.unit
            )
            .accessibilityLabel(Text("\(reading.name), \(daily ? String(localized: "last 14 days") : String(localized: "last 12 hours"))"))
            Text(daily ? String(localized: "Last 14 days") : String(localized: "Last 12 hours"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    /// The evidence card, when it speaks about this reading.
    private func relevantEvidence(for reading: Reading) -> Evidence? {
        guard let evidence = model.world.evidence[model.person] else { return nil }
        let unusual = evidence.unusual.signals.contains { $0.signal == reading.signal }
        let air = reading.signal == "co2" && evidence.focusRoom != nil
        return unusual || air ? evidence : nil
    }

    private func loadRoomHistory() async {
        guard signal == "co2", let api = model.api, let room = model.world.room(of: model.person) else { return }
        let from = model.hubNow() - Self.denseWindow
        roomRows = try? await api.rows(room: room, signal: "co2", from: from).filter { $0.person == nil }
    }
}

/// The evidence card's conclusion and reasons, in the hub's words.
struct EvidenceLines: View {
    @Environment(AppModel.self) private var model
    let evidence: Evidence
    let now: Double

    var body: some View {
        Text(pointsTo)
            .font(.headline)
        ForEach(Array(evidence.reasons.enumerated()), id: \.offset) { _, reason in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(words(for: reason))
                Spacer(minLength: 0)
                if let kind = reason.kind { KindBadge(kind: kind) }
            }
            .accessibilityElement(children: .combine)
        }
        Text("Where the data points, not a diagnosis.")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private func room(_ id: String?) -> String {
        id.map { Signals.roomName($0, rooms: model.world.profile?.rooms ?? []) } ?? ""
    }

    private var pointsTo: String {
        switch evidence.pointsTo {
        case "room": return String(localized: "Points to the room: \(room(evidence.focusRoom))")
        case "person": return String(localized: "Points to \(model.world.name(of: evidence.person))")
        case "sensor": return String(localized: "Points to the sensor: the reading behind this cannot be trusted")
        default: return String(localized: "Not enough to say where it points")
        }
    }

    private func words(for reason: EvidenceReason) -> String {
        switch reason.code {
        case "exposure-stands-out":
            let hours = ((reason.ms ?? 0) / 3_600_000).formatted(.number.precision(.fractionLength(0...1)))
            return String(localized: "\(hours) h above \(Signals.number(reason.level ?? 0)) mmHg, more than any crewmate")
        case "crewmates-same":
            return String(localized: "Crewmates in the same room show the same")
        case "crewmates-normal":
            return String(localized: "Crewmates in the same room are normal")
        case "sensor":
            guard let problem = reason.problem else { return "" }
            let place = room(problem.room)
            let signal = Signals.name(problem.signal)
            switch problem.problem {
            case "no-reading": return String(localized: "\(place): no reading of \(signal)")
            case "stale":
                let minutes = Int(((now - (problem.t ?? now)) / 60_000).rounded())
                return String(localized: "\(place): last reading of \(signal) \(minutes) minutes ago")
            case "stuck": return String(localized: "\(place): the \(signal) sensor may be stuck")
            default: return String(localized: "\(place): two sensors disagree on \(signal)")
            }
        default:
            return reason.code
        }
    }
}

#Preview {
    NavigationStack {
        ReadingDetailView(signal: "heart_rate")
    }
    .environment(SampleData.model())
    .preferredColorScheme(.dark)
}
