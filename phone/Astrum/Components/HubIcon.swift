// The hub's own line icons, drawn from the same SVG path data as
// hub/ui/src/person/icons.tsx (signals, trends) and hub/ui/src/dock/widgets.tsx
// (the widget headers), so the phone and the hub draw the same marks.
// Each is a whole shape centred in a 24 x 24 box, stroked with round caps and
// joins; the stroke weight is in that box's units, as in the hub's CSS.
// Decorative: the text beside an icon always carries its meaning.

import SwiftUI

enum HubIconName: String, CaseIterable, Sendable {
    // Signals (person/icons.tsx).
    case heart, pressure, wake, bed, moon, dumbbell, head, stress, tired, sleepy, mood
    case co2, oxygen, temperature, humidity, air, radiation, noise, light, vibration
    // Trends.
    case up, down, flat
    // Anything without its own icon.
    case dot
    // The dock widgets' headers (dock/widgets.tsx) that the list above lacks.
    case crew, alerts, earth, mission, exposure, board
    // The dock's footer glyphs (dock/widgets.tsx) and the top bar's (App.tsx, panels/MainPanels.tsx).
    case home, clock, send, warn, wifi, ask

    /// The SVG path, copied from the hub as is.
    var d: String {
        switch self {
        case .heart: "M12 19.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 7.1a4.1 4.1 0 0 1 7.5 2.3c0 5.5-7.5 10.1-7.5 10.1z"
        case .pressure: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 13l3.5-4M7.5 13h1M12 7.5v1M15.5 13h1"
        case .wake: "M12 6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM12 10v3l2 1.5M4.5 6.5l2.5-2.5M19.5 6.5L17 4M8 19.5l-1.5 1.5M16 19.5l1.5 1.5"
        case .bed: "M3.5 6v13M3.5 15.5h17V19M20.5 15.5v-3a2.5 2.5 0 0 0-2.5-2.5h-7.5v5.5M7 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
        case .moon: "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"
        case .dumbbell: "M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11"
        case .head: "M9 20.5v-3.2A6.5 6.5 0 1 1 18 11.8l1.5 3h-1.7v2.2a1.5 1.5 0 0 1-1.5 1.5h-1.8v2M9.5 8.5l2 1M13.5 6.5l-.5 2"
        case .stress: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM6 12h2.5l1.5-3.5 2.5 7 1.5-3.5h4"
        case .tired: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8 10.5h2.5M13.5 10.5H16M9.5 15.5h5"
        case .sleepy: "M11 4a8.5 8.5 0 1 0 9 9M7.5 11.5c.8.8 1.7.8 2.5 0M12.5 11.5c.8.8 1.7.8 2.5 0M15 3.5h4l-4 4h4"
        case .mood: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.5 14c2 2 5 2 7 0M9 9.5v.5M15 9.5v.5"
        case .co2: "M5.2 12H9M15 12h3.8M5.2 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM23 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0z"
        case .oxygen: "M9.5 7a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM17.5 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7.5 11.5a2.5 2.5 0 0 1 2-2"
        case .temperature: "M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0zM12 11v6"
        case .humidity: "M12 3.5s-6 6.6-6 10.5a6 6 0 0 0 12 0c0-3.9-6-10.5-6-10.5zM9 15a3 3 0 0 0 3 3"
        case .air: "M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7"
        case .radiation: "M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM10.5 9.4 7.5 4.2A8.5 8.5 0 0 0 3.5 11.5h6M13.5 9.4l3-5.2a8.5 8.5 0 0 1 4 7.3h-6M10.5 14.6l-3 5.2a8.5 8.5 0 0 0 9 0l-3-5.2"
        case .noise: "M4 9.5h3l4.5-4v13L7 14.5H4zM15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11"
        case .light: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"
        case .vibration: "M2.5 12h3l1.5-4 3 8 3-10 3 10 2-4h3.5"
        case .up: "M7 17L17 7M9.5 7H17v7.5"
        case .down: "M7 7l10 10M17 9.5V17H9.5"
        case .flat: "M6.5 12h11"
        case .dot: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"
        case .crew: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5"
        case .alerts: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0"
        case .earth: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z"
        case .mission: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2"
        case .exposure: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7v5h4.5"
        case .board: "M5 5h14v14H5zM9 9h6v6H9zM9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"
        case .home: "M4 10.5 12 4l8 6.5v9a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5z"
        case .clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2"
        case .send: "M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z"
        case .warn: "M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.1"
        case .wifi: "M2.5 9a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.6 15.4a5 5 0 0 1 6.8 0"
        case .ask: "M12 3.5c.6 4.6 1.9 5.9 6.5 6.5c-4.6.6-5.9 1.9-6.5 6.5c-.6-4.6-1.9-5.9-6.5-6.5c4.6-.6 5.9-1.9 6.5-6.5zM18.5 16.5l.5 2l2 .5l-2 .5l-.5 2l-.5-2l-2-.5l2-.5z"
        }
    }

