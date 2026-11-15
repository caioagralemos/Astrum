// The small marks every screen shares: a reading's label (Measured,
// Simulated...), a status badge that says in words what colour only hints
// at, and the two status colours, used only when something is wrong.

import SwiftUI

enum StatusTone {
    case quiet
    case watch
    case danger

    var color: Color {
        switch self {
        case .quiet: .secondary
        case .watch: .orange
        case .danger: .red
        }
    }
}

/// The label on every value: how it came to exist.
struct KindBadge: View {
    let kind: Kind

    var body: some View {
        Text(Signals.kindName(kind))
            .font(.caption2.weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(.secondary.opacity(0.5), lineWidth: 0.5))
            .accessibilityLabel(Text("Label: \(Signals.kindName(kind))"))
    }
}

/// A word with a symbol, so status is never shown by colour alone. Above or
/// below the usual takes the hub's trend arrow; anything else a warning sign.
struct StatusBadge: View {
    let text: String
    var tone: StatusTone = .watch
    var trend: HubIconName?

    var body: some View {
        Label {
            Text(text)
        } icon: {
            if let trend {
                HubIcon(trend, size: 14.4, weight: 2.2, relativeTo: .caption)
            } else {
                Image(systemName: tone == .danger ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
            }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(tone.color)
    }
}
