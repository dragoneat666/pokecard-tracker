-- Migration for v0.7.11: Bulk Tracker tables (TCGPlayer pricing export history).
-- Adds three new tables only; nothing existing is changed.

BEGIN;

CREATE TABLE bulk_snapshots (
  id              SERIAL PRIMARY KEY,
  snapshot_at     TIMESTAMP NOT NULL UNIQUE,
  source_filename TEXT NOT NULL,
  row_count       INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bulk_products (
  tcgplayer_id  INTEGER PRIMARY KEY,
  set_name      TEXT,
  product_name  TEXT NOT NULL,
  number        TEXT,
  rarity        TEXT,
  condition     TEXT
);

CREATE TABLE bulk_listing_rows (
  snapshot_id   INT NOT NULL REFERENCES bulk_snapshots(id) ON DELETE CASCADE,
  tcgplayer_id  INTEGER NOT NULL REFERENCES bulk_products(tcgplayer_id),
  quantity      INT NOT NULL DEFAULT 0,
  listed_price  NUMERIC(10, 2),
  market_price  NUMERIC(10, 2),
  low_price     NUMERIC(10, 2),
  PRIMARY KEY (snapshot_id, tcgplayer_id)
);

CREATE INDEX idx_bulk_rows_product ON bulk_listing_rows(tcgplayer_id);

COMMIT;
