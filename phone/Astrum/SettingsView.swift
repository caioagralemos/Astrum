// The settings sheet: which hub (found automatically, or typed in), the room
// the phone measures the owner in, whose phone this is, the Health permission, a test alert, the language, and a
// link to the hub's own page.

import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var typedAddress = ""
    @State private var addressProblem: String?
    @AppStorage(CheckInReminder.enabledKey) private var reminderOn = true
    @AppStorage(CheckInReminder.minutesKey) private var reminderMinutes = CheckInReminder.defaultMinutes

    var body: some View {
        NavigationStack {
            Form {
                hubSection
                personSection
                healthSection
                alertSection
                reminderSection
                languageSection
                hubPageSection
            }
            .tint(.white)
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
        ProjectionSection {
            LabeledContent("Using", value: model.address?.display ?? "None yet")
            // Alerts are made on this phone from the hub's live messages: say plainly whether they can arrive.
            if let since = model.connectedSince {
                Label(String(localized: "Connected to the hub since \(since.formatted(date: .omitted, time: .shortened))"), systemImage: "checkmark.circle.fill")
            } else {
                Label(String(localized: "Not connected: alerts cannot reach this phone"), systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(HubStyle.over)
            }
            LabeledContent("Room location", value: model.roomLocationText)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Room location")
                .accessibilityValue(model.roomLocationSpoken)

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
                .projectionField()
                .accessibilityLabel("Hub address")

            Button("Use this address", action: useTypedAddress)
                .buttonStyle(.projectionProminent)
                .disabled(typedAddress.trimmingCharacters(in: .whitespaces).isEmpty)

            if let addressProblem {
                Label(addressProblem, systemImage: "exclamationmark.circle")
                    .foregroundStyle(HubStyle.over)
            }
        } header: {
            ProjectionHeader(.wifi, "Hub")
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
        ProjectionSection {
            if model.crew.isEmpty {
                Text("Connect to the hub to see the crew.")
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 12) {
                    if let owner = model.crew.first(where: { $0.id == model.person }) {
                        CrewPortrait(member: owner, shape: .circle)
                            .frame(width: 32, height: 32)
                    }
                    Picker("Crewmate", selection: Binding(get: { model.person }, set: { model.choose(person: $0) })) {
                        Text("Not chosen").tag("")
                        ForEach(model.crew) { member in
                            Text(member.name).tag(member.id)
                        }
                    }
                }
            }
            Button("Run setup again") {
                dismiss()
                model.runSetupAgain()
            }
            .buttonStyle(.projection)
            .accessibilityHint("Shows the first-run screens again: hub, who you are, Health, alerts")
        } header: {
            ProjectionHeader(.crew, "Whose phone")
        } footer: {
            Text("This phone sends its Health readings as this crewmate's.")
        }
    }

    // MARK: Health

    private var healthSection: some View {
        ProjectionSection {
            LabeledContent("Access", value: model.healthState.title)
            if model.healthState == .notAsked {
                Button("Allow Health access") { model.requestHealthAccess() }
                    .buttonStyle(.projection)
            }
        } header: {
            ProjectionHeader(.heart, "Health")
        } footer: {
            if model.healthState == .asked {
                Text("iOS does not tell apps what you allowed. To check or change it, open the Settings app, then Health, Data Access & Devices, Astrum.")
            }
        }
    }

    // MARK: Language

    /// iOS keeps a per-app language: it follows the device unless changed in the Settings app.
    private var languageSection: some View {
        ProjectionSection {
            LabeledContent("Language", value: Locale.current.localizedString(forLanguageCode: model.lang) ?? model.lang)
            Button("Change in the Settings app") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
            .buttonStyle(.projection)
        } header: {
            ProjectionHeader(.earth, "Language")
        } footer: {
            Text("English or Portuguese. Astrum follows the device's language unless you choose another for Astrum in the Settings app.")
        }
    }

    // MARK: The hub's page

    @ViewBuilder
    private var hubPageSection: some View {
        if let url = model.pageURL {
            ProjectionSection {
                NavigationLink("Open the hub's page") {
                    HubWebView(url: url, hubReachable: model.link == .connected)
                        .ignoresSafeArea(edges: .bottom)
                        .navigationTitle("The hub's page")
                        .navigationBarTitleDisplayMode(.inline)
                }
            } footer: {
                Text("The hub's own interface, as the station's screens show it.")
            }
        }
    }

    // MARK: Daily check-in reminder

    private var reminderTime: Binding<Date> {
        Binding(
            get: { Calendar.current.date(bySettingHour: reminderMinutes / 60, minute: reminderMinutes % 60, second: 0, of: .now) ?? .now },
            set: {
                let parts = Calendar.current.dateComponents([.hour, .minute], from: $0)
                reminderMinutes = (parts.hour ?? 9) * 60 + (parts.minute ?? 0)
            }
        )
    }

    private var reminderSection: some View {
        ProjectionSection {
            Toggle("Remind me every day", isOn: $reminderOn)
            if reminderOn {
                DatePicker("Reminder time", selection: reminderTime, displayedComponents: .hourAndMinute)
            }
        } header: {
            ProjectionHeader(.mood, "Daily check-in reminder")
        } footer: {
            Text("A quiet notification at this time, phone time. It is skipped on a day you have already checked in.")
        }
        .onChange(of: reminderOn) { _, _ in model.rescheduleCheckInReminder() }
        .onChange(of: reminderMinutes) { _, _ in model.rescheduleCheckInReminder() }
    }

    // MARK: Alerts

    private var alertSection: some View {
        ProjectionSection {
            LabeledContent("Notifications", value: model.notificationText)
            Button("Send a test alert") { model.sendTestAlert() }
                .buttonStyle(.projection)
                .accessibilityHint("Arrives in five seconds")
        } header: {
            ProjectionHeader(.alerts, "Alerts")
        } footer: {
            Text("The test alert arrives after five seconds, so there is time to lock the phone. On a locked phone, alerts also show on the Apple Watch.")
        }
    }
}
