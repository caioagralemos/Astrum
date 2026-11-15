// The first run, five screens in order: find the hub (Bonjour, or a typed
// address), who are you (the hub's crew as faces), Health, then
// notifications and Bluetooth, then ready. One screen at a time, no swiping, so
// each permission is asked on its own screen with its reason, and every answer
// is reported as it really is. Shown until a hub and a crewmate are stored and
// the steps are done; Settings can run it again.

import CoreBluetooth
import SwiftUI
import UIKit

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step = Step.hub
    /// The hub screen moves on by itself only the first time; coming back to it, it waits.
    @State private var hubLeft = false

    enum Step: Int, CaseIterable {
        case hub, person, health, alerts, ready
    }

    var body: some View {
        screen
            .id(step)
            .transition(.astrumRise(reduceMotion: reduceMotion))
            .environment(\.setupNav, nav)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .foregroundStyle(.white)
        .tint(.white)
        .task { await model.refreshPermissions() }
    }

    /// The current screen, one subview each.
    @ViewBuilder
    private var screen: some View {
        switch step {
        case .hub: HubStep(autoContinue: !hubLeft, next: next)
        case .person: PersonStep(next: next)
        case .health: HealthStep(next: next)
        case .alerts: AlertsStep(next: next)
        case .ready: ReadyStep()
        }
    }

    private var nav: SetupNav {
        var nav = SetupNav(step: step.rawValue, total: Step.allCases.count)
        if let previous = Step(rawValue: step.rawValue - 1) {
            nav.back = { go(to: previous) }
        }
        return nav
    }

    private func next() {
        if step == .hub { hubLeft = true }
        if let following = Step(rawValue: step.rawValue + 1) { go(to: following) }
    }

    private func go(to target: Step) {
        withAnimation(Motion.reduced(Motion.content, reduceMotion)) { step = target }
    }
}

/// Where the first run (or the check-in) is, for the page's progress bar, Back and Close.
struct SetupNav: Sendable {
    var step = 0
    var total = 5
    var back: (@MainActor @Sendable () -> Void)?
    /// A close mark beside the progress, for a page shown as a sheet.
    var close: (@MainActor @Sendable () -> Void)?
    var closeHint: String?
}

extension EnvironmentValues {
    @Entry var setupNav = SetupNav()
}

// MARK: The page

