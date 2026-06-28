# Guest "try-it-first" path — device build + on-device test plan

The guest path (W329 mount+play → W330 claim → W331 join-prompts) is fully
built and web-verified, but two pieces can ONLY be validated on a real iOS
build: the **boot gate** (W329) and the **live Apple sign-in claim** (W330,
`signInWithApple` is native-only). This is the checklist to confirm both.

Current target build: **`2.2.7-w348`**.

---

## 1. Cut the build (MacBook lite flow)

```bash
cd /Volumes/AwakenedDev/repos/awakened-app
git fetch origin && git pull origin main
git log --oneline -3
```
Top line should be `919a6e5 W331 ...`.

```bash
bash scripts/prep-local-build.sh
```

**Gate — run after prep, before you archive:**
```bash
grep -q "2.2.7-w348" ios/App/App/public/app.js && echo "PASS: iOS bundle = W331 - safe to archive" || echo "FAIL: stale bundle - re-run prep"
```
Must print `PASS`.

Then in Xcode: **Any iOS Device (arm64)** → keep Marketing Version `2.2.6`,
bump **Build** to latest TestFlight + 1 → **Clean Build Folder** → **Archive**
→ **Distribute App → App Store Connect → Upload**. Install via TestFlight.

---

## 2. On-device test checklist

### A. No-regression FIRST (the part that must never break)
The boot gate runs before the whole app is defined, so confirm the existing
signed-in path is intact BEFORE testing guest mode.

- [ ] **Already-signed-in launch:** open the app on your normal (signed-in)
      account. It goes straight to the app — **no sign-in gate, no guest, no
      cinematic.** (If you see the gate here, STOP — the gate regressed.)
- [ ] **Settings → version line, 5-tap → Copy Debug Info** shows
      `"build": "2.2.7-w348"`.
- [ ] Cold-launch again (force-quit, reopen from the home icon) → still
      straight into the app.

### B. Reach the gate as a fresh user
You must be *unauthenticated* to see the gate. Two ways:
- **Easiest:** Settings → ACCOUNT → **Sign out**, then force-quit + reopen, **or**
- **Cleanest:** delete the app and reinstall from TestFlight (fresh state).

- [ ] After sign-out/reinstall, launch → the **sign-in gate** appears with
      **"Sign in to begin"** AND a **"Try it first — no account needed"** link
      under the Apple button.

### C. Guest mount + play
- [ ] Tap **"Try it first — no account needed"** → the app mounts. A fresh
      install runs the **cinematic onboarding** ("A new hunter stirs in the
      dark…"); name yourself when prompted (it should NOT hit the network).
- [ ] **Play the loop, all offline / no account:**
  - [ ] Add a habit, complete it → earn XP, see the float/celebration.
  - [ ] Engage and fight a boss.
  - [ ] Open The Ascent → climb at least one floor.
  - [ ] Confirm no error toasts / no "sign in required" blocking the loop.
- [ ] (Bonus) Trigger a Health-verified completion (walk, then open the app) →
      the **W328 "THE SYSTEM RECOGNIZES YOU"** moment should fire once.

### D. The guest nudges (sign-in at the moment of intent)
- [ ] **Settings** shows a gold **"Sign in & save your progress / You're
      playing as a guest"** row at the top.
- [ ] **Leaderboard** (open the Steps board) shows **"Join the leaderboard —
      sign in to post your scores"** with a gold CTA — NOT an empty board.
- [ ] **Rankings hub** shows **"Join the rankings"** with the same CTA.

### E. The claim (the device-only critical path)
- [ ] From any nudge (Settings row OR the leaderboard prompt), tap **Sign in &
      save your progress** → the **"Save your progress"** modal opens, name
      pre-filled with your guest name.
- [ ] Tap **Sign in with Apple** → the native Apple sheet appears → authorize.
- [ ] On success the app reloads. **CRITICAL — verify progress survived:**
  - [ ] The habit you added as a guest is still there.
  - [ ] Your XP / level / boss kill / Ascent floor are unchanged.
  - [ ] You are now **signed in** (alias set; the leaderboard now shows the
        real board, not the join prompt; Settings shows your account, the
        guest row is gone).
- [ ] Force-quit + reopen → straight into the app as the signed-in account
      (no gate, not a guest).

### F. Edge cases
- [ ] **Name taken:** if your guest name is already on the server, the claim
      shows "That name is taken" + tappable suggestion chips → pick one →
      claim succeeds.
- [ ] **Cancel Apple sheet:** cancelling the Apple authorize returns you to the
      modal (not stuck, button re-enabled).
- [ ] **"Not now":** dismisses the claim modal and you remain a guest with
      your progress intact.

---

## What to report back
If anything in **A** (regression) or **E** (claim + progress survival) fails,
that's the highest-priority fix. A/E are the two things the web preview could
not prove; everything in B/C/D was already verified in preview.
