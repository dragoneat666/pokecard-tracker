-- Migration for v0.7.8: make current_prices fast.
-- The old DISTINCT ON view scanned every row of prices (millions, because we
-- keep history) to find the newest price per card, even when a page only
-- needs a few hundred cards. This version does one index lookup per card.
-- Same columns and types, so dependent views (set_summary) are untouched.

CREATE OR REPLACE VIEW current_prices AS
SELECT
  c.id AS card_id,
  p.market_price,
  p.low_price,
  p.mid_price,
  p.holofoil_price,
  p.reverse_holo_price,
  p.fetched_at
FROM cards c
JOIN LATERAL (
  SELECT market_price, low_price, mid_price, holofoil_price, reverse_holo_price, fetched_at
  FROM prices
  WHERE card_id = c.id
  ORDER BY fetched_at DESC
  LIMIT 1
) p ON true;
