// The app's motion, in one place: a few named animations and transitions, so
// every screen moves the same way and the feel can be tuned here by changing a
// number. Quiet and physical, as the system's own apps: nothing decorative,
// each animation explains a change. Under Reduce Motion nothing moves or
// scales; changes cross-fade (or simply happen), and haptics stay.

import SwiftUI

enum Motion {
    /// A choice moving to where it was tapped: the region chips' selected fill.
    static let select = Animation.snappy(duration: 0.28)
    /// Content changing in place: the region's lists, numbers, bars, banners arriving.
    static let content = Animation.smooth(duration: 0.35)
    /// Something new appearing once: the check-in's confirmation line.
    static let appear = Animation.easeOut(duration: 0.3)
    /// An alert screen giving way to the next one: quick, no bounce.
    static let urgent = Animation.easeOut(duration: 0.22)
    /// The history chart drawing in, once, when its screen opens.
    static let reveal = Animation.easeOut(duration: 0.6)
    /// A pressed card or button settling back.
    static let press = Animation.spring(duration: 0.25, bounce: 0)
    /// What every animation becomes under Reduce Motion: a short cross-fade.
    static let calm = Animation.easeInOut(duration: 0.2)

    /// For changes that fade as well as move: the calm cross-fade under Reduce Motion
    /// (pair it with a transition that is opacity only then, e.g. `.astrumRise(reduceMotion:)`).
    static func reduced(_ animation: Animation, _ reduceMotion: Bool) -> Animation {
        reduceMotion ? calm : animation
    }

    /// For changes that are only movement (a fill sliding, a bar growing): none under Reduce Motion.
    static func movement(_ animation: Animation, _ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation
    }
}

extension AnyTransition {
    /// In: fades in rising 8 pt from below. Out: fades.
    static var astrumRise: AnyTransition {
        .asymmetric(insertion: .opacity.combined(with: .offset(y: 8)), removal: .opacity)
    }

    /// `astrumRise`, or a plain fade under Reduce Motion.
    static func astrumRise(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : astrumRise
    }
}

// MARK: Numbers

private struct NumericMotion<Value: Equatable>: ViewModifier {
    let value: Value
    var countsDown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .contentTransition(reduceMotion ? .opacity : .numericText(countsDown: countsDown))
            .animation(Motion.reduced(Motion.content, reduceMotion), value: value)
    }
}

extension View {
    /// A number that rolls to its new value (fades under Reduce Motion). Scoped to `value`,
    /// so only this text animates, and only when it changes.
    func numericMotion<V: Equatable>(_ value: V, countsDown: Bool = false) -> some View {
        modifier(NumericMotion(value: value, countsDown: countsDown))
    }
}

// MARK: Pressing

/// A tappable card: scales to 0.98 and dims a little while pressed, then settles back.
/// Under Reduce Motion it only dims. The tap itself is never delayed.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Pressed(configuration: configuration)
    }

    private struct Pressed: View {
        let configuration: Configuration
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
                .opacity(configuration.isPressed ? 0.85 : 1)
                .animation(Motion.press, value: configuration.isPressed)
        }
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var pressable: PressableStyle { PressableStyle() }
}
