// routes/sets.js
//
// Handles all set-level operations:
//   GET    /api/sets              — list all sets (dashboard/TOC view)
//   GET    /api/sets/:id          — single set with its cards
//   POST   /api/sets/search-tcg   — search PokéWallet API for a set to import
//   POST   /api/sets              — create a set (manual or from TCG API import)
//   DELETE /api/sets/:id          — remove a set and all its cards

import { Router } from 'express';
import { query } from '../db.js';
import { searchSets, importSetCards } from '../jobs/priceSync.js';

const router = Router();

// ─── GET /api/sets ────────────────────────────────────────────────────────────
// Returns all sets with aggregated stats from the set_summary view we created
// in init.sql. This is your Table of Contents — one row per set with owned
// count, total value, completion %, etc.
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        id,
        name,
        series,
        total_cards,
        release_date,
        logo_url,
        set_code,
        symbol_url,
        language,
        set_type,
        variant_type,
        cards_owned,
        cards_in_db,
        regular_cards,
        secret_cards,
        reverse_holo_count,
        master_total,
        master_owned,
        completion_pct,
        total_value,
        reverse_holo_value,
        (total_value + reverse_holo_value) AS grand_total_value
      FROM set_summary
      ORDER BY release_date DESC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    next(err); // Passes error to the global error handler in server.js
  }
});

// ─── GET /api/sets/:id ────────────────────────────────────────────────────────
// Returns a single set plus all its cards with current prices.
// This is what populates the per-set card table view.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params; // Extract the :id from the URL

    // First get the set itself
    const setResult = await query(
      'SELECT * FROM sets WHERE id = $1',
      [id]
    );

    if (setResult.rows.length === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }

    // Then get all cards for this set, joined with their latest price
    // and reverse holo data. LEFT JOIN means cards without prices or
    // reverse holos still show up (just with null values).
    const cardsResult = await query(`
      SELECT
        c.id,
        c.tcg_card_id,
        c.card_number,
        c.name,
        c.pokemon_type,
        c.rarity,
        c.storage,
        c.condition,
        c.stage,
        c.owned,
        c.has_extra,
        c.has_reverse_holo,
        c.has_first_edition,
        c.image_url,
        c.tcgtracking_id,
        -- Reverse holo owned count (0 if no reverse holo row exists)
        COALESCE(rh.owned, 0) AS reverse_owned,
        -- Current prices from the view
        cp.market_price,
        cp.low_price,
        cp.reverse_holo_price,
        cp.fetched_at AS price_updated_at,
        -- Calculated totals
        (cp.market_price * c.owned)           AS total_value,
        (cp.reverse_holo_price * rh.owned)    AS reverse_total_value
      FROM cards c
      LEFT JOIN reverse_holos rh  ON rh.card_id = c.id
      LEFT JOIN current_prices cp ON cp.card_id = c.id
      WHERE c.set_id = $1
      ORDER BY
        -- Sort by card number numerically where possible, fall back to text sort
        -- This handles "001", "002"... "151" correctly
        (REGEXP_REPLACE(c.card_number, '[^0-9]', '', 'g'))::INTEGER ASC NULLS LAST
    `, [id]);

    res.json({
      set: setResult.rows[0],
      cards: cardsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sets/search-tcg ────────────────────────────────────────────────
// Searches the PokéWallet API for sets matching a query string.
// The frontend calls this when you type in the "Add Set" search box.
// Returns a list of matching sets from the TCG API — not from our DB.
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
// Creates a new set. Two modes:
//
// Mode 1 — Import from TCG API (recommended):
//   Send { tcg_id: "sv8pt5" } and we'll pull all card data automatically.
//
// Mode 2 — Manual:
//   Send { name, series, total_cards } and we create an empty set.
//   You then add cards one by one.
router.post('/', async (req, res, next) => {
  try {
    const { tcg_id, name, series, total_cards, release_date, logo_url, set_code, language, set_type } = req.body;

    if (tcg_id) {
      // Mode 1: Import from PokéWallet API
      // importSetCards fetches the full card list and inserts everything
      const newSet = await importSetCards(tcg_id);
      return res.status(201).json(newSet);
    }

    // Mode 2: Manual set creation
    if (!name) {
      return res.status(400).json({ error: 'name is required for manual sets' });
    }

    const { rows } = await query(`
      INSERT INTO sets (name, series, total_cards, release_date, logo_url, set_code, language, set_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, series, total_cards || null, release_date || null, logo_url || null, set_code || null, language || null, set_type || 'Main']);

    res.status(201).json(rows[0]);
    // 201 Created is the correct HTTP status for "I made a new thing"
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/sets/:id ─────────────────────────────────────────────────────
// Deletes a set. Because of ON DELETE CASCADE in init.sql, this also
// automatically deletes all cards, reverse_holos, and prices for that set.
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query('DELETE FROM sets WHERE id = $1', [id]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }

    res.status(204).send(); // 204 No Content — success, nothing to return
  } catch (err) {
    next(err);
  }
});

export default router;
