// A steps card one step at a time, in a modal over the screen that opened it
// (dimmed and blurred behind, nothing taps through): one projection with the card's
// title and the gravity at the top, the step's looping illustration (when the
// medical lead's list gives it one), "Step 3 of 5" and the step's own text,
// then Previous and Next. Her "do not" list is one last page. The text is the
// card's, word for word, in order; the app adds nothing. Swipes page too.
// Under Reduce Motion the illustration is a still that plays once on request.

import AVFoundation
import CoreImage
import SwiftUI
import UIKit

struct StepsModal: View {
    let card: CardView
    /// Called once when "Done" on the last page closes it; never when it is closed any other way.
    var onDone: () -> Void = {}
    @Environment(AppModel.self) private var model: AppModel?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var page = 0
    @State private var shown = false
    @State private var forward = true
    @AccessibilityFocusState private var textFocused: Bool
    @AccessibilityFocusState private var titleFocused: Bool

    private var pageCount: Int { card.steps.count + (card.doNot.isEmpty ? 0 : 1) }
    private var isLast: Bool { page >= pageCount - 1 }
    private var gravityOn: Bool? {
        StepLoops.gravityOn(card, missionGravity: model?.world.profile?.mission?.gravity)
    }

    /// A step's text cut at its sentence ends, nothing reworded (the hub's steps screen does the same).
    static func sentences(_ text: String) -> [String] {
        var out: [String] = []
        var current = ""
        let chars = Array(text)
        for (i, ch) in chars.enumerated() {
            current.append(ch)
            guard ".!?".contains(ch), i + 2 < chars.count, chars[i + 1] == " " else { continue }
            let next = chars[i + 2]
            if next.isUppercase || next.isNumber || next == "\"" || next == "“" {
                out.append(current.trimmingCharacters(in: .whitespaces)); current = ""
            }
        }
        let rest = current.trimmingCharacters(in: .whitespaces)
        if !rest.isEmpty { out.append(rest) }
        return out
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                    .ignoresSafeArea()
                    .opacity(shown ? 1 : 0)
                    .accessibilityHidden(true)
                Color.black.opacity(shown ? 0.6 : 0)
                    .ignoresSafeArea()
                    .accessibilityHidden(true)
                panel
                    .frame(maxHeight: min(geo.size.height - 16, 680))
                    .opacity(shown ? 1 : 0)
                    .scaleEffect(shown || reduceMotion ? 1 : 0.96)
                    .accessibilityAddTraits(.isModal)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .presentationBackground(.clear)
        .onAppear {
            withAnimation(Motion.reduced(Motion.appear, reduceMotion)) { shown = true }
            Task {
                try? await Task.sleep(for: .milliseconds(450))
                titleFocused = true
            }
        }
    }

    private var panel: some View {
        VStack(spacing: 16) {
            header
            ZStack {
                pageView(page)
                    .id(page)
                    .transition(transition)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            buttons
        }
        .padding(EdgeInsets(top: 22, leading: 20, bottom: 20, trailing: 20))
        // The widgets' projection (outline, corner brackets, grid, tint) over a solid dark base. The base goes
        // behind the frame: a second background is drawn under the first, so the other way round hid the frame.
        .projectionFrame()
        .background(Color.black, in: RoundedRectangle(cornerRadius: HubStyle.radius, style: .circular))
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .gesture(swipe)
        .accessibilityAction(.escape) { close() }
    }

    /// Fades the modal out, then takes the cover away without the system's slide.
    private func close() {
        withAnimation(Motion.reduced(Motion.appear, reduceMotion)) { shown = false }
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { dismiss() }
        }
    }

    // MARK: Parts

    private var header: some View {
        let gravity: String? = gravityOn.map { $0 ? String(localized: "Gravity on") : String(localized: "Gravity off") }
        return Text(verbatim: [card.title, gravity].compactMap { $0 }.joined(separator: " · "))
            .font(.subheadline)
            .foregroundStyle(HubStyle.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.isHeader)
            .accessibilityFocused($titleFocused)
    }

    @ViewBuilder
    private func pageView(_ index: Int) -> some View {
        let content = Group {
            if index < card.steps.count {
                step(index)
            } else {
                doNot
            }
        }
        // At the largest text sizes the page scrolls; the text never truncates.
        if typeSize.isAccessibilitySize {
            ScrollView { content.padding(.vertical, 8) }
        } else {
            content
        }
    }

