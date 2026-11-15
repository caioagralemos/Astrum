// Earth, on Station, under the Earth widget (which shows the delay):
// "Contact Earth", and every message still listed, each counting down to its
// arrival and to the earliest reply.
// The only reply there can be is the hub's simulated one, marked as simulated
// (by AI, or the hub's fixed sentence). An alert's message carries the incident
// report the hub filed with it: a row opens it (IncidentReportLink).

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
                        if let label = message.simulatedLabel {
                            Text(label).font(.caption).foregroundStyle(HubStyle.muted)
                        } else if reply.simulated { KindBadge(kind: .simulated) }
                    }
                    Text(reply.key == "earth.simReply" ? String(localized: "Houston: message received. Your flight surgeon is reviewing it. (Simulated reply: there is no ground station in this demo.)") : reply.shownText)
                        .font(.footnote)
                }
                .padding(.top, 2)
            } else {
                let countdown = now >= message.replyAt
                    ? String(localized: "A reply can be here now")
                    : String(localized: "A reply can be back in \(Countdown.minutes(ms: message.replyAt - now))")
                Text(message.simulatedDelay == true ? "\(countdown) · \(String(localized: "simulated delay"))" : countdown)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if message.resolvedAt != nil {
                Text("The alert has ended; the reply is still on its way.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            }
            .accessibilityElement(children: .combine)
            if let report = message.report { IncidentReportLink(report: report) }
        }
        .padding(.vertical, 4)
    }

    private var title: String {
        if message.kind == "crew" {
            return String(localized: "From \(model.world.name(of: message.from ?? message.about.person))")
        }
        return String(localized: "Automatic message about \(model.world.name(of: message.about.person)): \(Signals.name(message.about.signal))")
    }
}

/// "Incident report sent to Earth": a row that opens the report, read-only.
struct IncidentReportLink: View {
    let report: IncidentReport
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 6) {
                Text("Incident report sent to Earth").multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").imageScale(.small).accessibilityHidden(true)
            }
            .font(.footnote.weight(.semibold))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Opens the report"))
        .sheet(isPresented: $open) { IncidentReportView(report: report) }
    }
}

/// The hub's incident report, in its sections: When, Where, Who, Readings, Timeline, Card, Crew told.
/// Every reading is one element (value, unit, kind, limit); nothing here can be changed.
struct IncidentReportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let report: IncidentReport

    var body: some View {
        NavigationStack {
            Form {
                if let summary = report.summary {
                    Text(summary).font(.subheadline).projectionRow()
                }
                if report.restricted == true {
                    Text("Private alert: the report keeps to what its message to Earth already says.")
                        .font(.footnote).foregroundStyle(HubStyle.muted).projectionRow()
                }
                section("When") {
                    Text(when)
                }
                section("Where") {
                    Text(report.where?.roomName ?? "—")
                }
                section("Who") {
                    Text(report.who?.name ?? report.who?.person.map { model.world.name(of: $0) } ?? "—")
                }
                if report.restricted != true {
                    section("Readings") {
                        let rows = (report.readings ?? []) + (report.bodyReadings ?? [])
                        if rows.isEmpty { Text("None in the report").foregroundStyle(HubStyle.muted) }
                        ForEach(rows) { reading in
                            ReadingRow(reading: reading)
                        }
                    }
                }
                section("Timeline") {
                    ForEach(Array((report.timeline ?? []).enumerated()), id: \.offset) { _, entry in
                        (Text(Self.clock(entry.at)).font(.footnote.monospacedDigit()).foregroundStyle(HubStyle.muted)
                         + Text(verbatim: "  ") + Text(entry.event))
                            .accessibilityElement(children: .combine)
                    }
                }
                section("Card") {
                    Text(report.card?.title ?? String(localized: "None in the report"))
                }
                section("Crew told") {
                    Text(told)
                }
            }
            .tint(.white)
            .navigationTitle("Incident report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func section<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        ProjectionSection {
            content()
        } header: {
            Text(title).foregroundStyle(.white).textCase(nil).accessibilityAddTraits(.isHeader)
        }
    }

    private var when: String {
        var parts: [String] = []
        if let at = report.filedAt { parts.append(String(localized: "Filed \(Self.clock(at))")) }
        if let day = report.missionDay { parts.append(String(localized: "mission day \(day)")) }
        if let level = report.alert?.level { parts.append(String(localized: "level \(level)")) }
        return parts.isEmpty ? "—" : parts.joined(separator: ", ")
    }

    private var told: String {
        let names = (report.crewTold ?? []).map { $0 == "everyone" ? String(localized: "Everyone") : model.world.name(of: $0) }
        return names.isEmpty ? "—" : names.joined(separator: ", ")
    }

    private static func clock(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .shortened)
    }

    private struct ReadingRow: View {
        let reading: IncidentReport.Reading

        var body: some View {
            let unit = reading.unit ?? ""
            let value = reading.value.map { [Signals.number($0), unit].filter { !$0.isEmpty }.joined(separator: " ") } ?? "—"
            let kind = reading.kind.flatMap(Kind.init(rawValue:)).map(Signals.kindName)
            let limit = reading.limit.map { String(localized: "Limit \([Signals.number($0), unit].filter { !$0.isEmpty }.joined(separator: " "))") }
            VStack(alignment: .leading, spacing: 2) {
                Text(reading.name ?? reading.signal).font(.footnote).foregroundStyle(HubStyle.muted)
                Text([value, kind, limit].compactMap { $0 }.joined(separator: " · "))
                    .font(.body.monospacedDigit())
                if reading.stale == true {
                    Text("stale").font(.caption).foregroundStyle(HubStyle.muted)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}
