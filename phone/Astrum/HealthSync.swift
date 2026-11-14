// Reads Health data (the Apple Watch's readings arrive through it) and turns
// new samples into hub rows, queued on disk for sending.
//
// Each kind of reading keeps its own saved anchor, so a sample is read once
// and never sent twice. iOS wakes the app when new samples land (background
// delivery), and the app reads whatever is new since the anchor.
//
// How each reading becomes a row:
// - heart rate, resting heart rate, HRV, breathing rate, blood oxygen, sound
//   level: one row per sample, at the sample's end time.
// - steps, exercise minutes, active energy: the day's running total so far
//   (Health removes the overlap between the Watch and the phone), at the time
//   of the newest sample counted. Each update sends a new, larger total.
// - sleep: minutes asleep in the night, counting a night from 18:00 to 18:00,
//   at the time the last stretch of sleep ended.

import Foundation
import HealthKit
import os

private let log = Logger(subsystem: "space.astrum.phone", category: "health")

/// The readings the phone sends, by the hub's signal name and unit.
enum BodySignal: String, CaseIterable, Sendable {
    case heartRate = "heart_rate"
    case restingHeartRate = "resting_heart_rate"
    case hrv
    case breathingRate = "breathing_rate"
    case bloodOxygen = "blood_oxygen"
    case sleepDuration = "sleep_duration"
    case steps
    case exerciseMinutes = "exercise_minutes"
    case activeEnergy = "active_energy"
    case soundLevel = "sound_level"

    /// The unit the hub stores.
    var unit: String {
        switch self {
        case .heartRate, .restingHeartRate: "bpm"
        case .hrv: "ms"
        case .breathingRate: "breaths/min"
        case .bloodOxygen: "%"
        case .sleepDuration, .exerciseMinutes: "min"
        case .steps: "count"
        case .activeEnergy: "kcal"
        case .soundLevel: "dBA"
        }
    }

    /// Nil only for sleep, which is a category, not a quantity.
    var quantityIdentifier: HKQuantityTypeIdentifier? {
        switch self {
        case .heartRate: .heartRate
        case .restingHeartRate: .restingHeartRate
        case .hrv: .heartRateVariabilitySDNN
        case .breathingRate: .respiratoryRate
        case .bloodOxygen: .oxygenSaturation
        case .sleepDuration: nil
        case .steps: .stepCount
        case .exerciseMinutes: .appleExerciseTime
        case .activeEnergy: .activeEnergyBurned
        case .soundLevel: .environmentalAudioExposure
        }
    }

    var sampleType: HKSampleType {
        if let identifier = quantityIdentifier { return HKQuantityType(identifier) }
        return HKCategoryType(.sleepAnalysis)
    }

    /// The Health unit to read a quantity in (unused for sleep).
    var healthUnit: HKUnit {
        switch self {
        case .heartRate, .restingHeartRate, .breathingRate: HKUnit.count().unitDivided(by: .minute())
        case .hrv: HKUnit.secondUnit(with: .milli)
        case .bloodOxygen: HKUnit.percent()
        case .sleepDuration, .exerciseMinutes: HKUnit.minute()
        case .steps: HKUnit.count()
        case .activeEnergy: HKUnit.kilocalorie()
        case .soundLevel: HKUnit.decibelAWeightedSoundPressureLevel()
        }
    }

    /// Health stores blood oxygen as 0...1; the hub wants a percentage.
    var multiplier: Double { self == .bloodOxygen ? 100 : 1 }

    var isDailyTotal: Bool { self == .steps || self == .exerciseMinutes || self == .activeEnergy }
}

