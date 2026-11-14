// The settings sheet: which hub (found automatically, or typed in), whose
// phone this is, the Health permission, and a test alert.

import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var typedAddress = ""
    @State private var addressProblem: String?

    var body: some View {
        NavigationStack {
            Form {
                hubSection
                personSection
                healthSection
                alertSection
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await model.refreshPermissions() }
        }
    }

    // MARK: Hub

    private var hubSection: some View {
        Section {
            LabeledContent("Using", value: model.address?.display ?? "None yet")

            ForEach(model.finder.hubs) { hub in
                let chosen = model.address == hub.address
                Button {
                    model.choose(address: hub.address, automatic: true)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hub.name)
                            Text(hub.address.display)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if chosen {
                            Image(systemName: "checkmark")
                                .accessibilityHidden(true)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .foregroundStyle(.primary)
                .accessibilityLabel("\(hub.name), \(hub.address.display)")
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }

            if model.finder.hubs.isEmpty {
                Text("Searching this Wi-Fi network…")
                    .foregroundStyle(.secondary)
            }

            TextField("Address, for example 192.168.1.20", text: $typedAddress)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(useTypedAddress)
                .accessibilityLabel("Hub address")

            Button("Use this address", action: useTypedAddress)
                .disabled(typedAddress.trimmingCharacters(in: .whitespaces).isEmpty)

            if let addressProblem {
                Label(addressProblem, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Hub")
        } footer: {
            Text("The hub is found automatically on the station's Wi-Fi. If no port is given, \(String(HubAddress.defaultPort)) is used.")
        }
    }

    private func useTypedAddress() {
        guard let address = HubAddress(text: typedAddress) else {
            addressProblem = "That is not an address. Try something like 192.168.1.20 or 192.168.1.20:4310."
            return
        }
        addressProblem = nil
        typedAddress = ""
        model.choose(address: address, automatic: false)
    }

    // MARK: Person

    private var personSection: some View {
        Section {
            if model.crew.isEmpty {
                Text("Connect to the hub to see the crew.")
                    .foregroundStyle(.secondary)
            } else {
                Picker("Crewmate", selection: Binding(get: { model.person }, set: { model.choose(person: $0) })) {
                    Text("Not chosen").tag("")
                    ForEach(model.crew) { member in
                        Text(member.name).tag(member.id)
                    }
                }
            }
        } header: {
            Text("Whose phone")
        } footer: {
            Text("This phone sends its Health readings as this crewmate's.")
        }
    }

    // MARK: Health

    private var healthSection: some View {
        Section {
            LabeledContent("Access", value: model.healthState.title)
            if model.healthState == .notAsked {
                Button("Allow Health access") { model.requestHealthAccess() }
            }
        } header: {
            Text("Health")
        } footer: {
            if model.healthState == .asked {
                Text("iOS does not tell apps what you allowed. To check or change it, open the Settings app, then Health, Data Access & Devices, Astrum.")
            }
        }
    }

    // MARK: Alerts

    private var alertSection: some View {
        Section {
            LabeledContent("Notifications", value: model.notificationText)
            Button("Send a test alert") { model.sendTestAlert() }
                .accessibilityHint("Arrives in five seconds")
        } header: {
            Text("Alerts")
        } footer: {
            Text("The test alert arrives after five seconds, so there is time to lock the phone. On a locked phone, alerts also show on the Apple Watch.")
        }
    }
}
