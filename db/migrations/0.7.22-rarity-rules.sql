-- Migration for v0.7.22: choose whether a rarity counts as Regular or Full Art
-- for the Missing Regular / Missing Full Art filters (set page and image
-- export). Only rarities changed on the Admin page get a row; the card sync
-- never touches this table, so a choice stays until it's changed back.

BEGIN;

CREATE TABLE IF NOT EXISTS rarity_rules (
  rarity     TEXT PRIMARY KEY,
  counts_as  TEXT NOT NULL CHECK (counts_as IN ('regular', 'full_art'))
);

COMMIT;
