import Foundation
import HealthKit
import UIKit
import UserNotifications

/// W1046 — THE READY HUNT, ON THE PHONE (owner 2026-10-12).
///
/// The web app only reads Apple Health while it is open, so a hunter who walks 10,000 steps
/// and never opens Awakened was told nothing. This watcher is woken by Apple Health in the
/// background (HealthKit background delivery), reads today's number the way `app.js` reads it,
/// and posts ONE local notification: "A hunt is ready".
///
/// It knows nothing about bosses. `app.js` (`_rhWatchSync`) writes the list it may announce to
/// Library/ready-hunt-watch.json with the Filesystem plugin, and this file reads it:
///
///   { "v":1, "on":true, "at":1791850000000, "pausedUntil":0,
///     "quiet":{"start":"22:00","end":"07:00"}, "hold":"", "seenDay":"2026-10-12", "seen":["the_carouser"],
///     "hunts":[ {"id":"the_steel_wolf","name":"The Steel Wolf","metric":"steps","bar":6000,
///                "beaten":"2026-10-11","until":0} ] }
///
/// MAIN APP target only. Installed by scripts/prep-local-build.sh (step 8d), which also adds
/// the HealthKit background-delivery entitlement and the one call in AppDelegate. No plugin,
/// no bridge: the tap is routed by @capacitor/local-notifications because the notification
/// carries the same `cap_extra` that plugin writes ({ kind: "hunt", bossId }).
///
/// The app decides, this only announces: a tap opens the app, which checks again before it
/// offers the strike. The numbers below must stay in step with `app.js`:
///   - `ReadyHuntMath.total`      = _totalFromHealthSamples (W799 manual entries dropped, W681 sources)
///   - `ReadyHuntMath.sleepHours` = getSleepBetween (the night keyed to today, time covered)
final class ReadyHuntWatcher {
    static let shared = ReadyHuntWatcher()

    static let metrics: [String] = ["steps", "flights", "sleep"]
    static let maxPerDay: Int = 3
    static let minGapSeconds: Double = 2 * 60 * 60
    static let staleSeconds: Double = 7 * 24 * 60 * 60
    static let notificationId: String = "88146"

    private let store = HKHealthStore()
    private let work = DispatchQueue(label: "com.goallearner.awakened.readyhunt")
    private var live: Set<String> = []
    private var hooked: Bool = false

    private init() {}

    /// AppDelegate calls this at launch, in the foreground or woken in the background.
    /// It runs again each time the app becomes active, so a hunter who grants Apple Health
    /// after the first launch is picked up without a restart.
    func start() {
        if !HKHealthStore.isHealthDataAvailable() { return }
        work.async {
            self.hookActive()
            for metric in ReadyHuntWatcher.metrics {
                self.observe(metric)
            }
        }
    }

    private func hookActive() {
        if hooked { return }
        hooked = true
        let center = NotificationCenter.default
        _ = center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { _ in
            ReadyHuntWatcher.shared.start()
        }
    }

    private func sampleType(_ metric: String) -> HKSampleType? {
        if metric == "steps" { return HKObjectType.quantityType(forIdentifier: .stepCount) }
        if metric == "flights" { return HKObjectType.quantityType(forIdentifier: .flightsClimbed) }
        if metric == "sleep" { return HKObjectType.categoryType(forIdentifier: .sleepAnalysis) }
        return nil
    }

    private func observe(_ metric: String) {
        if live.contains(metric) { return }
        guard let type = sampleType(metric) else { return }
        live.insert(metric)
        let query = HKObserverQuery(sampleType: type, predicate: nil) { running, done, error in
            let me = ReadyHuntWatcher.shared
            if error != nil {
                // Not allowed yet (or Apple Health is locked): drop it and try again next time the app opens.
                me.store.stop(running)
                me.work.async { me.live.remove(metric) }
                done()
                return
            }
            me.check(metric) { done() }
        }
        store.execute(query)
        store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
    }

    // MARK: - One check

