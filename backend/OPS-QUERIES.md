# OPS-QUERIES — the live-ops SQL pack (W841 · Train 3, G3 + C3b)

Copy-paste `wrangler d1` commands for reading the app's vital signs. Zero
deploys — run from `backend/`. Every command is read-only.

```
npx wrangler d1 execute awakened-db --remote --command "<SQL>"
```

**Cadence (C3b):** run §1 at least weekly and at the start of any live-ops
session. New `client_errors` rows = investigate BEFORE shipping anything new.
(`[w833-backfill]` messages are diagnostics, not errors — they record what the
step backfill saw; remove that telemetry once the fleet looks clean.)

---

## 1 · Weekly sweep — errors + silent breakage

Client errors, last 7 days, grouped (who / what build / how often):

```sql
SELECT u.alias, ce.build, substr(ce.message,1,90) AS msg, COUNT(*) AS n,
       MAX(datetime(ce.created_at/1000,'unixepoch')) AS last
  FROM client_errors ce JOIN users u ON u.id = ce.user_id
 WHERE ce.created_at > (strftime('%s','now') - 7*86400) * 1000
 GROUP BY u.alias, ce.build, msg ORDER BY last DESC;
```

Wave-2 write health (W884): are the fire-and-forget server writes actually
landing? `[w2-write]` breadcrumbs are throttled to once per tag per device per
day, and guest/signed-out sessions never report — so ANY row here is a real
failure, and the tag names which write broke.

```sql
SELECT substr(ce.message, 1, 60) AS write_failure,
       COUNT(*) AS n, COUNT(DISTINCT ce.user_id) AS hunters,
       MAX(datetime(ce.created_at/1000,'unixepoch')) AS last
  FROM client_errors ce
 WHERE ce.message LIKE '[w2-write]%'
   AND ce.created_at > (strftime('%s','now') - 14*86400) * 1000
 GROUP BY write_failure ORDER BY n DESC;
```

The positive half — reading these two together is the whole diagnostic. For
the tower: `w2_write_ok` rows but an empty `tower_events` means the SERVER is
dropping them; no rows of either kind means nobody advanced a floor (the
feature is starved, not broken); `[w2-write] tower_clear` failures mean the
wiring itself is broken.

```sql
SELECT detail AS write_tag, COUNT(*) AS days, COUNT(DISTINCT user_id) AS hunters
  FROM funnel_events WHERE event = 'w2_write_ok'
 GROUP BY detail ORDER BY hunters DESC;
```

Health-blackout detector (the W830 incident, institutionalized): anyone
OPENING the app days after their last step submit is reading 0 from Health.

```sql
SELECT u.alias, ls.current_value AS steps, ls.week_start,
       date(ls.updated_at/1000,'unixepoch') AS last_submit,
       (SELECT MAX(date_utc) FROM app_opens ao WHERE ao.user_id = u.id) AS last_open
  FROM leaderboard_snapshots ls JOIN users u ON u.id = ls.user_id
 WHERE ls.metric = 'step_total'
   AND (SELECT MAX(date_utc) FROM app_opens ao WHERE ao.user_id = u.id)
       > date(ls.updated_at/1000,'unixepoch','+2 days');
```

Ascent wipe check (current lags server best → W819 heal pending):

```sql
SELECT u.alias, ls.current_value, ls.best_value
  FROM leaderboard_snapshots ls JOIN users u ON u.id = ls.user_id
 WHERE ls.metric = 'floor_best' AND ls.current_value < ls.best_value;
```

## 2 · Retention & actives

7-day actives by OPENS (⚠ the canonical active metric is SYNC recency — §5):

```sql
SELECT COUNT(DISTINCT user_id) AS active_7d FROM app_opens
 WHERE date_utc >= date('now','-7 days');
```

Opens per day, last 14:

```sql
SELECT date_utc, COUNT(*) AS opens FROM app_opens
 WHERE date_utc >= date('now','-14 days') GROUP BY date_utc ORDER BY date_utc DESC;
```

