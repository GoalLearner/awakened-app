-- W1040 SECURITY (2026-10-11 review, M1) — the 90-day prune of funnel_events filters on
-- created_at alone, and the table's two indexes both lead with another column
-- ((event, created_at) and (user_id, created_at)), so the prune was a FULL TABLE SCAN,
-- run inline on app-open pings. D1 bills rows scanned and runs one query at a time: the
-- cost and the stall both grow with the table. client_errors got this index in 0041;
-- funnel_events never did.
--
-- Additive and idempotent. No data is changed.
CREATE INDEX IF NOT EXISTS idx_funnel_events_created ON funnel_events (created_at);
