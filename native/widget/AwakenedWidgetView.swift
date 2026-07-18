import WidgetKit
import SwiftUI

// W718 — the small home widget's SwiftUI view. Belongs to the WIDGET target.
struct AwakenedWidgetView: View {
    var entry: AwakenedEntry

    // Ring fill = today's steps toward today's goal, clamped to [0,1] so it
    // fills proportionally and tops out FULL exactly when the goal is met
    // (e.g. an 8,000 goal → 4,000 steps = half ring, 8,000+ = full).
    private var progress: Double {
        guard entry.stepGoal > 0, entry.stepsKnown else { return 0 }
        return min(1.0, Double(entry.steps) / Double(entry.stepGoal))
    }
    private var goalMet: Bool {
        entry.stepGoal > 0 && entry.stepsKnown && entry.steps >= entry.stepGoal
    }
    private var rankColor: Color { Color(hexString: entry.rankColorHex) }

    var body: some View {
        content.awakenedContainerBackground()
    }

    private var content: some View {
        VStack(spacing: 6) {
            // ── Global Steps-leaderboard position ──
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if entry.lbRank > 0 {
                    Text("#\(entry.lbRank)")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .foregroundColor(rankColor)
                    Text("STEPS")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white.opacity(0.5))
                } else {
                    Text(entry.rankTier.isEmpty ? "AWAKENED" : "RANK \(entry.rankTier)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white.opacity(0.6))
                }
            }

            // ── Today's step ring (live from HealthKit) ──
            ZStack {
                Circle().stroke(Color.white.opacity(0.12), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(
                        AngularGradient(gradient: Gradient(colors: [rankColor.opacity(0.65), rankColor]),
                                        center: .center),
                        style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text(entry.stepsKnown ? shortSteps(entry.steps) : "—")
                        .font(.system(size: 17, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)
                    // Goal-met cue: the sub-label flips to "GOAL ✓" in the rank
                    // color the moment today's steps reach the goal.
                    if goalMet {
                        Text("GOAL ✓")
                            .font(.system(size: 7.5, weight: .bold))
                            .foregroundColor(rankColor)
                    } else {
                        Text("TODAY")
                            .font(.system(size: 7.5, weight: .bold))
                            .foregroundColor(.white.opacity(0.45))
                    }
                }
            }
            .frame(width: 88, height: 88)
        }
        .padding(12)
    }

    // 6,200 → "6,200"; 12,340 → "12.3k"
    private func shortSteps(_ n: Int) -> String {
        if n >= 10000 { return String(format: "%.1fk", Double(n) / 1000.0) }
        if n >= 1000  { return "\(n / 1000),\(String(format: "%03d", n % 1000))" }
        return "\(n)"
    }
}

// MARK: - Background (swap-in layer; Phase 2 = member card art)
// v1 is a clean navy radial. It is deliberately its OWN view so adding the
// painted member card_bg later touches THIS type only — draw a RESIZED, CACHED
// image behind the same scrim. Do NOT drop a full-bleed ~1000px webp here:
// widget extensions have a hard memory budget and full-res art is the classic
// way to get the tile jettisoned by the system.
struct AwakenedWidgetBackground: View {
    var body: some View {
        RadialGradient(
            gradient: Gradient(colors: [Color(hexString: "#1a1633"), Color(hexString: "#07070f")]),
            center: .center, startRadius: 6, endRadius: 120)
    }
}

private extension View {
    // iOS 17 requires containerBackground for the tile to fill; earlier iOS
    // uses a ZStack. This keeps the call site identical across versions.
    @ViewBuilder func awakenedContainerBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { AwakenedWidgetBackground() }
        } else {
            ZStack { AwakenedWidgetBackground(); self }
        }
    }
}

// MARK: - Hex → Color
extension Color {
    init(hexString: String) {
        var hex = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
        if hex.hasPrefix("#") { hex.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&v)
        if hex.count == 6 {
            self.init(.sRGB,
                      red:   Double((v & 0xFF0000) >> 16) / 255.0,
                      green: Double((v & 0x00FF00) >> 8)  / 255.0,
                      blue:  Double(v & 0x0000FF)         / 255.0,
                      opacity: 1)
        } else {
            self.init(.sRGB, red: 0.655, green: 0.545, blue: 0.980, opacity: 1) // #a78bfa fallback
        }
    }
}
