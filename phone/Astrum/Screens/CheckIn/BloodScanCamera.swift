// The live camera for reading the blood analyser's screen. Frames are read on
// the camera's own queue a few times a second (BloodScanReader), only inside
// the framing guide, and each look goes to the main actor, where a
// BloodScan.Tally decides which values are steady. The session stops when the
// screen goes away. Nothing is recorded or saved; the last look's picture is
// kept in memory for the review screen.

import AVFoundation
import CoreImage
import SwiftUI
import UIKit

/// The capture session and the frame reader. All session work happens on
/// `queue`; the class is used from the main actor only through start, stop,
/// focus and the guide rectangle, which hop to the queue or take the lock.
final class BloodScanCamera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    /// One read frame: its lines, and the guide's picture for the review.
    typealias Look = @MainActor @Sendable ([BloodScan.Line], CGImage) -> Void

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "space.astrum.bloodscan.camera")
    private let output = AVCaptureVideoDataOutput()
    private var device: AVCaptureDevice?
    private var configured = false
    private let context = CIContext()

    private let lock = NSLock()
    /// The framing guide as a fraction of the preview, and the preview's size: the
    /// preview fills its view (aspect fill), so the guide's part of each frame follows from both.
    private var guide = CGRect(x: 0, y: 0, width: 1, height: 1)
    private var viewSize = CGSize(width: 9, height: 16)
    private var lastRead = Date.distantPast
    private var onLook: Look?

    /// Reads per second at most; Vision's accurate pass is the real limit.
    private let interval: TimeInterval = 0.25

    func start(onLook: @escaping Look) {
        lock.withLock { self.onLook = onLook }
        queue.async { [self] in
            if !configured { configure() }
            if configured, !session.isRunning { session.startRunning() }
        }
    }

    func stop() {
        lock.withLock { onLook = nil }
        queue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func setGuide(_ rect: CGRect, in size: CGSize) {
        guard rect.width > 0, rect.height > 0, size.width > 0, size.height > 0 else { return }
        lock.withLock { guide = rect; viewSize = size }
    }

    /// Focus and expose at a point in the sensor's normalised coordinates.
    func focus(at point: CGPoint) {
        queue.async { [self] in
            guard let device, (try? device.lockForConfiguration()) != nil else { return }
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = point
                device.focusMode = .autoFocus
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = point
                device.exposureMode = .continuousAutoExposure
            }
            device.unlockForConfiguration()
            // Back to following the scene after this focus.
            queue.asyncAfter(deadline: .now() + 2) { [self] in
                guard let device = self.device, (try? device.lockForConfiguration()) != nil else { return }
                if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                device.unlockForConfiguration()
            }
        }
    }

    private func configure() {
        // A virtual camera switches to the ultra wide lens for close-ups where the phone has one.
        let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInWideAngleCamera]
        guard let camera = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices.first,
              let input = try? AVCaptureDeviceInput(device: camera) else { return }
        session.beginConfiguration()
        session.sessionPreset = session.canSetSessionPreset(.hd4K3840x2160) ? .hd4K3840x2160 : .hd1920x1080
        guard session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            return
        }
        session.addInput(input)
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        output.setSampleBufferDelegate(self, queue: queue)
        session.addOutput(output)
        session.commitConfiguration()

        if (try? camera.lockForConfiguration()) != nil {
            if camera.isFocusModeSupported(.continuousAutoFocus) { camera.focusMode = .continuousAutoFocus }
            if camera.isAutoFocusRangeRestrictionSupported { camera.autoFocusRangeRestriction = .near }
            if camera.isExposureModeSupported(.continuousAutoExposure) { camera.exposureMode = .continuousAutoExposure }
            if camera.hasTorch, camera.isTorchModeSupported(.off) { camera.torchMode = .off }
            camera.unlockForConfiguration()
        }
        device = camera
        configured = true
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let (guide, view, onLook, due) = lock.withLock { () -> (CGRect, CGSize, Look?, Bool) in
            let due = Date().timeIntervalSince(lastRead) >= interval
            if due { lastRead = Date() }
            return (guide, viewSize, onLook, due)
        }
        guard due, let onLook, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // The sensor's picture turned upright for a phone held portrait, then cut to
        // the guide: the part of the frame the preview shows (aspect fill), and the guide within it.
        var frame = CIImage(cvPixelBuffer: buffer).oriented(.right)
        frame = frame.transformed(by: .init(translationX: -frame.extent.minX, y: -frame.extent.minY))
        let size = frame.extent.size
        let scale = max(view.width / size.width, view.height / size.height)
        let shown = CGSize(width: view.width / scale, height: view.height / scale)
        let left = (size.width - shown.width) / 2, top = (size.height - shown.height) / 2
        let cut = CGRect(x: left + guide.minX * shown.width, y: size.height - (top + guide.maxY * shown.height),
                         width: guide.width * shown.width, height: guide.height * shown.height)
        var picture = frame.cropped(to: cut.intersection(frame.extent))
        picture = picture.transformed(by: .init(translationX: -picture.extent.minX, y: -picture.extent.minY))
        guard let still = context.createCGImage(picture, from: picture.extent) else { return }

        let lines = BloodScanReader.read(CIImage(cgImage: still), options: BloodScanReader.Options())
        Task { @MainActor in onLook(lines, still) }
    }
}

