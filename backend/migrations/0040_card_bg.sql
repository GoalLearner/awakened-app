-- 0040 — W706: member-exclusive player-card background.
-- card_bg = the background id a MEMBER equipped (NULL = basic card). Written via
-- the public-profile-summary PUT (server validates membership at write time;
-- achievement eligibility rides the client-reported trust model like rank).
-- Published cross-user on every board/profile read, same pattern as founder_seq
-- and avatar_id. TEXT id (e.g. 'bg-founder'), validated against the catalog at
-- write time so an unknown/retired id can never propagate.
ALTER TABLE public_profile_summary ADD COLUMN card_bg TEXT;
