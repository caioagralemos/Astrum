// Finds the text on a photo of the blood analyser's screen, on the phone, with
// Vision: accurate recognition, no language correction (these are numbers and
// short labels, not words). Nothing leaves the phone. The lines are turned
// level first: a photo taken at a slant tilts every row, and BloodScan pairs
// labels and numbers by their rows.

import CoreGraphics
import Foundation
import ImageIO
import Vision

enum BloodScanReader {
    /// The recognised lines of `image`, levelled, as fractions of the upright photo.
    @concurrent
    static func lines(in image: CGImage, orientation: CGImagePropertyOrientation) async throws -> [BloodScan.Line] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
        let observations = request.results ?? []

        // The upright photo's size in pixels, so angles are true angles.
        let sideways: Set<CGImagePropertyOrientation> = [.left, .leftMirrored, .right, .rightMirrored]
        let width = Double(sideways.contains(orientation) ? image.height : image.width)
        let height = Double(sideways.contains(orientation) ? image.width : image.height)

        // The tilt of the text: the median slope of the lines' top edges.
        let slopes = observations.compactMap { o -> Double? in
            let dx = (o.topRight.x - o.topLeft.x) * width, dy = (o.topRight.y - o.topLeft.y) * height
            return dx > 0 ? atan2(dy, dx) : nil
        }.sorted()
        let angle = slopes.isEmpty ? 0 : slopes[slopes.count / 2]
        let (c, s) = (cos(-angle), sin(-angle))

        return observations.compactMap { o in
            guard let text = o.topCandidates(1).first?.string else { return nil }
            // Each corner in pixels, turned about the photo's centre, then back to fractions, top left origin.
            let corners = [o.topLeft, o.topRight, o.bottomLeft, o.bottomRight].map { p -> (Double, Double) in
                let x = p.x * width - width / 2, y = p.y * height - height / 2
                return ((x * c - y * s + width / 2) / width, 1 - (x * s + y * c + height / 2) / height)
            }
            let xs = corners.map(\.0), ys = corners.map(\.1)
            return BloodScan.Line(text: text, x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        }
    }
}
