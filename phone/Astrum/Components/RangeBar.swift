// A thin bar showing where a value sits: against the person's own usual
// range (a lighter band), against NASA's CO2 marks (2.8 and 3), or toward a
// daily target (exercise against NASA's 1.5 hours). Decorative: the row says
// the same in words for VoiceOver.

import SwiftUI

struct RangeBar: View, Animatable {
    enum Scale: Hashable {
        /// The usual band within the bar's extent.
        case usual(band: ClosedRange<Double>)
        /// Marks at fixed levels, the last one the limit.
        case marks([Double], extent: ClosedRange<Double>)
        /// Filled toward a target.
        case target(Double)
    }

    var value: Double
    let scale: Scale
    var marked = false

    /// The dot (or the filled length) glides to a new value.
    nonisolated var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Canvas { context, size in
            let mid = size.height / 2
            let track = Path(roundedRect: CGRect(x: 0, y: mid - 1, width: size.width, height: 2), cornerRadius: 1)
            context.fill(track, with: .color(.white.opacity(0.12)))

            let extent = extent
            func x(_ v: Double) -> CGFloat {
                let f = (v - extent.lowerBound) / max(extent.upperBound - extent.lowerBound, .ulpOfOne)
                return CGFloat(min(1, max(0, f))) * size.width
            }

            switch scale {
            case .usual(let band):
                let rect = CGRect(x: x(band.lowerBound), y: mid - 3, width: x(band.upperBound) - x(band.lowerBound), height: 6)
                context.fill(Path(roundedRect: rect, cornerRadius: 3), with: .color(.white.opacity(0.35)))
            case .marks(let levels, _):
                for level in levels {
                    context.fill(Path(CGRect(x: x(level) - 0.5, y: 0, width: 1, height: size.height)), with: .color(.white.opacity(0.6)))
                }
            case .target(let target):
                let rect = CGRect(x: 0, y: mid - 2, width: x(min(value, target)), height: 4)
                context.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(.white.opacity(0.8)))
                context.fill(Path(CGRect(x: size.width - 1, y: 0, width: 1, height: size.height)), with: .color(.white.opacity(0.6)))
                return
            }

            let dot = CGRect(x: x(value) - 4, y: mid - 4, width: 8, height: 8)
            context.fill(Path(ellipseIn: dot), with: .color(marked ? HubStyle.watch : .white))
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }

    /// The bar with its value change animated (none under Reduce Motion), scoped to the value.
    var animated: some View {
        RangeBarMotion(bar: self)
    }

    private var extent: ClosedRange<Double> {
        switch scale {
        case .usual(let band):
            let width = max(band.upperBound - band.lowerBound, .ulpOfOne)
            let low = min(band.lowerBound - width / 2, value)
            let high = max(band.upperBound + width / 2, value)
            return low...high
        case .marks(_, let extent):
            return extent
        case .target(let target):
            return 0...target
        }
    }
}

private struct RangeBarMotion: View {
    let bar: RangeBar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        bar.animation(Motion.movement(Motion.content, reduceMotion), value: bar.value)
    }
}

extension RangeBar {
    /// The bar a reading gets, or nil when there is nothing to place it against.
    init?(reading: Reading) {
        // Not current: nothing to place against the usual or NASA's levels.
        guard !reading.stale, let value = reading.row.value else { return nil }
        if reading.signal == "co2" {
            self.init(value: value, scale: .marks([Signals.co2HeadacheLevel, Signals.co2Limit], extent: 1.5...4.5), marked: reading.isMarked)
        } else if reading.signal == "exercise_minutes" {
            self.init(value: value, scale: .target(Signals.exerciseTargetMinutes))
        } else if let band = reading.baseline?.judged?.band {
            self.init(value: value, scale: .usual(band: band), marked: reading.isMarked)
        } else {
            return nil
        }
    }
}
