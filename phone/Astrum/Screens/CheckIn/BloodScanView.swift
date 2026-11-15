// The blood analyser's screen, read by the camera (many frames, live:
// BloodScanLiveView) or from a chosen photo (read three ways), on the phone
// (Model/BloodScanReader.swift, Model/BloodScan.swift, Model/BloodScanTally.swift),
// then every value waits for the crewmate. A value
// read from the photo is sent only once it is confirmed or typed over; the
// rest are left empty to type by hand. Saved through POST /api/blood like
// typed results, with the confirmed ones marked as read from a photo. The
// photo lives only in this screen's memory.
//
// This reads a screen. It is not a connection to the analyser.

import ImageIO
import PhotosUI
import UniformTypeIdentifiers
import SwiftUI
import UIKit

struct BloodScanView: View {
    let entries: [BloodEntry]
    /// After the hub stored the results: how many.
    var onSaved: (Int) -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var photo: UIImage?
    @State private var rows: [BloodScanRow] = []
    @State private var reading = false
    @State private var showingCamera = false
    @State private var choosing = false
    @State private var saving = false
    @State private var said: String?
    @FocusState private var focus: String?

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    if let photo, !reading {
                        BloodScanReview(photo: photo, rows: $rows, focus: $focus, saving: saving, connected: model.isConnected,
                                        said: said, save: save, retake: retake)
                    } else {
                        capture
                    }
                }
                .keyboardFields($focus, order: rows.map(\.id))
                .scrollsToFocus(focus, with: proxy)
            }
            .tint(.white)
            .navigationTitle("Scan the analyser")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .fullScreenCover(isPresented: $showingCamera) {
                BloodScanLiveView(entries: entries, lang: model.lang) { readings, image in
                    showingCamera = false
                    show(readings, image)
                } cancel: {
                    showingCamera = false
                }
            }
            .sheet(isPresented: $choosing) {
                PhotoLibraryPicker { data in
                    choosing = false
                    guard let data else { return }
                    if let image = UIImage(data: data) { read(image) } else { said = String(localized: "That photo could not be opened.") }
                }
                .ignoresSafeArea()
            }
        }
    }

    private var capture: some View {
        ProjectionSection {
            Text("Point the camera at the analyser's results screen: hold the phone square to it, fill the frame with the screen and avoid reflections. The values are read over a few seconds.")
            if reading {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Reading the photo…")
                }
                .accessibilityElement(children: .combine)
            } else {
                Button {
                    showingCamera = true
                } label: {
                    Label("Scan with the camera", systemImage: "camera.viewfinder")
                }
                .buttonStyle(.projectionProminent)
                .disabled(!BloodScanLiveView.isAvailable)
                if !BloodScanLiveView.isAvailable {
                    Text("This device has no camera: choose a photo instead.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button {
                    choosing = true
                } label: {
                    Label("Choose a photo", systemImage: "photo")
                }
                .buttonStyle(.projection)
            }
            if let said {
                Text(said).foregroundStyle(.secondary)
            }
        } header: {
            ProjectionHeader(.humidity, "Analyser screen")
        } footer: {
            Text("Astrum reads the numbers on this phone. It is not connected to the analyser: you check every value before it is sent.")
        }
    }

    /// Reads a chosen photo on the phone three ways; a value is offered only
    /// when two of them read the same number and none reads another.
    private func read(_ image: UIImage) {
        guard let cgImage = image.cgImage else {
            said = String(localized: "That photo could not be opened.")
            return
        }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        let wanted = entries.map { ($0.id, $0.unit) }
        reading = true
        said = nil
        Task {
            let looks = await BloodScanReader.lines(in: cgImage, orientation: orientation, passes: BloodScanReader.Options.stillPasses)
            var tally = BloodScan.Tally(needed: 2)
            for lines in looks { tally.add(BloodScan.read(lines, wanted: wanted)) }
            reading = false
            show(tally.result(entries.map(\.id)), image)
        }
    }

    /// The review, from what was read.
    private func show(_ readings: [String: BloodScan.Reading], _ image: UIImage?) {
        guard let image else { return }
        rows = entries.map { BloodScanRow(entry: $0, lang: model.lang, reading: readings[$0.id] ?? .notFound) }
        photo = image
    }

    private func retake() {
        photo = nil
        rows = []
        said = nil
    }

    private func save() {
        guard let api = model.api else { return }
        let values = BloodScanRow.values(rows)
        let fromPhoto = rows.filter { $0.state == .checked && values[$0.id] != nil }.map(\.id)
        focus = nil
        saving = true
        said = nil
        Task {
            do {
                try await api.postBlood(person: model.person, values: values, fromPhoto: fromPhoto)
                onSaved(values.count)
                dismiss()
            } catch HubError.refused(let words) {
                said = String(localized: "The hub refused it: \(words)")
            } catch {
                said = String(localized: "The hub is out of reach.")
            }
            saving = false
        }
    }
}

