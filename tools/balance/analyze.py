#!/usr/bin/env python3
"""Drop-table balance audit for Awakened.
Reads tools/balance/items.json (produced by extract.js) and reports the rare +
ultra-rare (+ mythic) catalog by boss/rank, plus gaps, power outliers, and
drop-rate balance. Combat power = sum of str/vit/int/focus/will (WLT excluded —
it is economy-only with no combat role, per W470). Stdlib only."""
import json, os, sys, statistics as st
from collections import defaultdict
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, "items.json"), encoding="utf-8"))
items = data["items"]

RANK_ORD = {"E":0,"D":1,"C":2,"B":3,"A":4,"S":5,"S+":6}
RARITY_ORD = {"common":0,"rare":1,"ultra_rare":2,"mythic":3}
RARE_PLUS = ("rare","ultra_rare","mythic")
ALL_SLOTS = ["helm","cape","amulet","weapon","body","legs","gloves","boots","ring"]
def rk(it): return RANK_ORD.get(it["boss_rank"], 9)
def pct(x): return "-" if x is None else f"{x*100:.0f}%"

rares = [i for i in items if i["rarity"] in RARE_PLUS]

# ---- bosses, in rank order ----
bosses = {}
for i in items:
    bosses.setdefault(i["source_boss"], i)
boss_order = sorted({i["source_boss"] for i in items},
                    key=lambda b: (rk(bosses[b]), bosses[b]["coopOnly"], bosses[b]["boss_name"] or "", str(b)))

real_boss_ids = {b["id"] for b in data["bosses"]}
shop = [i for i in items if i.get("acquisition") == "shop"]            # W306 — buyable, not dropped
orphans = [i for i in items if i["source_boss"] not in real_boss_ids and i.get("acquisition") != "shop"]
mismatch = [i for i in items if i.get("acquisition") == "drop" and i["tier"] != i["boss_rank"]]

print("="*78)
print("AWAKENED — DROP-TABLE BALANCE AUDIT")
print("="*78)
nrare = sum(1 for i in items if i["rarity"]=="rare")
nultra = sum(1 for i in items if i["rarity"]=="ultra_rare")
nmyth = sum(1 for i in items if i["rarity"]=="mythic")
print(f"{len(items)} items | {nrare} rare, {nultra} ultra-rare, {nmyth} mythic, "
      f"{sum(1 for i in items if i['rarity']=='common')} common")
if shop:
    print(f"\n  i {len(shop)} shop-buyable (non-drop) items — W306, obtainable in the Marketplace (source_boss:null by design):")
    for i in shop:
        print(f"      {i['rarity']:10} {i['name'][:32]:32} cp={i['combat_power']:>2} tier={i['tier']}")
if orphans:
    print(f"\n  ! {len(orphans)} TRUE ORPHANS — source_boss set but not a real boss (broken / unobtainable):")
    for i in orphans:
        print(f"      {i['rarity']:10} {i['name'][:30]:30} -> source_boss='{i['source_boss']}'")
if mismatch:
    print(f"\n  ! {len(mismatch)} TIER / BOSS-RANK MISMATCH (item.tier disagrees with its boss's rank):")
    for i in mismatch:
        print(f"      {i['name'][:30]:30} tier={i['tier']} but {i['boss_name']} is {i['boss_rank']}-rank")

# ============ 1. BREAKDOWN BY BOSS / RANK ============
print("\n" + "="*78)
print("1. BREAKDOWN BY BOSS (rank order) — rare + ultra-rare + mythic")
print("="*78)
for b in boss_order:
    bi = bosses[b]
    pool = [i for i in rares if i["source_boss"]==b]
    if not pool: continue
    pool.sort(key=lambda i:(RARITY_ORD[i["rarity"]], i["slot"]))
    tag = " [CO-OP]" if bi["coopOnly"] else ""
    dt = bi.get("drop_rate")
    print(f"\n■ {bi['boss_name']}  ({bi['boss_rank']}-rank, {bi.get('statDomain') or '—'}, {bi.get('cadence') or '—'}){tag}")
    for i in pool:
        bn = i["bonuses"]
        nz = " ".join(f"{k.upper()}+{bn[k]}" for k in ("str","vit","int","focus","will","wlt") if bn[k])
        rr = {"rare":"R ","ultra_rare":"UR","mythic":"MY"}[i["rarity"]]
        print(f"   {rr} {i['name'][:30]:30} {i['slot']:7} cp={i['combat_power']:>2} "
              f"(wlt+{bn['wlt']}) drop={pct(i['drop_rate']):>4}  [{nz}]")

