# ClaudeDesign brief — The Wardrobe, rebuilt for earned looks

## What you're designing

**The Wardrobe** in **Awakened**: the sheet that opens when a hunter taps their own avatar. It is where
they choose the look they wear and the background behind their card on every leaderboard. Redesign
it as **two tabs**:

1. **LOOKS** — the avatar a hunter wears.
2. **BACKGROUNDS** — the painted scene behind their leaderboard row and profile card.

Three screenshots of today's Wardrobe are attached (`current-1-looks`, `current-2-backgrounds`,
`current-3-shop`). Today it is one long scroll: the equipped portrait, a grid of free looks, the
background grid, then a SHOP of seven paid skins at the very bottom.

## Why it's changing

- **The seven top-tier skins are no longer sold.** Each one is now earned by a real milestone. They
  are the best art in the app and today they sit at the bottom behind a price tag. The owner wants
  them **up front**, where a hunter sees what there is to earn.
- **Backgrounds are no longer a member perk.** Every hunter can wear any background they have earned.
- One scroll is too long. Two tabs keep each screen simple.

## The app in one breath

Dark-fantasy "level up your real life" habit RPG with Solo-Leveling energy, driven by Apple Health.
Deep near-black navy, **Cinzel** serif for heroic headings, **JetBrains Mono** for labels and numbers,
**gold (#f5b842 / #fbbf24)** for the biggest achievements, violet (#a78bfa / #8b5cf6) for the rare
tier. Hex, sigil and rune motifs, premium glow. **Earned and powerful, never cute.** The current
screenshots show the existing language (the gold medallion with four gems, the tile grid, the mono
labels); keep that family, improve it.

## LOOKS tab

**The equipped look**, large at the top: the gold medallion portrait with the look's name.

**The top-tier skins (7)**, first, above everything else. Round portrait, ring colour = rarity:

| Skin | Rarity | Ring | Earned by | Progress a hunter sees |
|---|---|---|---|---|
| Emberforged | Legendary | violet | Keep a pact flame with one friend for 30 days | best flame, e.g. 12 / 30 days |
| The Void-Touched | Legendary | violet | Raise 10 shadows | 6 / 10 shadows |
| The Verdant Oracle | Legendary | violet | Open the app 30 days in a row | 18 / 30 days |
| Null Protocol | Mythic | gold | Clear Floor 90 of the Ascent | 73 / 90 |
| Null Protocol II | Mythic | gold | Slay 200 bosses | 87 / 200 |
| Dawnbringer | Mythic | gold | Reach S rank | rank B |
| Stardust Sovereign | Mythic | gold | Walk 1,000,000 steps | 747,366 / 1,000,000 |

Each skin has three states, all visible at a glance:
- **Locked**: the art is still visible but clearly not yet theirs. Tapping it opens the skin's detail
  (below).
- **Earned**: tap to wear it.
- **Worn**: marked as the equipped look.

**The free looks (12)**, after the top-tier skins: Your Class (the hunter's class default, tagged
CLASS), Warrior, Ranger, Mage, Assassin, Paladin, Merchant, Sage, Wanderer, Bloodmoon, Tempest,
Frostweaver. All always available; tap to wear.

**A locked skin's detail** (opened by tapping a locked skin): the art large, its name, its rarity, one
short line of flavour that already exists for each skin (e.g. "The first light, given a body."), and
the milestone with the hunter's progress toward it. This is the one place the condition is spelled
out, so it has to read instantly.

## BACKGROUNDS tab

A grid of wide banner tiles (about 3:1), each showing the real art, its name and either EARNED or the
requirement. **Basic** (the plain card, the default) first, then:

The Hundred-K City (100K step club) · The Summit (clear Floor 100) · Stormbreaker (reach S rank) ·
Beyond the Peak (S+ prestige) · The Boneyard (500 boss kills) · Champion's Ring (Arena tier) ·
The Vault (own a mega-rare) · The Eternal Flame (365-day streak) · The Grinning Dark (defeat The
Grinning God) · The E-Gate through The S-Gate (clear every boss of that rank, six tiles) · The Full
Vault (own all 3 mega-rares) · The Complete Log (complete the Collection Log) · Thirty Days Sworn
(30-day walk or sleep streak) · Founder's Dawn (founders only, 20 exist).

States: worn, earned (tap to wear), locked (requirement shown; tapping explains it the same way a
locked skin does, in the background's wide format). Show how a chosen background looks behind the
hunter's card, at the top of this tab, the way LOOKS shows the equipped portrait.

## Rules the owner has set (keep all of them)

- **Minimal words.** No explanations of what is self-evident, no instructions, no "tap to…" hints.
  If a line can go, it goes.
- No exclamation marks, no emoji, never the words "fell" or "felled".
- Hunter names are lowercase and never set in Cinzel.
- Nothing is for sale on these two tabs.

## Screens (iPhone, 390 × 844, a bottom sheet over the app)

1. LOOKS, a newer hunter: most top-tier skins locked, wearing their class look.
2. LOOKS, a veteran: four top-tier skins earned, one worn.
3. A locked skin's detail, legendary and mythic.
4. BACKGROUNDS: a mix of earned and locked, one worn, the preview at the top.
5. A locked background's detail.
6. The tab switch itself.

## How it connects

A separate brief covers the celebration when a skin or background is earned. Its EQUIP button lands
the hunter here with the new look worn. The two should feel like one system.

## Attached

Today's three Wardrobe screenshots, every portrait (the 7 top-tier skins and the 12 free looks, as
round busts) and every background banner.

## What to hand back

An HTML prototype with both tabs, every tile state, the two detail views, and the tab switch.