/// One screen: a projection frame filling most of the screen (12 pt in from the
/// sides and the safe area), with the progress at its top, the icon (or a face),
/// title, sentence and the step's own content, and the buttons pinned at its
/// bottom: Back outlined on the left, the main action filled on the right.
/// VoiceOver lands on the title each time a screen appears. Shared with the check-in.
struct SetupPage<Content: View, Buttons: View>: View {
    var icon: HubIconName?
    /// A face in a circle in place of the icon (the last screen).
    var face: CrewMember?
    /// A system symbol in place of the icon (the check-in's end).
    var symbol: String?
    let title: String
    /// What VoiceOver reads for the title, when it says more than the words shown.
    var titleLabel: Text?
    var sentence: String?
    /// Centred both ways (the last screen); otherwise from the top, left-aligned.
    var centered = false
    @ViewBuilder var content: Content
    /// Stacked, the main action last: it sits beside Back.
    @ViewBuilder var buttons: Buttons
    @Environment(\.setupNav) private var nav
    @AccessibilityFocusState private var titleFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            progress
                .padding(.top, 14)
                .padding(.horizontal, 20)
            GeometryReader { viewport in
                ScrollView {
                    words
                        .frame(maxWidth: .infinity, minHeight: viewport.size.height, alignment: centered ? .center : .top)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            buttonRow
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .projectionFrame()
        .padding(12)
        .task {
            // After the screen has settled, so VoiceOver does not drop the move.
            try? await Task.sleep(for: .milliseconds(450))
            titleFocused = true
        }
    }

    /// One segment per screen, across the frame's inner width.
    private var progress: some View {
        HStack(spacing: 12) {
            HStack(spacing: 4) {
                ForEach(0..<nav.total, id: \.self) { index in
                    Capsule()
                        .fill(.white.opacity(index <= nav.step ? 1 : 0.2))
                        .frame(height: 2)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Step \(nav.step + 1) of \(nav.total)"))
            if let close = nav.close {
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.body.weight(.medium))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.pressable)
                .padding(.vertical, -14)
                .accessibilityLabel(Text("Close"))
                .accessibilityHint(nav.closeHint.map { Text($0) } ?? Text(verbatim: ""))
            }
        }
    }

    private var words: some View {
        VStack(alignment: centered ? .center : .leading, spacing: 10) {
            if let icon {
                HubIcon(icon, size: 34, weight: 1.5, relativeTo: .title)
                    .accessibilityHidden(true)
                    .padding(.bottom, 4)
            }
            if let face {
                CrewPortrait(member: face, shape: .circle)
                    .frame(width: 96, height: 96)
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                    .padding(.bottom, 8)
            }
            if let symbol {
                Image(systemName: symbol)
                    .font(.largeTitle.weight(.light))
                    .accessibilityHidden(true)
                    .padding(.bottom, 4)
            }
            Text(title)
                .font(.title2.weight(.bold))
                .accessibilityLabel(titleLabel ?? Text(title))
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($titleFocused)
            if let sentence {
                Text(sentence)
                    .font(.callout)
                    .foregroundStyle(HubStyle.muted)
            }
            content
        }
        .multilineTextAlignment(centered ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
        .padding(.top, 28)
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }

    /// Back beside the stacked actions, bottom-aligned; under each other at the largest text sizes.
    @ViewBuilder
    private var buttonRow: some View {
        if let back = nav.back {
            let backButton = SetupButton(Text("Back"), .outlined, natural: true, action: back)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: 12) {
                    backButton
                    VStack(spacing: 10) { buttons }
                }
                VStack(spacing: 10) {
                    buttons
                    SetupButton(Text("Back"), .outlined, action: back)
                }
            }
        } else {
            VStack(spacing: 10) { buttons }
        }
    }
}

/// The emergency screens' button language: 48 high, radius 8. Filled white for
/// the main action, a white outline for another, a faint outline for "not now".
struct SetupButton: View {
    enum Kind { case filled, outlined, quiet }

    let title: Text
    let kind: Kind
    /// As wide as its words (Back, beside the main action), instead of the full width.
    var natural = false
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    init(_ title: Text, _ kind: Kind, natural: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.kind = kind
        self.natural = natural
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            title
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .frame(maxWidth: natural ? nil : .infinity, minHeight: 48)
                .foregroundStyle(kind == .filled ? Color.black : kind == .quiet ? HubStyle.muted : .white)
                .background {
                    let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
                    switch kind {
                    case .filled: shape.fill(.white)
                    case .outlined: shape.strokeBorder(.white, lineWidth: 1.5)
                    case .quiet: shape.strokeBorder(.white.opacity(0.3), lineWidth: 1)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.pressable)
        .font(.subheadline.weight(kind == .quiet ? .medium : .semibold))
        .opacity(isEnabled ? 1 : 0.4)
    }
}

/// One plain line of what happened, with a shape so colour is never the only cue.
private struct ResultLine: View {
    let text: String
    let good: Bool

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: good ? "checkmark.circle" : "minus.circle")
        }
        .font(.callout)
        .foregroundStyle(good ? .white : HubStyle.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}

// MARK: 1 · Find the hub

private struct HubStep: View {
    let autoContinue: Bool
    let next: () -> Void
    @Environment(AppModel.self) private var model
    @State private var typing = false
    @State private var typed = ""
    @State private var problem: String?
    @State private var gaveUp = false
    @FocusState private var fieldFocused: Bool

