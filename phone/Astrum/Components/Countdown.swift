// Time spans as the screens say them: "45 s", "3 min 05 s", "1 h 12 min".

import Foundation

enum Countdown {
    /// Milliseconds as a short span, never negative.
    static func text(ms: Double) -> String {
        let seconds = max(0, Int((ms / 1000).rounded(.up)))
        let duration = Duration.seconds(seconds)
        if seconds < 60 { return duration.formatted(.units(allowed: [.seconds], width: .abbreviated)) }
        if seconds < 3600 { return duration.formatted(.units(allowed: [.minutes, .seconds], width: .abbreviated)) }
        return duration.formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }
}
