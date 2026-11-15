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

    /// A wait counted down in whole minutes, rounded up ("14 min", "1 h 12 min"), so two screens
    /// that hear the hub's clock a few seconds apart still show the same thing.
    static func minutes(ms: Double) -> String {
        let minutes = max(0, Int((ms / 60_000).rounded(.up)))
        let duration = Duration.seconds(minutes * 60)
        if minutes < 60 { return duration.formatted(.units(allowed: [.minutes], width: .abbreviated)) }
        return duration.formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }
}
