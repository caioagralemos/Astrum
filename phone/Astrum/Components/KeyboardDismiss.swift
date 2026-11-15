// Tap anywhere outside a text field and the keyboard goes away, on every
// screen and sheet, without each screen having to ask for it.
//
// One tap recogniser sits on the window. It never takes the touch from what
// is under it (buttons, rows and links still get their tap), it ignores taps
// that land in a text field or on the keyboard's own bar, and it only acts
// while a field is being edited. A control marked `.keepsKeyboard()` (Ask
// Astra's send button and quick replies) is exempt too: the recogniser cannot
// see SwiftUI's views, so each marked control reports its frame in the window
// and a tap inside one is left alone.

import SwiftUI
#if canImport(UIKit)
import UIKit

@MainActor
final class KeyboardDismisser: NSObject, UIGestureRecognizerDelegate {
    static let shared = KeyboardDismisser()
    private var installed = Set<ObjectIdentifier>()
    /// The frames, in window coordinates, of the controls that keep the keyboard up.
    private var keepers: [UUID: CGRect] = [:]

    func keep(_ id: UUID, frame: CGRect?) {
        keepers[id] = frame
    }

    /// Adds the recogniser to every window that does not have it yet (sheets get their own window scene's key window).
    func install() {
        for scene in UIApplication.shared.connectedScenes {
            guard let scene = scene as? UIWindowScene else { continue }
            for window in scene.windows where !installed.contains(ObjectIdentifier(window)) {
                let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
                tap.cancelsTouchesInView = false
                tap.delaysTouchesBegan = false
                tap.delaysTouchesEnded = false
                tap.requiresExclusiveTouchType = false
                tap.delegate = self
                window.addGestureRecognizer(tap)
                installed.insert(ObjectIdentifier(window))
            }
        }
    }

    @objc private func tapped(_ recogniser: UITapGestureRecognizer) {
        recogniser.view?.endEditing(true)
    }

    // A tap inside a text input keeps the keyboard (and lets the caret move); so does one on a control
    // that says it works with the keyboard up (the bar's own buttons live outside the window's content).
    func gestureRecognizer(_ recogniser: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        let point = touch.location(in: recogniser.view)
        if keepers.values.contains(where: { $0.contains(point) }) { return false }
        var view = touch.view
        while let current = view {
            if current is UITextField || current is UITextView || current is UISearchBar { return false }
            view = current.superview
        }
        return true
    }

    func gestureRecognizer(_ recogniser: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}
#endif

private struct DismissKeyboardOnTapOutside: ViewModifier {
    func body(content: Content) -> some View {
        content
            #if canImport(UIKit)
            .onAppear { KeyboardDismisser.shared.install() }
            // A sheet brings a new window: look again whenever the keyboard is about to show.
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                KeyboardDismisser.shared.install()
            }
            #endif
    }
}

/// Reports a control's frame to the recogniser while it is on screen.
private struct KeepsKeyboard: ViewModifier {
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            #if canImport(UIKit)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
                KeyboardDismisser.shared.keep(id, frame: frame)
            }
            .onDisappear { KeyboardDismisser.shared.keep(id, frame: nil) }
            #endif
    }
}

extension View {
    /// Put once at the app's root: a tap outside a text field puts the keyboard away everywhere.
    func dismissesKeyboardOnTapOutside() -> some View {
        modifier(DismissKeyboardOnTapOutside())
    }

    /// A tap on this control leaves the keyboard up (a chat's send button, its quick replies).
    func keepsKeyboard() -> some View {
        modifier(KeepsKeyboard())
    }
}