# ============ 2. POWER BY RANK x RARITY ============
print("\n" + "="*78)
print("2. COMBAT POWER by RANK x RARITY  (cp = str+vit+int+focus+will)")
print("="*78)
print(f"{'rank':5} {'rarity':11} {'n':>2} {'min':>4} {'avg':>5} {'max':>4}")
cohort = defaultdict(list)
for i in rares:
    cohort[(i["boss_rank"], i["rarity"])].append(i["combat_power"])
rows = []
for (rank, rar), vals in sorted(cohort.items(), key=lambda kv:(RANK_ORD.get(kv[0][0],9), RARITY_ORD[kv[0][1]])):
    rows.append((rank, rar, len(vals), min(vals), st.mean(vals), max(vals)))
    print(f"{rank:5} {rar:11} {len(vals):>2} {min(vals):>4} {st.mean(vals):>5.1f} {max(vals):>4}")

# monotonicity: avg cp should rise with rank within a rarity
print("\n  -- progression check (avg cp should not DROP as rank rises) --")
for rar in ("rare","ultra_rare"):
    seq = [(rank, st.mean(v)) for (rank, r), v in cohort.items() if r==rar]
    seq.sort(key=lambda x: RANK_ORD.get(x[0],9))
    flagged = False
    for (r1,a1),(r2,a2) in zip(seq, seq[1:]):
        if a2 < a1:
            print(f"  ! {rar}: {r1}(avg {a1:.1f}) -> {r2}(avg {a2:.1f})  REGRESSION (higher rank is weaker)")
            flagged = True
    if not flagged: print(f"  ok {rar}: avg cp non-decreasing across ranks")

# ============ 3. GAPS ============
print("\n" + "="*78)
print("3. GAPS")
print("="*78)
print("\n  -- bosses missing a rarity tier (solo dungeon bosses only) --")
for b in boss_order:
    bi = bosses[b]
    if bi["coopOnly"]: continue
    pool = [i for i in items if i["source_boss"]==b]
    if not pool: continue
    have = {i["rarity"] for i in pool}
    miss = [r for r in ("rare","ultra_rare") if r not in have]
    if miss:
        print(f"  ! {bi['boss_name']} ({bi['boss_rank']}): no {', '.join(miss)}  (has: {', '.join(sorted(have, key=lambda x:RARITY_ORD[x]))})")

print("\n  -- slot coverage of rare+ per rank (which of 9 slots have a rare/UR) --")
for rank in sorted({i["boss_rank"] for i in rares}, key=lambda r:RANK_ORD.get(r,9)):
    slots = {i["slot"] for i in rares if i["boss_rank"]==rank}
    miss = [s for s in ALL_SLOTS if s not in slots]
    print(f"  {rank:3}: {len(slots)}/9 slots  missing: {', '.join(miss) if miss else 'none'}")

print("\n  -- items per rank (rare+UR+mythic) --")
cnt = defaultdict(lambda:[0,0,0])
for i in rares:
    idx = {"rare":0,"ultra_rare":1,"mythic":2}[i["rarity"]]
    cnt[i["boss_rank"]][idx]+=1
for rank in sorted(cnt, key=lambda r:RANK_ORD.get(r,9)):
    r,u,m = cnt[rank]
    print(f"  {rank:3}: {r} rare, {u} ultra, {m} mythic  (total {r+u+m})")

