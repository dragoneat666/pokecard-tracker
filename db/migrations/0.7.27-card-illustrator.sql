-- Migration for v0.7.27: cards get an illustrator, for the Card Browser's
-- Illustrator filter.
--
-- The columns start empty. TCGdex is the main source for illustrators
-- (TCGplayer's artist names have typos, and Destined Rivals is off by one
-- card), and TCGTracking's "Artist" fills in cards TCGdex has nothing for.
-- illustrator_source says which one a card's name came from ('tcgdex' or
-- 'tcgtracking'), so a reimport from TCGTracking never overwrites a TCGdex
-- name. Filled on every set import / reimport, and once for the sets you
-- already have through Admin -> "Fill in illustrators".
--
-- Safe to run twice.

BEGIN;

ALTER TABLE cards ADD COLUMN IF NOT EXISTS illustrator TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS illustrator_source TEXT;

CREATE INDEX IF NOT EXISTS idx_cards_illustrator ON cards(illustrator);

COMMIT;