/// The camera's picture, filling its frame. Reports where the framing guide
/// falls on the sensor whenever its layout changes, and passes taps on to focus.
struct BloodScanPreview: UIViewRepresentable {
    let camera: BloodScanCamera
    /// The guide as a fraction of this view (the same rectangle the overlay draws).
    let guide: CGRect

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = camera.session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.camera = camera
        view.guide = guide
        view.addGestureRecognizer(UITapGestureRecognizer(target: view, action: #selector(PreviewView.tapped(_:))))
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.guide = guide
        view.setNeedsLayout()
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        var camera: BloodScanCamera?
        var guide: CGRect = .zero

        override func layoutSubviews() {
            super.layoutSubviews()
            camera?.setGuide(guide, in: bounds.size)
        }

        @objc func tapped(_ tap: UITapGestureRecognizer) {
            camera?.focus(at: previewLayer.captureDevicePointConverted(fromLayerPoint: tap.location(in: self)))
        }
    }
}

// MARK: The live screen

/// Full screen: the camera, a framing guide, and a quiet list of the values as
/// they settle. It finishes by itself once every value it has seen is settled,
/// or when "Use what was read" is tapped.
struct BloodScanLiveView: View {
    let entries: [BloodEntry]
    let lang: String
    /// What was read, and the guide's picture for the review.
    let done: ([String: BloodScan.Reading], UIImage?) -> Void
    let cancel: () -> Void

    static var isAvailable: Bool { AVCaptureDevice.default(for: .video) != nil }

    /// The framing guide, as a fraction of the camera view.
    private static let guide = CGRect(x: 0.06, y: 0.12, width: 0.88, height: 0.5)