    /// Apple Health said `metric` changed. `finish` MUST be called exactly once.
    private func check(_ metric: String, _ finish: @escaping () -> Void) {
        DispatchQueue.main.async {
            // An observer fires once the moment it starts, so every launch runs a check, and a
            // launch a person makes is .inactive before it is .active. Only the background speaks.
            let onScreen: Bool = UIApplication.shared.applicationState != .background
            self.work.async {
                if onScreen {
                    finish()   // the app is open or opening: its own sheet says it
                    return
                }
                self.evaluate(metric, finish)
            }
        }
    }

    private func evaluate(_ metric: String, _ finish: @escaping () -> Void) {
        guard let watch = ReadyHuntWatch.load() else { finish(); return }
        let now = Date()
        let today = ReadyHuntClock.dayKey(now)
        let memo = ReadyHuntMemo.load(today)
        if !ReadyHuntClock.allowed(now, today, watch, memo) { finish(); return }
        // `fresh` = not said yet today: only these can cause a notification.
        // `standing` = every hunt on this metric still open, said or not: what a notification lists,
        // so a second one in the day reads "3 hunts are ready", not "A hunt is ready" for the newest.
        let fresh = ReadyHuntWatcher.candidates(metric, now, today, watch, memo, false)
        if fresh.isEmpty { finish(); return }
        let standing = ReadyHuntWatcher.candidates(metric, now, today, watch, memo, true)
        readValue(metric, now) { value in
            self.work.async {
                var news: Int = 0
                for hunt in fresh {
                    if value >= hunt.bar { news += 1 }
                }
                if news == 0 { finish(); return }
                var ready: [ReadyHuntEntry] = []
                for hunt in standing {
                    if value >= hunt.bar { ready.append(hunt) }
                }
                if ready.isEmpty { finish(); return }
                self.permitted { ok in
                    self.work.async {
                        if !ok { finish(); return }
                        self.post(metric, value, ready, today, finish)
                    }
                }
            }
        }
    }

    /// The hunts on `metric` that could be announced right now. `withTold` keeps the ones this
    /// watcher has already said today (for the wording); without it, only what is still news.
    static func candidates(_ metric: String, _ now: Date, _ today: String, _ watch: ReadyHuntWatch, _ memo: ReadyHuntMemo, _ withTold: Bool) -> [ReadyHuntEntry] {
        let nowMs: Double = now.timeIntervalSince1970 * 1000
        let seenToday: Bool = watch.seenDay == today
        var out: [ReadyHuntEntry] = []
        for hunt in watch.hunts {
            if hunt.metric != metric { continue }
            if hunt.beaten == today { continue }                         // a daily boss is beaten once a day
            if hunt.until > nowMs { continue }                           // a hunt already running resolves on its own
            if seenToday && watch.seen.contains(hunt.id) { continue }    // the app already showed it today
            if !withTold && memo.told.contains(hunt.id) { continue }     // this watcher already said it today
            out.append(hunt)
        }
        return out
    }

