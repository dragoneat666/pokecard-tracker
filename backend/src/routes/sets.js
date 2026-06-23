// routes/sets.js
import { Router } from 'express';
import { query } from '../db.js';
import { searchSets, importSetCards } from '../jobs/priceSync.js';
import { downloadAndLocalizeImage } from '../utils/imageDownload.js';

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

// ─── GET /api/sets/search-source ──────────────────────────────────────────────
// Searches cards within a specific already-imported set, by name or number.
// Used by the Import Card tab to find cards (e.g. MCAP alternates) to copy
// into the current set.
router.get('/search-source', async (req, res, next) => {
  try {
    const { source_set_id, q } = req.query;
    if (!source_set_id) return res.status(400).json({ error: 'source_set_id is required' });
    if (!q) return res.status(400).json({ error: 'q query param required (card number or name)' });

    const { rows } = await query(`
      SELECT id, card_number, name, rarity, image_url, tcgtracking_id
      FROM cards
      WHERE set_id = $1
        AND (name ILIKE $2 OR card_number ILIKE $2)
      ORDER BY name
      LIMIT 25
    `, [source_set_id, `%${q}%`]);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sets/mcap-id ─────────────────────────────────────────────────────
// Quick lookup so the frontend can jump straight to MCAP without the user
// having to find it in a dropdown.
router.get('/mcap-id', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, name FROM sets WHERE tcg_id = '2374'`);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'MCAP not imported yet' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sets/:id/search-own-cards ───────────────────────────────────────
// Searches cards within this set's own family (main, subsets, alternates)
// by name or number. Used by the Move Card tab to find a card to relocate.
router.get('/:id/search-own-cards', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'q query param required' });

    const { rows } = await query(`
      SELECT c.id, c.card_number, c.name, c.rarity, c.is_alternate, c.set_id, s.name AS set_name
      FROM cards c
      JOIN sets s ON s.id = c.set_id
      WHERE (c.set_id = $1 OR s.parent_set_id = $1)
        AND (c.name ILIKE $2 OR c.card_number ILIKE $2)
      ORDER BY c.is_alternate, c.name
      LIMIT 25
    `, [id, `%${q}%`]);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sets/:id/missing-type ───────────────────────────────────────────
// Returns all cards (main + alternates + subsets like Trainer Gallery) in this
// set's family that have no pokemon_type set.
router.get('/:id/missing-type', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(`
      SELECT c.id, c.card_number, c.name, c.rarity, c.pokemon_type, c.is_alternate, s.name AS set_name
      FROM cards c
      JOIN sets s ON s.id = c.set_id
      WHERE (c.set_id = $1 OR s.parent_set_id = $1)
        AND c.pokemon_type IS NULL
      ORDER BY c.is_alternate, s.id, c.name
    `, [id]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sets/:id/import-alternate ──────────────────────────────────────
// Copies a card from MCAP (or any other set) into the target set as an
// alternate. Copies the card's most recent price along with it so it shows
// up correctly immediately, without needing a separate price refresh.
router.post('/:id/import-alternate', async (req, res, next) => {
  try {
    const { id } = req.params; // target set id
    const { source_card_id, card_number } = req.body;

    if (!source_card_id) {
      return res.status(400).json({ error: 'source_card_id is required' });
    }

    const { rows: sourceRows } = await query(
      'SELECT * FROM cards WHERE id = $1',
      [source_card_id]
    );
    if (sourceRows.length === 0) {
      return res.status(404).json({ error: 'Source card not found' });
    }
    const source = sourceRows[0];

    // Use the provided card_number override (parsed from the MCAP name on the
    // frontend) or fall back to the source card's own number.
    const finalCardNumber = card_number || source.card_number;

    const { rows: newCardRows } = await query(`
      INSERT INTO cards (
        set_id, card_number, name, pokemon_type, rarity,
        has_reverse_holo, has_first_edition, image_url, stage, is_alternate
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      RETURNING *
    `, [
      id, finalCardNumber, source.name, source.pokemon_type, source.rarity,
      source.has_reverse_holo, source.has_first_edition, source.image_url, source.stage,
    ]);
    const newCard = newCardRows[0];

    // Copy the most recent price for the source card, if one exists
    const { rows: priceRows } = await query(
      'SELECT * FROM current_prices WHERE card_id = $1',
      [source_card_id]
    );
    if (priceRows.length > 0) {
      const p = priceRows[0];
      await query(`
        INSERT INTO prices (card_id, market_price, low_price, reverse_holo_price, holofoil_price)
        VALUES ($1, $2, $3, $4, $5)
      `, [newCard.id, p.market_price, p.low_price, p.reverse_holo_price, p.holofoil_price]);
    }

    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );

    res.status(201).json(newCard);
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
      WHERE c.set_id = $1 AND c.is_alternate = false
      ORDER BY
        CASE WHEN REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') = ''
          THEN 0 ELSE 1
        END ASC,
        NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER ASC NULLS LAST,
        REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') ASC,
        NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::INTEGER ASC NULLS LAST
    `, [id]);

    const alternateCardsResult = await query(`
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
      WHERE c.set_id = $1 AND c.is_alternate = true
      ORDER BY c.name
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
      alternateCards: alternateCardsResult.rows,
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
    let { name, set_type, variant_type, logo_url, symbol_url, series, release_date, is_parent, parent_set_id, date_manual } = req.body;

    // If series is being manually set, sync it to series_map as a protected
    // entry so future reimports of this or any set sharing the same set_code
    // won't overwrite it with auto-detection.
    if (series) {
      const { rows: setRows } = await query('SELECT set_code FROM sets WHERE id = $1', [id]);
      const setCode = setRows[0]?.set_code;
      if (setCode) {
        await query(`
          INSERT INTO series_map (set_code, series, is_manual)
          VALUES ($1, $2, true)
          ON CONFLICT (set_code) DO UPDATE SET series = $2, is_manual = true
        `, [setCode, series]);
      }
    }

    // Download and localize any new remote image URLs before saving
    if (logo_url) {
      logo_url = await downloadAndLocalizeImage(logo_url, id, 'logo');
    }
    if (symbol_url) {
      symbol_url = await downloadAndLocalizeImage(symbol_url, id, 'symbol');
    }

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
