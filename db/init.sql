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
  variant_type  TEXT NOT NULL DEFAULT 'reverse_holo',
  is_parent     BOOLEAN NOT NULL DEFAULT false,
  parent_set_id INT REFERENCES sets(id),
  date_manual BOOLEAN NOT NULL DEFAULT false,
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
  has_reverse_holo BOOLEAN,
  has_first_edition BOOLEAN,
  image_url     TEXT,
  tcgtracking_id INTEGER,
  stage            TEXT,

  condition     TEXT NOT NULL DEFAULT 'Near Mint'
                CHECK (condition IN ('Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged')),

  -- True for cards that don't belong in the official checklist — MCAP
  -- alternate art imports, manually moved misprints, etc. Displayed in a
  -- separate "Alternates" section below the main card table and any subsets.
  is_alternate  BOOLEAN NOT NULL DEFAULT false,

  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index speeds up "give me all cards for set X" queries
CREATE INDEX idx_cards_set_id ON cards(set_id);

-- Index speeds up card number numeric sort in set view query
CREATE INDEX idx_cards_number_numeric ON cards (
  (NULLIF(REGEXP_REPLACE(card_number, '[^0-9]', '', 'g'), ''))
);

CREATE UNIQUE INDEX idx_cards_tcgtracking_id ON cards(tcgtracking_id) WHERE tcgtracking_id IS NOT NULL;

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
WITH set_denominators AS (
  SELECT
    set_id,
    MAX(NULLIF(REGEXP_REPLACE(SPLIT_PART(card_number, '/', 2), '[^0-9]', '', 'g'), '')::INTEGER) as printed_total
  FROM cards
  WHERE card_number LIKE '%/%'
    AND REGEXP_REPLACE(SPLIT_PART(card_number, '/', 2), '[^0-9]', '', 'g') != ''
    AND REGEXP_REPLACE(SPLIT_PART(card_number, '/', 2), '[A-Za-z]', '', 'g') = SPLIT_PART(card_number, '/', 2)
  GROUP BY set_id
),
set_family AS (
  SELECT id AS parent_id, id AS member_id FROM sets WHERE parent_set_id IS NULL
  UNION ALL
  SELECT parent_set_id AS parent_id, id AS member_id FROM sets WHERE parent_set_id IS NOT NULL
)
SELECT
  s.id, s.name, s.series, s.total_cards, s.release_date, s.logo_url,
  s.set_code, s.symbol_url, s.language, s.set_type, s.variant_type,
  s.is_parent, s.parent_set_id,
  COUNT(c.id) FILTER (WHERE c.owned >= 1) AS cards_owned,
  COUNT(c.id) AS cards_in_db,
  COUNT(c.id) FILTER (
    WHERE REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g') != ''
      AND REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[A-Za-z]', '', 'g') = SPLIT_PART(c.card_number, '/', 1)
      AND NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER
          <= COALESCE(sd.printed_total, s.total_cards, 9999)
  ) AS regular_cards,
  COUNT(c.id) FILTER (
    WHERE REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[A-Za-z]', '', 'g') != SPLIT_PART(c.card_number, '/', 1)
      OR (
        REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g') != ''
        AND NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER
            > COALESCE(sd.printed_total, s.total_cards, 9999)
      )
  ) AS secret_cards,
  COUNT(c.id) FILTER (
    WHERE c.has_reverse_holo = true OR c.has_first_edition = true
  ) AS reverse_holo_count,
  COUNT(c.id) + COUNT(c.id) FILTER (
    WHERE c.has_reverse_holo = true OR c.has_first_edition = true
  ) AS master_total,
  COUNT(c.id) FILTER (WHERE c.owned >= 1) +
  COUNT(rh.id) FILTER (WHERE rh.owned >= 1) AS master_owned,
  ROUND(
    COUNT(c.id) FILTER (WHERE c.owned >= 1)::NUMERIC
    / NULLIF(s.total_cards, 0) * 100
  , 1) AS completion_pct,
  COALESCE(SUM(cp.market_price * c.owned) FILTER (WHERE c.owned >= 1), 0) AS total_value,
  COALESCE(SUM(cp.reverse_holo_price * rh.owned) FILTER (WHERE rh.owned >= 1), 0) AS reverse_holo_value
FROM sets s
LEFT JOIN set_denominators sd ON sd.set_id = s.id
LEFT JOIN set_family sf ON sf.parent_id = s.id
LEFT JOIN cards c ON c.set_id = sf.member_id
LEFT JOIN current_prices cp ON cp.card_id = c.id
LEFT JOIN reverse_holos rh ON rh.card_id = c.id
WHERE s.parent_set_id IS NULL
GROUP BY s.id, s.name, s.series, s.total_cards, s.release_date, s.logo_url,
         s.set_code, s.symbol_url, s.language, s.set_type, s.variant_type,
         s.is_parent, s.parent_set_id, sd.printed_total
