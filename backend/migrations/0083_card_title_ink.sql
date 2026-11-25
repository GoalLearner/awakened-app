-- 0083 — W1315: the colour a hunter's Ascent title is written in on their profile card (owner 2026-11-25: "allow
-- users to select a color for their ascent title"). One of the name's inks (CARD_INK_IDS, allow-listed at write
-- time); NULL = the title's own tier colour. Read cross-user on the public profile card.
ALTER TABLE public_profile_summary ADD COLUMN card_title_ink TEXT;
