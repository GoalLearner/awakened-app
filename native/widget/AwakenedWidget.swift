import WidgetKit
import SwiftUI
import HealthKit

// ─────────────────────────────────────────────────────────────────────────
// W718 — Awakened home-screen widget (WidgetKit extension).
// This file belongs to the WIDGET EXTENSION target (NOT the main app).
//
// Data model:
//   • Game state (streak, rank tier + color, today's step goal) is written by
//     the app into the shared App Group container via WidgetBridgePlugin.
//   • Today's step COUNT is read live from HealthKit here, on each refresh, so
//     the ring stays current even when the app hasn't been opened.
// ─────────────────────────────────────────────────────────────────────────

// MARK: - Shared constants (MUST match WidgetBridgePlugin.swift + the App Group)
enum AwakenedShared {
    static let appGroup = "group.com.goallearner.awakened"
    static let stateKey = "widgetState"
}

// MARK: - Game state (written by the app)
struct AwakenedState {
    var streak: Int = 0
    var stepGoal: Int = 0
    var rankTier: String = ""
    var rankColorHex: String = "#a78bfa"

    static func load() -> AwakenedState {
        guard let d = UserDefaults(suiteName: AwakenedShared.appGroup),
              let json = d.string(forKey: AwakenedShared.stateKey),
              let data = json.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return AwakenedState() }

        var s = AwakenedState()
        s.streak       = (obj["streak"]   as? NSNumber)?.intValue ?? (obj["streak"]   as? Int) ?? 0
        s.stepGoal     = (obj["stepGoal"] as? NSNumber)?.intValue ?? (obj["stepGoal"] as? Int) ?? 0
        s.rankTier     = (obj["rankTier"]  as? String) ?? ""
        s.rankColorHex = (obj["rankColor"] as? String) ?? "#a78bfa"
        return s
    }
}

// MARK: - Timeline entry
struct AwakenedEntry: TimelineEntry {
    let date: Date
    let streak: Int
    let steps: Int
    let stepGoal: Int
    let rankTier: String
    let rankColorHex: String
    let stepsKnown: Bool   // false → HealthKit unavailable / denied (show "—", no ring)
}

// MARK: - HealthKit: today's cumulative step count
private let healthStore = HKHealthStore()

private func fetchTodaySteps(_ completion: @escaping (Int?) -> Void) {
    guard HKHealthStore.isHealthDataAvailable(),
          let type = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        completion(nil); return
    }
    let start = Calendar.current.startOfDay(for: Date())
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
    let query = HKStatisticsQuery(quantityType: type,
                                  quantitySamplePredicate: predicate,
                                  options: .cumulativeSum) { _, result, _ in
        let steps = result?.sumQuantity()?.doubleValue(for: HKUnit.count())
        completion(steps.map { Int($0.rounded()) })
    }
    healthStore.execute(query)
}

// MARK: - Timeline provider
struct AwakenedProvider: TimelineProvider {
    func placeholder(in context: Context) -> AwakenedEntry {
        AwakenedEntry(date: Date(), streak: 8, steps: 6200, stepGoal: 10000,
                      rankTier: "A", rankColorHex: "#ef4444", stepsKnown: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (AwakenedEntry) -> Void) {
        let s = AwakenedState.load()
        completion(AwakenedEntry(date: Date(), streak: s.streak, steps: 0, stepGoal: s.stepGoal,
                                 rankTier: s.rankTier, rankColorHex: s.rankColorHex, stepsKnown: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AwakenedEntry>) -> Void) {
        let s = AwakenedState.load()
        fetchTodaySteps { steps in
            let entry = AwakenedEntry(date: Date(), streak: s.streak, steps: steps ?? 0,
                                      stepGoal: s.stepGoal, rankTier: s.rankTier,
                                      rankColorHex: s.rankColorHex, stepsKnown: steps != nil)
            // ~20-minute refresh hint. WidgetKit may stretch this under system
            // budget, but the app also force-reloads on every save/sync
            // (WidgetCenter.reloadAllTimelines), so game-state changes appear
            // promptly regardless of this cadence.
            let next = Calendar.current.date(byAdding: .minute, value: 20, to: Date())
                ?? Date().addingTimeInterval(1200)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Widget declaration
struct AwakenedWidget: Widget {
    let kind = "AwakenedStreakWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AwakenedProvider()) { entry in
            AwakenedWidgetView(entry: entry)
        }
        .configurationDisplayName("Awakened")
        .description("Your streak, today's steps, and rank at a glance.")
        .supportedFamilies([.systemSmall])   // Phase 2: add .accessoryCircular / .accessoryRectangular (lock screen)
    }
}

@main
struct AwakenedWidgetBundle: WidgetBundle {
    var body: some Widget {
        AwakenedWidget()
    }
}
