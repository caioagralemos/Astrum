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
                    .font(.body.monospacedDigit().weight(.medium))
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

    private var name: String {
        if let entry { return Locale.current.language.languageCode?.identifier == "pt" ? entry.name.pt : entry.name.en }
        return Signals.name(result.id)
    }

    private var judgement: String {
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