    private func step(_ index: Int) -> some View {
        let loop = StepLoops.loop(card: card.id, step: index, gravityOn: gravityOn)
        return VStack(spacing: 14) {
            if let loop {
                VStack(spacing: 6) {
                    StepIllustration(loop: loop)
                        .frame(maxWidth: typeSize.isAccessibilitySize ? 220 : .infinity,
                               maxHeight: typeSize.isAccessibilitySize ? 220 : .infinity)
                        .layoutPriority(0)
                    if !loop.isReviewed {
                        Text("Not yet reviewed by the medical lead")
                            .font(.caption2)
                            .foregroundStyle(HubStyle.faint)
                    }
                }
            } else {
                Spacer(minLength: 0)
            }
            VStack(spacing: 12) {
                Text("Step \(index + 1) of \(card.steps.count)")
                    .font(.subheadline)
                    .foregroundStyle(HubStyle.muted)
                let lines = Self.sentences(card.steps[index])
                if lines.count > 2 {
                    // A long step: the card's own sentences, in order and word for word, one to a line.
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { item in
                            Text(item.element)
                                .font(item.offset == 0 ? .body.weight(.semibold) : .body)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                } else {
                    Text(card.steps[index])
                        .font(.title3)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityFocused($textFocused)
            .layoutPriority(1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
    }

    private var doNot: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 0)
            Text("Do not")
                .font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($textFocused)
            VStack(alignment: .leading, spacing: 12) {
                ForEach(card.doNot, id: \.self) { item in
                    Label(item, systemImage: "xmark")
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
    }

    private var buttons: some View {
        HStack(spacing: 16) {
            Button { go(-1) } label: {
                Text("Previous")
                    .frame(minWidth: 96, minHeight: 44)
                    .padding(.horizontal, 12)
                    .overlay {
                        RoundedRectangle(cornerRadius: HubStyle.controlRadius + 2, style: .continuous)
                            .strokeBorder(.white, lineWidth: 1.5)
                    }
                    .contentShape(Rectangle())
            }
            .foregroundStyle(.white)
            .disabled(page == 0)
            .opacity(page == 0 ? 0.35 : 1)
            .accessibilityHint(Text("Shows the previous step"))

            Spacer(minLength: 0)

            Button {
                if isLast {
                    onDone()
                    close()
                } else {
                    go(1)
                }
            } label: {
                Text(isLast ? "Done" : "Next")
                    .frame(minWidth: 96, minHeight: 44)
                    .padding(.horizontal, 12)
                    .foregroundStyle(.black)
                    .background(.white, in: RoundedRectangle(cornerRadius: HubStyle.controlRadius + 2, style: .continuous))
            }
            .accessibilityHint(isLast ? Text("Closes the steps") : Text("Shows the next step"))
        }
        .font(.headline)
        .buttonStyle(.pressable)
    }

    // MARK: Paging

    private var transition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(
            insertion: .opacity.combined(with: .offset(x: forward ? 24 : -24)),
            removal: .opacity
        )
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let dx = value.translation.width
                guard abs(dx) > 60, abs(dx) > abs(value.translation.height) else { return }
                go(dx < 0 ? 1 : -1)
            }
    }

    private func go(_ delta: Int) {
        let next = page + delta
        guard next >= 0, next < pageCount else { return }
        forward = delta > 0
        textFocused = false
        withAnimation(Motion.reduced(Motion.content, reduceMotion)) { page = next }
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            textFocused = true
        }
    }
}

// MARK: The illustration

/// A step's loop: muted, looping, no controls, faded into the dark at its edges with
/// at its edges. Under Reduce Motion, its still and a play button.
private struct StepIllustration: View {
    let loop: StepLoops.Loop
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var playingOnce = false

    var body: some View {
        LoopSurface(loop: loop, mode: reduceMotion ? (playingOnce ? .once : .still) : .loop) {
            playingOnce = false
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel(Text("Illustration of this step"))
        .accessibilityAddTraits(.isImage)
        .overlay(alignment: .center) {
            if reduceMotion && !playingOnce {
                Button { playingOnce = true } label: {
                    Image(systemName: "play.fill")
                        .font(.title2)
                        .foregroundStyle(.black)
                        .frame(width: 56, height: 56)
                        .background(.white, in: Circle())
                }
                .accessibilityLabel(Text("Play the illustration once"))
            }
        }
    }
}

private struct LoopSurface: UIViewRepresentable {
    enum Mode { case loop, once, still }

    let loop: StepLoops.Loop
    let mode: Mode
    let onFinished: () -> Void

    func makeUIView(context: Context) -> LoopSurfaceView {
        LoopSurfaceView(loop: loop)
    }

    func updateUIView(_ view: LoopSurfaceView, context: Context) {
        view.onFinished = onFinished
        view.show(mode)
    }

    static func dismantleUIView(_ view: LoopSurfaceView, coordinator: ()) {
        view.stop()
    }
}

/// The video (or still) in a layer masked by an even soft radial fade.
/// The video's navy is drained of colour, so the dark around the figures meets the app's black.
private final class LoopSurfaceView: UIView {
    private let loop: StepLoops.Loop
    private let content = CALayer()
    private let videoLayer = AVPlayerLayer()
    private let stillLayer = CALayer()
    private let fade = CAGradientLayer()
    private let maskLayer = CALayer()
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var endObserver: NSObjectProtocol?
    private var mode: LoopSurface.Mode?
    var onFinished: () -> Void = {}

    init(loop: StepLoops.Loop) {
        self.loop = loop
        super.init(frame: .zero)
        backgroundColor = .clear
        isUserInteractionEnabled = false
        videoLayer.videoGravity = .resizeAspect
        stillLayer.contentsGravity = .resizeAspect
        content.addSublayer(stillLayer)
        content.addSublayer(videoLayer)
        layer.addSublayer(content)

        fade.type = .radial
        fade.colors = [UIColor.white.cgColor, UIColor.white.cgColor, UIColor.clear.cgColor]
        fade.locations = [0, 0.6, 1]
        fade.startPoint = CGPoint(x: 0.5, y: 0.5)
        fade.endPoint = CGPoint(x: 1, y: 1)
        maskLayer.addSublayer(fade)
        content.mask = maskLayer

        if let still = loop.still, let image = Self.drained(UIImage(contentsOfFile: still.path)) {
            stillLayer.contents = image
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for sub in [content, videoLayer, stillLayer, maskLayer, fade] { sub.frame = bounds }
        CATransaction.commit()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Off screen, nothing plays.
        if window == nil { player?.pause() } else if mode == .loop || mode == .once { player?.play() }
    }

    func show(_ newMode: LoopSurface.Mode) {
        guard newMode != mode else { return }
        mode = newMode
        stop()
        // The still holds the place until the video is ready, so nothing flashes.
        videoLayer.isHidden = true
        stillLayer.isHidden = false
        guard newMode != .still else { return }

        Task { [weak self] in
            guard let self else { return }
            let item = AVPlayerItem(url: self.loop.video)
            // Set before the looper copies the item, so every copy is drained too.
            item.videoComposition = await Self.drainedComposition(for: self.loop.video)
            guard self.mode == newMode, self.player == nil else { return }
            let player = AVQueuePlayer()
            player.isMuted = true
            player.preventsDisplaySleepDuringVideoPlayback = false
            if newMode == .loop {
                self.looper = AVPlayerLooper(player: player, templateItem: item)
            } else {
                player.insert(item, after: nil)
                self.endObserver = NotificationCenter.default.addObserver(
                    forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated { self?.onFinished() }
                }
            }
            self.player = player
            self.videoLayer.player = player
            self.videoLayer.isHidden = false
            self.stillLayer.isHidden = true
            if self.window != nil { player.play() }
        }
    }

    func stop() {
        player?.pause()
        looper?.disableLooping()
        looper = nil
        player = nil
        videoLayer.player = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }

    // MARK: Colour

    private static func drainedComposition(for url: URL) async -> AVVideoComposition? {
        let asset = AVURLAsset(url: url)
        return try? await AVVideoComposition.videoComposition(with: asset) { request in
            let grey = request.sourceImage.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0])
            request.finish(with: grey, context: nil)
        }
    }

    private static func drained(_ image: UIImage?) -> CGImage? {
        guard let image, let input = CIImage(image: image) else { return nil }
        let grey = input.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0])
        return CIContext().createCGImage(grey, from: grey.extent)
    }
}

// MARK: Presenting

extension View {
    /// Shows the steps for `item` as a modal over this screen, above the tab bar and the keyboard.
    /// Open it with `StepsPresentation.open { item = card }` so the system's slide stays off.
    func stepsModal(item: Binding<CardView?>, onDone: @escaping (String) -> Void = { _ in }) -> some View {
        fullScreenCover(item: item) { card in
            StepsModal(card: card, onDone: { onDone(card.id) })
        }
        .onChange(of: item.wrappedValue?.id) { _, id in
            guard id != nil else { return }
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }
}

enum StepsPresentation {
    /// Runs the change that presents the modal with the system animation off; the modal fades in itself.
    @MainActor static func open(_ change: () -> Void) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction, change)
    }
}
