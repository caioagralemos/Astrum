// Shows the hub's own interface in a web view. The page is the same responsive
// interface the hub window and common screens use; the phone only adds
// "?person=<id>&phone=1" so the page knows whose phone it is.

import SwiftUI
import WebKit

struct HubWebView: UIViewRepresentable {
    let url: URL
    /// When the hub comes back after a failed load, the page is loaded again.
    let hubReachable: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        #if DEBUG
        webView.isInspectable = true
        #endif
        context.coordinator.load(url, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        if coordinator.loadedURL != url {
            coordinator.load(url, in: webView)
        } else if hubReachable && coordinator.failed {
            coordinator.load(url, in: webView)
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        private(set) var loadedURL: URL?
        private(set) var failed = false

        func load(_ url: URL, in webView: WKWebView) {
            loadedURL = url
            failed = false
            webView.load(URLRequest(url: url))
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            failed = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed = true
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed = true
        }
    }
}