    private func permitted(_ done: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            done(settings.authorizationStatus == .authorized)
        }
    }

    private func readValue(_ metric: String, _ now: Date, _ done: @escaping (Double) -> Void) {
        guard let type = sampleType(metric) else { done(0); return }
        let dayStart = ReadyHuntClock.startOfDay(now)
        // app.js asks for the night from noon yesterday; steps and flights from midnight.
        let from: Date = metric == "sleep" ? dayStart.addingTimeInterval(-12 * 60 * 60) : dayStart
        let predicate = HKQuery.predicateForSamples(withStart: from, end: now, options: .strictStartDate)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            let list: [HKSample] = samples ?? []
            if metric == "sleep" {
                done(ReadyHuntMath.sleepHours(list, now))
            } else {
                done(ReadyHuntMath.total(list))
            }
        }
        store.execute(query)
    }

    private func post(_ metric: String, _ value: Double, _ ready: [ReadyHuntEntry], _ today: String, _ finish: @escaping () -> Void) {
        // Two metrics can arrive together: look at the day's record again before speaking.
        var memo = ReadyHuntMemo.load(today)
        if memo.count >= ReadyHuntWatcher.maxPerDay { finish(); return }
        let nowSeconds: Double = Date().timeIntervalSince1970
        if memo.last > 0 && nowSeconds - memo.last < ReadyHuntWatcher.minGapSeconds { finish(); return }

        var lead: ReadyHuntEntry = ready[0]
        for hunt in ready {
            if hunt.bar > lead.bar { lead = hunt }
        }
        let extra: [String: Any] = ["kind": "hunt", "bossId": lead.id]
        let content = UNMutableNotificationContent()
        content.title = ReadyHuntCopy.title(ready.count)
        content.body = ReadyHuntCopy.body(metric, value, ready.count, lead.name)
        content.sound = UNNotificationSound.default
        content.userInfo = ["cap_extra": extra]
        let request = UNNotificationRequest(identifier: ReadyHuntWatcher.notificationId, content: content, trigger: nil)
        // Written BEFORE the notification is handed over. Everything here runs on one serial
        // queue, so a second metric arriving in the same moment reads this record and stays quiet.
        for hunt in ready {
            if !memo.told.contains(hunt.id) { memo.told.append(hunt.id) }
        }
        memo.count += 1
        memo.last = nowSeconds
        memo.save()
        UNUserNotificationCenter.current().add(request) { _ in
            finish()
        }
    }
}

// MARK: - What app.js hands over

struct ReadyHuntEntry {
    let id: String
    let name: String
    let metric: String
    let bar: Double
    let beaten: String
    let until: Double
}

struct ReadyHuntWatch {
    var on: Bool = false
    var at: Double = 0
    var pausedUntil: Double = 0
    var quietStart: String = ""
    var quietEnd: String = ""
    var hold: String = ""
    var seenDay: String = ""
    var seen: [String] = []
    var hunts: [ReadyHuntEntry] = []

    static let fileName: String = "ready-hunt-watch.json"

    static func fileURL() -> URL? {
        let dirs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)
        guard let dir = dirs.first else { return nil }
        return dir.appendingPathComponent(ReadyHuntWatch.fileName)
    }

    static func number(_ raw: Any?) -> Double {
        if let n = raw as? NSNumber { return n.doubleValue }
        return 0
    }

    static func text(_ raw: Any?) -> String {
        if let s = raw as? String { return s }
        return ""
    }

    static func load() -> ReadyHuntWatch? {
        guard let url = ReadyHuntWatch.fileURL() else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return ReadyHuntWatch.parse(data)
    }

    static func parse(_ data: Data) -> ReadyHuntWatch? {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }
        guard let root = object as? [String: Any] else { return nil }
        var watch = ReadyHuntWatch()
        if let flag = root["on"] as? Bool { watch.on = flag }
        watch.at = ReadyHuntWatch.number(root["at"])
        watch.pausedUntil = ReadyHuntWatch.number(root["pausedUntil"])
        if let quiet = root["quiet"] as? [String: Any] {
            watch.quietStart = ReadyHuntWatch.text(quiet["start"])
            watch.quietEnd = ReadyHuntWatch.text(quiet["end"])
        }
        watch.hold = ReadyHuntWatch.text(root["hold"])
        watch.seenDay = ReadyHuntWatch.text(root["seenDay"])
        if let seen = root["seen"] as? [String] { watch.seen = seen }
        if let list = root["hunts"] as? [[String: Any]] {
            for item in list {
                let id = ReadyHuntWatch.text(item["id"])
                let metric = ReadyHuntWatch.text(item["metric"])
                let bar = ReadyHuntWatch.number(item["bar"])
                if id.isEmpty || metric.isEmpty || !(bar > 0) { continue }
                let entry = ReadyHuntEntry(
                    id: id,
                    name: ReadyHuntWatch.text(item["name"]),
                    metric: metric,
                    bar: bar,
                    beaten: ReadyHuntWatch.text(item["beaten"]),
                    until: ReadyHuntWatch.number(item["until"])
                )
                watch.hunts.append(entry)
            }
        }
        return watch
    }
}

