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
        case .quiet: HubStyle.muted
        case .watch: HubStyle.watch
        case .danger: HubStyle.over
        }
    }
}

/// The label on every value: how it came to exist, the hub's mark and its word
/// in a small outlined tag (the hub's label chip, radius 3).
struct KindBadge: View {
    let kind: Kind

    var body: some View {
        HStack(spacing: 4) {
            KindMark(kind: kind)
            Text(Signals.kindName(kind))
        }
        .font(.caption)
        .foregroundStyle(HubStyle.muted)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .overlay(RoundedRectangle(cornerRadius: 3, style: .circular).strokeBorder(.white.opacity(HubStyle.hairline), lineWidth: 1))
        .accessibilityElement(children: .ignore)
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
