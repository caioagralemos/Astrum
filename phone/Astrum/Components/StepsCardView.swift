// A steps card exactly as the medical lead wrote it: the steps word for
// word, what not to do, that she approved it, and her own list of the parts
// not checked against a source (it does not mean the card is unapproved).
// The app adds no advice of its own. Used in Ask Astra and the alert screens.

import SwiftUI

struct StepsCardView: View {
    let card: CardView
    /// True when the card is shown in the other language because this one has none.
    var otherLanguage = false
    /// When set, a tap on the card opens its steps one at a time (StepsModal).
    var onOpen: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let onOpen {
                ProjectionHeader(.warn, "Steps card: \(card.title)")
                    .accessibilityAddTraits([.isHeader, .isButton])
                    .accessibilityAction { onOpen() }
                    .accessibilityHint(Text("Opens the steps one at a time"))
            } else {
                ProjectionHeader(.warn, "Steps card: \(card.title)")
                    .accessibilityAddTraits(.isHeader)
            }
            if otherLanguage {
                Text("This card is only written in another language.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(card.steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(verbatim: "\(index + 1).")
                        .font(.body.monospacedDigit().weight(.semibold))
                    Text(step)
                }
                .accessibilityElement(children: .combine)
            }
            if !card.doNot.isEmpty {
                Text("Do not")
                    .font(.subheadline.weight(.semibold))
                ForEach(card.doNot, id: \.self) { item in
                    Label(item, systemImage: "xmark")
                }
            }
            if card.messageHouston {
                Text("This card says to message Earth.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if card.approvedBy == "medical_lead" {
                Text("Approved by the medical lead.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !card.unverified.isEmpty {
                unchecked
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onOpen?() }
    }

    /// Her list of the parts not checked against a source; a long one folds away.
    @ViewBuilder
    private var unchecked: some View {
        let list = card.unverified.formatted(.list(type: .and))
        if card.unverified.count > 2 {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(card.unverified, id: \.self) { part in
                        Text(verbatim: "• \(part)")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
            } label: {
                Text("Parts not checked against a source: \(card.unverified.count)")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityHint(Text(list))
        } else {
            Text("Parts not checked against a source: \(list)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}
