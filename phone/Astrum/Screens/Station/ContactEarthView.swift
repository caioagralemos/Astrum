// Writing to Earth: a message from the owner, posted to /api/earth/messages.
// It says how long it takes to arrive before it is sent.

import SwiftUI

struct ContactEarthView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                ProjectionSection {
                    TextField("Message", text: $text, axis: .vertical)
                        .lineLimit(4...12)
                        .focused($focused)
                        .projectionField()
                } footer: {
                    if let delay = model.world.profile?.delayToEarthSeconds {
                        Text("It reaches Earth in \(Countdown.text(ms: delay * 1000)). A reply can be back in \(Countdown.text(ms: delay * 2000)) at the earliest.")
                    }
                }
                if let problem {
                    Text(problem).foregroundStyle(.secondary)
                        .projectionRow()
                }
            }
            .tint(.white)
            .navigationTitle("Contact Earth")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send to Earth", action: send)
                        .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !model.isConnected)
                }
            }
            .onAppear { focused = true }
        }
    }

    private func send() {
        guard let api = model.api else { return }
        sending = true
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                try await api.postEarth(from: model.person, text: message)
                dismiss()
            } catch HubError.refused(let words) {
                problem = String(localized: "The hub refused it: \(words)")
            } catch {
                problem = String(localized: "The hub is out of reach.")
            }
            sending = false
        }
    }
}
