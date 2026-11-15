// The short first run: find the hub (Bonjour or a typed address), choose who
// I am from the hub's crew, Health access, notifications. Then the tabs.

import SwiftUI
import UIKit

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var step = Step.hub

    enum Step: Int, CaseIterable {
        case hub, person, health, notifications
    }

    var body: some View {
        NavigationStack {
            Form {
                switch step {
                case .hub: HubStep()
                case .person: PersonStep()
                case .health: HealthStep()
                case .notifications: NotificationStep()
                }
            }
            .navigationTitle(title)
            .toolbar {
                if step != .hub {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Back") { step = Step(rawValue: step.rawValue - 1) ?? .hub }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(step == .notifications ? String(localized: "Start") : String(localized: "Next"), action: next)
                        .disabled(!canContinue)
                }
            }
            .task { await model.refreshPermissions() }
        }
    }

    private var title: String {
        switch step {
        case .hub: String(localized: "Find the hub")
        case .person: String(localized: "Who are you?")
        case .health: String(localized: "Health")
        case .notifications: String(localized: "Alerts")
        }
    }

    private var canContinue: Bool {
        switch step {
        case .hub: model.address != nil
        case .person: !model.person.isEmpty
        case .health, .notifications: true
        }
    }

    private func next() {
        if let following = Step(rawValue: step.rawValue + 1) {
            step = following
        } else {
            model.finishOnboarding()
        }
    }
}

private struct HubStep: View {
    @Environment(AppModel.self) private var model
    @State private var typed = ""
    @State private var problem: String?

    var body: some View {
        Section {
            ForEach(model.finder.hubs) { hub in
                Button {
                    model.choose(address: hub.address, automatic: true)
                } label: {
                    LabeledContent(hub.name, value: hub.address.display)
                }
                .accessibilityAddTraits(model.address == hub.address ? .isSelected : [])
            }
            if model.finder.hubs.isEmpty {
                VStack(spacing: 12) {
                    HubLoadingMark(width: 72)
                    Text("Searching this Wi-Fi network…")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
        } header: {
            Text("On this Wi-Fi")
        } footer: {
            Text("Astrum is a companion to the station's hub. It finds the hub on the station's Wi-Fi.")
        }

        Section("Or type its address") {
            TextField("Address, for example 192.168.1.20", text: $typed)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit(useTyped)
            Button("Use this address", action: useTyped)
                .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
            if let problem {
                Text(problem).foregroundStyle(.secondary)
            }
        }

        if let address = model.address {
            Section {
                LabeledContent("Using", value: address.display)
                Label(model.link.title, systemImage: model.link.symbol)
            }
        }
    }

    private func useTyped() {
        guard let address = HubAddress(text: typed) else {
            problem = String(localized: "That is not an address. Try something like 192.168.1.20 or 192.168.1.20:4310.")
            return
        }
        problem = nil
        typed = ""
        model.choose(address: address, automatic: false)
    }
}

private struct PersonStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            if model.crew.isEmpty {
                Text("Waiting for the hub to send the crew.")
                    .foregroundStyle(.secondary)
            }
            ForEach(model.crew) { member in
                Button {
                    model.choose(person: member.id)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.name).foregroundStyle(.primary)
                            Text(Signals.roleName(member.role))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if model.person == member.id {
                            Image(systemName: "checkmark").accessibilityHidden(true)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .accessibilityAddTraits(model.person == member.id ? .isSelected : [])
            }
        } footer: {
            Text("This phone is yours: it shows your body and sends your Health readings as yours.")
        }
    }
}

private struct HealthStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            LabeledContent("Access", value: model.healthState.title)
            if model.healthState == .notAsked {
                Button("Allow Health access") { model.requestHealthAccess() }
            }
        } footer: {
            Text("Astrum reads your Apple Watch's readings from Health and sends them to the hub. It writes nothing to Health. You can skip this.")
        }
    }
}

private struct NotificationStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section {
            LabeledContent("Notifications", value: model.notificationText)
            Button("Open the Settings app") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
        } footer: {
            Text("Alerts about you, and alerts everyone is told, arrive as time-sensitive notifications, also on a locked phone and the Apple Watch.")
        }
    }
}

#Preview {
    OnboardingView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
