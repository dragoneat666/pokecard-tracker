-- Migration for v0.7.20: Coins, grouped by generation. Adds new tables only;
-- nothing existing is changed.
--
-- Every coin has at least one variety (a have/need box). Most have one; coins
-- that came in several versions (holo types, copyright lines) get one each.

BEGIN;

CREATE TABLE IF NOT EXISTS coin_generations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coins (
  id             SERIAL PRIMARY KEY,
  generation_id  INT NOT NULL REFERENCES coin_generations(id) ON DELETE CASCADE,
  region         TEXT NOT NULL,
  number         INT NOT NULL,
  name           TEXT NOT NULL,
  released_in    TEXT NOT NULL DEFAULT '',
  release_date   TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  image_url      TEXT,
  back_image_url TEXT,
  source_key     TEXT,
  UNIQUE (generation_id, region, number),
  UNIQUE (generation_id, source_key)
);

CREATE TABLE IF NOT EXISTS coin_varieties (
  id          SERIAL PRIMARY KEY,
  coin_id     INT NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  owned       BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE (coin_id, name)
);

COMMIT;
