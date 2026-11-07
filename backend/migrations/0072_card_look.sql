-- 0072 — W1146: the hunter's card look, published for every hunter to see.
-- The Wardrobe's three cosmetic slots (W1143): card_frame = the medallion frame
-- (gilded default), card_ink = the colour the name is written in (ivory default),
-- card_aura = the particles around the medallion (none default). Phone-claimed,
-- same trust model as the earned looks the phone claims; the server allow-lists
-- the ids at write time so an unknown id never propagates. NULL = the default.
-- Read cross-user: card_ink on every board row (the name's colour on the high
-- scores), all three on the public profile card.
ALTER TABLE public_profile_summary ADD COLUMN card_frame TEXT;
ALTER TABLE public_profile_summary ADD COLUMN card_ink TEXT;
ALTER TABLE public_profile_summary ADD COLUMN card_aura TEXT;
