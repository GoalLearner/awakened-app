-- W834 (Train 3, G2) — build + funnel reporting via the app-open body.
--
-- The app-open ping previously ignored its request body entirely. Two gaps
-- that closes:
--   1. The backend has NO idea what build any user runs — so the Monday
--      update push (lib/update-push.ts) broadcasts to everyone, including
--      users already current (the #1 push-opt-out risk, R1b's dependency).
--   2. Zero funnel instrumentation — paywall impressions, purchases,
--      onboarding completion etc. are invisible (G4 events land here).
--
-- app_opens.build: the APP_BUILD_TAG the user's LATEST open that UTC day ran
-- (e.g. '2.5.1-w840'). Latest-build-per-user = the row with MAX(date_utc).
ALTER TABLE app_opens ADD COLUMN build TEXT;

-- funnel_events: append-only, client-batched via the app-open body, capped
-- per call and length-clamped server-side. 90-day inline self-prune (same
-- posture as client_errors' 30-day one — crons can stall, inserts can't).
CREATE TABLE funnel_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,             -- verified session sub; never client-specified
  created_at INTEGER NOT NULL,             -- unix ms, server clock
  event      TEXT    NOT NULL,             -- snake_case name, e.g. 'paywall_impression'
  detail     TEXT,                         -- optional context, clamped 200
  build      TEXT                          -- APP_BUILD_TAG at send time
);
CREATE INDEX idx_funnel_events_event_time ON funnel_events (event, created_at);
CREATE INDEX idx_funnel_events_user_time  ON funnel_events (user_id, created_at);
