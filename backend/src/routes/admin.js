// routes/admin.js
// Admin-only routes:
//   GET    /api/admin/series-map         — list all series map entries
//   POST   /api/admin/series-map         — add a new entry
//   PATCH  /api/admin/series-map/:code   — update series name and/or is_manual
//   DELETE /api/admin/series-map/:code   — remove an entry
//   GET    /api/admin/data-sources       — external sites we pull data from, what
//                                          each provides, and live key/usage status

import { Router } from 'express';
import { query } from '../db.js';
import { getApiUsageToday } from '../utils/rateLimiter.js';

const router = Router();

// ─── GET /api/admin/data-sources ──────────────────────────────────────────────
// Descriptions live here, next to the code that does the pulling, so they're
// easy to update when an integration changes. API keys are only reported as
// configured / not configured — never returned.
router.get('/data-sources', async (_req, res, next) => {
  try {
    const graded = await getApiUsageToday('pokemon-api-graded');

    res.json([
      {
        name: 'TCGTracking',
        site: 'tcgtracking.com',
        auth: 'none',
        role: 'Primary source — cards, prices, sealed product',
        pulls: [
          'Set search and the full card list for each set: name, number, rarity, picture, and whether a card has a reverse holo or 1st edition version',
          'Card prices: market, low, reverse holo and holofoil / 1st edition (nightly at 3 AM, and whenever you refresh a set)',
          'Sealed product for each set (boxes, ETBs, blisters) with prices',
          'Set symbol images',
          'Card pictures (from cdn.tcgtracking.com), shown in the app and in image exports',
        ],
        usedBy: 'Add Set, Reimport, Refresh Prices, nightly price sync, sealed products, card pictures',
      },
      {
        name: 'PokéWallet',
        site: 'pokewallet.io',
        auth: 'key',
        keyConfigured: !!process.env.TCG_API_KEY,
        keyName: 'TCG_API_KEY',
        role: 'Secondary source — card types and set details',
        pulls: [
          'Each card’s Pokémon type or card type (Fire, Item, Supporter, ...) and evolution stage',
          'Set details: release date (fallback), set code and language',
        ],
        usedBy: 'Set import and reimport only (a failure here doesn’t stop an import — types are just left blank)',
        limit: '1,000 requests per day on the free plan',
      },
      {
        name: 'pokemon-api.com (via RapidAPI)',
        site: 'pokemon-tcg-api.p.rapidapi.com',
        auth: 'key',
        keyConfigured: !!process.env.POKEMON_API_RAPIDAPI_KEY,
        keyName: 'POKEMON_API_RAPIDAPI_KEY',
        role: 'Graded card prices',
        pulls: [
          'eBay sold prices for graded copies (PSA, BGS, CGC, ACE, TAG), by grade — the median price',
        ],
        usedBy: 'The 🔍 button on graded cards, and the graded step of a price refresh',
        limit: 'Billed on overage, so the app hard-stops at 90 calls per day and 25 per minute',
        usage: { used: graded.used, limit: graded.limit },
      },
      {
        name: 'Image links you provide',
        site: 'any site (e.g. Bulbapedia)',
        auth: 'none',
        role: 'Set logos and symbols',
        pulls: [
          'The logo and symbol image URLs you paste into Edit Set — downloaded once and stored on your server, so the browser never loads them from the other site',
        ],
        usedBy: 'Edit Set and set import',
      },
    ]);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/series-map ────────────────────────────────────────────────
router.get('/series-map', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT set_code, series, is_manual FROM series_map ORDER BY series, set_code'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/series-map ───────────────────────────────────────────────
router.post('/series-map', async (req, res, next) => {
  try {
    const { set_code, series } = req.body;
    if (!set_code || !series) {
      return res.status(400).json({ error: 'set_code and series are required' });
    }
    const { rows } = await query(
      `INSERT INTO series_map (set_code, series, is_manual)
       VALUES ($1, $2, true)
       ON CONFLICT (set_code) DO UPDATE SET series = $2, is_manual = true
       RETURNING *`,
      [set_code.trim().toUpperCase(), series.trim()]
    );

    // Sync to any sets already in the DB with this set_code
    await query(
      'UPDATE sets SET series = $1 WHERE set_code = $2',
      [series.trim(), set_code.trim().toUpperCase()]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/series-map/:code ───────────────────────────────────────
router.patch('/series-map/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const { series, is_manual } = req.body;
    const { rows } = await query(
      `UPDATE series_map SET
        series    = COALESCE($1, series),
        is_manual = COALESCE($2, is_manual)
       WHERE set_code = $3
       RETURNING *`,
      [series ?? null, is_manual ?? null, code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Set code not found' });

    // Sync the change to any sets already in the DB with this set_code
    if (series) {
      await query(
        'UPDATE sets SET series = $1 WHERE set_code = $2',
        [series.trim(), code]
      );
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/series-map/:code ──────────────────────────────────────
router.delete('/series-map/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const { rowCount } = await query(
      'DELETE FROM series_map WHERE set_code = $1', [code]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Set code not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