# ============ 4. OUTLIERS (OP / underpowered for rank) ============
print("\n" + "="*78)
print("4. POWER OUTLIERS — OP / underpowered for rank")
print("="*78)
print("\n  -- per (rank,rarity) cohort: items >=1.5sd AND >=15% from cohort mean --")
print("     (both gates so a rank's DESIGNED best item isn't false-flagged as OP)")
any_out = False
for (rank, rar), vals in cohort.items():
    if len(vals) < 3: continue
    m, sd = st.mean(vals), (st.pstdev(vals) or 0)
    if sd == 0 or m == 0: continue
    for i in [x for x in rares if x["boss_rank"]==rank and x["rarity"]==rar]:
        z = (i["combat_power"]-m)/sd
        margin = abs(i["combat_power"]-m)/m
        if abs(z) >= 1.5 and margin >= 0.15:
            tag = "OP" if z>0 else "WEAK"
            coop = " [CO-OP]" if i.get("coopOnly") else ""
            print(f"  ! [{tag}] {i['name'][:30]:30} {rank}/{rar} cp={i['combat_power']} "
                  f"(cohort avg {m:.1f}, z={z:+.1f}, {margin*100:+.0f}%){coop}")
            any_out = True
if not any_out: print("  (none — every item within 15% of its rank/rarity cohort mean)")

print("\n  -- rarity inversions: a RARE >= an ULTRA at the SAME boss --")
inv = False
for b in boss_order:
    rs = [i for i in items if i["source_boss"]==b and i["rarity"]=="rare"]
    us = [i for i in items if i["source_boss"]==b and i["rarity"]=="ultra_rare"]
    if not rs or not us: continue
    maxr, minu = max(i["combat_power"] for i in rs), min(i["combat_power"] for i in us)
    if maxr >= minu:
        print(f"  ! {bosses[b]['boss_name']} ({bosses[b]['boss_rank']}): best rare cp={maxr} >= weakest ultra cp={minu}")
        inv = True
if not inv: print("  (none — ultras always beat rares at their boss)")

print("\n  -- cross-rank inversions: a LOWER-rank item out-powers a HIGHER-rank item of SAME rarity --")
for rar in ("rare","ultra_rare"):
    pool = [i for i in rares if i["rarity"]==rar]
    mx_by_rank = {}
    mn_by_rank = {}
    for rank in sorted({i["boss_rank"] for i in pool}, key=lambda r:RANK_ORD.get(r,9)):
        v=[i["combat_power"] for i in pool if i["boss_rank"]==rank]
        mx_by_rank[rank]=max(v); mn_by_rank[rank]=min(v)
    ranks = sorted(mx_by_rank, key=lambda r:RANK_ORD.get(r,9))
    for lo in ranks:
        for hi in ranks:
            if RANK_ORD[hi] > RANK_ORD[lo] and mn_by_rank[hi] < mx_by_rank[lo]:
                # only report the most extreme: a higher rank whose WEAKEST is below a lower rank's STRONGEST
                worst = [i for i in pool if i["boss_rank"]==hi and i["combat_power"]==mn_by_rank[hi]][0]
                print(f"  ~ {rar}: {hi} has '{worst['name'][:26]}' cp={mn_by_rank[hi]} < best {lo} cp={mx_by_rank[lo]}")
                break

# ============ 5. DROP-RATE BALANCE ============
print("\n" + "="*78)
print("5. DROP-RATE BALANCE  (per boss; EV = expected drops/kill)")
print("="*78)
print(f"{'rank':5} {'boss':26} {'ultra':>6} {'rare':>6} {'EV(any)':>8}")
for b in boss_order:
    bi = bosses[b]
    ur = next((i["drop_rate"] for i in items if i["source_boss"]==b and i["rarity"]=="ultra_rare"), None)
    rr = next((i["drop_rate"] for i in items if i["source_boss"]==b and i["rarity"]=="rare"), None)
    cr = next((i["drop_rate"] for i in items if i["source_boss"]==b and i["rarity"]=="common"), None)
    ev = sum(x for x in (ur,rr,cr) if x)  # rough upper bound (independent rolls, pre-pity)
    tag = " [CO-OP]" if bi["coopOnly"] else ""
    print(f"{bi['boss_rank']:5} {(bi['boss_name'] or '(orphan/no boss)')[:26]:26} {pct(ur):>6} {pct(rr):>6} {ev*100:>7.0f}%{tag}")
print("\n(EV is a pre-pity upper bound from independent rolls; the real engine rolls "
      "ultra->rare->common first-hit-wins + pity floors, so realized EV is lower.)")
print("\nDone.")
