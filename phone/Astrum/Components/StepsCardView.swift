// A steps card exactly as the medical lead wrote it: the steps word for
// word, what not to do, and whether it is still unverified. The app adds no
// advice of its own.

import SwiftUI

struct StepsCardView: View {
    let card: CardView
    /// True when the card is shown in the other language because this one has none.
    var otherLanguage = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Steps card: \(card.title)")
                .font(.headline)
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
                Text("This card says to message Houston.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !card.unverified.isEmpty {
                Text("Not yet verified by the medical lead")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
