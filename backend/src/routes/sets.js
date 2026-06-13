// routes/sets.js
import { Router } from 'express';
import { query } from '../db.js';
import { searchSets, importSetCards } from '../jobs/priceSync.js';

const router = Router();

// ─── GET /api/sets ────────────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        id, name, series, total_cards, release_date, logo_url, set_code,
        symbol_url, language, set_type, variant_type, is_parent, parent_set_id,
        cards_owned, cards_in_db, regular_cards, secret_cards, reverse_holo_count,
        master_total, master_owned, completion_pct, total_value, reverse_holo_value,
        (total_value + reverse_holo_value) AS grand_total_value
      FROM set_summary_cache
      ORDER BY release_date DESC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sets/parents ────────────────────────────────────────────────────
// Returns only sets marked as parent sets — used to populate the
// "child of" dropdown in EditSetModal.
// IMPORTANT: must be defined before /:id or Express matches "parents" as an id.
router.get('/parents', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name FROM sets WHERE is_parent = true ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sets/children/:parentId ─────────────────────────────────────────
router.get('/children/:parentId', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name FROM sets WHERE parent_set_id = $1 ORDER BY release_date ASC',
      [req.params.parentId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sets/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const setResult = await query(
      'SELECT * FROM sets WHERE id = $1',
      [id]
    );

    if (setResult.rows.length === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }

    const cardsResult = await query(`
      SELECT
        c.id, c.card_number, c.name, c.pokemon_type, c.rarity,
        c.storage, c.condition, c.stage, c.owned, c.has_extra,
        c.has_reverse_holo, c.has_first_edition, c.image_url, c.tcgtracking_id,
        COALESCE(rh.owned, 0) AS reverse_owned,
        cp.market_price, cp.low_price, cp.reverse_holo_price,
        cp.fetched_at AS price_updated_at,
        (cp.market_price * c.owned) AS total_value,
        (cp.reverse_holo_price * rh.owned) AS reverse_total_value
      FROM cards c
      LEFT JOIN reverse_holos rh ON rh.card_id = c.id
      LEFT JOIN current_prices cp ON cp.card_id = c.id
      WHERE c.set_id = $1
      ORDER BY
        CASE WHEN REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') = ''
          THEN 0 ELSE 1
        END ASC,
        NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER ASC NULLS LAST,
        REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') ASC,
        NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER ASC NULLS LAST
    `, [id]);

    // If this is a parent set, fetch child sets and their cards
    let childSets = [];
    if (setResult.rows[0].is_parent) {
      const { rows: children } = await query(
        'SELECT * FROM sets WHERE parent_set_id = $1 ORDER BY release_date ASC',
        [id]
      );
      for (const child of children) {
        const { rows: childCards } = await query(`
          SELECT
            c.id, c.card_number, c.name, c.pokemon_type, c.rarity,
            c.storage, c.condition, c.stage, c.owned, c.has_extra,
            c.has_reverse_holo, c.has_first_edition, c.image_url, c.tcgtracking_id,
            COALESCE(rh.owned, 0) AS reverse_owned,
            cp.market_price, cp.low_price, cp.reverse_holo_price,
            cp.fetched_at AS price_updated_at,
            (cp.market_price * c.owned) AS total_value,
            (cp.reverse_holo_price * rh.owned) AS reverse_total_value
          FROM cards c
          LEFT JOIN reverse_holos rh ON rh.card_id = c.id
          LEFT JOIN current_prices cp ON cp.card_id = c.id
          WHERE c.set_id = $1
          ORDER BY
            CASE WHEN REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') = ''
              THEN 0 ELSE 1
            END ASC,
            NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER ASC NULLS LAST,
            REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') ASC,
            NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER ASC NULLS LAST
        `, [child.id]);
        childSets.push({ set: child, cards: childCards });
      }
    }

    res.json({
      set: setResult.rows[0],
      cards: cardsResult.rows,
      childSets,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sets/search-tcg ────────────────────────────────────────────────
router.post('/search-tcg', async (req, res, next) => {
  try {
    const { query: searchQuery } = req.body;
    if (!searchQuery) {
      return res.status(400).json({ error: 'query is required' });
    }
    const results = await searchSets(searchQuery);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sets ───────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { tcg_id, name, series, total_cards, release_date, logo_url, set_code, language, set_type } = req.body;

    if (tcg_id) {
      const newSet = await importSetCards(tcg_id);
      return res.status(201).json(newSet);
    }

    if (!name) {
      return res.status(400).json({ error: 'name is required for manual sets' });
    }

    const { rows } = await query(`
      INSERT INTO sets (name, series, total_cards, release_date, logo_url, set_code, language, set_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, series, total_cards || null, release_date || null, logo_url || null, set_code || null, language || null, set_type || 'Main']);

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/sets/:id ──────────────────────────────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, set_type, variant_type, logo_url, symbol_url, series, release_date, is_parent, parent_set_id, date_manual } = req.body;

    const { rows } = await query(`
      UPDATE sets SET
        name          = COALESCE($1, name),
        set_type      = COALESCE($2, set_type),
        variant_type  = COALESCE($3, variant_type),
        logo_url      = $4,
        symbol_url    = $5,
        series        = COALESCE($6, series),
        release_date  = CASE WHEN $7::date IS NOT NULL THEN $7::date ELSE release_date END,
        is_parent     = COALESCE($8, is_parent),
        parent_set_id = $9,
        date_manual   = COALESCE($10, date_manual)
      WHERE id = $11
      RETURNING *
    `, [name, set_type, variant_type, logo_url, symbol_url, series, release_date, is_parent ?? null, parent_set_id ?? null, date_manual ?? null, id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Set not found' });
    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/sets/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query('DELETE FROM sets WHERE id = $1', [id]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }

    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
