-- Migration for v0.7.23: coins get a size ("Regular", "Large", "Jumbo",
-- "Metal"). Coins already imported get it from their description, the same way
-- the importer does it (backend/src/utils/bulbapediaCoins.js coinSize):
--   "Large-sized, ..."  -> Large   (any "<word>-sized" / "<word> sized")
--   "Metal Coin ..."    -> Metal
--   anything else       -> Regular
-- Only coins whose size was never set (NULL) are filled, so running this again
-- doesn't undo a size changed or cleared by hand. Coins with no description
-- (added by hand) stay empty.

BEGIN;

ALTER TABLE coins ADD COLUMN IF NOT EXISTS size TEXT;

UPDATE coins SET size = CASE
    WHEN description ~* '\m[a-z]+[- ]sized\M'
      THEN initcap(substring(description from '(?i)\m([a-z]+)[- ]sized\M'))
    WHEN description ~* '\mmetal coin\M' THEN 'Metal'
    ELSE 'Regular'
  END
WHERE size IS NULL AND description <> '';

COMMIT;
