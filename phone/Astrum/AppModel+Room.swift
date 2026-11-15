// Room location glue: the RoomLocator's "entered a board's room" / "left"
// become measured stays on the hub (POST /api/stays), kept on disk while the
// hub is out of reach and sent later with the times they happened. Settings
// shows the result in one row.

import Foundation
import os

private let log = Logger(subsystem: "space.astrum.phone", category: "room")

extension AppModel {
    /// The source the hub records these stays under.
    var roomSource: String { "phone:\(person):ble" }

    /// Starts the locator once a crewmate is chosen, so the Bluetooth question comes with a reason.
    func startRoomLocation() {
        guard !person.isEmpty else { return }
        roomLocator.onChange = { [weak self] board, at in self?.roomChanged(board: board, at: at) }
        roomLocator.start()
    }

    /// The hub's clock at a moment on this phone, in milliseconds (never a scenario's clock).
    private func hubTime(_ date: Date) -> Int64 {
        Int64(date.timeIntervalSince1970 * 1000 + world.clockOffset)
    }

    private func roomChanged(board: String?, at: Date) {
        guard !person.isEmpty else { return }
        let event = StayEvent(person: person, board: board, room: board.flatMap { world.room(ofBoard: $0) }, t: hubTime(at))
        Task {
            await stayOutbox.append(event)
            flushStays()
        }
    }

    /// Sends waiting room changes, oldest first. Stops at the first network failure.
    /// Then, if the hub has the owner somewhere other than the board's room the phone is near now, says so again.
    func flushStays() {
        guard !isSendingStays, let api else { return }
        isSendingStays = true
        Task {
            defer { isSendingStays = false }
            while let event = await stayOutbox.first {
                let room: String?
                if let board = event.board {
                    guard let found = event.room ?? world.room(ofBoard: board) else {
                        // The hub does not say where this board is: nothing honest to send.
                        if world.hasData { await stayOutbox.removeFirst() } else { return }
                        continue
                    }
                    room = found
                } else {
                    room = nil
                }
                do {
                    try await api.postStay(person: event.person, room: room, t: event.t, source: "phone:\(event.person):ble")
                    await stayOutbox.removeFirst()
                } catch HubError.refused(let words) {
                    // Sending it again would be refused the same way (for example, older than the hub's newest stay).
                    log.error("Hub refused a room change: \(words, privacy: .public)")
                    await stayOutbox.removeFirst()
                } catch {
                    return
                }
            }
            await reassertRoom(api: api)
        }
    }

    /// After a refusal or a hub restart, the hub may not have the room the phone measures now: tell it, as of now.
    private func reassertRoom(api: HubAPI) async {
        guard !person.isEmpty, case .near(let board) = roomLocator.state, let room = world.room(ofBoard: board) else { return }
        let open = world.stays.filter { $0.person == person && $0.until == nil }.max { $0.from < $1.from }
        if open?.room == room, open?.kind == .measured { return }
        try? await api.postStay(person: person, room: room, t: hubTime(Date()), source: roomSource)
    }

    /// The Settings row's words: where the owner is, or why it is not known.
    var roomLocationText: String {
        switch roomLocator.state {
        case .near(let board):
            guard let room = world.room(ofBoard: board) else { return String(localized: "Near board \(board)") }
            return String(localized: "In \(Signals.roomName(room, rooms: world.profile?.rooms ?? [])) (Measured)")
        case .notSeen: return String(localized: "Board not seen")
        case .bluetoothOff: return String(localized: "Bluetooth off")
        case .notAllowed: return String(localized: "Not allowed")
        case .unavailable: return String(localized: "Not available on this device")
        }
    }

    /// What VoiceOver reads for the row.
    var roomLocationSpoken: String {
        guard case .near(let board) = roomLocator.state, let room = world.room(ofBoard: board) else { return roomLocationText }
        return String(localized: "In \(Signals.roomName(room, rooms: world.profile?.rooms ?? [])), measured from the board's Bluetooth signal. Near the board, not proof of being inside the room.")
    }
}
