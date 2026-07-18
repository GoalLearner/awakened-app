import Foundation
import Capacitor
import WidgetKit

/// W718 — Home-screen widget bridge (Capacitor 6, pure-Swift plugin).
///
/// The web app (`app.js` → `_pushWidgetState`) calls
/// `WidgetBridge.setState({streak, stepGoal, rankTier, rankColor, alias, updatedAt})`
/// on every save / foreground. We persist a compact JSON blob into the shared
/// App Group container that the WidgetKit extension reads, then nudge WidgetKit
/// to reload so the tile updates promptly.
///
/// NOTE: steps are deliberately NOT passed here — the widget reads today's step
/// count LIVE from HealthKit on each timeline refresh, so a number written on
/// sync would only go stale. This plugin carries game state (streak/rank/goal).
///
/// This file belongs to the MAIN APP target. Capacitor 6 auto-registers
/// plugins that conform to `CAPBridgedPlugin`, so no manual registration or
/// Objective-C `.m` shim is needed — just add the file to the App target.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise)
    ]

    // MUST match `AwakenedShared` in the widget extension AND the App Group id
    // you enable on both App IDs in the portal.
    static let appGroup = "group.com.goallearner.awakened"
    static let stateKey = "widgetState"

    @objc func setState(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: WidgetBridgePlugin.appGroup) else {
            call.reject("App Group \(WidgetBridgePlugin.appGroup) unavailable — is the App Groups capability enabled on this target?")
            return
        }

        // Read fields explicitly (never dump `call.options` — it carries
        // Capacitor-internal keys). Missing fields fall back to safe defaults.
        var state: [String: Any] = [:]
        state["lbRank"]    = call.getInt("lbRank") ?? 0   // global Steps-board position (0 = unknown)
        state["stepGoal"]  = call.getInt("stepGoal") ?? 0
        state["rankTier"]  = call.getString("rankTier") ?? ""
        state["rankColor"] = call.getString("rankColor") ?? "#a78bfa"
        state["alias"]     = call.getString("alias") ?? ""
        state["updatedAt"] = call.getDouble("updatedAt") ?? 0

        if let data = try? JSONSerialization.data(withJSONObject: state, options: []),
           let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: WidgetBridgePlugin.stateKey)
        }

        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