    var body: some View {
        SetupPage(
            icon: .wifi,
            title: String(localized: "Looking for your hub"),
            sentence: String(localized: "Stay on the same Wi-Fi as the hub. Astrum finds it by itself.")
        ) {
            status
                .padding(.top, 12)
            if typing { typeField.padding(.top, 8) }
        } buttons: {
            if !typing {
                SetupButton(Text("Type the address"), model.link == .connected ? .quiet : .outlined) {
                    typing = true
                    fieldFocused = true
                }
            }
            if model.link == .connected {
                SetupButton(Text("Continue"), .filled, action: next)
            }
        }
        // No hub after a while: say so, and keep looking.
        .task {
            try? await Task.sleep(for: .seconds(12))
            gaveUp = true
        }
        // Found and connected: on to the next screen after a short beat.
        .task(id: model.link == .connected) {
            guard autoContinue, model.link == .connected else { return }
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled, model.link == .connected else { return }
            next()
        }
    }

    /// The discovery's real state.
    @ViewBuilder
    private var status: some View {
        HStack(spacing: 12) {
            if let address = model.address {
                let name = model.finder.hubs.first(where: { $0.address == address })?.name ?? address.display
                if model.link == .connected {
                    Image(systemName: "checkmark.circle.fill").accessibilityHidden(true)
                    Text("Found \(name)")
                } else {
                    Image(systemName: model.link.symbol).accessibilityHidden(true)
                    Text(verbatim: "\(model.link.title) · \(address.display)")
                }
            } else if gaveUp {
                Image(systemName: "exclamationmark.triangle").accessibilityHidden(true)
                Text("No hub found on this Wi-Fi yet. Still looking.")
            } else {
                HubLoadingMark(width: 40)
                    .accessibilityHidden(true)
                Text("Searching this Wi-Fi network…")
            }
        }
        .font(.callout)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .animation(Motion.calm, value: model.link)
    }

    private var typeField: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Address, for example 192.168.1.20", text: $typed)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($fieldFocused)
                .onSubmit(useTyped)
                .projectionField()
                .accessibilityLabel("Hub address")
            SetupButton(Text("Use this address"), .filled, action: useTyped)
                .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
            if let problem {
                Text(problem)
                    .font(.callout)
                    .foregroundStyle(HubStyle.muted)
            }
        }
    }

    private func useTyped() {
        guard let address = HubAddress(text: typed) else {
            problem = String(localized: "That is not an address. Try something like 192.168.1.20 or 192.168.1.20:4310.")
            return
        }
        problem = nil
        fieldFocused = false
        model.choose(address: address, automatic: false)
    }
}

// MARK: 2 · Who are you?

private struct PersonStep: View {
    let next: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var chosen: String?

