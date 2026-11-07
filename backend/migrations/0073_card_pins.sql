-- 0073 — W1155: the card's PINS. Up to two badges the hunter chose to show under
-- the title (Million Steps, Shadow Army, Summit, Boss Slayer, Best Day), stored as a
-- JSON array of {id, v} where v is the number the badge shows (shadows raised, bosses
-- slain, best day's steps). Phone-claimed like the card look (W1146): the server
-- allow-lists the ids, clamps v and caps the array at two. NULL = no pins.
ALTER TABLE public_profile_summary ADD COLUMN card_pins TEXT;