ORDER BY s.release_date DESC NULLS LAST;

-- ─── MATERIALIZED VIEW CACHE ──────────────────────────────────────────────────
-- Caches set_summary results for fast dashboard loads.
-- Refreshed automatically after imports, price updates, and card ownership changes.
CREATE MATERIALIZED VIEW set_summary_cache AS
SELECT * FROM set_summary;

CREATE UNIQUE INDEX idx_set_summary_cache_id ON set_summary_cache(id);

-- ─── SERIES MAP ───────────────────────────────────────────────────────────────
-- Maps set codes to series names. is_manual = true means a user set this
-- through the UI and it will never be overwritten by auto-detection on reimport.
CREATE TABLE IF NOT EXISTS series_map (
  set_code  TEXT PRIMARY KEY,
  series    TEXT NOT NULL,
  is_manual BOOLEAN NOT NULL DEFAULT false
);

-- Pre-populated known set codes. All is_manual = false so auto-detect can
-- still update them, but in practice these won't change.
INSERT INTO series_map (set_code, series) VALUES
  -- Original Series
  ('BS',    'Original Series'),
  ('BSS',   'Original Series'),
  ('BS2',   'Original Series'),
  ('JU',    'Original Series'),
  ('FO',    'Original Series'),
  ('TR',    'Original Series'),
  ('G1',    'Original Series'),
  ('G2',    'Original Series'),
  -- Neo Series
  ('N1',    'Neo Series'),
  ('N2',    'Neo Series'),
  ('N3',    'Neo Series'),
  ('N4',    'Neo Series'),
  -- Legendary Collection
  ('LC',    'Legendary Collection'),
  -- e-Card Series
  ('EX',    'e-Card Series'),
  ('AQ',    'e-Card Series'),
  ('SK',    'e-Card Series'),
  -- EX Series
  ('RS',    'EX Series'),
  ('SS',    'EX Series'),
  ('DR',    'EX Series'),
  ('MA',    'EX Series'),
  ('HL',    'EX Series'),
  ('RG',    'EX Series'),
  ('TRR',   'EX Series'),
  ('DX',    'EX Series'),
  ('EM',    'EX Series'),
  ('UF',    'EX Series'),
  ('DS',    'EX Series'),
  ('LM',    'EX Series'),
  ('HP',    'EX Series'),
  ('CG',    'EX Series'),
  ('DF',    'EX Series'),
  ('PK',    'EX Series'),
  -- Diamond & Pearl
  ('DP',    'Diamond & Pearl'),
  ('MT',    'Diamond & Pearl'),
  ('SW',    'Diamond & Pearl'),
  ('GE',    'Diamond & Pearl'),
  ('MD',    'Diamond & Pearl'),
  ('LA',    'Diamond & Pearl'),
  ('SF',    'Diamond & Pearl'),
  -- Platinum
  ('PL',    'Platinum'),
  ('RR',    'Platinum'),
  ('SV',    'Platinum'),
  ('AR',    'Platinum'),
  -- HeartGold & SoulSilver
  ('HS',    'HeartGold & SoulSilver'),
  ('UL',    'HeartGold & SoulSilver'),
  ('UD',    'HeartGold & SoulSilver'),
  ('TM',    'HeartGold & SoulSilver'),
  ('CL',    'HeartGold & SoulSilver'),
  -- Black & White
  ('BLW',   'Black & White'),
  ('EPO',   'Black & White'),
  ('NVI',   'Black & White'),
  ('NXD',   'Black & White'),
  ('DEX',   'Black & White'),
  ('DRX',   'Black & White'),
  ('DRV',   'Black & White'),
  ('BCR',   'Black & White'),
  ('PLS',   'Black & White'),
  ('PLF',   'Black & White'),
  ('PLB',   'Black & White'),
  ('LTR',   'Black & White'),
  -- XY
  ('KSS',   'XY'),
  ('XY',    'XY'),
  ('FLF',   'XY'),
  ('FFI',   'XY'),
  ('PHF',   'XY'),
  ('PRC',   'XY'),
  ('DCR',   'XY'),
  ('ROS',   'XY'),
  ('AOR',   'XY'),
  ('BKT',   'XY'),
  ('BKP',   'XY'),
  ('GEN',   'XY'),
  ('FCO',   'XY'),
  ('STS',   'XY'),
  ('EVO',   'XY'),
  -- Sun & Moon
  ('SUM',   'Sun & Moon'),
  ('GRI',   'Sun & Moon'),
  ('BUS',   'Sun & Moon'),
  ('SLG',   'Sun & Moon'),
  ('CIN',   'Sun & Moon'),
  ('UPR',   'Sun & Moon'),
  ('FLI',   'Sun & Moon'),
  ('CES',   'Sun & Moon'),
  ('DRM',   'Sun & Moon'),
  ('LOT',   'Sun & Moon'),
  ('TEU',   'Sun & Moon'),
  ('DET',   'Sun & Moon'),
  ('UNB',   'Sun & Moon'),
  ('UNM',   'Sun & Moon'),
  ('HIF',   'Sun & Moon'),
  ('CEC',   'Sun & Moon'),
  -- Sun & Moon Base Set (TCGTracking uses SM01 not SUM)
  ('SM01',  'Sun & Moon'),
  -- Sword & Shield
  ('SSH',   'Sword & Shield'),
  ('RCL',   'Sword & Shield'),
  ('DAA',   'Sword & Shield'),
  ('CPA',   'Sword & Shield'),
  ('VIV',   'Sword & Shield'),
  ('SHF',   'Sword & Shield'),
  ('BST',   'Sword & Shield'),
  ('CRE',   'Sword & Shield'),
  ('EVS',   'Sword & Shield'),
  ('CEL',   'Sword & Shield'),
  ('FST',   'Sword & Shield'),
  ('BRS',   'Sword & Shield'),
  ('ASR',   'Sword & Shield'),
  ('PGO',   'Sword & Shield'),
  ('LOR',   'Sword & Shield'),
  ('SIT',   'Sword & Shield'),
  ('CRZ',   'Sword & Shield'),
  -- Scarlet & Violet
  ('SVI',   'Scarlet & Violet'),
  ('PAL',   'Scarlet & Violet'),
  ('OBF',   'Scarlet & Violet'),
  ('MEW',   'Scarlet & Violet'),
  ('PAR',   'Scarlet & Violet'),
  ('PAF',   'Scarlet & Violet'),
  ('TEF',   'Scarlet & Violet'),
  ('TWM',   'Scarlet & Violet'),
  ('SFA',   'Scarlet & Violet'),
  ('SCR',   'Scarlet & Violet'),
  ('SSP',   'Scarlet & Violet'),
  ('PRE',   'Scarlet & Violet'),
  ('JTG',   'Scarlet & Violet'),
  ('DRI',   'Scarlet & Violet'),
  ('BLK',   'Scarlet & Violet'),
  ('WHT',   'Scarlet & Violet'),
  -- Mega Evolution
  ('MEG',   'Mega Evolution'),
  ('PFL',   'Mega Evolution'),
  ('ASC',   'Mega Evolution'),
  ('POR',   'Mega Evolution'),
  ('CRI',   'Mega Evolution'),
  ('PBL',   'Mega Evolution'),
  ('30C',   'Mega Evolution'),
  -- Promos
  ('WP',    'Promo'),
  ('NP',    'Promo'),
  ('DPP',   'Promo'),
  ('HSP',   'Promo'),
  ('BWP',   'Promo'),
  ('XYP',   'Promo'),
  ('SMP',   'Promo'),
  ('SWSH',  'Promo'),
  ('SVP',   'Promo'),
  ('MEP',   'Promo'),
  -- McDonald's
  ('M11',   'McDonald''s'),
  ('M12',   'McDonald''s'),
  ('M13',   'McDonald''s'),
  ('M14',   'McDonald''s'),
  ('M15',   'McDonald''s'),
  ('M16',   'McDonald''s'),
  ('M17',   'McDonald''s'),
  ('M18',   'McDonald''s'),
  ('M19',   'McDonald''s'),
  ('M21',   'McDonald''s'),
  ('M22',   'McDonald''s'),
  ('M23',   'McDonald''s'),
  ('M24',   'McDonald''s'),
  -- POP / Play! Prize Packs
  ('POP1',  'POP Series'),
  ('POP2',  'POP Series'),
  ('POP3',  'POP Series'),
  ('POP4',  'POP Series'),
  ('POP5',  'POP Series'),
  ('POP6',  'POP Series'),
  ('POP7',  'POP Series'),
  ('POP8',  'POP Series'),
  ('POP9',  'POP Series'),
  ('PPS1',  'Play! Prize Pack'),
  ('PPS2',  'Play! Prize Pack'),
  ('PPS3',  'Play! Prize Pack'),
  ('PPS4',  'Play! Prize Pack'),
  ('PPS5',  'Play! Prize Pack'),
  ('PPS6',  'Play! Prize Pack'),
  ('PPS7',  'Play! Prize Pack'),
  ('PPS8',  'Play! Prize Pack'),
  -- Miscellaneous
  ('SI',    'Miscellaneous'),
  ('RM',    'Miscellaneous'),
  ('FUT20', 'Miscellaneous'),
  ('CL',    'Miscellaneous')
ON CONFLICT (set_code) DO NOTHING;