    @State private var camera = BloodScanCamera()
    @State private var tally = BloodScan.Tally(needed: 3)
    @State private var photo: CGImage?
    @State private var access = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var lastStart = 0
    @State private var finished = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch access {
            case .authorized:
                BloodScanPreview(camera: camera, guide: Self.guide)
                    .ignoresSafeArea()
                    .accessibilityLabel("Camera view")
                    .accessibilityHint("Point it at the analyser's results screen. Tap to focus.")
                guideFrame
                    .ignoresSafeArea()
            case .notDetermined:
                ProgressView()
            default:
                notAllowed
            }
            VStack(spacing: 0) {
                Text("Fit the analyser's screen in the frame")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .background(.black.opacity(0.6))
                Spacer()
                panel
            }
        }
        .foregroundStyle(.white)
        .tint(.white)
        .preferredColorScheme(.dark)
        .task {
            if access == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .video)
                access = AVCaptureDevice.authorizationStatus(for: .video)
            }
            guard access == .authorized else { return }
            camera.start { lines, image in look(lines, image) }
        }
        .onDisappear { camera.stop() }
    }

    /// Corner brackets where the screen should sit; the camera reads only inside them.
    private var guideFrame: some View {
        GeometryReader { geometry in
            let g = Self.guide
            let rect = CGRect(x: g.minX * geometry.size.width, y: g.minY * geometry.size.height,
                              width: g.width * geometry.size.width, height: g.height * geometry.size.height)
            Path { path in
                let reach: CGFloat = 28
                for (corner, dx, dy) in [(CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0), (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0),
                                         (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0), (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0)] {
                    path.move(to: CGPoint(x: corner.x + dx * reach, y: corner.y))
                    path.addLine(to: corner)
                    path.addLine(to: CGPoint(x: corner.x, y: corner.y + dy * reach))
                }
            }
            .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var notAllowed: some View {
        VStack(spacing: 16) {
            Text("Astrum is not allowed to use the camera. You can allow it in Settings, or choose a photo or type the values instead.")
                .multilineTextAlignment(.center)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            .buttonStyle(.projectionProminent)
        }
        .padding(24)
    }

    /// The values as they settle, then the two ways out.
    private var panel: some View {
        VStack(alignment: .leading, spacing: 12) {
            let seen = entries.filter { tally.started.contains($0.id) }
            if seen.isEmpty {
                Text(access == .authorized ? String(localized: "Looking for results…") : "")
                    .foregroundStyle(HubStyle.muted)
            } else {
                // A wrapping row of "Na ✓  K …": each with words for VoiceOver.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 14) { ForEach(seen) { progress($0) } }
                    VStack(alignment: .leading, spacing: 6) { ForEach(seen) { progress($0) } }
                }
            }
            HStack(spacing: 12) {
                Button("Cancel") {
                    camera.stop()
                    cancel()
                }
                .buttonStyle(.projection)
                Button("Use what was read") { finish() }
                    .buttonStyle(.projectionProminent)
                    .disabled(photo == nil)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.black.opacity(0.75))
    }

    private func progress(_ entry: BloodEntry) -> some View {
        let (symbol, words): (String, String) = if tally.locked[entry.id] != nil {
            ("checkmark", String(localized: "read"))
        } else if tally.disagrees(entry.id) {
            ("questionmark", String(localized: "unclear, check it"))
        } else {
            ("ellipsis", String(localized: "reading"))
        }
        return HStack(spacing: 4) {
            Text(verbatim: BloodScan.shortLabel(entry.id))
            Image(systemName: symbol).accessibilityHidden(true)
        }
        .font(.body.monospaced())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(lang == "pt" ? entry.name.pt : entry.name.en): \(words)"))
    }

    /// One frame read: weigh it, keep the picture, finish when everything seen has settled.
    private func look(_ lines: [BloodScan.Line], _ image: CGImage) {
        guard !finished else { return }
        let before = tally.locked.count, started = tally.started.count
        tally.add(BloodScan.read(lines, wanted: entries.map { ($0.id, $0.unit) }))
        if tally.started.count > started { lastStart = tally.looks }
        if photo == nil || tally.locked.count > before { photo = image }
        if tally.locked.count > before {
            let names = tally.locked.keys.filter { !$0.isEmpty }.count
            AccessibilityNotification.Announcement(String(localized: "\(names) values read")).post()
        }
        // Everything seen has settled, and nothing new has appeared for a while.
        if tally.settled, tally.looks >= 8, tally.looks - lastStart >= 4 { finish() }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        camera.stop()
        done(tally.result(entries.map(\.id)), photo.map { UIImage(cgImage: $0) })
    }
}
