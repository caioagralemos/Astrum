// A crewmate's face as set up on the hub: the portrait is loaded from the
// hub's own address (kept in memory, and in the URL cache for offline), drawn
// in greys like the rest of the projection. With no portrait, or none
// reachable, a quiet tile with the person's initial stands in. Decorative to
// VoiceOver: the name always sits beside it.

import SwiftUI
import UIKit

/// The portraits already loaded, by address.
@MainActor
final class PortraitStore {
    static let shared = PortraitStore()
    private var images: [URL: UIImage] = [:]

    func cached(_ url: URL) -> UIImage? { images[url] }

    /// Only pictures are kept: a failure is not remembered, so the next try (the next hub state) asks again.
    func load(_ url: URL) async -> UIImage? {
        if let image = images[url] { return image }
        // The URL cache answers when the hub is out of reach and the picture was seen before;
        // if what it holds is not a picture, ask the hub itself. Plain http to the hub's local
        // address is allowed by NSAllowsLocalNetworking, as for every other hub request.
        for policy in [URLRequest.CachePolicy.returnCacheDataElseLoad, .reloadIgnoringLocalCacheData] {
            let request = URLRequest(url: url, cachePolicy: policy, timeoutInterval: 15)
            guard let (data, response) = try? await URLSession.shared.data(for: request) else { return nil }
            if (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data) {
                images[url] = image
                return image
            }
        }
        return nil
    }

    /// Where a crewmate's portrait is: a full address as given, or a path on the hub.
    static func url(of member: CrewMember, hub: HubAddress?) -> URL? {
        guard let portrait = member.portrait else { return nil }
        if let full = URL(string: portrait), full.scheme != nil { return full }
        guard let hub else { return nil }
        var parts = URLComponents()
        parts.scheme = "http"
        parts.host = hub.host
        parts.port = hub.port
        // "crew/crew-4.jpg", "/crew/crew-4.jpg" or "crew//crew-4.jpg": one leading slash, no doubles.
        let segments = portrait.split(separator: "/", omittingEmptySubsequences: true)
        guard !segments.isEmpty else { return nil }
        parts.path = "/" + segments.joined(separator: "/")
        return parts.url
    }
}

struct CrewPortrait: View {
    enum Shape { case square, circle }

    let member: CrewMember
    var shape: Shape = .square
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?

    var body: some View {
        let url = PortraitStore.url(of: member, hub: model.address)
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image = image ?? url.flatMap({ PortraitStore.shared.cached($0) }) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .grayscale(1)
                } else {
                    initial
                }
            }
            .clipShape(clip)
            .overlay { if isSample, image != nil { aiMark } }
            .accessibilityHidden(true)
            // Tried again whenever the link to the hub changes (a failed load is not remembered).
            .task(id: "\(url?.absoluteString ?? "")|\(model.link == .connected)") {
                guard let url else { image = nil; return }
                if let loaded = await PortraitStore.shared.load(url) { image = loaded }
            }
    }

    /// A sample portrait (not a photo someone added): an AI-generated picture, marked in its own bottom-left
    /// corner, which the square crop cuts off.
    private var isSample: Bool {
        guard let portrait = member.portrait else { return false }
        return !portrait.contains("custom/")
    }

    /// The same "AI" mark, drawn over the crop: bottom-left on a square, bottom centre on a circle.
    /// Left off below 44 points, where it would cover the face.
    private var aiMark: some View {
        GeometryReader { geometry in
            let side = geometry.size.width
            if side >= 44 {
                let size = max(8, side * 0.085)
                Text(verbatim: "AI")
                    .font(.system(size: size, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, size * 0.45)
                    .padding(.vertical, size * 0.15)
                    .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: size * 0.45, style: .continuous))
                    .padding(side * 0.045)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: shape == .circle ? .bottom : .bottomLeading)
            }
        }
    }

    private var clip: AnyShape {
        switch shape {
        case .square: AnyShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        case .circle: AnyShape(Circle())
        }
    }

    /// The fallback, with no photo: the same line figure the hub's crew card draws (hub/ui/src/dock/widgets.tsx,
    /// Portrait), a faceted head and shoulders, on a faint fill. The same for everyone; the name is beside it.
    private var initial: some View {
        GeometryReader { geometry in
            PortraitFigure()
                .stroke(Color.white.opacity(0.42), style: StrokeStyle(lineWidth: max(0.75, geometry.size.width * 0.9 / 48), lineCap: .round, lineJoin: .round))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white.opacity(HubStyle.fieldFill))
        }
    }
}

/// The hub's placeholder portrait, as lines on its 48 by 48 grid, scaled to fill the width and sit on the bottom edge.
private struct PortraitFigure: Shape {
    private static let closed: [[(CGFloat, CGFloat)]] = [
        [(23, 7), (30, 9.5), (33, 15), (35, 20), (33, 25.5), (28, 29.5), (21, 29), (16, 25), (14, 17), (16, 10)],
    ]
    private static let open: [[(CGFloat, CGFloat)]] = [
        [(30, 9.5), (27, 16), (33, 15)], [(27, 16), (35, 20)], [(16, 10), (22, 19), (27, 16)], [(14, 17), (22, 19), (21, 29)],
        [(27, 16), (29, 23), (35, 20)], [(29, 23), (33, 25.5)], [(29, 23), (28, 29.5)], [(22, 19), (29, 23)],
        [(19.5, 29.2), (18.5, 34)], [(27.5, 29.8), (28, 34)],
        [(1, 48), (4, 40), (14, 35.5), (18.5, 34), (23.5, 39), (28, 34), (35, 36), (44, 40), (47, 48)],
        [(14, 35.5), (16, 48)], [(35, 36), (33, 48)], [(23.5, 39), (23.5, 48)], [(4, 40), (9, 48)], [(44, 40), (40, 48)],
    ]

    func path(in rect: CGRect) -> Path {
        let scale = rect.width / 48
        let top = rect.maxY - 48 * scale
        func point(_ p: (CGFloat, CGFloat)) -> CGPoint { CGPoint(x: rect.minX + p.0 * scale, y: top + p.1 * scale) }
        var path = Path()
        for line in Self.closed {
            path.addLines(line.map(point))
            path.closeSubpath()
        }
        for line in Self.open { path.addLines(line.map(point)) }
        return path
    }
}
