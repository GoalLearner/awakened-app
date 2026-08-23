-- W867 (Wave 2 Train B) — THE OATHBOUND: C+ veterans swear a 14-day oath
-- over a zero-kill rookie's first boss kill. Fulfillment is detected
-- server-side when the rookie's public_profile_summary bosses_slain_total
-- first moves above zero (the client owns kills; the summary is the
-- queryable mirror). Rewards are CLAIMED client-side (the co-op award
-- model): each side flips its claimed flag exactly once and grants souls
-- locally. Expiry is lazy (reads mark past-window pending rows expired) —
-- idle oaths cost nobody anything.
CREATE TABLE oaths (
  id              TEXT    PRIMARY KEY,
  mentor_user_id  TEXT    NOT NULL,
  rookie_user_id  TEXT    NOT NULL,
  sworn_at        INTEGER NOT NULL,             -- unix ms
  expires_at      INTEGER NOT NULL,             -- unix ms (sworn_at + 14d)
  status          TEXT    NOT NULL DEFAULT 'pending',  -- pending | fulfilled | expired
  fulfilled_at    INTEGER,
  mentor_claimed  INTEGER NOT NULL DEFAULT 0,
  rookie_claimed  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (mentor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (rookie_user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- One live oath per rookie; a mentor's two-oath cap is enforced in the handler.
CREATE UNIQUE INDEX idx_oaths_rookie_pending ON oaths(rookie_user_id) WHERE status = 'pending';
CREATE INDEX idx_oaths_mentor ON oaths(mentor_user_id, status);
