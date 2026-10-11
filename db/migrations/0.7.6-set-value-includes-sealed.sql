-- Migration for v0.7.6: set value now includes sealed product and uses graded
-- prices. Rebuilds set_summary / set_summary_cache with a new sealed_value
-- column. Card/collection data is not touched; the views are just aggregates.
-- Run inside one transaction so a failure leaves the old views in place.

BEGIN;

DROP MATERIALIZED VIEW set_summary_cache;
DROP VIEW set_summary;

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
),
sealed_values AS (
  SELECT sf.parent_id, SUM(sp.market_price * sp.owned) AS sealed_value
  FROM set_family sf
  JOIN sealed_products sp ON sp.set_id = sf.member_id
  GROUP BY sf.parent_id
)
SELECT
  s.id, s.name, s.series, s.total_cards, s.release_date, s.logo_url,
  s.set_code, s.symbol_url, s.language, s.set_type, s.variant_type,
  s.is_parent, s.parent_set_id, s.pinned_at,
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
  COALESCE(SUM(CASE WHEN c.is_graded THEN c.graded_price ELSE cp.market_price END * c.owned) FILTER (WHERE c.owned >= 1), 0) AS total_value,
  COALESCE(SUM(CASE WHEN rh.is_graded THEN rh.graded_price ELSE cp.reverse_holo_price END * rh.owned) FILTER (WHERE rh.owned >= 1), 0) AS reverse_holo_value,
  COALESCE(sv.sealed_value, 0) AS sealed_value
FROM sets s
LEFT JOIN set_denominators sd ON sd.set_id = s.id
LEFT JOIN sealed_values sv ON sv.parent_id = s.id
LEFT JOIN set_family sf ON sf.parent_id = s.id
LEFT JOIN cards c ON c.set_id = sf.member_id
LEFT JOIN current_prices cp ON cp.card_id = c.id
LEFT JOIN reverse_holos rh ON rh.card_id = c.id
WHERE s.parent_set_id IS NULL
GROUP BY s.id, s.name, s.series, s.total_cards, s.release_date, s.logo_url,
         s.set_code, s.symbol_url, s.language, s.set_type, s.variant_type,
         s.is_parent, s.parent_set_id, s.pinned_at, sd.printed_total, sv.sealed_value
ORDER BY s.release_date DESC NULLS LAST;

CREATE MATERIALIZED VIEW set_summary_cache AS SELECT * FROM set_summary;
CREATE UNIQUE INDEX idx_set_summary_cache_id ON set_summary_cache(id);

COMMIT;