    var body: some View {
        let crew = model.crew
        let picked = crew.first { $0.id == (chosen ?? model.person) }
        SetupPage(title: String(localized: "Who are you?"), sentence: aboard(crew.count)) {
            if crew.isEmpty {
                empty.padding(.top, 12)
            } else {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(crew) { member in
                        tile(member, selected: member.id == picked?.id)
                    }
                }
                .padding(.top, 12)
                Text("Not here? Add crewmates on the hub.")
                    .font(.footnote)
                    .foregroundStyle(HubStyle.muted)
                    .padding(.top, 6)
            }
        } buttons: {
            SetupButton(picked.map { Text("I'm \($0.name)") } ?? Text("Choose yourself"), .filled) {
                guard let picked else { return }
                model.choose(person: picked.id)
                next()
            }
            .disabled(picked == nil)
        }
    }

    private var oneColumn: Bool { typeSize.isAccessibilitySize }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: oneColumn ? 1 : 2)
    }

    private func aboard(_ count: Int) -> String? {
        guard count > 0 else { return nil }
        if let place = Signals.placeName(model.world.profile) {
            return String(localized: "\(place) · \(count) aboard")
        }
        return String(localized: "\(count) aboard")
    }

    /// No crew yet: waiting for the hub, or the hub really has none. Never a made-up person.
    @ViewBuilder
    private var empty: some View {
        if model.link == .connected && model.world.profile != nil {
            ResultLine(text: String(localized: "Set up the crew on the hub first."), good: false)
        } else {
            HStack(spacing: 10) {
                ProgressView()
                Text("Waiting for the hub to send the crew.")
            }
            .font(.callout)
            .foregroundStyle(HubStyle.muted)
            .accessibilityElement(children: .combine)
        }
    }

    private func tile(_ member: CrewMember, selected: Bool) -> some View {
        let role = member.role.isEmpty ? nil : Signals.roleName(member.role)
        return Button {
            chosen = member.id
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            let face = CrewPortrait(member: member)
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(.white.opacity(selected ? 1 : 0.3), lineWidth: selected ? 2 : 1)
                }
                .overlay(alignment: .topTrailing) {
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.white, .black)
                            .padding(6)
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    if member.isMedicalOfficer && !oneColumn { badge.padding(6) }
                }
            let words = VStack(alignment: oneColumn ? .leading : .center, spacing: 2) {
                Text(member.name).font(.subheadline.weight(.semibold))
                if let role {
                    Text(role).font(.caption).foregroundStyle(HubStyle.muted)
                }
                if member.isMedicalOfficer && oneColumn { badge.padding(.top, 4) }
            }
            .multilineTextAlignment(oneColumn ? .leading : .center)
            if oneColumn {
                HStack(spacing: 14) {
                    face.frame(width: 72)
                    words
                    Spacer(minLength: 0)
                }
            } else {
                VStack(spacing: 8) {
                    face
                    words
                }
            }
        }
        .buttonStyle(.pressable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text([member.name, role, member.isMedicalOfficer ? String(localized: "Medical officer") : nil]
            .compactMap { $0 }.joined(separator: ", ")))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .animation(Motion.calm, value: selected)
    }

    private var badge: some View {
        Text("Medical officer")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Capsule().fill(.black.opacity(0.7)))
            .overlay(Capsule().strokeBorder(.white.opacity(0.6), lineWidth: 1))
            .foregroundStyle(.white)
    }
}

// MARK: 3 · Share your readings

private struct HealthStep: View {
    let next: () -> Void
    @Environment(AppModel.self) private var model
    @State private var asking = false

    var body: some View {
        SetupPage(
            icon: .heart,
            title: String(localized: "Share your readings"),
            sentence: String(localized: "Heart rate, sleep and blood oxygen from your Watch go to the hub on this base. Nothing leaves it.")
        ) {
            switch model.healthState {
            case .unavailable:
                ResultLine(text: String(localized: "Health is not available on this device. Astrum works without it."), good: false)
            case .asked:
                // iOS never tells an app which readings it may see: say what can be known.
                ResultLine(text: String(localized: "Asked. If no readings reach the hub, check the Settings app, under Health."), good: true)
            case .notAsked:
                EmptyView()
            }
        } buttons: {
            if model.healthState == .notAsked {
                SetupButton(Text("Not now"), .quiet, action: next)
                SetupButton(Text("Allow Health"), .filled) {
                    asking = true
                    Task {
                        await model.askForHealth()
                        asking = false
                    }
                }
                .disabled(asking)
            } else {
                SetupButton(Text("Continue"), .filled, action: next)
            }
        }
    }
}

// MARK: 4 · Let Astrum reach you

private struct AlertsStep: View {
    let next: () -> Void
    @Environment(AppModel.self) private var model
    @State private var notifications: NotificationAccess?
    @State private var notificationsDeclined = false
    @State private var bluetoothAsked = false
    /// iOS's Bluetooth answer, read again until it arrives (no callback carries it reliably).
    @State private var bluetoothAuthorization = CBManager.authorization
    @State private var bluetoothDeclined = false