/// What this watcher has already said today (UserDefaults, this device only).
struct ReadyHuntMemo {
    var day: String = ""
    var told: [String] = []
    var count: Int = 0
    var last: Double = 0

    static let key: String = "readyHuntMemo.v1"

    static func load(_ today: String) -> ReadyHuntMemo {
        var memo = ReadyHuntMemo()
        memo.day = today
        guard let saved = UserDefaults.standard.dictionary(forKey: ReadyHuntMemo.key) else { return memo }
        let savedDay = ReadyHuntWatch.text(saved["day"])
        if savedDay != today { return memo }
        if let told = saved["told"] as? [String] { memo.told = told }
        memo.count = Int(ReadyHuntWatch.number(saved["count"]))
        memo.last = ReadyHuntWatch.number(saved["last"])
        return memo
    }

    func save() {
        let record: [String: Any] = ["day": day, "told": told, "count": count, "last": last]
        UserDefaults.standard.set(record, forKey: ReadyHuntMemo.key)
    }
}

// MARK: - The device's own day (Gregorian, like JavaScript's Date)

enum ReadyHuntClock {
    static func calendar() -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        return cal
    }

    static func startOfDay(_ date: Date) -> Date {
        return calendar().startOfDay(for: date)
    }

    /// "2026-10-12", the same key app.js builds with getFullYear / getMonth / getDate.
    static func dayKey(_ date: Date) -> String {
        let parts = calendar().dateComponents([.year, .month, .day], from: date)
        let year: Int = parts.year ?? 0
        let month: Int = parts.month ?? 0
        let day: Int = parts.day ?? 0
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func minutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":")
        if parts.count != 2 { return nil }
        guard let hours = Int(parts[0]), let mins = Int(parts[1]) else { return nil }
        return hours * 60 + mins
    }

    static func inQuiet(_ date: Date, _ start: String, _ end: String) -> Bool {
        guard let from = minutes(start), let to = minutes(end) else { return false }
        if from == to { return false }
        let parts = calendar().dateComponents([.hour, .minute], from: date)
        let hour: Int = parts.hour ?? 0
        let minute: Int = parts.minute ?? 0
        let now: Int = hour * 60 + minute
        if from < to { return now >= from && now < to }
        return now >= from || now < to
    }

    /// May anything be announced at all right now?
    static func allowed(_ now: Date, _ today: String, _ watch: ReadyHuntWatch, _ memo: ReadyHuntMemo) -> Bool {
        let nowSeconds: Double = now.timeIntervalSince1970
        if !watch.on { return false }
        if watch.hold == today { return false }
        if watch.at <= 0 { return false }
        if nowSeconds - watch.at / 1000 > ReadyHuntWatcher.staleSeconds { return false }   // not opened in a week: stay silent
        if watch.pausedUntil > nowSeconds * 1000 { return false }
        if !watch.quietStart.isEmpty && inQuiet(now, watch.quietStart, watch.quietEnd) { return false }
        if memo.count >= ReadyHuntWatcher.maxPerDay { return false }
        if memo.last > 0 && nowSeconds - memo.last < ReadyHuntWatcher.minGapSeconds { return false }
        return true
    }
}

// MARK: - The same arithmetic as app.js

enum ReadyHuntMath {
    /// W799 — a number typed into the Health app, or logged by a Shortcut, never counts.
    static func isManual(_ bundle: String) -> Bool {
        let lower = bundle.lowercased()
        return lower == "com.apple.health" || lower == "com.apple.shortcuts"
    }

    static func looksApple(_ name: String) -> Bool {
        let lower = name.lowercased()
        return lower.contains("iphone") || lower.contains("apple watch") || lower.contains("applewatch")
    }

