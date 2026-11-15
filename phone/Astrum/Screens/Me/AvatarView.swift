// The body on Me: the hub's 3D crew avatar (hub/ui/src/avatar), built into
// Resources/avatar.html and shown in a web view, offline. Tapping a region
// selects it. With or without a selection, every marked region is drawn in the
// watch colour (the danger colour for a level 3 alert), and a marked Blood draws
// the vessels: hub/ui/src/person/regions.ts, the same table as Signals.swift. To VoiceOver it is one
// element: the region buttons under it are the way to choose.

import SwiftUI
import WebKit

struct AvatarView: View {
    let marked: Set<BodyRegion>
    /// Marked regions with a level 3 alert.
    let danger: Set<BodyRegion>
    @Binding var selected: BodyRegion?
    /// What each region holds now, for VoiceOver: "2 readings outside your usual".
    let status: (BodyRegion) -> String

    var body: some View {
        AvatarWebView(marked: marked, danger: danger, selected: $selected)
            .frame(height: 440)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Body"))
            .accessibilityValue(selected.map { Text($0.title) + Text(verbatim: ", ") + Text(status($0)) }
                ?? Text(marked.isEmpty ? "" : BodyRegion.markedList(marked)))
            .accessibilityHint(Text("Choose a region with the buttons below"))
    }
}

private struct AvatarWebView: UIViewRepresentable {
    let marked: Set<BodyRegion>
    let danger: Set<BodyRegion>
    @Binding var selected: BodyRegion?

    func makeCoordinator() -> Coordinator { Coordinator(selected: $selected) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "astrum")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        // Not opaque, so nothing white shows before the page draws its black.
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.underPageBackgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif
        if let url = Bundle.main.url(forResource: "avatar", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.selected = $selected
        context.coordinator.send(selected: selected, marked: marked, danger: danger, to: webView)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "astrum")
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var selected: Binding<BodyRegion?>
        private var loaded = false
        private var state = ""
        private var sent = ""

        init(selected: Binding<BodyRegion?>) {
            self.selected = selected
        }

        /// Hands the page the state, once it has loaded and only when it changed.
        func send(selected: BodyRegion?, marked: Set<BodyRegion>, danger: Set<BodyRegion>, to webView: WKWebView) {
            let names = marked.map(\.rawValue).sorted().map { "\"\($0)\"" }.joined(separator: ",")
            let level = { (region: BodyRegion) in danger.contains(region) ? "over" : "watch" }
            let states = marked.sorted { $0.rawValue < $1.rawValue }.map { "\"\($0.rawValue)\":\"\(level($0))\"" }.joined(separator: ",")
            let blood = marked.contains(.blood) ? "\"\(level(.blood))\"" : "null"
            state = "{\"selected\":\(selected.map { "\"\($0.rawValue)\"" } ?? "null"),\"marked\":[\(names)],\"states\":{\(states)},\"blood\":\(blood)}"
            guard loaded, state != sent else { return }
            sent = state
            webView.evaluateJavaScript("window.astrum.setState(\(state))")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded = true
            sent = state
            webView.evaluateJavaScript("window.astrum.setState(\(state))")
        }

        /// A tap on a region: selects it, or clears it when it was already selected.
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let name = body["region"] as? String,
                  let region = BodyRegion(rawValue: name) else { return }
            selected.wrappedValue = selected.wrappedValue == region ? nil : region
        }
    }
}
