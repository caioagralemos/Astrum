// The hub's loading mark (hub/ui/src/Loading.tsx and loading.css): the brand
// mark with a light running round its orbit, one lap every 1.8 s. Drawn from
// the same path data, in the same order: the ring, the light's blurred glow,
// the light, then the cross on top. Every copy reads one clock, so a copy
// taking over carries on where the last one was. With Reduce Motion the light
// stands still where the web's does (its head at the half-way point).
// Decorative: the words next to it say what is happening.

import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct HubLoadingMark: View {
    /// The mark's width in points; the hub's loading screen uses 112.
    var width: CGFloat = 112
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.previewReduceMotion) private var previewReduceMotion

    var body: some View {
        Group {
            if reduceMotion || previewReduceMotion {
                Canvas { context, size in Self.draw(context, size: size, lap: 0) }
            } else {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in Self.draw(context, size: size, lap: Self.lap(at: timeline.date)) }
                }
            }
        }
        .frame(width: width, height: width * Self.box.height / Self.box.width)
        .accessibilityHidden(true)
    }

    // MARK: The mark, as in hub/ui/public/brand/mark.svg

    static let box = CGSize(width: 88, height: 68)
    private static let cross = [
        "M34 11C34 7.13401 37.134 4 41 4H47C50.866 4 54 7.13401 54 11V57C54 60.866 50.866 64 47 64H41C37.134 64 34 60.866 34 57V11Z",
        "M67 24C70.866 24 74 27.134 74 31V37C74 40.866 70.866 44 67 44H21C17.134 44 14 40.866 14 37V31C14 27.134 17.134 24 21 24H67Z",
    ].map(SVGPath.parse)
    /// The ring in its own frame (moved to the centre, turned to its tilt), where it is an ellipse band.
    private static let ring = SVGPath.parse(
        "M-53.56 0a53.56 10.01 0 1 0 107.12 0a53.56 10.01 0 1 0 -107.12 0ZM-36.44 0a36.44 6.76 0 1 0 72.88 0a36.44 6.76 0 1 0 -72.88 0Z")
    private static let ringCentre = CGPoint(x: 43.33, y: 33.8)
    private static let ringTilt = Angle.degrees(142.38)

    // MARK: The light

    /// Squashed back to a circle, the band is a ring 45 out and 17 wide: the light
    /// runs round that circle at an even pace, which reads as an orbit seen at a tilt.
    private static let flatten: CGFloat = 0.1869
    private static let orbit: CGFloat = 45
    private static let lightWidth: CGFloat = 18
    /// Spans of the orbit (out of 100) around the head at 50, with their opacity:
    /// a long faint tail behind, a bright core, a short soft edge ahead.
    private static let light: [(from: Double, to: Double, opacity: Double)] = [
        (-40, 0, 0.08), (-30, 0, 0.1), (-22, 0, 0.13), (-15, 0, 0.17), (-9, 0, 0.24), (-4.5, 0.5, 0.4),
        (-2, 1, 0.8), (0, 2, 0.35), (0, 3.2, 0.15),
    ]
    /// A blurred copy of the head, so it glows a little past the edges of the band.
    private static let glow: [(from: Double, to: Double, opacity: Double)] = [(-10, 0, 0.35), (-4, 1.5, 0.7)]
    private static let glowBlur: CGFloat = 1.6
    private static let head: Double = 50
    static let lapSeconds: Double = 1.8

    /// How far round the light is, 0 to 1, on the one clock all copies share.
    static func lap(at date: Date) -> Double {
        date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: lapSeconds) / lapSeconds
    }

    /// Draws the mark fitted to the middle of `size`, the light `lap` (0 to 1) of the way round.
    static func draw(_ context: GraphicsContext, size: CGSize, lap: Double) {
        var mark = context
        let scale = min(size.width / box.width, size.height / box.height)
        mark.translateBy(x: (size.width - box.width * scale) / 2, y: (size.height - box.height * scale) / 2)
        mark.scaleBy(x: scale, y: scale)

        var frame = mark
        frame.translateBy(x: ringCentre.x, y: ringCentre.y)
        frame.rotate(by: ringTilt)
        frame.fill(ring, with: .color(.white.opacity(0.6)), style: FillStyle(eoFill: true))

        // The glow is clipped to the band first, then blurred, so it spills just past it.
        frame.drawLayer { glowLayer in
            glowLayer.addFilter(.blur(radius: glowBlur))
            drawLight(glowLayer, spans: glow, lap: lap)
        }
        drawLight(frame, spans: light, lap: lap)

        for path in cross {
            mark.fill(path, with: .color(.white))
        }
    }

    private static func drawLight(_ context: GraphicsContext, spans: [(from: Double, to: Double, opacity: Double)], lap: Double) {
        context.drawLayer { band in
            band.clip(to: ring, style: FillStyle(eoFill: true))
            for span in spans {
                let start = (head + span.from) / 100 + lap
                band.fill(stretch(from: start, length: (span.to - span.from) / 100), with: .color(.white.opacity(span.opacity)))
            }
        }
    }

    /// A stretch of the orbit as the web strokes it: 18 wide with flat ends,
    /// round the circle from (45, 0) with increasing angle, then flattened.
    /// Built as an outline, since a stroke in a flattened context keeps its
    /// width the same all round where the web's flattens with the circle.
    private static func stretch(from start: Double, length: Double) -> Path {
        let steps = max(2, Int((length * 360).rounded(.up)))
        let radii = [orbit + lightWidth / 2, orbit - lightWidth / 2]
        var path = Path()
        for (side, radius) in radii.enumerated() {
            for step in 0...steps {
                let along = side == 0 ? step : steps - step
                let angle = 2 * Double.pi * (start + length * Double(along) / Double(steps))
                let point = CGPoint(x: radius * cos(angle), y: radius * sin(angle) * flatten)
                if side == 0 && step == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
        }
        path.closeSubpath()
        return path
    }
}

