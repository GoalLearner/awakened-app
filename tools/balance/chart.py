#!/usr/bin/env python3
"""Power-vs-rank scatter for Awakened — before/after the item-power tune.
Reads tools/balance/items_before.json + items.json and writes curve.png.
  pip install matplotlib ; python tools/balance/chart.py
Combat power = STR+VIT+INT+FOCUS+WILL (WLT excluded — economy-only). circle=solo
drop, square=co-op, triangle=shop-buyable; colour=rarity; lines=solo-only avg."""
import json, os, statistics as st
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

HERE = os.path.dirname(os.path.abspath(__file__))
RANK = ["E","D","C","B","A","S"]
ORD = {r:i for i,r in enumerate(RANK)}
COL = {"rare":"#3b82f6","ultra_rare":"#f5b842","mythic":"#e0457b"}

def load(name):
    items = json.load(open(os.path.join(HERE,name),encoding="utf-8"))["items"]
    return [i for i in items if i["rarity"] in COL and i["boss_rank"] in ORD]

def jit(rank_i, key):  # deterministic horizontal spread for same-rank points
    return rank_i + ((hash(key)%9)-4)*0.045

def panel(ax, items, title):
    for i in items:
        x = jit(ORD[i["boss_rank"]], i["id"])
        m = "s" if i.get("coopOnly") else ("^" if i.get("acquisition")=="shop" else "o")
        ax.scatter(x, i["combat_power"], c=COL[i["rarity"]], marker=m, s=64,
                   edgecolors="#1b1b2b", linewidths=0.5, alpha=0.92, zorder=3)
    for rar,col in (("rare","#3b82f6"),("ultra_rare","#f5b842")):
        pts=[]
        for r in RANK:
            v=[i["combat_power"] for i in items if i["boss_rank"]==r and i["rarity"]==rar and not i.get("coopOnly")]
            if v: pts.append((ORD[r], st.mean(v)))
        if len(pts)>1:
            ax.plot([p[0] for p in pts],[p[1] for p in pts],color=col,lw=2.4,alpha=0.55,zorder=2)
    ax.set_xticks(range(len(RANK))); ax.set_xticklabels(RANK)
    ax.set_xlabel("Dungeon rank"); ax.set_title(title, fontsize=12, fontweight="bold")
    ax.set_ylim(0, 46); ax.grid(True, axis="y", alpha=0.22)

fig, (a1,a2) = plt.subplots(1,2, figsize=(15,7), sharey=True)
panel(a1, load("items_before.json"), "BEFORE")
panel(a2, load("items.json"),        "AFTER (tuned)")
a1.set_ylabel("Combat power (STR+VIT+INT+FOCUS+WILL)")
legend = [Line2D([0],[0],marker="o",color="w",markerfacecolor=COL["rare"],markersize=10,label="rare"),
          Line2D([0],[0],marker="o",color="w",markerfacecolor=COL["ultra_rare"],markersize=10,label="ultra-rare"),
          Line2D([0],[0],marker="o",color="w",markerfacecolor=COL["mythic"],markersize=10,label="mythic"),
          Line2D([0],[0],marker="o",color="w",markerfacecolor="#888",markersize=10,label="solo drop (o)"),
          Line2D([0],[0],marker="s",color="w",markerfacecolor="#888",markersize=10,label="co-op (square)"),
          Line2D([0],[0],marker="^",color="w",markerfacecolor="#888",markersize=10,label="shop (triangle)")]
a2.legend(handles=legend, loc="upper left", fontsize=9, framealpha=0.9)
fig.suptitle("Awakened — item combat power vs rank (rare+ / WLT excluded)", fontsize=14, fontweight="bold")
fig.tight_layout(rect=[0,0,1,0.96])
out = os.path.join(HERE,"curve.png"); fig.savefig(out, dpi=130)
print("wrote", out)
