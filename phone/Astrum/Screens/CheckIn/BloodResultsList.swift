// The owner's newest blood results from /api/blood, each with its label and
// the hub's comparison with the medical lead's entry. No range is invented:
// without an entry it says so.

import SwiftUI

struct BloodResultsList: View {
    let reply: BloodReply?
    let person: String

    var body: some View {
        if let reply {
            let results = reply.latest[person] ?? []
            if results.isEmpty {
                Text("No blood test yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(results) { result in
                    BloodResultRow(result: result, entry: reply.entries.first { $0.id == result.id })
                }
            }
        } else {
            Text("Blood tests need the hub.")
                .foregroundStyle(.secondary)
        }
    }
}

struct BloodResultRow: View {
    let result: BloodResult
    let entry: BloodEntry?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(name)
                Spacer(minLength: 8)
                Text(Signals.text(result.row))
                    .font(.body.monospacedDigit().weight(.light))
            }
            HStack(spacing: 8) {
                KindBadge(kind: result.row.kind)
                Text(judgement)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(verbatim: "\(Signals.sourceText(result.row)) · \(result.row.date.formatted(date: .abbreviated, time: .omitted))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var name: String { Self.name(of: result, entry: entry) }

    static func name(of result: BloodResult, entry: BloodEntry?) -> String {
        if let entry { return Locale.current.language.languageCode?.identifier == "pt" ? entry.name.pt : entry.name.en }
        // Without the hub's entry: the blood signal's own name (blood.<id>, _ for -), never the id.
        return Signals.name("blood." + result.id.replacingOccurrences(of: "-", with: "_"))
    }

    private var judgement: String { Self.judgement(of: result, entry: entry) }

    static func judgement(of result: BloodResult, entry: BloodEntry?) -> String {
        if !result.unitMatches && entry != nil { return String(localized: "Recorded in \(result.row.unit); not compared") }
        switch result.judgement {
        case "in-range": return String(localized: "Within range")
        case "below": return String(localized: "Below range")
        case "above": return String(localized: "Above range")
        case "urgent-below": return String(localized: "Far below range: urgent")
        case "urgent-above": return String(localized: "Far above range: urgent")
        default: return String(localized: "No range set yet")
        }
    }
}

/// One blood result in full, opened from a blood warning on Me: the value with its unit and
/// label, the medical lead's range and which side of it the value is on, when and how it was
/// entered, and earlier results of the same analyte the phone has.
struct BloodResultDetailView: View {
    @Environment(AppModel.self) private var model
    /// "blood.<id>", _ for -.
    let signal: String
    let reply: BloodReply?

    var body: some View {
        let id = String(signal.dropFirst("blood.".count)).replacingOccurrences(of: "_", with: "-")
        let result = reply?.latest[model.person]?.first { $0.id == id }
        let entry = reply?.entries.first { $0.id == id }
        let earlier = model.history.rows(for: signal).filter { $0.t != result?.row.t }.sorted { $0.t > $1.t }
        Group {
            if let result {
                List {
                    ProjectionSection { value(result, entry: entry) }
                    if !earlier.isEmpty {
                        ProjectionSection {
                            ForEach(earlier, id: \.t) { row in
                                HStack {
                                    Text(row.date.formatted(date: .abbreviated, time: .shortened))
                                        .foregroundStyle(.secondary)
                                    Spacer(minLength: 8)
                                    Text(Signals.text(row)).monospacedDigit()
                                }
                                .accessibilityElement(children: .combine)
                            }
                        } header: {
                            ProjectionHeader(.clock, "Earlier results")
                        }
                    }
                }
                .tint(.white)
            } else if let last = earlier.first {
                ContentUnavailableView {
                    Label { Text("No latest result from the hub") } icon: { HubIcon(signal: signal, size: 48, relativeTo: .largeTitle) }
                } description: {
                    Text("Last result: \(Signals.text(last)) on \(last.date.formatted(date: .abbreviated, time: .shortened)).")
                }
            } else {
                ContentUnavailableView(reply == nil ? String(localized: "Blood tests need the hub.") : String(localized: "No blood test yet."),
                                       systemImage: "drop")
            }
        }
        .navigationTitle(Signals.name(signal))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func value(_ result: BloodResult, entry: BloodEntry?) -> some View {
        let (number, unit) = Signals.display(result.row)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(number).font(.largeTitle.weight(.light).monospacedDigit())
                if !unit.isEmpty { Text(unit).foregroundStyle(.secondary) }
            }
            Text(BloodResultRow.judgement(of: result, entry: entry))
                .font(.headline)
            if let range = entry?.reference_range, let words = Self.range(range, unit: entry?.unit ?? "") {
                Text(words).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                KindBadge(kind: result.row.kind)
                Text(verbatim: "\(Signals.sourceText(result.row)) · \(result.row.date.formatted(date: .abbreviated, time: .shortened))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// "The medical lead's range: 70 to 105 mg/dL."
    private static func range(_ range: BloodEntry.Range, unit: String) -> String? {
        switch (range.low, range.high) {
        case let (low?, high?): String(localized: "The medical lead's range: \(Signals.number(low)) to \(Signals.number(high)) \(unit).")
        case let (low?, nil): String(localized: "The medical lead's range: from \(Signals.number(low)) \(unit).")
        case let (nil, high?): String(localized: "The medical lead's range: up to \(Signals.number(high)) \(unit).")
        default: nil
        }
    }
}
