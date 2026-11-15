// The Messages look Ask Astra's thread is drawn in, carried over from the
// owner's Aimbot chat (Views/ChatBubbles.swift, ChatTimes.swift and the
// bubble, typing dots and composer pill in IntelligenceView.swift): the
// bubble with its tail on a run's last message, Messages' grey and blue, the
// centred times between stretches of the chat, the three dots. This tab is
// the one place that follows Messages rather than the projection frames.

import SwiftUI
import UIKit

/// Messages' bubble. The tail curls off the bottom corner on the speaker's
/// side, and only the last bubble of a run has it. One outline, tail
/// included, drawn for the incoming side and mirrored for the owner's.
struct ChatBubbleShape: Shape {
    let isMine: Bool
    let hasTail: Bool

    /// Messages' grey, in both appearances.
    static let incomingFill = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 0.23, alpha: 1) : UIColor(white: 0.91, alpha: 1)
    })
    /// Messages' blue.
    static let outgoingFill = Color(uiColor: .systemBlue)
    /// The footer band of an attachment, a step darker than the bubble (a link preview's title bar).
    static let bandFill = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 0.17, alpha: 1) : UIColor(white: 0.85, alpha: 1)
    })

    func path(in rect: CGRect) -> Path {
        let r = min(17, rect.height / 2)
        guard hasTail else { return Path(roundedRect: rect, cornerRadius: r, style: .continuous) }
        let w = rect.width, h = rect.height
        var p = Path()
        p.move(to: CGPoint(x: r, y: 0))
        p.addLine(to: CGPoint(x: w - r, y: 0))
        p.addQuadCurve(to: CGPoint(x: w, y: r), control: CGPoint(x: w, y: 0))
        p.addLine(to: CGPoint(x: w, y: h - r))
        p.addQuadCurve(to: CGPoint(x: w - r, y: h), control: CGPoint(x: w, y: h))
        p.addLine(to: CGPoint(x: 16, y: h))
        // Out along the baseline to a tip past the side, then a concave sweep back up into it.
        p.addCurve(to: CGPoint(x: -6, y: h),
                   control1: CGPoint(x: 8, y: h + 0.5), control2: CGPoint(x: -1, y: h + 0.5))
        p.addCurve(to: CGPoint(x: 0, y: h - 15),
                   control1: CGPoint(x: 1, y: h - 3), control2: CGPoint(x: 0, y: h - 8))
        p.addLine(to: CGPoint(x: 0, y: r))
        p.addQuadCurve(to: CGPoint(x: r, y: 0), control: CGPoint(x: 0, y: 0))
        p.closeSubpath()
        let placement = isMine
            ? CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: rect.maxX, ty: rect.minY)
            : CGAffineTransform(translationX: rect.minX, y: rect.minY)
        return p.applying(placement)
    }
}

extension View {
    /// Inside a bubble: Messages' padding and the speaker's fill.
    func chatBubble(isMine: Bool, hasTail: Bool) -> some View {
        padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(ChatBubbleShape(isMine: isMine, hasTail: hasTail)
                .fill(isMine ? ChatBubbleShape.outgoingFill : ChatBubbleShape.incomingFill))
    }
}

/// A plain text bubble: the owner's words in white on blue, Astra's in the
/// primary ink on grey. Always its full height; holding it offers Copy.
struct ChatTextBubble: View {
    let text: String
    let isMine: Bool
    let hasTail: Bool

    var body: some View {
        Text(text)
            .foregroundStyle(isMine ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .fixedSize(horizontal: false, vertical: true)
            .chatBubble(isMine: isMine, hasTail: hasTail)
            .contextMenu {
                Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
            }
    }
}

/// One side's row: the bubble against its side, room kept on the far side
/// so a run never spans the whole width (less at accessibility sizes).
struct ChatRow<Content: View>: View {
    let isMine: Bool
    @ViewBuilder let content: Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            if isMine { Spacer(minLength: farGap) }
            content
            if !isMine { Spacer(minLength: farGap) }
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
    }

    private var farGap: CGFloat { typeSize.isAccessibilitySize ? 24 : 60 }
}

/// Messages' three dots while an answer is being prepared. Reduce Motion keeps them still.
struct TypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { dot in
                    // Each dot brightens in turn.
                    let phase = (sin(time * 5 - Double(dot) * 0.9) + 1) / 2
                    Circle()
                        .fill(.secondary)
                        .frame(width: 7, height: 7)
                        .opacity(reduceMotion ? 0.6 : 0.35 + 0.65 * phase)
                        .offset(y: reduceMotion ? 0 : -2.5 * phase)
                }
            }
            .padding(.vertical, 5)
        }
        .accessibilityHidden(true)
    }
}

/// When messages were sent, as Messages shows it: a centred time above a
/// message that comes after a gap.
enum ChatTimeline {
    /// A gap this long gets its own time above the next message.
    static let gap: TimeInterval = 15 * 60

    static func startsSection(_ date: Date, after previous: Date?) -> Bool {
        guard let previous else { return true }
        return date.timeIntervalSince(previous) >= gap
    }

    /// "Today 13:38", "Yesterday 13:38", "Tuesday 13:38" within the week, then "Tue, 8 Sep at 19:09".
    static func label(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDate(date, inSameDayAs: now) { return String(localized: "Today \(time)") }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        if days == 1 { return String(localized: "Yesterday \(time)") }
        if (2..<7).contains(days) { return "\(date.formatted(.dateTime.weekday(.wide))) \(time)" }
        let sameYear = calendar.isDate(date, equalTo: now, toGranularity: .year)
        let day = date.formatted(sameYear ? .dateTime.weekday(.abbreviated).day().month(.abbreviated)
                                          : .dateTime.weekday(.abbreviated).day().month(.abbreviated).year())
        return String(localized: "\(day) at \(time)")
    }

    /// The time alone, or with its day when it was not today.
    static func short(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        calendar.isDate(date, inSameDayAs: now) ? date.formatted(date: .omitted, time: .shortened) : label(date, now: now, calendar: calendar)
    }
}

/// The centred time between two stretches of the chat.
struct ChatTimeLabel: View {
    let date: Date

    var body: some View {
        Text(ChatTimeline.label(date))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 14)
            .padding(.bottom, 2)
    }
}

/// The composer's surface: Liquid Glass where the system has it, as Messages'
/// field; a thin outline on earlier systems.
struct ComposerPill: ViewModifier {
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.background {
                Color.clear.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
            }
        } else {
            content.background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.secondary.opacity(0.35), lineWidth: 1)
            }
        }
    }
}
