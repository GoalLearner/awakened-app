-- W871 (Wave 2 Train B) — THE WORLDGATE: one server, one monster.
-- The week IS the raid: the gate's HP is set lazily on the week's first
-- read (scaled to 14d actives, minus last week's carry-over damage), and
-- the DAMAGE is simply the live SUM of every hunter's weekly verified
-- step_total from leaderboard_snapshots — zero new submission plumbing,
-- and the zero-kill 66% are included the moment their steps sync.
-- Pool >= HP before Sunday's reset = SLAIN; a survived gate keeps 5% of
-- the damage as permanent carry into the next week's HP, so a small
-- server always eventually wins.
CREATE TABLE world_gates (
  week_start TEXT    PRIMARY KEY,     -- PT-Sunday 'YYYY-MM-DD'
  hp         INTEGER NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'open',   -- open | slain | survived
  slain_at   INTEGER,
  slain_by   TEXT,                    -- the hunter whose sync landed the last blow
  created_at INTEGER NOT NULL
);
CREATE TABLE world_gate_claims (
  week_start TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (week_start, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
