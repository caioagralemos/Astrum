// The owner's radiation dose on Me (the hub's Dose block in PersonView.tsx):
// worked out from room rates and stays, never measured. Today, this mission and
// projected at mission end, each in its own unit; NASA's career limit only beside
// a dose made wholly of dose equivalent. Words and numbers only: no colour, no bar.

import SwiftUI

struct DoseCard: View {
    /// Their dose, or nil when the hub has none for them (no radiation source).
    let dose: PersonDose?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let dose, !dose.amounts.isEmpty {
                HStack(spacing: 4) {
                    KindMark(kind: dose.kind)
                    Text(Self.kindName(dose.kind))
                }
                .font(.caption)
                .foregroundStyle(HubStyle.muted)
                // Every value below says its label aloud.
                .accessibilityHidden(true)

                ForEach(dose.amounts, id: \.quantity) { amount in
                    AmountView(amount: amount, dose: dose, titled: dose.amounts.count > 1)
                }
                ForEach(gapLines(dose), id: \.self) { note($0) }
                if dose.comparable, let limit = dose.limit {
                    note(String(localized: "NASA career limit: less than \(Self.number(limit.value)) \(limit.unit)") + ". "
                         + String(localized: "The limit counts a whole career. This is this mission only."))
                } else if dose.reason == "mixed" {
                    note(String(localized: "Some rooms give absorbed dose (Gy) and others dose equivalent (Sv): shown apart, not compared with NASA's limit."))
                } else if dose.reason == "absorbed" {
                    note(String(localized: "Absorbed dose (Gy) is not dose equivalent (Sv), so it is not compared with NASA's limit in mSv."))
                }
                note(String(localized: "Worked out from the radiation rate of each room and the time spent there. Nobody wears a dosimeter."))
            } else {
                note(String(localized: "No radiation source, so no dose."))
            }
        }
        .padding(.vertical, 4)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(HubStyle.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// "today: location unknown for 5 h, no radiation reading for 12 h", for each window with an hour or more of gaps.
    private func gapLines(_ dose: PersonDose) -> [String] {
        func gaps(_ c: PersonDose.Coverage) -> [String] {
            var list: [String] = []
            if c.unplacedMs >= Self.hour { list.append(String(localized: "location unknown for \(Self.hours(c.unplacedMs)) h")) }
            if c.noRateMs >= Self.hour { list.append(String(localized: "no radiation reading for \(Self.hours(c.noRateMs)) h")) }
            return list
        }
        return [(String(localized: "today"), gaps(dose.today)), (String(localized: "this mission"), gaps(dose.mission))]
            .filter { !$0.1.isEmpty }
            .map { "\($0.0): \($0.1.joined(separator: ", "))" }
    }

    // MARK: Words and numbers

    static let hour: Double = 3_600_000

    static func hours(_ ms: Double) -> Int { Int((ms / hour).rounded()) }

    /// Two significant figures under 1, one decimal above, in the reader's locale.
    static func number(_ value: Double) -> String {
        value != 0 && abs(value) < 1
            ? value.formatted(.number.precision(.significantDigits(1...2)))
            : value.formatted(.number.precision(.fractionLength(0...1)))
    }

    /// The dose's own word (a feminine "dose" in Portuguese, so not the readings' kind names).
    static func kindName(_ kind: Kind) -> String {
        switch kind {
        case .simulated: String(localized: "dose.kind.simulated", defaultValue: "Simulated")
        case .replayed: String(localized: "dose.kind.replayed", defaultValue: "Replayed")
        default: String(localized: "dose.kind.estimated", defaultValue: "Estimated")
        }
    }

    /// The unit as VoiceOver should say it: "millisieverts", not "m S v".
    static func spokenUnit(_ unit: String) -> String {
        switch unit {
        case "Sv": String(localized: "sieverts")
        case "mSv": String(localized: "millisieverts")
        case "uSv", "µSv": String(localized: "microsieverts")
        case "nSv": String(localized: "nanosieverts")
        case "Gy": String(localized: "grays")
        case "mGy": String(localized: "milligrays")
        case "uGy", "µGy": String(localized: "micrograys")
        case "nGy": String(localized: "nanograys")
        default: unit
        }
    }
}

/// One quantity: today, this mission and projected at mission end, then its average per day.
private struct AmountView: View {
    let amount: PersonDose.Amount
    let dose: PersonDose
    /// Named only when the dose holds both quantities.
    let titled: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if titled {
                Text(amount.quantity == "absorbed" ? String(localized: "Absorbed dose") : String(localized: "Dose equivalent"))
                    .font(.subheadline)
                    .accessibilityAddTraits(.isHeader)
            }
            // Side by side; one under another at the largest text sizes.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            layout {
                value(String(localized: "today"), amount.today, share: nil)
                value(String(localized: "this mission"), amount.mission, share: dose.comparable ? dose.ofLimit?.mission : nil)
                if let projected = amount.projected {
                    value(String(localized: "projected at mission end"), projected, share: dose.comparable ? dose.ofLimit?.projected : nil)
                }
            }
            Text(String(localized: "\(DoseCard.number(amount.ratePerDay)) \(amount.unit) a day on average"))
                .font(.footnote)
                .foregroundStyle(HubStyle.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(Text(String(localized: "\(DoseCard.number(amount.ratePerDay)) \(DoseCard.spokenUnit(amount.unit)) a day on average")))
        }
    }

    private func value(_ label: String, _ number: Double, share: Double?) -> some View {
        let shareText = share.map { String(localized: "\(DoseCard.number($0 * 100))% of the career limit") }
        let spoken = [label, "\(DoseCard.number(number)) \(DoseCard.spokenUnit(amount.unit))",
                      DoseCard.kindName(dose.kind).lowercased(), shareText].compactMap { $0 }
        return VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption)
                .foregroundStyle(HubStyle.muted)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(DoseCard.number(number))
                    .font(.title3.monospacedDigit())
                Text(amount.unit)
                    .font(.caption)
                    .foregroundStyle(HubStyle.muted)
            }
            if let shareText {
                Text(shareText)
                    .font(.caption2)
                    .foregroundStyle(HubStyle.muted)
            }
        }
        .frame(maxWidth: typeSize.isAccessibilitySize ? nil : .infinity, alignment: .leading)
        // "this mission, 0.31 millisieverts, simulated, 0.052% of the career limit"
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spoken.joined(separator: ", ")))
    }
}