Per-user lifecycle (first/last open, days active):

```sql
SELECT u.alias, MIN(ao.date_utc) AS first_open, MAX(ao.date_utc) AS last_open,
       COUNT(*) AS days_active
  FROM app_opens ao JOIN users u ON u.id = ao.user_id
 GROUP BY u.alias ORDER BY last_open DESC;
```

(The D1/D7/D30 rollup lives at `GET /v1/admin/retention` — needs
`ADMIN_METRICS_SECRET`, an owner loose end.)

## 3 · Build distribution (W834+)

Who runs what — also the W835 Monday-push gate's source of truth. NULL build
= pre-2.5.1 client (they get the update nudge; that's correct):

```sql
SELECT b.build, COUNT(*) AS users FROM (
  SELECT a1.user_id,
         (SELECT a2.build FROM app_opens a2
           WHERE a2.user_id = a1.user_id AND a2.build IS NOT NULL
           ORDER BY a2.date_utc DESC LIMIT 1) AS build
    FROM app_opens a1 GROUP BY a1.user_id) b
 GROUP BY b.build ORDER BY users DESC;
```

## 4 · Funnel (W834/W839, 90-day retention)

Event totals, last 30 days (paywall_impression → purchase_attempt →
purchase_completed is the money funnel; onboarding_complete is activation):

```sql
SELECT event, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users
  FROM funnel_events
 WHERE created_at > (strftime('%s','now') - 30*86400) * 1000
 GROUP BY event ORDER BY n DESC;
```

Onboarding path split:

```sql
SELECT detail AS path, COUNT(*) AS n FROM funnel_events
 WHERE event = 'onboarding_complete' GROUP BY detail ORDER BY n DESC;
```

### The activation funnel (W883 — 3.0.1 Tranche A2)

THE question this answers: of the hunters who reach the Double Dungeon, where
do they fall out? Before W883 the funnel jumped straight from
`onboarding_complete` to `first_boss_kill` with nothing in between, so
"rookies never see the DD" and "they all stall on CLIMB" were
indistinguishable. Read this ladder top to bottom — each rung should be a
modest step down from the one above; a cliff names the problem.

```sql
SELECT event, COUNT(DISTINCT user_id) AS hunters, COUNT(*) AS n
  FROM funnel_events
 WHERE event IN ('onboarding_complete','dd_started','dd_sealed','dd_altar',
                 'fg_guide_shown','first_hunt_engaged','first_boss_kill')
   AND created_at > (strftime('%s','now') - 30*86400) * 1000
 GROUP BY event
 ORDER BY CASE event WHEN 'onboarding_complete' THEN 1 WHEN 'dd_started' THEN 2
                     WHEN 'dd_sealed' THEN 3 WHEN 'dd_altar' THEN 4
                     WHEN 'fg_guide_shown' THEN 5 WHEN 'first_hunt_engaged' THEN 6
                     ELSE 7 END;
```

Which commandment loses them — `detail` is the day (1 WALK / 2 CLIMB /
3 ENDURE). Compare seals against repeats at the same day: CLIMB (2) is the
one with no alternate path, so a repeat spike there is the expected stall.

```sql
SELECT event, detail AS commandment,
       COUNT(DISTINCT user_id) AS hunters, COUNT(*) AS n
  FROM funnel_events
 WHERE event IN ('dd_sealed','dd_repeat')
 GROUP BY event, detail ORDER BY commandment, event;
```

## 5 · Snapshot mining (G3 — user_state_snapshots)

Actives by SYNC recency — the canonical metric (memory: never count actives
by app_opens alone):

```sql
SELECT COUNT(*) AS synced_7d FROM user_state_snapshots
 WHERE server_updated_at > (strftime('%s','now') - 7*86400) * 1000;
```

XP / shields / habit-count roster (envelope: `$.keys.hb_*` hold STRINGIFIED
localStorage values, hence the json() re-parse for nested blobs):

```sql
SELECT u.alias,
       CAST(json_extract(s.state_json,'$.keys.hb_points') AS INTEGER)  AS xp,
       json_extract(s.state_json,'$.keys.hb_shields')                  AS shields,
       json_array_length(json(json_extract(s.state_json,'$.keys.hb_habits'))) AS habits,
       s.app_version, date(s.server_updated_at/1000,'unixepoch')       AS synced
  FROM user_state_snapshots s JOIN users u ON u.id = s.user_id
 ORDER BY xp DESC;
```

## 6 · Push ledgers (Train 3 audit trail)

```sql
SELECT * FROM push_broadcast_log ORDER BY day_key DESC LIMIT 5;          -- Monday broadcast pages
```

```sql
SELECT u.alias, wb.lapse_open_date, datetime(wb.sent_at/1000,'unixepoch') AS sent
  FROM win_back_pushes wb JOIN users u ON u.id = wb.user_id
 ORDER BY wb.sent_at DESC LIMIT 20;                                      -- win-backs (W836)
```

```sql
SELECT ua.alias AS a, ub.alias AS b, pf.day_key
  FROM pact_flame_pushes pf
  JOIN users ua ON ua.id = pf.user_a JOIN users ub ON ub.id = pf.user_b
 ORDER BY pf.day_key DESC LIMIT 20;                                      -- flame warnings (W837)
```

## 7 · Weekly Hunger override (W845)

The rotation is deterministic client-side; set a row here ONLY to hand-pick
a week (clients adopt it at boot). `week_start` = the PT-Sunday key, same as
the boards. Delete the row to restore the deterministic pick.

```sql
INSERT OR REPLACE INTO weekly_hunger_overrides (week_start, boss_id, created_at)
VALUES ('2026-08-23', 'the_twin_maw', strftime('%s','now')*1000);
```

```sql
SELECT * FROM weekly_hunger_overrides ORDER BY week_start DESC LIMIT 5;
```

## Notes

- Sim users: exclude with `u.apple_sub NOT LIKE 'sim_test_%'` where it matters.
- All `date_utc` / `date('now')` values are UTC day keys; board weeks are
  PT-Sunday-anchored (`week_start`).
- `wrangler d1 execute` occasionally throws a transient Cloudflare API error —
  retry once before believing it.

## 8. Community board (W907)

Newest topics with author + state:

    npx wrangler d1 execute awakened-db --remote --command "SELECT t.id, t.tag, substr(t.title,1,60) AS title, u.alias, t.reply_count, t.hidden_at IS NOT NULL AS hidden, t.deleted_at IS NOT NULL AS deleted, datetime(t.last_activity_at/1000,'unixepoch') AS last FROM board_topics t JOIN users u ON u.id=t.author_id ORDER BY t.last_activity_at DESC LIMIT 30;"

Open reports (what the moderators' push pointed at):

    npx wrangler d1 execute awakened-db --remote --command "SELECT r.id, r.target_kind, r.target_id, r.reason, u.alias AS reporter, datetime(r.created_at/1000,'unixepoch') AS at FROM board_reports r JOIN users u ON u.id=r.reporter_id WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC;"

Mutes and moderators:

    npx wrangler d1 execute awakened-db --remote --command "SELECT u.alias, m.until, datetime(m.until/1000,'unixepoch') AS until_at, m.reason FROM board_mutes m JOIN users u ON u.id=m.user_id;"
    npx wrangler d1 execute awakened-db --remote --command "SELECT u.alias, bm.role, datetime(bm.granted_at/1000,'unixepoch') AS since FROM board_moderators bm JOIN users u ON u.id=bm.user_id;"

Emergency moderator delete from the CLI (the app has the same action):

    npx wrangler d1 execute awakened-db --remote --command "UPDATE board_topics SET deleted_at=strftime('%s','now')*1000, deleted_by='ops', body='' WHERE id='<topic id>';"
