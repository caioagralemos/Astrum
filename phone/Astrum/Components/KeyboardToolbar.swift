// The bar over the keyboard on screens with fields: previous and next field,
// and Done to put the keyboard away. The decimal pad has no return key, so
// without it a number field could not be left.

import SwiftUI

extension View {
    /// Adds previous / next / Done over the keyboard for the fields in `order`,
    /// moving `focus` between them. Put it once per screen, on the scrolling container.
    func keyboardFields<Field: Hashable>(_ focus: FocusState<Field?>.Binding, order: [Field]) -> some View {
        toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                let index = focus.wrappedValue.flatMap { order.firstIndex(of: $0) }
                Button {
                    if let index, index > 0 { focus.wrappedValue = order[index - 1] }
                } label: {
                    Image(systemName: "chevron.up")
                }
                .accessibilityLabel(Text("Previous field"))
                .disabled(index == nil || index == 0)
                Button {
                    if let index, index + 1 < order.count { focus.wrappedValue = order[index + 1] }
                } label: {
                    Image(systemName: "chevron.down")
                }
                .accessibilityLabel(Text("Next field"))
                .disabled(index == nil || index! + 1 >= order.count)
                Spacer()
                Button("Done") { focus.wrappedValue = nil }
                    .fontWeight(.semibold)
                    .accessibilityHint(Text("Hides the keyboard"))
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    /// Keeps the focused field in view above the keyboard: each field carries `.id(field)`.
    func scrollsToFocus<Field: Hashable>(_ focus: Field?, with proxy: ScrollViewProxy) -> some View {
        onChange(of: focus) { _, field in
            guard let field else { return }
            // After the keyboard has started to rise, so the visible area is the one left above it.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(150))
                proxy.scrollTo(field, anchor: .center)
            }
        }
    }
}

/// A number field's row: the name on the left, wrapping to more lines rather
/// than being cut, the field on the right; stacked at accessibility sizes.
/// `tapped` runs on a tap on the name (to put the keyboard away), never on the field.
struct NumberFieldRow<Field: View>: View {
    let name: String
    var tapped: () -> Void = {}
    @ViewBuilder let field: Field
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        layout {
            Text(verbatim: name)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture(perform: tapped)
            field
                .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : 130)
        }
    }
}
