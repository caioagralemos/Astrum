// The live connection to the hub's WebSocket (/ws). Keeps it open, notices
// when it drops (a ping every 20 seconds; no pong within 10 closes it), and
// reconnects with a growing wait: 1, 2, 4 ... up to 30 seconds, forever, for
// as long as the app runs. Decodes each message off the main actor and
// hands it to its owner, in the order it arrived.

import Foundation
import os

@MainActor
final class HubSocket {
    enum State: Equatable {
        case connecting
        case connected
        case retrying
    }

    var onState: (@MainActor (State) -> Void)?
    var onMessage: (@MainActor (HubIncoming) -> Void)?

    private var task: URLSessionWebSocketTask?
    private var loop: Task<Void, Never>?
    private var hello: String?

    /// Connects (or reconnects at once, with the wait reset) to the given socket.
    func connect(to url: URL, hello: String?) {
        disconnect()
        self.hello = hello
        loop = Task { [weak self] in await self?.run(url) }
    }

    func disconnect() {
        loop?.cancel()
        loop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    /// Sends a new hello on the open socket, and on every later reconnect.
    func update(hello: String) {
        self.hello = hello
        task?.send(.string(hello)) { _ in }
    }

    private func run(_ url: URL) async {
        var attempt = 0
        while !Task.isCancelled {
            onState?(.connecting)
            let task = URLSession.shared.webSocketTask(with: url)
            task.maximumMessageSize = 4_000_000
            self.task = task
            task.resume()
            if let hello { try? await task.send(.string(hello)) }

            let pinger = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    if Task.isCancelled { break }
                    // A ping that never comes back (the Wi-Fi went, the Mac slept) would leave the socket
                    // looking open while nothing arrives: give it 10 seconds, then reconnect.
                    let pong = OSAllocatedUnfairLock(initialState: false)
                    task.sendPing { error in
                        if error != nil { task.cancel(with: .goingAway, reason: nil) } else { pong.withLock { $0 = true } }
                    }
                    try? await Task.sleep(for: .seconds(10))
                    if Task.isCancelled { break }
                    if !pong.withLock({ $0 }) { task.cancel(with: .goingAway, reason: nil) }
                }
            }

            var heard = false
            do {
                while !Task.isCancelled {
                    let message = try await task.receive()
                    if !heard {
                        heard = true
                        attempt = 0
                        onState?(.connected)
                    }
                    if let incoming = await Self.decode(message) { onMessage?(incoming) }
                }
            } catch {
                // The socket closed or failed; fall through to the wait below.
            }
            pinger.cancel()
            task.cancel(with: .goingAway, reason: nil)
            if Task.isCancelled { return }

            onState?(.retrying)
            let wait = min(30.0, pow(2.0, Double(attempt)))
            attempt += 1
            try? await Task.sleep(for: .seconds(wait))
        }
    }

    /// Decodes one message off the main actor; the full state can be large.
    @concurrent
    private nonisolated static func decode(_ message: URLSessionWebSocketTask.Message) async -> HubIncoming? {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let bytes): data = bytes
        @unknown default: return nil
        }
        return try? JSONDecoder().decode(HubIncoming.self, from: data)
    }
}
