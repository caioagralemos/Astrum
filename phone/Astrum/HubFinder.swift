// Finds the hub on the local Wi-Fi. The hub announces itself over Bonjour as
// "_astrum._tcp" (hub/core/main.ts); this browses for that service and turns
// each announcement into an IPv4 address the web view and socket can use.

import Foundation
import Network
import Observation
import os

private let log = Logger(subsystem: "space.astrum.phone", category: "bonjour")

@MainActor
@Observable
final class HubFinder {
    private(set) var hubs: [DiscoveredHub] = []

    /// Called each time a hub's address is worked out.
    @ObservationIgnored var onFound: (@MainActor (DiscoveredHub) -> Void)?

    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var resolving: [NWEndpoint: NWConnection] = [:]

    func start() {
        guard browser == nil else { return }
        let browser = NWBrowser(for: .bonjour(type: "_astrum._tcp", domain: nil), using: NWParameters())
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            // The browser runs on the main queue (see start below).
            MainActor.assumeIsolated { self?.update(results) }
        }
        browser.stateUpdateHandler = { [weak self] state in
            guard case .failed(let error) = state else { return }
            log.error("Bonjour browsing failed: \(error.localizedDescription, privacy: .public)")
            MainActor.assumeIsolated { self?.restartSoon() }
        }
        self.browser = browser
        browser.start(queue: .main)
    }

    private func restartSoon() {
        browser?.cancel()
        browser = nil
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            self?.start()
        }
    }

    private func update(_ results: Set<NWBrowser.Result>) {
        var names = Set<String>()
        for result in results {
            guard case .service(let name, _, _, _) = result.endpoint else { continue }
            names.insert(name)
            if !hubs.contains(where: { $0.name == name }) && resolving[result.endpoint] == nil {
                resolve(result.endpoint, name: name)
            }
        }
        hubs.removeAll { !names.contains($0.name) }
    }

    /// Opens a short connection to the service to learn its address, then closes it.
    private func resolve(_ endpoint: NWEndpoint, name: String) {
        let parameters = NWParameters.tcp
        // Ask for IPv4, so the address fits in a plain http:// URL.
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let connection = NWConnection(to: endpoint, using: parameters)
        resolving[endpoint] = connection
        connection.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated { self?.resolution(of: endpoint, name: name, changedTo: state) }
        }
        connection.start(queue: .main)
    }

    private func resolution(of endpoint: NWEndpoint, name: String, changedTo state: NWConnection.State) {
        guard let connection = resolving[endpoint] else { return }
        switch state {
        case .ready:
            if case .hostPort(let host, let port)? = connection.currentPath?.remoteEndpoint,
               let text = Self.text(for: host) {
                let hub = DiscoveredHub(name: name, address: HubAddress(host: text, port: Int(port.rawValue)))
                hubs.removeAll { $0.name == name }
                hubs.append(hub)
                onFound?(hub)
            }
            connection.cancel()
            resolving[endpoint] = nil
        case .failed, .waiting:
            connection.cancel()
            resolving[endpoint] = nil
        default:
            break
        }
    }

    private static func text(for host: NWEndpoint.Host) -> String? {
        let text: String
        switch host {
        case .ipv4(let address): text = "\(address)"
        case .name(let name, _): text = name
        case .ipv6: return nil
        @unknown default: return nil
        }
        // Drop an interface suffix such as "%en0".
        return text.split(separator: "%").first.map(String.init)
    }
}