// MARK: The review

/// One hub entry on the review screen: what the photo gave, and where the field stands.
struct BloodScanRow: Identifiable, Hashable {
    enum State: Hashable {
        /// Filled from the photo, not confirmed yet: never sent.
        case unchecked
        /// Filled from the photo and confirmed by the person.
        case checked
        /// Typed (or typed over) by the person.
        case typed
        case empty
    }

    let id: String
    let name: String
    let unit: String
    let reading: BloodScan.Reading
    var text: String
    var state: State

    init(entry: BloodEntry, lang: String, reading: BloodScan.Reading) {
        id = entry.id
        name = lang == "pt" ? entry.name.pt : entry.name.en
        unit = entry.unit
        self.reading = reading
        switch reading {
        case .read(let value, let shown, _), .readWithoutUnit(let value, let shown):
            // In this phone's way of writing numbers, with the decimals the analyser showed.
            text = value.formatted(.number.precision(.fractionLength(BloodScan.decimals(shown))).grouping(.never))
            state = .unchecked
        default:
            text = ""
            state = .empty
        }
    }

    /// The field's number, read the way the rest of Check-in reads typed values.
    var number: Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : (try? Double(trimmed, format: .number))
    }

    /// Typed text that is not a number.
    var isInvalid: Bool { state == .typed && number == nil }

    /// What is sent: confirmed and typed rows only.
    static func values(_ rows: [BloodScanRow]) -> [String: Double] {
        var out: [String: Double] = [:]
        for row in rows where row.state == .checked || row.state == .typed {
            if let number = row.number { out[row.id] = number }
        }
        return out
    }
}

struct BloodScanReview: View {
    let photo: UIImage
    @Binding var rows: [BloodScanRow]
    var focus: FocusState<String?>.Binding
    let saving: Bool
    let connected: Bool
    let said: String?
    let save: () -> Void
    let retake: () -> Void

    var body: some View {
        ProjectionSection {
            ZoomablePhoto(image: photo)
            Text("The photo stays on this phone and is discarded when you close this screen.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Use another photo", action: retake)
                .buttonStyle(.projection)
        } header: {
            ProjectionHeader(.humidity, "Photo")
        }

        ProjectionSection {
            ForEach($rows) { $row in
                BloodScanRowView(row: $row, focus: focus)
                    .id(row.id)
            }
        } header: {
            ProjectionHeader(.humidity, "Values")
        } footer: {
            Text("Only values you confirmed or typed are saved. Nothing is converted.")
        }

        ProjectionSection {
            let count = BloodScanRow.values(rows).count
            let unchecked = rows.filter { $0.state == .unchecked }.count
            if unchecked > 0 {
                Text("\(unchecked) values read from the photo are not checked yet: they will not be saved.")
                    .foregroundStyle(.secondary)
            }
            if rows.contains(where: \.isInvalid) {
                Text("A typed value is not a number: correct it to save.")
                    .foregroundStyle(.secondary)
            }
            if !connected {
                Text("Saving needs the hub.").foregroundStyle(.secondary)
            }
            Button(action: save) {
                if saving {
                    ProgressView()
                } else {
                    Text("Save \(count) results")
                }
            }
            .buttonStyle(.projectionProminent)
            .disabled(saving || count == 0 || !connected || rows.contains(where: \.isInvalid))
            if let said {
                Text(said).foregroundStyle(.secondary)
            }
        }
    }
}