actor HealthSync {
    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// How far back to look. Samples the Watch syncs later than this are skipped,
    /// and the first run sends two days, not the whole history.
    private static let lookback: TimeInterval = 2 * 86_400

    private let store = HKHealthStore()
    private let queue: ReadingQueue
    private let queued: AsyncStream<Void>.Continuation
    private var person = ""
    private var started = false
    private var running: Set<BodySignal> = []
    private var again: Set<BodySignal> = []

    /// `queued` is told each time new readings are on disk, waiting to be sent.
    init(queue: ReadingQueue, queued: AsyncStream<Void>.Continuation) {
        self.queue = queue
        self.queued = queued
    }

    private var readTypes: Set<HKObjectType> {
        Set(BodySignal.allCases.map { $0.sampleType as HKObjectType })
    }

    func requestAccess() async throws {
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    /// True once the permission sheet has been shown. iOS never tells an app
    /// which read permissions were granted, only that it asked.
    func hasAsked() async -> Bool {
        guard Self.isAvailable else { return false }
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: readTypes)
        return status == .unnecessary
    }

    /// Starts watching every reading for this crewmate. Safe to call again
    /// when the crewmate changes.
    func start(person: String) async {
        self.person = person
        guard Self.isAvailable, !started, !person.isEmpty else { return }
        started = true
        for signal in BodySignal.allCases {
            // Fires once now, and again whenever Health has new samples of this type.
            let query = HKObserverQuery(sampleType: signal.sampleType, predicate: nil) { @Sendable [weak self] _, completion, error in
                guard error == nil, let self else {
                    completion()
                    return
                }
                // Health's completion handler is not marked Sendable, but it is safe to
                // call from any thread; it is called exactly once, after the sync.
                nonisolated(unsafe) let done = completion
                Task {
                    await self.sync(signal)
                    done()
                }
            }
            store.execute(query)
            do {
                try await store.enableBackgroundDelivery(for: signal.sampleType, frequency: .immediate)
            } catch {
                log.error("No background delivery for \(signal.rawValue, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Reads everything new. Used when the phone is unlocked again, since
    /// Health data cannot be read while the phone is locked.
    func syncAll() async {
        for signal in BodySignal.allCases { await sync(signal) }
    }

    /// Reads one type. If a read of the same type is already under way, it
    /// runs once more after it instead of in parallel (which could send twice).
    func sync(_ signal: BodySignal) async {
        guard started, !person.isEmpty else { return }
        if running.contains(signal) {
            again.insert(signal)
            return
        }
        running.insert(signal)
        repeat {
            again.remove(signal)
            await fetch(signal)
        } while again.contains(signal)
        running.remove(signal)
    }

    private func fetch(_ signal: BodySignal) async {
        let person = self.person
        let recent = HKQuery.predicateForSamples(withStart: Date(timeIntervalSinceNow: -Self.lookback), end: nil)
        do {
            let readings: [QueuedReading]
            let anchor: HKQueryAnchor
            if let identifier = signal.quantityIdentifier {
                let type = HKQuantityType(identifier)
                let query = HKAnchoredObjectQueryDescriptor(
                    predicates: [.quantitySample(type: type, predicate: recent)],
                    anchor: savedAnchor(for: signal)
                )
                let result = try await query.result(for: store)
                anchor = result.newAnchor
                if signal.isDailyTotal {
                    readings = try await dayTotals(signal, type: type, added: result.addedSamples, person: person)
                } else {
                    readings = result.addedSamples.map { sample in
                        reading(signal, value: sample.quantity.doubleValue(for: signal.healthUnit) * signal.multiplier, at: sample.endDate, person: person)
                    }
                }
            } else {
                let type = HKCategoryType(.sleepAnalysis)
                let query = HKAnchoredObjectQueryDescriptor(
                    predicates: [.categorySample(type: type, predicate: recent)],
                    anchor: savedAnchor(for: signal)
                )
                let result = try await query.result(for: store)
                anchor = result.newAnchor
                readings = try await sleepNights(touchedBy: result.addedSamples, person: person)
            }
            // On disk first, then the anchor: a crash in between sends again rather than never.
            if !readings.isEmpty {
                await queue.append(readings)
                queued.yield()
            }
            save(anchor, for: signal)
        } catch {
            log.error("Could not read \(signal.rawValue, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The running total of each day that has new samples.
    private func dayTotals(_ signal: BodySignal, type: HKQuantityType, added: [HKQuantitySample], person: String) async throws -> [QueuedReading] {
        let calendar = Calendar.current
        var newest: [Date: Date] = [:]
        for sample in added {
            let day = calendar.startOfDay(for: sample.startDate)
            newest[day] = max(newest[day] ?? sample.endDate, sample.endDate)
        }
        var out: [QueuedReading] = []
        for (day, latest) in newest.sorted(by: { $0.key < $1.key }) {
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else { continue }
            let window = HKQuery.predicateForSamples(withStart: day, end: nextDay, options: .strictStartDate)
            let query = HKStatisticsQueryDescriptor(predicate: .quantitySample(type: type, predicate: window), options: .cumulativeSum)
            guard let sum = try await query.result(for: store)?.sumQuantity() else { continue }
            out.append(reading(signal, value: sum.doubleValue(for: signal.healthUnit), at: min(latest, nextDay), person: person))
        }
        return out
    }

    /// Minutes asleep in each night that has new sleep samples. Overlapping
    /// stretches (Watch and phone both recording) are counted once.
    private func sleepNights(touchedBy added: [HKCategorySample], person: String) async throws -> [QueuedReading] {
        let calendar = Calendar.current
        let type = HKCategoryType(.sleepAnalysis)
        // A night belongs to the day you wake up on: 18:00 the day before to 18:00 that day.
        let wakeDays = Set(added.map { calendar.startOfDay(for: $0.endDate.addingTimeInterval(6 * 3600)) })
        var out: [QueuedReading] = []
        for day in wakeDays.sorted() {
            let start = day.addingTimeInterval(-6 * 3600)
            let end = day.addingTimeInterval(18 * 3600)
            let query = HKSampleQueryDescriptor(
                predicates: [.categorySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end))],
                sortDescriptors: []
            )
            // Sorted here rather than in the query: a key path sort is not Sendable.
            let samples = try await query.result(for: store).sorted { $0.startDate < $1.startDate }
            let asleep = HKCategoryValueSleepAnalysis.allAsleepValues
            let stretches = samples
                .filter { sample in
                    guard let value = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return false }
                    return asleep.contains(value)
                }
                .map { (from: max($0.startDate, start), to: min($0.endDate, end)) }
                .filter { $0.from < $0.to }
                .sorted { $0.from < $1.from }

            var total: TimeInterval = 0
            var current: (from: Date, to: Date)?
            for stretch in stretches {
                if let open = current, stretch.from <= open.to {
                    current = (from: open.from, to: max(open.to, stretch.to))
                } else {
                    if let open = current { total += open.to.timeIntervalSince(open.from) }
                    current = stretch
                }
            }
            if let open = current { total += open.to.timeIntervalSince(open.from) }

            guard total > 0, let woke = stretches.map({ $0.to }).max() else { continue }
            out.append(reading(.sleepDuration, value: (total / 60).rounded(), at: woke, person: person))
        }
        return out
    }

    private func reading(_ signal: BodySignal, value: Double, at date: Date, person: String) -> QueuedReading {
        QueuedReading(
            person: person,
            t: Int64((date.timeIntervalSince1970 * 1000).rounded()),
            signal: signal.rawValue,
            value: (value * 100).rounded() / 100,
            unit: signal.unit
        )
    }

    // MARK: Anchors

    private func savedAnchor(for signal: BodySignal) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: "anchor.\(signal.rawValue)") else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func save(_ anchor: HKQueryAnchor, for signal: BodySignal) {
        guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else { return }
        UserDefaults.standard.set(data, forKey: "anchor.\(signal.rawValue)")
    }
}
