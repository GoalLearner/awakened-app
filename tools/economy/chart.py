#!/usr/bin/env python3
"""tools/economy/chart.py — W479 two-tier economy gap, before vs after.

Reads sim-twotier.json (written by sim-twotier.js) and plots cumulative RANK XP
over time for a consistently-completing hunter under each economy, with the rank
thresholds drawn in. The "before" custom curves crawl; the W479 "after" curves
snap up to (10 habits) or proportionally toward (5 habits) the pack curve.

Run:  node tools/economy/sim-twotier.js && python tools/economy/chart.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "sim-twotier.json")) as f:
    data = json.load(f)

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    sys.exit("matplotlib not installed — run: pip install matplotlib")

DAYS = 700  # window for readability (S+ for every fixed profile lands inside this)
x = list(range(1, DAYS + 1))

STYLE = {
    # Pack drawn as a wide gold halo; the 10-habit custom-AFTER curve is identical
    # (parity) and rides on top of it, so the gold peeks out as an "exactly equal" band.
    "pack10":          ("#f59e0b", "-",  6.0, "Pack — Morning Routine (10 habits)"),
    "custom10_after":  ("#22c55e", "-",  2.2, "Custom 10 habits — AFTER (W479) — rides on pack"),
    "custom5_after":   ("#38bdf8", "-",  2.0, "Custom 5 habits — AFTER (W479)"),
    "custom10_before": ("#9ca3af", "--", 1.6, "Custom 10 habits — BEFORE (zero compound)"),
    "custom5_before":  ("#6b7280", ":",  1.6, "Custom 5 habits — BEFORE (zero compound)"),
}

fig, ax = plt.subplots(figsize=(11, 6.5))
fig.patch.set_facecolor("#0b0a12")
ax.set_facecolor("#0b0a12")

cum = data["cumulative"]
order = ["pack10", "custom10_after", "custom5_after", "custom10_before", "custom5_before"]
for key in order:
    color, ls, lw, label = STYLE[key]
    y = cum[key][:DAYS]
    ax.plot(x, y, color=color, linestyle=ls, linewidth=lw, label=label)

# Rank threshold lines (B/A/S/S+)
for r in data["ranks"]:
    if r["id"] in ("B", "A", "S", "S+"):
        ax.axhline(r["min"], color="#3b3a4a", linewidth=0.8, zorder=0)
        ax.text(DAYS * 0.995, r["min"], "  " + r["id"], color="#8b8a9a",
                va="bottom", ha="right", fontsize=9, fontweight="bold")

# Mark S+ crossings for the headline profiles
for key in ("pack10", "custom10_after", "custom5_after"):
    d = data["profiles"][[p["key"] for p in data["profiles"]].index(key)]["reached"].get("S+")
    if d and d <= DAYS:
        color = STYLE[key][0]
        ax.scatter([d], [36000], color=color, s=42, zorder=5, edgecolor="white", linewidth=0.6)
        ax.annotate(f"S+ @ {d}d", (d, 36000), textcoords="offset points", xytext=(6, 8),
                    color=color, fontsize=8.5, fontweight="bold")

ax.set_ylim(0, 40000)
ax.set_xlim(0, DAYS)
ax.set_xlabel("Days of perfect consistency", color="#c9c8d4")
ax.set_ylabel("Cumulative rank XP", color="#c9c8d4")
ax.set_title("W479 — Custom-path compound closes the two-tier gap\n"
             "10-habit custom reaches parity with the pack; 5-habit stays fair (proportional)",
             color="#ffffff", fontsize=12.5, pad=14)
ax.tick_params(colors="#8b8a9a")
for spine in ax.spines.values():
    spine.set_color("#3b3a4a")
ax.legend(loc="lower right", facecolor="#15141f", edgecolor="#3b3a4a", labelcolor="#d6d5e0", fontsize=9)
ax.grid(True, color="#1b1a26", linewidth=0.6)

out = os.path.join(HERE, "twotier.png")
fig.tight_layout()
fig.savefig(out, dpi=140, facecolor=fig.get_facecolor())
print("Wrote " + out)
