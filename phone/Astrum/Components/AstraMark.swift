// Astra's mark: the orbit light of the brand mark, the ring alone without the
// cross, at the logo's own tilt and proportions (hub/ui/src/AstraMark.tsx).
// Drawn by HubLoadingMark's own code. Idle, the light rests as a short bright
// segment; working, it runs one lap every 1.8 s on the clock every copy shares.
// With Reduce Motion it stands still and the words beside it carry the state.
// Small, the band is thickened so it never becomes a hairline. Decorative:
// the text next to it says what is happening.

import SwiftUI
import UIKit

struct AstraMark: View {
    /// The mark's width in points.
    var width: CGFloat = 28
    var working = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if working && !reduceMotion {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in
                        Self.draw(context, size: size, lap: HubLoadingMark.lap(at: timeline.date), rest: false)
                    }
                }
            } else {
                Canvas { context, size in Self.draw(context, size: size, lap: 0, rest: !working) }
            }
        }
        .frame(width: width, height: width * Self.box.height / Self.box.width)
        .accessibilityHidden(true)
    }

    // MARK: Drawing

    /// The band's narrowest part stays about this wide, in points.
    private static let minimumBand: CGFloat = 1.75
    /// The logo's ring at its narrowest: 10.01 out, 6.76 in.
    private static let band: CGFloat = 10.01 - 6.76

    /// The grown ring overflows the logo's box by `grow` on each side; the box grows with it.
    private static func grow(forWidth width: CGFloat) -> CGFloat {
        max(0, (minimumBand * HubLoadingMark.box.width / width - band) / 2)
    }

    private static let box = HubLoadingMark.box

    static func draw(_ context: GraphicsContext, size: CGSize, lap: Double, rest: Bool) {
        let grow = grow(forWidth: size.width)
        let outer = CGSize(width: box.width + 2 * grow, height: box.height + 2 * grow)
        var mark = context
        let scale = min(size.width / outer.width, size.height / outer.height)
        mark.translateBy(x: (size.width - outer.width * scale) / 2, y: (size.height - outer.height * scale) / 2)
        mark.scaleBy(x: scale, y: scale)
        mark.translateBy(x: grow, y: grow)
        HubLoadingMark.drawOrbit(mark, lap: lap, grow: grow, rest: rest, ink: .foreground)
    }

    /// The mark at rest as a template image, for the Ask Astra tab.
    @MainActor static let tabImage: UIImage = {
        let renderer = ImageRenderer(content: AstraMark(width: 28))
        renderer.scale = 3
        return (renderer.uiImage ?? UIImage()).withRenderingMode(.alwaysTemplate)
    }()
}

#Preview("Astra's mark") {
    VStack(spacing: 24) {
        AstraMark(width: 20)
        AstraMark(width: 28)
        AstraMark(width: 28, working: true)
        AstraMark(width: 112, working: true)
    }
    .padding()
    .preferredColorScheme(.dark)
}
