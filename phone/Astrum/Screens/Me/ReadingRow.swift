// One reading in Me's list: the hub's icon for it, name, value with unit, the bar against the
// person's usual, the label, and a badge in words when it is outside the
// usual, part of an alert, or not current. VoiceOver reads it as one sentence.

import SwiftUI

struct ReadingRow: View {
    let reading: Reading

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    name
                    Spacer(minLength: 8)
                    value
                }
                VStack(alignment: .leading, spacing: 4) {
                    name
                    value
                }
            }
            if let bar = RangeBar(reading: reading) {
                bar
            }
            HStack(spacing: 8) {
                KindBadge(kind: reading.row.kind)
                if let badge = reading.standing.badge {
                    StatusBadge(text: badge, tone: reading.standing == .airOver ? .danger : .watch,
                                trend: reading.standing == .above ? .up : reading.standing == .below ? .down : nil)
                }
                if reading.inAlert && reading.standing.badge == nil {
                    StatusBadge(text: String(localized: "Part of an alert"))
                }
                if reading.stale {
                    Text("Not current · \(reading.row.date.formatted(date: .omitted, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(HubStyle.muted)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(reading.spoken))
    }

    private var name: some View {
        HStack(spacing: 8) {
            HubIcon(signal: reading.signal)
            Text(reading.name)
                .font(.body)
        }
    }

    private var value: some View {
        let (number, unit) = Signals.display(reading.row)
        return HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(number)
                .font(.title3.weight(.light).monospacedDigit())
            if !unit.isEmpty {
                Text(unit)
                    .font(.footnote)
                    .foregroundStyle(HubStyle.muted)
            }
        }
        .foregroundStyle(reading.stale ? HubStyle.faint : .white)
    }
}
