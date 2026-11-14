// Where the hub is on the network, and the addresses built from it: the page
// the phone shows, the live socket, and the door for posting readings.

import Foundation

struct HubAddress: Hashable, Codable, Sendable {
    static let defaultPort = 4310

    let host: String
    let port: Int

    init(host: String, port: Int = HubAddress.defaultPort) {
        self.host = host
        self.port = port
    }

    /// Reads what someone typed: "192.168.1.20", "192.168.1.20:4310",
    /// "astrum.local" or "http://192.168.1.20:4310/". Returns nil if it is not an address.
    init?(text: String) {
        var rest = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for scheme in ["http://", "https://", "ws://"] where rest.hasPrefix(scheme) {
            rest.removeFirst(scheme.count)
        }
        if let slash = rest.firstIndex(of: "/") { rest = String(rest[..<slash]) }

        var host = rest
        var port = HubAddress.defaultPort
        if let colon = rest.lastIndex(of: ":") {
            guard let number = Int(rest[rest.index(after: colon)...]), (1...65_535).contains(number) else { return nil }
            host = String(rest[..<colon])
            port = number
        }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-"))
        guard !host.isEmpty, host.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        self.init(host: host, port: port)
    }

    /// How the address is shown and stored: "192.168.1.20:4310".
    var display: String { "\(host):\(port)" }

    /// The hub's own interface, told whose phone this is.
    func pageURL(person: String) -> URL? {
        var items = [URLQueryItem]()
        if !person.isEmpty { items.append(URLQueryItem(name: "person", value: person)) }
        items.append(URLQueryItem(name: "phone", value: "1"))
        return url(scheme: "http", path: "/", query: items)
    }

    var webSocketURL: URL? { url(scheme: "ws", path: "/ws") }

    var readingsURL: URL? { url(scheme: "http", path: "/api/readings") }

    private func url(scheme: String, path: String, query: [URLQueryItem]? = nil) -> URL? {
        var parts = URLComponents()
        parts.scheme = scheme
        parts.host = host
        parts.port = port
        parts.path = path
        parts.queryItems = query
        return parts.url
    }
}

/// A hub found on the Wi-Fi by its Bonjour announcement.
struct DiscoveredHub: Identifiable, Hashable, Sendable {
    /// The announced name, e.g. "Astrum hub".
    let name: String
    let address: HubAddress

    var id: String { name }
}