    /// The hub's icon for a signal (FOR_SIGNAL in icons.tsx). The phone's own
    /// signals take the hub icon for the same thing; the rest take the dot, as on the hub.
    init(signal: String) {
        switch signal {
        case "heart_rate", "hrv", "resting_heart_rate": self = .heart
        case "blood_pressure_systolic", "blood_pressure_diastolic", "pressure": self = .pressure
        case "sleep_duration": self = .moon
        case "sleep_efficiency": self = .bed
        case "sleep_awakenings": self = .wake
        case "exercise_minutes": self = .dumbbell
        case "checkin.headache": self = .head
        case "checkin.mood": self = .mood
        case "mood.stress", "checkin.stress": self = .stress
        case "mood.fatigue", "checkin.fatigue": self = .tired
        case "mood.sleepy": self = .sleepy
        case "co2": self = .co2
        case "oxygen", "blood_oxygen": self = .oxygen
        case "temperature": self = .temperature
        case "humidity": self = .humidity
        case "air_quality": self = .air
        case "radiation": self = .radiation
        case "noise", "sound_level": self = .noise
        case "light": self = .light
        case "vibration": self = .vibration
        default: self = .dot
        }
    }
}

/// One hub icon as a shape, fitted to the middle of its frame.
struct HubIconShape: Shape {
    let name: HubIconName

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let transform = CGAffineTransform(translationX: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
            .scaledBy(x: scale, y: scale)
        return SVGPath.parse(name.d).applying(transform)
    }
}

/// A hub icon at a size that follows Dynamic Type, stroked as the hub strokes it.
/// Hidden from VoiceOver: the words next to it say what it is.
struct HubIcon: View {
    let name: HubIconName
    private let weight: CGFloat
    @ScaledMetric private var side: CGFloat

    /// `size` is the hub's size in points (22 for `.icon`, 14.4 in a widget header);
    /// `weight` its stroke width in the 24-unit box (1.5, or 2 at small sizes).
    init(_ name: HubIconName, size: CGFloat = 22, weight: CGFloat = 1.5, relativeTo style: Font.TextStyle = .body) {
        self.name = name
        self.weight = weight
        _side = ScaledMetric(wrappedValue: size, relativeTo: style)
    }

    init(signal: String, size: CGFloat = 22, weight: CGFloat = 1.5, relativeTo style: Font.TextStyle = .body) {
        self.init(HubIconName(signal: signal), size: size, weight: weight, relativeTo: style)
    }

    var body: some View {
        HubIconShape(name: name)
            .stroke(style: StrokeStyle(lineWidth: weight * side / 24, lineCap: .round, lineJoin: .round))
            .frame(width: side, height: side)
            .accessibilityHidden(true)
    }
}

// MARK: Reading the path data

/// The subset of SVG path syntax the hub's icons use: M L H V C S A Z, absolute
/// and relative, with the compact number forms ("1.5-1.5", ".8.8").
enum SVGPath {
    static func parse(_ d: String) -> Path {
        var path = Path()
        var reader = Reader(Array(d.unicodeScalars))
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var command: Unicode.Scalar = "M"

        while true {
            if let next = reader.command() {
                command = next
            } else if !reader.atNumber {
                break
            }
            let relative = CharacterSet.lowercaseLetters.contains(command)
            let origin = relative ? current : .zero
            func point() -> CGPoint {
                let x = reader.number(), y = reader.number()
                return CGPoint(x: origin.x + x, y: origin.y + y)
            }
            var control: CGPoint?

            switch command {
            case "M", "m":
                current = point()
                start = current
                path.move(to: current)
                // Pairs after a move are lines.
                command = relative ? "l" : "L"
            case "L", "l":
                current = point()
                path.addLine(to: current)
            case "H", "h":
                current.x = origin.x + reader.number()
                path.addLine(to: current)
            case "V", "v":
                current.y = (relative ? current.y : 0) + reader.number()
                path.addLine(to: current)
            case "C", "c":
                let c1 = point(), c2 = point(), end = point()
                path.addCurve(to: end, control1: c1, control2: c2)
                control = c2
                current = end
            case "S", "s":
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = point(), end = point()
                path.addCurve(to: end, control1: c1, control2: c2)
                control = c2
                current = end
            case "A", "a":
                let rx = reader.number(), ry = reader.number(), rotation = reader.number()
                let large = reader.flag(), sweep = reader.flag()
                let end = point()
                arc(&path, from: current, to: end, rx: rx, ry: ry, degrees: rotation, large: large, sweep: sweep)
                current = end
            case "Z", "z":
                path.closeSubpath()
                current = start
            default:
                return path
            }
            lastControl = control
        }
        return path
    }

