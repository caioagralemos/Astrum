// Tap anywhere outside a text field and the keyboard goes away, on every
// screen and sheet, without each screen having to ask for it.
//
// One tap recogniser sits on the window. It never takes the touch from what
// is under it (buttons, rows and links still get their tap), it ignores taps
// that land in a text field or on the keyboard's own bar, and it only acts
// while a field is being edited.

import SwiftUI
#if canImport(UIKit)
import UIKit

@MainActor
final class KeyboardDismisser: NSObject, UIGestureRecognizerDelegate {
    static let shared = KeyboardDismisser()
    private var installed = Set<ObjectIdentifier>()

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

extension View {
    /// Put once at the app's root: a tap outside a text field puts the keyboard away everywhere.
    func dismissesKeyboardOnTapOutside() -> some View {
        modifier(DismissKeyboardOnTapOutside())
    }
}
