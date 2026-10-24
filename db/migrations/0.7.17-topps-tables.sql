-- Migration for v0.7.17: Topps checklists hold explicit, editable tables.
--
-- Before: a checklist's tables were worked out on the fly from which printings
-- each card had. Now each table is stored (title, columns, rows) so it can be
-- edited like a sheet. Existing checklists are converted with the same
-- grouping the old page used, and every check you've made is kept: the cell
-- count and owned count before and after must match (verified by the checks at
-- the end, which abort the whole migration if they don't).
--
-- Also adds topps_cards.image_url for card pictures later.

BEGIN;

-- Remember what we're starting with so we can prove nothing was lost.
CREATE TEMP TABLE topps_before ON COMMIT DROP AS
SELECT COUNT(*) AS cells, COUNT(*) FILTER (WHERE owned) AS owned FROM topps_cells;

-- 1. The new tables table. "shape" is scratch: the set of printings a group of
--    cards shares.
CREATE TABLE topps_tables (
  id          SERIAL PRIMARY KEY,
  set_id      INT NOT NULL REFERENCES topps_sets(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  sort_order  INT NOT NULL DEFAULT 0,
  shape       INT[]
);
CREATE INDEX idx_topps_tables_set ON topps_tables(set_id);

-- 2. One table per distinct group of printings in each checklist, ordered by
--    where its first card sits.
INSERT INTO topps_tables (set_id, title, sort_order, shape)
SELECT c.set_id, '', MIN(c.sort_order),
       COALESCE(x.vids, ARRAY[]::int[])
FROM topps_cards c
LEFT JOIN (
  SELECT card_id, array_agg(variant_id ORDER BY variant_id) AS vids
  FROM topps_cells GROUP BY card_id
) x ON x.card_id = c.id
GROUP BY c.set_id, COALESCE(x.vids, ARRAY[]::int[])
ORDER BY c.set_id, MIN(c.sort_order);

-- 3. Put every card into its table.
ALTER TABLE topps_cards ADD COLUMN table_id INT REFERENCES topps_tables(id) ON DELETE CASCADE;
ALTER TABLE topps_cards ADD COLUMN image_url TEXT;

UPDATE topps_cards c SET table_id = t.id
FROM topps_tables t
WHERE t.set_id = c.set_id
  AND t.shape = COALESCE(
        (SELECT array_agg(cl.variant_id ORDER BY cl.variant_id) FROM topps_cells cl WHERE cl.card_id = c.id),
        ARRAY[]::int[]);

-- 4. Table titles, like the old page: a single printing uses its own name
--    ("Tin Topper"); several sharing the part after the dash use that
--    ("Blue Logo - Diecut" + "Black Logo - Diecut" -> "Diecut"); otherwise
--    they're joined. The biggest table in each checklist is the main one and
--    gets no heading.
UPDATE topps_tables t SET title = d.title
FROM (
  SELECT t2.id,
         CASE
           WHEN array_length(t2.shape, 1) IS NULL THEN ''
           WHEN array_length(t2.shape, 1) = 1 THEN (SELECT v.name FROM topps_variants v WHERE v.id = t2.shape[1])
           ELSE (
             SELECT CASE WHEN COUNT(DISTINCT regexp_replace(v.name, '^.* - ', '')) = 1
                         THEN MIN(regexp_replace(v.name, '^.* - ', ''))
                         ELSE string_agg(v.name, ' / ' ORDER BY v.sort_order) END
             FROM topps_variants v WHERE v.id = ANY (t2.shape))
         END AS title
  FROM topps_tables t2
) d
WHERE t.id = d.id;

UPDATE topps_tables SET title = ''
WHERE id IN (
  SELECT DISTINCT ON (t.set_id) t.id
  FROM topps_tables t
  JOIN topps_cards c ON c.table_id = t.id
  GROUP BY t.id, t.set_id, t.sort_order
  ORDER BY t.set_id, COUNT(*) DESC, t.sort_order
);

-- 5. Columns now belong to a table. A printing shared by several tables gets
--    its own copy in each, and the cells are pointed at the right copy.
ALTER TABLE topps_variants DROP CONSTRAINT IF EXISTS topps_variants_set_id_name_key;
ALTER TABLE topps_variants ADD COLUMN table_id INT REFERENCES topps_tables(id) ON DELETE CASCADE;

CREATE TEMP TABLE variant_map ON COMMIT DROP AS
SELECT t.id AS table_id,
       v.id AS old_id,
       nextval(pg_get_serial_sequence('topps_variants', 'id'))::int AS new_id,
       v.set_id, v.name, v.sort_order
FROM topps_tables t
CROSS JOIN LATERAL unnest(t.shape) AS u(vid)
JOIN topps_variants v ON v.id = u.vid;

INSERT INTO topps_variants (id, set_id, name, sort_order, table_id)
SELECT new_id, set_id, name, sort_order, table_id FROM variant_map;

UPDATE topps_cells cl SET variant_id = m.new_id
FROM variant_map m
JOIN topps_cards c ON c.table_id = m.table_id
WHERE cl.card_id = c.id AND cl.variant_id = m.old_id;

DELETE FROM topps_variants WHERE table_id IS NULL;

-- A heading-bearing table with one printing doesn't need the printing name
-- repeated in its column, so that column just reads "Owned".
UPDATE topps_variants v SET name = 'Owned'
FROM topps_tables t
WHERE v.table_id = t.id AND t.title <> '' AND array_length(t.shape, 1) = 1;

-- 6. Tidy up: required columns, new uniqueness per table, drop the old links.
ALTER TABLE topps_variants ALTER COLUMN table_id SET NOT NULL;
ALTER TABLE topps_variants DROP COLUMN set_id;
ALTER TABLE topps_variants ADD CONSTRAINT topps_variants_table_id_name_key UNIQUE (table_id, name);

ALTER TABLE topps_cards ALTER COLUMN table_id SET NOT NULL;
ALTER TABLE topps_cards DROP COLUMN set_id;
ALTER TABLE topps_cards ADD CONSTRAINT topps_cards_table_id_number_key UNIQUE (table_id, number);
CREATE INDEX idx_topps_cards_table ON topps_cards(table_id);

ALTER TABLE topps_tables DROP COLUMN shape;

-- 7. Prove nothing was lost; any mismatch rolls the whole migration back.
DO $$
DECLARE b RECORD; a RECORD;
BEGIN
  SELECT * INTO b FROM topps_before;
  SELECT COUNT(*) AS cells, COUNT(*) FILTER (WHERE owned) AS owned INTO a FROM topps_cells;
  IF a.cells <> b.cells OR a.owned <> b.owned THEN
    RAISE EXCEPTION 'Topps migration check failed: before % cells / % owned, after % cells / % owned',
      b.cells, b.owned, a.cells, a.owned;
  END IF;
  IF EXISTS (SELECT 1 FROM topps_cells cl
             JOIN topps_cards c ON c.id = cl.card_id
             JOIN topps_variants v ON v.id = cl.variant_id
             WHERE c.table_id <> v.table_id) THEN
    RAISE EXCEPTION 'Topps migration check failed: a cell links a card and a column from different tables';
  END IF;
END $$;

COMMIT;