private struct BloodScanRowView: View {
    @Binding var row: BloodScanRow
    var focus: FocusState<String?>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            NumberFieldRow(name: row.name, tapped: { focus.wrappedValue = nil }) {
                TextField("Result", text: text)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .projectionField()
                    .focused(focus, equals: row.id)
                    .accessibilityLabel(Text(verbatim: "\(String(localized: "\(row.name), in \(row.unit)")), \(stateWords)"))
            }
            Text("In \(row.unit)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .onTapGesture { focus.wrappedValue = nil }

            if let note {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            switch row.state {
            case .unchecked:
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle").accessibilityHidden(true)
                    Text("Read from the photo: check it")
                }
                .font(.footnote)
                .foregroundStyle(HubStyle.watch)
                Button {
                    focus.wrappedValue = nil
                    row.state = .checked
                } label: {
                    Text("Confirm \(row.text) \(row.unit)")
                }
                .buttonStyle(.projection)
                .accessibilityLabel(Text("Confirm \(row.name): \(row.text) \(row.unit)"))
            case .checked:
                status("checkmark.circle", "Read from the photo, checked by you")
            case .typed:
                if row.isInvalid {
                    status("exclamationmark.triangle", "Not a number")
                } else {
                    status("keyboard", "Typed by you")
                }
            case .empty:
                EmptyView()
            }
        }
    }

    /// The field: typing anything makes it the person's own value.
    private var text: Binding<String> {
        Binding(get: { row.text }, set: { new in
            guard new != row.text else { return }
            row.text = new
            row.state = new.trimmingCharacters(in: .whitespaces).isEmpty ? .empty : .typed
        })
    }

    private func status(_ symbol: String, _ words: LocalizedStringKey) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).accessibilityHidden(true)
            Text(words)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    /// Where the field stands, for VoiceOver.
    private var stateWords: String {
        switch row.state {
        case .unchecked: String(localized: "read from the photo, not checked yet")
        case .checked: String(localized: "read from the photo, checked by you")
        case .typed: String(localized: "typed by you")
        case .empty: String(localized: "empty")
        }
    }

    /// What the photo gave, when it is not simply a value.
    private var note: String? {
        switch row.reading {
        case .read(_, _, let unitSeen?):
            return String(localized: "The unit on the photo was read as “\(unitSeen)”.")
        case .read:
            return nil
        case .readWithoutUnit:
            return String(localized: "Unit not read: check the unit on the screen. Filled in \(row.unit), the unit Astrum records.")
        case .notFound:
            return String(localized: "Not found on the photo.")
        case .flagged(let shown):
            return String(localized: "The analyser flagged this value (\(shown)): enter it by hand.")
        case .otherUnit(let shown, let unit):
            return String(localized: "The photo shows \(shown) \(unit). Astrum records this in \(row.unit) and does not convert: enter it in \(row.unit) by hand.")
        case .unclear(let problem):
            switch problem {
            case .implausible(let shown, let limits):
                return String(localized: "Read as \(shown), which the analyser cannot show (it reads \(Signals.number(limits.lowerBound)) to \(Signals.number(limits.upperBound)) \(row.unit)): enter it by hand.")
            case .unreadable(let shown):
                return String(localized: "“\(shown)” could not be read as a number: enter it by hand.")
            case .extraDigit(let shown):
                return String(localized: "Read as \(shown), more digits than the analyser shows (a mark after the number may have been read as a digit): enter it by hand.")
            case .noUnit:
                return String(localized: "The unit could not be read on the photo: enter it by hand.")
            case .ambiguous:
                return String(localized: "It is not clear which number belongs to it: enter it by hand.")
            case .unknownUnit:
                return String(localized: "Astrum cannot check a reading in \(row.unit): enter it by hand.")
            case .missingDigit(let shown):
                return String(localized: "Read as \(shown), fewer digits than the analyser shows (a digit or the point may have been missed): enter it by hand.")
            case .uncertainDigit(let shown):
                return String(localized: "Read as \(shown), but a digit could also be read another way: enter it by hand.")
            case .disagree:
                return String(localized: "Different numbers were read for it: enter it by hand.")
            case .notSteady(let shown):
                return String(localized: "Read as \(shown) too few times to be sure: enter it by hand.")
            }
        }
    }
}

// MARK: The photo