/// The hub's loading screen: the mark dead centre on black, the status line
/// under it. VoiceOver reads only the line, and hears it again when it changes.
struct HubLoadingScreen: View {
    let message: String
    /// False for the first 200 ms, so a fast connection never sees the mark or the line.
    var shown = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                HubLoadingMark()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)
                    // Under the mark, so the mark itself stays dead centre.
                    .padding(.top, proxy.size.height / 2 + 112 * HubLoadingMark.box.height / HubLoadingMark.box.width / 2 + 18)
            }
            .opacity(shown ? 1 : 0)
            .accessibilityHidden(!shown)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: shown)
        }
        // The whole screen, not the safe area: the mark sits at the screen's true centre.
        .ignoresSafeArea()
        .background(Color.black.ignoresSafeArea())
        .onChange(of: message) { _, now in
            guard shown else { return }
            #if canImport(UIKit)
            // Queued behind whatever VoiceOver is already saying, never cutting it off.
            UIAccessibility.post(notification: .announcement,
                                 argument: NSAttributedString(string: now, attributes: [.accessibilitySpeechQueueAnnouncement: true]))
            #endif
        }
    }
}

/// Covers the content with the loading screen while `waiting`, on the hub's timing:
/// a wait under 200 ms never shows the mark, once shown it stays at least 500 ms,
/// then it fades out over 200 ms (at once with Reduce Motion).
struct HubLoadingCover: ViewModifier {
    let waiting: Bool
    let message: String
    @State private var covering: Bool
    @State private var shownAt: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let delay = Duration.milliseconds(200)
    private static let hold: TimeInterval = 0.5
    private static let fade: TimeInterval = 0.2

    init(waiting: Bool, message: String) {
        self.waiting = waiting
        self.message = message
        _covering = State(initialValue: waiting)
    }

    func body(content: Content) -> some View {
        content
            .accessibilityHidden(covering)
            .overlay {
                if covering {
                    HubLoadingScreen(message: message, shown: shownAt != nil)
                        .transition(.opacity)
                }
            }
            .task(id: waiting) { await follow() }
    }

    private func follow() async {
        if waiting {
            if !covering {
                shownAt = nil
                covering = true
            }
            guard shownAt == nil else { return }
            try? await Task.sleep(for: Self.delay)
            guard !Task.isCancelled else { return }
            shownAt = .now
        } else {
            guard let at = shownAt else {
                covering = false
                return
            }
            let left = Self.hold - Date.now.timeIntervalSince(at)
            if left > 0 {
                try? await Task.sleep(for: .seconds(left))
                guard !Task.isCancelled else { return }
            }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: Self.fade)) { covering = false }
        }
    }
}

/// Reduce Motion is read-only in the environment; previews stand in for it with this.
private extension EnvironmentValues {
    @Entry var previewReduceMotion = false
}

#Preview("Loading mark") {
    HubLoadingScreen(message: AppModel.Link.noHub.title)
        .environment(AppModel(running: false))
        .preferredColorScheme(.dark)
}

#Preview("Loading mark, Reduce Motion") {
    HubLoadingScreen(message: AppModel.Link.connecting.title)
        .environment(AppModel(running: false))
        .environment(\.previewReduceMotion, true)
        .preferredColorScheme(.dark)
}
