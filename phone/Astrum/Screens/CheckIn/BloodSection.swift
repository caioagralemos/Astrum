// The blood test part of Check-in: the medical lead's entries from
// /api/blood, a field per entry to type a result (posted back, all or
// nothing), "Scan the analyser's screen" (BloodScanView: read from a photo,
// checked by the person), and the owner's newest results. With no entries it
// says so and shows no ranges of its own.

import SwiftUI

struct BloodSection: View {
    var focus: FocusState<CheckInField?>.Binding
    /// The entries' ids in screen order, for the keyboard's previous / next.
    @Binding var ids: [String]
    @Environment(AppModel.self) private var model
    @State private var scanning = false
    @State private var reply: BloodReply?
    @State private var typed: [String: String] = [:]
    @State private var said: String?
    @State private var sending = false

    var body: some View {
        ProjectionSection {
            if let reply {
                if reply.entries.isEmpty {
                    Text("No blood tests set up yet")
                        .foregroundStyle(.secondary)
                } else {
                    Button {
                        focus.wrappedValue = nil
                        scanning = true
                    } label: {
                        Label("Scan the analyser's screen", systemImage: "camera.viewfinder")
                    }
                    .buttonStyle(.projection)
                    .accessibilityHint(Text("Reads the results from a photo; you check each value before it is sent"))
                    ForEach(reply.entries) { entry in
                        entryField(entry)
                    }
                    Button(sending ? String(localized: "Sending…") : String(localized: "Send results"), action: send)
                        .buttonStyle(.projectionProminent)
                        .disabled(sending || values.isEmpty || !model.isConnected)
                }
                if let said {
                    Text(said).foregroundStyle(.secondary)
                }
            } else {
                Text(model.isConnected ? String(localized: "Loading…") : String(localized: "Blood tests need the hub."))
                    .foregroundStyle(.secondary)
            }
        } header: {
            ProjectionHeader(.humidity, "Blood test")
        } footer: {
            Text("A typed result is stored as Measured: an instrument read it.")
        }

        ProjectionSection {
            BloodResultsList(reply: reply, person: model.person)
        } header: {
            ProjectionHeader(.humidity, "Your latest results")
        }
        .task(id: model.isConnected) { await load() }
        .onChange(of: reply?.entries.map(\.id) ?? []) { _, new in ids = new }
        .sheet(isPresented: $scanning) {
            BloodScanView(entries: reply?.entries ?? []) { count in
                said = String(localized: "Sent. The hub stored \(count) results.")
                Task { await load() }
            }
        }
    }

    private func entryField(_ entry: BloodEntry) -> some View {
        let name = model.lang == "pt" ? entry.name.pt : entry.name.en
        // The unit sits on the line under the name, so a long name is never cut by the field.
        return VStack(alignment: .leading, spacing: 4) {
            NumberFieldRow(name: name, tapped: { focus.wrappedValue = nil }) {
                TextField("Result", text: binding(entry.id))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .projectionField()
                    .focused(focus, equals: .blood(entry.id))
                    .accessibilityLabel(Text("\(name), in \(entry.unit)"))
            }
            Group {
                if let low = entry.reference_range.low, let high = entry.reference_range.high {
                    Text("Range \(Signals.number(low))–\(Signals.number(high)) \(entry.unit)")
                } else {
                    Text("In \(entry.unit), no range set yet")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .onTapGesture { focus.wrappedValue = nil }
        }
        .id(CheckInField.blood(entry.id))
    }

    private func binding(_ id: String) -> Binding<String> {
        Binding(get: { typed[id] ?? "" }, set: { typed[id] = $0 })
    }

    /// The typed values that read as numbers, in this phone's way of writing them.
    private var values: [String: Double] {
        typed.compactMapValues { text in
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty ? nil : (try? Double(trimmed, format: .number))
        }
    }

    private func load() async {
        guard let api = model.api else { return }
        reply = (try? await api.blood()) ?? reply
    }

    private func send() {
        guard let api = model.api else { return }
        sending = true
        focus.wrappedValue = nil
        let values = values
        Task {
            do {
                try await api.postBlood(person: model.person, values: values)
                said = String(localized: "Sent. The hub stored \(values.count) results.")
                typed = [:]
                await load()
            } catch HubError.refused(let words) {
                said = String(localized: "The hub refused it: \(words)")
            } catch {
                said = String(localized: "The hub is out of reach.")
            }
            sending = false
        }
    }
}