/// The photo, pinch or double-tap to zoom, drag to look around. VoiceOver can zoom it too.
private struct ZoomablePhoto: View {
    let image: UIImage
    @State private var scale: CGFloat = 1
    @State private var settled: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var dragged: CGSize = .zero

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .scaleEffect(scale)
            .offset(offset)
            .frame(maxWidth: .infinity)
            .frame(height: 280)
            .clipped()
            .contentShape(Rectangle())
            .gesture(MagnifyGesture()
                .onChanged { scale = min(max(settled * $0.magnification, 1), 6) }
                .onEnded { _ in settled = scale; if scale == 1 { offset = .zero; dragged = .zero } })
            .simultaneousGesture(DragGesture()
                .onChanged { offset = CGSize(width: dragged.width + $0.translation.width, height: dragged.height + $0.translation.height) }
                .onEnded { _ in dragged = offset }, isEnabled: scale > 1)
            .onTapGesture(count: 2) { zoom(to: scale > 1 ? 1 : 2.5) }
            .accessibilityElement()
            .accessibilityLabel("Photo of the analyser's screen")
            .accessibilityAddTraits(.isImage)
            .accessibilityZoomAction { action in
                zoom(to: action.direction == .zoomIn ? min(scale + 1, 6) : max(scale - 1, 1))
            }
    }

    private func zoom(to value: CGFloat) {
        scale = value
        settled = value
        if value == 1 { offset = .zero; dragged = .zero }
    }
}

// MARK: The photo library

/// The photo library, for one image, read into memory. The picker runs outside
/// the app, so no photo library permission is asked for.
private struct PhotoLibraryPicker: UIViewControllerRepresentable {
    let done: @MainActor @Sendable (Data?) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let done: @MainActor @Sendable (Data?) -> Void
        init(done: @escaping @MainActor @Sendable (Data?) -> Void) { self.done = done }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider else { done(nil); return }
            let done = done
            _ = provider.loadDataRepresentation(for: .image) { data, _ in
                Task { @MainActor in done(data) }
            }
        }
    }
}

private extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}

// MARK: Preview

#Preview("Review") {
    @Previewable @FocusState var focus: String?
    @Previewable @State var rows: [BloodScanRow] = {
        // An i-STAT 1 screen as the reader would hand it over, read by the real parser.
        let lines: [BloodScan.Line] = [
            .init(text: "Na mmol/L", x: 0.24, y: 0.25, width: 0.22, height: 0.035), .init(text: "141", x: 0.62, y: 0.24, width: 0.15, height: 0.055),
            .init(text: "K mmol/L", x: 0.24, y: 0.33, width: 0.22, height: 0.035), .init(text: "7.2↑", x: 0.62, y: 0.32, width: 0.15, height: 0.055),
            .init(text: "Glu mmol/L", x: 0.24, y: 0.41, width: 0.22, height: 0.035), .init(text: "5.9", x: 0.62, y: 0.40, width: 0.15, height: 0.055),
            .init(text: "Hct %PCV", x: 0.24, y: 0.49, width: 0.22, height: 0.035), .init(text: "41", x: 0.62, y: 0.48, width: 0.15, height: 0.055),
            .init(text: "Hb* g/dL", x: 0.24, y: 0.57, width: 0.22, height: 0.035), .init(text: "139", x: 0.62, y: 0.56, width: 0.15, height: 0.055),
        ]
        let entries = SampleData.bloodEntries
        let found = BloodScan.read(lines, wanted: entries.map { ($0.id, $0.unit) })
        var rows = entries.map { BloodScanRow(entry: $0, lang: "en", reading: found[$0.id] ?? .notFound) }
        rows[1].state = .checked
        return rows
    }()
    let photo = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 400)).image { context in
        UIColor(white: 0.82, alpha: 1).setFill()
        context.fill(CGRect(x: 0, y: 0, width: 300, height: 400))
        let font = UIFont.monospacedSystemFont(ofSize: 20, weight: .regular)
        for (i, line) in ["Na mmol/L    141", "K mmol/L     7.2↑", "Glu mmol/L   5.9", "Hct %PCV      41", "Hb* g/dL     139"].enumerated() {
            (line as NSString).draw(at: CGPoint(x: 24, y: 90 + i * 50), withAttributes: [.font: font, .foregroundColor: UIColor.black])
        }
    }
    NavigationStack {
        Form {
            BloodScanReview(photo: photo, rows: $rows, focus: $focus, saving: false, connected: true, said: nil, save: {}, retake: {})
        }
        .keyboardFields($focus, order: rows.map(\.id))
    }
    .tint(.white)
    .preferredColorScheme(.dark)
}
