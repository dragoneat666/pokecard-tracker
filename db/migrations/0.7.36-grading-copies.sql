-- Migration for v0.7.36: saved copies of cards from the Grading tab.
--
-- When you own two copies of a card, each one can be checked on the Grading
-- tab (centering, whitening, surface) and saved here, so the two can be
-- compared and you pick which to keep. Every saved copy is one row:
--
--   slot     'regular', or 'reverse' for the Reverse Holo / 1st Edition slot
--   status   'checked' saved, no decision yet
--            'keep'    the copy you chose to keep
--            'sell'    the other copy: the set page shows "1 to sell" while
--                      you still have 2 copies ticked. Nothing here ever
--                      unticks a box; you do that yourself once it's gone.
--   label    your own note to tell copies apart ("binder", "top loader")
--   estimate the estimated grade (low..high when it's a close call)
--   result   everything measured, for showing and comparing later: each
--            side's centering and whitening, the surface checklist, which
--            version of each check made it, and the settings used
--   images   file names of the straightened front/back pictures and their
--            thumbnails. The files themselves live in the grading volume
--            (/app/grading), NOT in the database, so the nightly database
--            backup stays small; they are backed up separately.
--
-- A copy is deleted with its card (ON DELETE CASCADE); its picture files are
-- then left behind in the volume (harmless).
--
-- Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS grading_copies (
  id             SERIAL PRIMARY KEY,
  card_id        INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  slot           TEXT NOT NULL DEFAULT 'regular' CHECK (slot IN ('regular', 'reverse')),
  status         TEXT NOT NULL DEFAULT 'checked' CHECK (status IN ('checked', 'keep', 'sell')),
  label          TEXT,
  estimate       SMALLINT,
  estimate_low   SMALLINT,
  estimate_high  SMALLINT,
  result         JSONB NOT NULL DEFAULT '{}',
  images         JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grading_copies_card ON grading_copies(card_id, slot);

COMMIT;
