-- =============================================================================
-- init.sql — runs ONCE when the PostgreSQL container first boots
-- After that, changes here do nothing (the volume already exists)
-- To re-run: docker compose down -v && docker compose up  (DELETES ALL DATA)
-- =============================================================================


-- ─── SETS ────────────────────────────────────────────────────────────────────
-- One row per Pokemon TCG set (e.g. "Prismatic Evolutions", "Base Set")
CREATE TABLE sets (
  id            SERIAL PRIMARY KEY,       -- Auto-incrementing integer ID
  tcg_id        TEXT UNIQUE,              -- pokemontcg.io set ID e.g. "sv8pt5"
  name          TEXT NOT NULL,
  series        TEXT,                     -- "Scarlet & Violet", "XY", etc.
  total_cards   INT,                      -- Official printed total from the API
  release_date  DATE,
  logo_url      TEXT,                     -- URL to set logo image
  set_code      TEXT,
  symbol_url    TEXT,
  language      TEXT,
  set_type      TEXT NOT NULL DEFAULT 'Main',
  created_at    TIMESTAMPTZ DEFAULT NOW() -- Timestamp with timezone
);


-- ─── CARDS ───────────────────────────────────────────────────────────────────
-- One row per card per set. Most data comes from pokemontcg.io on import.
CREATE TABLE cards (
  id            SERIAL PRIMARY KEY,
  set_id        INT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE: if you delete a set, all its cards are deleted too

  tcg_card_id   TEXT UNIQUE,             -- pokemontcg.io card ID e.g. "sv8pt5-45"
  card_number   TEXT NOT NULL,           -- "045" or "045/131" — display only
  name          TEXT NOT NULL,
  pokemon_type  TEXT,                    -- "Fire", "Water", "Colorless", etc.
  rarity        TEXT,                    -- "Common", "Rare Holo", "Special Illustration Rare"

  -- Storage location — where this card physically lives
  storage       TEXT DEFAULT 'binder'
                CHECK (storage IN ('binder', 'sleeve', 'toploader', 'safe')),

  -- Ownership: 0 = don't have it, 1 = have one, 2 = have two (rares only)
  -- SMALLINT = tiny integer (0-32767), CHECK enforces only 0/1/2 are valid
  owned         SMALLINT NOT NULL DEFAULT 0 CHECK (owned IN (0, 1, 2)),

  -- For the "set completion" stat: did you intentionally acquire a 2nd copy?
  -- This is separate from owned so we don't mess up owned=1 meaning "complete"
  has_extra     BOOLEAN NOT NULL DEFAULT FALSE,

  condition     TEXT NOT NULL DEFAULT 'Near Mint'
                CHECK (condition IN ('Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged')),

  stage         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index speeds up "give me all cards for set X" queries
CREATE INDEX idx_cards_set_id ON cards(set_id);


-- ─── REVERSE HOLOS ───────────────────────────────────────────────────────────
-- Reverse holo is a parallel version of most cards in a set.
-- Stored separately because it has its own owned count and price.
-- UNIQUE on card_id means each card can only have one reverse holo row.
CREATE TABLE reverse_holos (
  id       SERIAL PRIMARY KEY,
  card_id  INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE UNIQUE,
  owned    SMALLINT NOT NULL DEFAULT 0 CHECK (owned IN (0, 1, 2))
);


-- ─── PRICES ──────────────────────────────────────────────────────────────────
-- We INSERT a new row every refresh instead of updating.
-- This gives us free price history — we can see what a card was worth over time.
-- To get "current price", we just query the most recent row for each card.
CREATE TABLE prices (
  id                  SERIAL PRIMARY KEY,
  card_id             INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  fetched_at          TIMESTAMPTZ DEFAULT NOW(),
  market_price        NUMERIC(10, 2),  -- TCGPlayer market price
  low_price           NUMERIC(10, 2),  -- TCGPlayer low
  mid_price           NUMERIC(10, 2),  -- TCGPlayer mid
  holofoil_price      NUMERIC(10, 2),  -- For cards with a holo variant price
  reverse_holo_price  NUMERIC(10, 2)   -- Reverse holo market price
);

-- Index speeds up "latest price for card X" queries significantly
CREATE INDEX idx_prices_card_fetched ON prices(card_id, fetched_at DESC);


-- ─── HELPFUL VIEW ────────────────────────────────────────────────────────────
-- A VIEW is a saved query you can SELECT from like a table.
-- This gives us "current price per card" without repeating the logic everywhere.
-- It uses a "window function": for each card_id, number rows by fetched_at DESC,
-- then keep only row_number = 1 (the most recent).
CREATE VIEW current_prices AS
SELECT DISTINCT ON (card_id)
  card_id,
  market_price,
  low_price,
  mid_price,
  holofoil_price,
  reverse_holo_price,
  fetched_at
FROM prices
ORDER BY card_id, fetched_at DESC;


-- ─── DASHBOARD VIEW ──────────────────────────────────────────────────────────
-- This replaces your Table of Contents sheet.
-- Aggregates per-set stats in one query — no formula linking required.
CREATE VIEW set_summary AS
SELECT
  s.id,
  s.name,
  s.series,
  s.total_cards,
  s.release_date,
  s.logo_url,
  s.set_code,
  s.symbol_url,
  s.language,
  s.set_type,

  COUNT(c.id) FILTER (WHERE c.owned >= 1) AS cards_owned,
  COUNT(c.id) AS cards_in_db,

  -- Regular cards: numbered within the set total
  COUNT(c.id) FILTER (
    WHERE (REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'))::INTEGER
          <= COALESCE(s.total_cards, 9999)
  ) AS regular_cards,

  -- Secret cards: numbered above the set total
  COUNT(c.id) FILTER (
    WHERE (REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'))::INTEGER
          > COALESCE(s.total_cards, 9999)
  ) AS secret_cards,

  -- Reverse holo eligible: cards that have a reverse holo price
  COUNT(c.id) FILTER (
    WHERE cp.reverse_holo_price IS NOT NULL
  ) AS reverse_holo_count,

  -- Master set total: all cards + reverse holo eligible cards
  COUNT(c.id) + COUNT(c.id) FILTER (
    WHERE cp.reverse_holo_price IS NOT NULL
  ) AS master_total,

  -- Master set owned: regular owned + reverse holos owned
  COUNT(c.id) FILTER (WHERE c.owned >= 1) +
  COUNT(rh.id) FILTER (WHERE rh.owned >= 1) AS master_owned,

  ROUND(
    COUNT(c.id) FILTER (WHERE c.owned >= 1)::NUMERIC
    / NULLIF(s.total_cards, 0) * 100
  , 1) AS completion_pct,

  COALESCE(SUM(cp.market_price) FILTER (WHERE c.owned >= 1), 0) AS total_value,
  COALESCE(SUM(cp.reverse_holo_price) FILTER (WHERE rh.owned >= 1), 0) AS reverse_holo_value

FROM sets s
LEFT JOIN cards c ON c.set_id = s.id
LEFT JOIN current_prices cp ON cp.card_id = c.id
LEFT JOIN reverse_holos rh ON rh.card_id = c.id
GROUP BY s.id, s.name, s.series, s.total_cards, s.release_date, s.logo_url, s.set_code, s.symbol_url, s.language, s.set_type
ORDER BY s.release_date DESC NULLS LAST;