    /// An SVG arc as a centre-parameterised arc (SVG 1.1, appendix F.6.5).
    private static func arc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx: CGFloat, ry: CGFloat,
                            degrees: CGFloat, large: Bool, sweep: Bool) {
        guard p0 != p1 else { return }
        var rx = abs(rx), ry = abs(ry)
        guard rx > 0, ry > 0 else { path.addLine(to: p1); return }
        let phi = degrees * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy
        let y1 = -sinPhi * dx + cosPhi * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= lambda.squareRoot(); ry *= lambda.squareRoot() }
        let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var factor = (max(0, numerator / denominator)).squareRoot()
        if large == sweep { factor = -factor }
        let cx1 = factor * rx * y1 / ry
        let cy1 = -factor * ry * x1 / rx
        let center = CGPoint(x: cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2,
                             y: sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2)
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        }
        let ux = (x1 - cx1) / rx, uy = (y1 - cy1) / ry
        let theta = angle(1, 0, ux, uy)
        var delta = angle(ux, uy, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi } else if sweep && delta < 0 { delta += 2 * .pi }
        // A unit circle, scaled, turned and moved into place. A positive sweep runs
        // with increasing angle, which Core Graphics calls counterclockwise.
        let transform = CGAffineTransform(translationX: center.x, y: center.y).rotated(by: phi).scaledBy(x: rx, y: ry)
        path.addArc(center: .zero, radius: 1, startAngle: .radians(theta), endAngle: .radians(theta + delta),
                    clockwise: !sweep, transform: transform)
    }

    private struct Reader {
        let scalars: [Unicode.Scalar]
        var index = 0

        init(_ scalars: [Unicode.Scalar]) { self.scalars = scalars }

        private mutating func skipSeparators() {
            while index < scalars.count, scalars[index] == " " || scalars[index] == "," || scalars[index] == "\n" { index += 1 }
        }

        mutating func command() -> Unicode.Scalar? {
            skipSeparators()
            guard index < scalars.count, CharacterSet.letters.contains(scalars[index]) else { return nil }
            defer { index += 1 }
            return scalars[index]
        }

        var atNumber: Bool {
            mutating get {
                skipSeparators()
                guard index < scalars.count else { return false }
                return CharacterSet.decimalDigits.contains(scalars[index]) || "+-.".unicodeScalars.contains(scalars[index])
            }
        }

        mutating func number() -> CGFloat {
            skipSeparators()
            var text = ""
            var seenDot = false
            if index < scalars.count, scalars[index] == "-" || scalars[index] == "+" {
                text.unicodeScalars.append(scalars[index])
                index += 1
            }
            while index < scalars.count {
                let s = scalars[index]
                if CharacterSet.decimalDigits.contains(s) {
                    text.unicodeScalars.append(s)
                } else if s == ".", !seenDot {
                    seenDot = true
                    text.unicodeScalars.append(s)
                } else {
                    break
                }
                index += 1
            }
            return CGFloat(Double(text) ?? 0)
        }

        /// Arc flags are single digits and may run together ("0 1 0" or "010").
        mutating func flag() -> Bool {
            skipSeparators()
            guard index < scalars.count else { return false }
            defer { index += 1 }
            return scalars[index] == "1"
        }
    }
}

#Preview("Hub icons") {
    let columns = [GridItem(.adaptive(minimum: 64))]
    return ScrollView {
        LazyVGrid(columns: columns, spacing: 16) {
            ForEach(HubIconName.allCases, id: \.self) { name in
                VStack(spacing: 6) {
                    HubIcon(name, size: 28)
                    Text(verbatim: name.rawValue).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding()
    }
    .preferredColorScheme(.dark)
}