    var body: some View {
        SetupPage(
            icon: .alerts,
            title: String(localized: "Let Astrum reach you"),
            sentence: String(localized: "It asks “Are you OK?” when a reading looks wrong, and tells you when a crewmate needs help.")
        ) {
            if let line = notificationLine {
                ResultLine(text: line.text, good: line.good)
            }
            if notificationsAnswered {
                VStack(alignment: .leading, spacing: 8) {
                    Rectangle()
                        .fill(.white.opacity(HubStyle.hairline))
                        .frame(height: 1)
                        .padding(.vertical, 10)
                        .accessibilityHidden(true)
                    Label {
                        Text("Bluetooth")
                    } icon: {
                        HubIcon(.board, size: 20, relativeTo: .headline)
                    }
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                    Text("So the hub knows which room you are in.")
                        .font(.callout)
                        .foregroundStyle(HubStyle.muted)
                    if let line = bluetoothLine {
                        ResultLine(text: line.text, good: line.good)
                    }
                }
                .transition(.opacity)
            }
        } buttons: {
            if !notificationsAnswered {
                SetupButton(Text("Not now"), .quiet) { notificationsDeclined = true }
                SetupButton(Text("Allow notifications"), .filled) {
                    Task { notifications = await model.askForNotifications() }
                }
            } else if !bluetoothAnswered {
                SetupButton(Text("Not now"), .quiet) { bluetoothDeclined = true }
                SetupButton(Text("Allow Bluetooth"), .filled) {
                    bluetoothAsked = true
                    model.startRoomLocation(asking: true)
                    Task {
                        while CBManager.authorization == .notDetermined {
                            try? await Task.sleep(for: .milliseconds(300))
                        }
                        bluetoothAuthorization = CBManager.authorization
                    }
                }
                .disabled(bluetoothAsked)
            } else {
                SetupButton(Text("Continue"), .filled, action: next)
            }
        }
        .animation(Motion.calm, value: notificationsAnswered)
        .task { notifications = await AppModel.notificationAccess() }
    }

    private var notificationsAnswered: Bool {
        notificationsDeclined || (notifications.map { $0 != .notAsked } ?? false)
    }

    private var notificationLine: (text: String, good: Bool)? {
        if notificationsDeclined && !(notifications?.allowed ?? false) {
            return (String(localized: "Without notifications, alerts reach you only while Astrum is open."), false)
        }
        switch notifications {
        case .allowed: return (String(localized: "Notifications are on, time-sensitive."), true)
        case .allowedNotTimeSensitive: return (String(localized: "Notifications are on, but not time-sensitive: a Focus can hold an alert back."), true)
        case .denied: return (String(localized: "Notifications are off: alerts reach you only while Astrum is open."), false)
        case .notAsked, nil: return nil
        }
    }

    private var bluetoothAnswered: Bool {
        bluetoothDeclined || bluetoothAuthorization != .notDetermined
    }

    private var bluetoothLine: (text: String, good: Bool)? {
        switch bluetoothAuthorization {
        case .notDetermined:
            return bluetoothDeclined ? (String(localized: "Without Bluetooth, the hub will not know which room you are in."), false) : nil
        case .denied, .restricted:
            return (String(localized: "Not allowed: the hub will not know which room you are in."), false)
        case .allowedAlways:
            switch model.roomLocator.state {
            case .bluetoothOff: return (String(localized: "Allowed, but Bluetooth is off: turn it on for room location."), false)
            case .unavailable: return (String(localized: "This device cannot find the room boards."), false)
            default: return (String(localized: "Bluetooth is on for room location."), true)
            }
        @unknown default:
            return nil
        }
    }
}

// MARK: 5 · Ready

private struct ReadyStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let member = model.crew.first { $0.id == model.person }
        let name = member?.name ?? model.personName ?? ""
        SetupPage(
            face: member,
            title: String(localized: "You're on board, \(name)."),
            sentence: String(localized: "Your first check-in takes a minute. Astrum learns what is usual for you from here."),
            centered: true
        ) {
            EmptyView()
        } buttons: {
            SetupButton(Text("Later"), .quiet) {
                model.finishOnboarding()
                model.selectedTab = .me
            }
            SetupButton(Text("Do my first check-in"), .filled) {
                model.finishOnboarding()
                model.startTodaysCheckIn()
            }
        }
    }
}

#Preview {
    OnboardingView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
