-- Migration for v0.7.14: Topps checklist tables. Adds new tables only; nothing
-- existing is changed.

BEGIN;

CREATE TABLE topps_sets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE topps_variants (
  id          SERIAL PRIMARY KEY,
  set_id      INT NOT NULL REFERENCES topps_sets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE (set_id, name)
);

CREATE TABLE topps_cards (
  id          SERIAL PRIMARY KEY,
  set_id      INT NOT NULL REFERENCES topps_sets(id) ON DELETE CASCADE,
  number      TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE (set_id, number)
);

CREATE TABLE topps_cells (
  card_id     INT NOT NULL REFERENCES topps_cards(id) ON DELETE CASCADE,
  variant_id  INT NOT NULL REFERENCES topps_variants(id) ON DELETE CASCADE,
  owned       BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (card_id, variant_id)
);

CREATE INDEX idx_topps_cards_set ON topps_cards(set_id);
CREATE INDEX idx_topps_cells_variant ON topps_cells(variant_id);

COMMIT;
