// Astra's mark (hub/ui/src/AstraMark.tsx): three of the brand mark's ring,
// crossed about one centre 60° apart (the logo's tilt, then 120° and 240° on),
// with one light running through all three as one closed route: along a ring
// round its tip, on to the next where they cross near the centre, and round.
// Drawn by HubLoadingMark's own ring and light. At rest the light holds still
// at the top tip as a short bright segment; ready, it makes a slow lap of the
// route; working, a fast one, on the clock every copy shares. With Reduce
// Motion it holds still at the top tip and the words beside it carry the
// state. Small, the bands are thickened so they never become hairlines.
// Decorative: the text next to it says what is happening.

import SwiftUI
import UIKit

struct AstraMark: View {
    enum Activity { case rest, ready, working }

    /// The mark's width (and height) in points.
    var width: CGFloat = 28
    var activity: Activity = .rest
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let seconds = Self.lapSeconds(activity), !reduceMotion {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in
                        Self.draw(context, size: size, lap: HubLoadingMark.lap(at: timeline.date, seconds: seconds), rest: false)
                    }
                }
            } else {
                Canvas { context, size in Self.draw(context, size: size, lap: 0, rest: activity == .rest) }
            }
        }
        .frame(width: width, height: width)
        .accessibilityHidden(true)
    }

    // MARK: Geometry (route worked out in /private/tmp/astra3/route.py)

    /// Each ring's tilt, in the order the light visits them.
    private static let tilts: [Double] = [142.38, 262.38, 22.38]
    /// Each ring carries the stretch from this far before its tip to this far after (radians on the orbit
    /// circle). At each hand-over the light turns 58°, the least any route allows.
    private static let half = 1.46331
    /// One ring's stretch, out of a whole orbit's 100; the route is three of them.
    private static let segment = half / Double.pi * 100
    private static let route = 3 * segment
    /// The three rings fit a square this far out from the centre, before growing.
    private static let reach: CGFloat = 54

    /// Seconds per trip round the whole route: the working pace is the loading light's, ready a third of it.
    private static func lapSeconds(_ activity: Activity) -> Double? {
        switch activity {
        case .rest: nil
        case .ready: 7.5
        case .working: 2.5
        }
    }

    // MARK: Drawing

    /// The band's narrowest part stays about this wide, in points.
    private static let minimumBand: CGFloat = 1.75
    /// The logo's ring at its narrowest: 10.01 out, 6.76 in.
    private static let band: CGFloat = 10.01 - 6.76

    private static func grow(forWidth width: CGFloat) -> CGFloat {
        max(0, (minimumBand * 2 * reach / width - band) / 2)
    }

    static func draw(_ context: GraphicsContext, size: CGSize, lap: Double, rest: Bool) {
        let grow = grow(forWidth: size.width)
        let box = 2 * (reach + grow)
        var mark = context
        let scale = min(size.width, size.height) / box
        mark.translateBy(x: size.width / 2, y: size.height / 2)
        mark.scaleBy(x: scale, y: scale)

        let ring = HubLoadingMark.ring(grow: grow)
        let width = HubLoadingMark.lightWidth + 2 * grow / HubLoadingMark.flatten
        // The rings as one shape, so where they cross is no brighter; small, at the logo's 60%.
        mark.drawLayer { rings in
            rings.opacity = size.width < 32 ? 0.6 : 0.35
            for tilt in tilts {
                var frame = rings
                frame.rotate(by: .degrees(tilt))
                frame.fill(ring, with: .foreground, style: FillStyle(eoFill: true))
            }
        }
        let head = route / 2 + lap * route
        for (k, tilt) in tilts.enumerated() {
            var frame = mark
            frame.rotate(by: .degrees(tilt))
            frame.drawLayer { glowLayer in
                glowLayer.addFilter(.blur(radius: HubLoadingMark.glowBlur))
                HubLoadingMark.drawLight(glowLayer, band: ring, width: width, pieces: pieces(HubLoadingMark.glow, head: head, ring: k), ink: .foreground)
            }
            HubLoadingMark.drawLight(frame, band: ring, width: width,
                                     pieces: pieces(rest ? HubLoadingMark.core : HubLoadingMark.light, head: head, ring: k), ink: .foreground)
        }
    }

    /// The parts of the light's spans (round `head` on the route) that fall on ring `k`'s stretch,
    /// as stretches of that ring's orbit circle.
    private static func pieces(_ spans: [(from: Double, to: Double, opacity: Double)], head: Double, ring k: Int) -> [(start: Double, length: Double, opacity: Double)] {
        let low = Double(k) * segment, high = low + segment
        let first = -half / (2 * Double.pi)
        var out: [(start: Double, length: Double, opacity: Double)] = []
        for span in spans {
            for shift in [-route, 0, route] {
                let from = max(head + span.from + shift, low), to = min(head + span.to + shift, high)
                if to > from { out.append((first + (from - low) / 100, (to - from) / 100, span.opacity)) }
            }
        }
        return out
    }

    /// The mark at rest as a template image, for the Ask Astra tab.
    @MainActor static let tabImage: UIImage = {
        let renderer = ImageRenderer(content: AstraMark(width: 25))
        renderer.scale = 3
        return (renderer.uiImage ?? UIImage()).withRenderingMode(.alwaysTemplate)
    }()
}

#Preview("Astra's mark") {
    VStack(spacing: 24) {
        AstraMark(width: 20)
        AstraMark(width: 28, activity: .ready)
        AstraMark(width: 28, activity: .working)
        AstraMark(width: 112, activity: .working)
    }
    .padding()
    .preferredColorScheme(.dark)
}
