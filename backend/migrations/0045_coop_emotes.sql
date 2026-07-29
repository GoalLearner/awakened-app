-- W801 — battle emotes were fire-and-forget (APNs push only), so a partner's
-- Rally never appeared in anyone's battle log. Persist them per instance;
-- GET /v1/coop-boss/:id serves the recent tail for the log.
CREATE TABLE coop_emotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emote TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_coop_emotes_instance ON coop_emotes(instance_id, id);