    /// app.js `_totalFromHealthSamples`: one source → its total; several → the largest Apple
    /// device's total, or the largest of all when no Apple device wrote any.
    static func total(_ samples: [HKSample]) -> Double {
        var raw: Double = 0
        var bySource: [String: Double] = [:]
        var apple: [String: Bool] = [:]
        for sample in samples {
            guard let quantity = sample as? HKQuantitySample else { continue }
            let source = quantity.sourceRevision.source
            let bundle: String = source.bundleIdentifier
            if isManual(bundle) { continue }
            let value: Double = quantity.quantity.doubleValue(for: HKUnit.count())
            if !(value > 0) { continue }
            raw += value
            let key: String = bundle.isEmpty ? source.name : bundle
            if key.isEmpty { continue }
            if bySource[key] == nil {
                bySource[key] = 0
                if bundle.isEmpty {
                    apple[key] = looksApple(source.name)
                } else {
                    apple[key] = bundle.lowercased().hasPrefix("com.apple.health.")
                }
            }
            let soFar: Double = bySource[key] ?? 0
            bySource[key] = soFar + value
        }
        if bySource.count <= 1 { return raw.rounded() }
        var maxApple: Double = 0
        var maxAll: Double = 0
        for (key, sum) in bySource {
            if sum > maxAll { maxAll = sum }
            let isApple: Bool = apple[key] ?? false
            if isApple && sum > maxApple { maxApple = sum }
        }
        let best: Double = maxApple > 0 ? maxApple : maxAll
        return best.rounded()
    }

    /// app.js `getSleepBetween`: the night keyed to today is every asleep sample whose start,
    /// moved on four hours, lands on today; its length is the time COVERED, not the sum (two
    /// trackers on one night do not double it). In-bed and awake samples are not sleep.
    static func sleepHours(_ samples: [HKSample], _ now: Date) -> Double {
        let today = ReadyHuntClock.dayKey(now)
        var starts: [Double] = []
        var ends: [Double] = []
        for sample in samples {
            guard let stage = sample as? HKCategorySample else { continue }
            if isManual(stage.sourceRevision.source.bundleIdentifier) { continue }
            if stage.value == HKCategoryValueSleepAnalysis.inBed.rawValue { continue }
            if stage.value == HKCategoryValueSleepAnalysis.awake.rawValue { continue }
            let shifted = stage.startDate.addingTimeInterval(4 * 60 * 60)
            if ReadyHuntClock.dayKey(shifted) != today { continue }
            let from: Double = stage.startDate.timeIntervalSince1970
            let to: Double = stage.endDate.timeIntervalSince1970
            if to > from {
                starts.append(from)
                ends.append(to)
            }
        }
        let order: [Int] = starts.indices.sorted { starts[$0] < starts[$1] }
        var covered: Double = 0
        var coveredEnd: Double = -Double.greatestFiniteMagnitude
        for index in order {
            let from: Double = max(starts[index], coveredEnd)
            let to: Double = ends[index]
            if to > from { covered += to - from }
            if to > coveredEnd { coveredEnd = to }
        }
        return covered / 3600
    }
}

// MARK: - The words (no exclamation marks; the hunter's own number, never a guess)

enum ReadyHuntCopy {
    static func title(_ count: Int) -> String {
        if count == 1 { return "A hunt is ready" }
        return "\(count) hunts are ready"
    }

    static func number(_ metric: String, _ value: Double) -> String {
        if metric == "sleep" {
            let minutes: Int = Int((value * 60 + 0.000001).rounded(.down))
            let hours: Int = minutes / 60
            let rest: Int = minutes % 60
            if rest == 0 { return "\(hours) h last night" }
            return "\(hours) h \(rest) m last night"
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.maximumFractionDigits = 0
        let rounded: Double = value.rounded()
        let text: String = formatter.string(from: NSNumber(value: rounded)) ?? String(Int(rounded))
        if metric == "steps" { return "\(text) steps today" }
        return "\(text) flights today"
    }

    static func body(_ metric: String, _ value: Double, _ count: Int, _ lead: String) -> String {
        let head: String = number(metric, value)
        if count == 1 { return "\(head). \(lead) is yours." }
        if count == 2 { return "\(head). One tap takes both." }
        return "\(head). One tap takes all \(count)."
    }
}
