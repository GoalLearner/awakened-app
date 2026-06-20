-- 0023_pvp_friend_echo.sql — "Duel a Friend's Echo".
-- Publish each player's COMBATANT snapshot (6 stats + weapon + avatar + name) on the public
-- profile summary, so a friend can summon an AI mirror of their real loadout and spar it
-- (always UNRANKED — you pick the opponent, so it never moves ranked ELO; same anti-farm rule
-- as invite-by-code duels). The snapshot is server-validated to the sanitizeCombatant shape on
-- write (6 stats clamped, weaponId allowlisted, name/avatar bounded) — it carries NO progression,
-- currency, or rank, so it cannot grant power. One opaque additive column, same discipline as
-- 0016's avatar_id.
--
-- Apply (NOT via `migrations apply`) with:
--   wrangler d1 execute awakened-db --remote --file=migrations/0023_pvp_friend_echo.sql

ALTER TABLE public_profile_summary ADD COLUMN combatant_json TEXT;
