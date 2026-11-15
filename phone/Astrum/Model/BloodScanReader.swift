// Finds the text on a picture of the blood analyser's screen, on the phone,
// with Vision: accurate recognition, no language correction (these are numbers
// and short labels, not words). Nothing leaves the phone.
//
// Before reading, the picture is prepared (Options): cut to the screen's
// rectangle and squared up when one is found with confidence, turned grey, and
// given local contrast (an unsharp mask 20 px wide). Scaling the text to a set
// height, softening against moiré, global contrast, sharpening and inverting
// are available but off: on simulated photos of a screen they did not help or
// made things worse. After reading, the lines are
// levelled: a picture taken at a slant tilts every row, and BloodScan pairs
// labels and numbers by their rows. Which steps are on by default was decided
// by measurement (phone/SKETCH-NOTES.md).
//
// Thread-safe and synchronous (`read`), so the camera can call it from its
// own queue; `lines` is the same for one photo, off the main actor.

import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision

enum BloodScanReader {
    struct Options: Hashable, Sendable {
        /// Square up to the screen's rectangle when one is found.
        var rectify = true
        /// Scale so the text is about this tall, in pixels (nil: as it is).
        var textHeight: Double? = nil
        /// Gaussian blur against moiré, in pixels of the picture as it comes.
        var soften: Double = 0
        /// Grey.
        var gray = true
        /// Contrast (1: unchanged).
        var contrast: Double = 1
        /// Light text on dark (some LCDs).
        var invert = false
        /// Local contrast: an unsharp mask this wide (pixels of the prepared picture), 0 for none.
        var localContrast: Double = 20
        /// Sharpening against a little defocus (CISharpenLuminance), 0 for none.
        var sharpen: Double = 0

        /// The three ways a chosen photo is read (the default, wider local
        /// contrast, and without squaring up); BloodScan.Tally weighs them.
        static let stillPasses = [Options(), Options(localContrast: 40), Options(rectify: false)]

        static let none = Options(rectify: false, textHeight: nil, soften: 0, gray: false, contrast: 1, invert: false, localContrast: 0)
    }

    /// The lines of one photo, read with each of `passes`, one list per pass.
    @concurrent
    static func lines(in image: CGImage, orientation: CGImagePropertyOrientation,
                      passes: [Options] = [Options()]) async -> [[BloodScan.Line]] {
        let upright = CIImage(cgImage: image).oriented(orientation)
        return passes.map { read(upright, options: $0) }
    }

    /// Prepares and reads one picture (already upright). Lines are fractions of the prepared picture.
    static func read(_ image: CIImage, options: Options) -> [BloodScan.Line] {
        var image = image.transformed(by: .init(translationX: -image.extent.minX, y: -image.extent.minY))
        if options.rectify, let screen = screenRectangle(in: image) {
            image = screen
        }
        if options.soften > 0 {
            image = image.clampedToExtent().applyingGaussianBlur(sigma: options.soften).cropped(to: image.extent)
        }
        if options.localContrast > 0 {
            image = image.clampedToExtent().applyingFilter("CIUnsharpMask", parameters: [
                kCIInputRadiusKey: options.localContrast, kCIInputIntensityKey: 1.0]).cropped(to: image.extent)
        }
        if options.sharpen > 0 {
            image = image.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: options.sharpen])
        }
        if options.gray || options.contrast != 1 || options.invert {
            image = image.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0, kCIInputContrastKey: options.contrast])
            if options.invert { image = image.applyingFilter("CIColorInvert") }
        }
        var lines = recognise(image)
        // Text far from the target height: scale and read again.
        if let target = options.textHeight, let height = textHeight(lines, in: image.extent.height) {
            let factor = min(max(target / height, 0.5), 3)
            let longest = max(image.extent.width, image.extent.height) * factor
            if abs(factor - 1) > 0.25, longest <= 6000 {
                lines = recognise(image.transformed(by: .init(scaleX: factor, y: factor)).samplingLinear())
            }
        }
        return lines
    }

    // MARK: Steps

    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    /// The largest confident rectangle covering a good part of the picture, squared up.
    private static func screenRectangle(in image: CIImage) -> CIImage? {
        let request = VNDetectRectanglesRequest()
        request.minimumConfidence = 0.8
        request.minimumSize = 0.25
        request.minimumAspectRatio = 0.3
        request.quadratureTolerance = 25
        request.maximumObservations = 4
        guard (try? VNImageRequestHandler(ciImage: image).perform([request])) != nil,
              let best = request.results?.max(by: { area($0) < area($1) }), area(best) > 0.12 else { return nil }
        let size = image.extent.size
        func point(_ p: CGPoint) -> CIVector { CIVector(x: p.x * size.width, y: p.y * size.height) }
        return image.applyingFilter("CIPerspectiveCorrection", parameters: [
            "inputTopLeft": point(best.topLeft), "inputTopRight": point(best.topRight),
            "inputBottomLeft": point(best.bottomLeft), "inputBottomRight": point(best.bottomRight)])
    }

    private static func area(_ r: VNRectangleObservation) -> Double {
        // Shoelace formula over the four corners (normalised).
        let p = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft]
        var sum = 0.0
        for i in 0..<4 { let a = p[i], b = p[(i + 1) % 4]; sum += a.x * b.y - b.x * a.y }
        return abs(sum) / 2
    }

    /// The median height, in pixels, of lines that hold a digit.
    private static func textHeight(_ lines: [BloodScan.Line], in height: Double) -> Double? {
        let heights = lines.filter { $0.text.contains(where: \.isNumber) }.map { $0.height * height }.sorted()
        return heights.isEmpty ? nil : heights[heights.count / 2]
    }

    /// Vision on a prepared picture, then the rows levelled.
    private static func recognise(_ image: CIImage) -> [BloodScan.Line] {
        let extent = image.extent.integral
        guard extent.width >= 16, extent.height >= 16,
              let cgImage = context.createCGImage(image, from: extent) else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        guard (try? VNImageRequestHandler(cgImage: cgImage).perform([request])) != nil else { return [] }
        let observations = request.results ?? []
        let width = Double(cgImage.width), height = Double(cgImage.height)

        // The tilt of the text: the median slope of the lines' top edges.
        let slopes = observations.compactMap { o -> Double? in
            let dx = (o.topRight.x - o.topLeft.x) * width, dy = (o.topRight.y - o.topLeft.y) * height
            return dx > 0 ? atan2(dy, dx) : nil
        }.sorted()
        let angle = slopes.isEmpty ? 0 : slopes[slopes.count / 2]
        let (c, s) = (cos(-angle), sin(-angle))

        return observations.compactMap { o in
            let candidates = o.topCandidates(3).map(\.string)
            guard let text = candidates.first else { return nil }
            // Each corner in pixels, turned about the picture's centre, then back to fractions, top left origin.
            let corners = [o.topLeft, o.topRight, o.bottomLeft, o.bottomRight].map { p -> (Double, Double) in
                let x = p.x * width - width / 2, y = p.y * height - height / 2
                return ((x * c - y * s + width / 2) / width, 1 - (x * s + y * c + height / 2) / height)
            }
            let xs = corners.map(\.0), ys = corners.map(\.1)
            return BloodScan.Line(text: text, x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!,
                                  alternatives: Array(candidates.dropFirst()))
        }
    }
}
