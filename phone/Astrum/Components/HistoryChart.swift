// A reading's history: a line over the last 12 hours, or points over the
// last 14 days for a daily value (the windows the hub's person view uses),
// with the person's usual range as a band or NASA's levels as rules.

import Charts
import SwiftUI

struct HistoryChart: View {
    let rows: [Row]
    let daily: Bool
    var band: ClosedRange<Double>? = nil
    var levels: [Double] = []
    let unit: String
    /// False until the chart first appears; it then draws in from the left (fades in under Reduce Motion), once.
    @State private var revealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Chart {
            if let band, let first = rows.first, let last = rows.last {
                RectangleMark(
                    xStart: .value("From", first.date), xEnd: .value("To", last.date),
                    yStart: .value("Usual low", band.lowerBound), yEnd: .value("Usual high", band.upperBound)
                )
                .foregroundStyle(.white.opacity(0.07))
            }
            ForEach(levels, id: \.self) { level in
                RuleMark(y: .value("NASA level", level))
                    .foregroundStyle(HubStyle.faint)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, alignment: .leading) {
                        Text("NASA \(Signals.number(level)) \(unit)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
            }
            ForEach(rows, id: \.self) { row in
                if let value = row.value {
                    if daily {
                        PointMark(x: .value("Time", row.date), y: .value("Value", value))
                            .foregroundStyle(.white)
                    } else {
                        LineMark(x: .value("Time", row.date), y: .value("Value", value))
                            .foregroundStyle(.white)
                            .interpolationMethod(.monotone)
                    }
                }
            }
        }
        .chartYScale(domain: .automatic(includesZero: false))
        .frame(minHeight: 180)
        .mask(alignment: .leading) {
            GeometryReader { proxy in
                Rectangle().frame(width: revealed || reduceMotion ? proxy.size.width : 0)
            }
        }
        .opacity(revealed || !reduceMotion ? 1 : 0)
        .onAppear {
            guard !revealed else { return }
            withAnimation(Motion.reduced(Motion.reveal, reduceMotion)) { revealed = true }
        }
    }
}
