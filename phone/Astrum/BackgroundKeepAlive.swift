// Keeps the app running while the phone is locked, so the hub's socket stays
// open and room alarms arrive within seconds.
//
// HOW: it plays silence through the audio background mode, mixed with any
// other audio so it never interrupts music or calls. iOS keeps an app that is
// playing audio alive.
//
// This is a deliberate workaround for a prototype. Astrum is installed only on
// the developer's own phones from Xcode and is NOT going to the App Store,
// whose review rejects silent audio used this way. The proper route is
// Apple's Local Push Connectivity (NEAppPushProvider), which needs an
// entitlement that has been requested but not granted.
//
// To switch it off, set `isEnabled` to false.

import AVFoundation
import os

private let log = Logger(subsystem: "space.astrum.phone", category: "keepalive")

@MainActor
final class BackgroundKeepAlive {
    /// The one switch for this workaround.
    static let isEnabled = true

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var observers: [NSObjectProtocol] = []
    private lazy var silence: AVAudioPCMBuffer? = Self.makeSilence()

    func start() {
        guard Self.isEnabled, !engine.isRunning else { return }
        observeInterruptions()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            guard let silence else { return }
            if player.engine == nil {
                engine.attach(player)
                engine.connect(player, to: engine.mainMixerNode, format: silence.format)
            }
            try engine.start()
            player.scheduleBuffer(silence, at: nil, options: .loops, completionHandler: nil)
            player.play()
        } catch {
            log.error("Keep-alive audio did not start: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// A call or another app can stop our audio, and iOS can reset audio altogether; start again after either.
    private func observeInterruptions() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw == AVAudioSession.InterruptionType.ended.rawValue else { return }
            MainActor.assumeIsolated { self?.start() }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.start() }
        })
        // iOS can reset the whole audio system (rare, but it happens); the engine stops without an interruption.
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.engine.stop()
                self?.start()
            }
        })
    }

    /// One second of silence, looped.
    private static func makeSilence() -> AVAudioPCMBuffer? {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100) else { return nil }
        buffer.frameLength = buffer.frameCapacity
        if let channel = buffer.floatChannelData?[0] {
            channel.update(repeating: 0, count: Int(buffer.frameLength))
        }
        return buffer
    }
}
