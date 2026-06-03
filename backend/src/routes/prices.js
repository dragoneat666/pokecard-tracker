// routes/prices.js
//
// Handles price refresh operations:
//   POST /api/prices/refresh/:setId   — manually trigger a price refresh for one set
//   GET  /api/prices/history/:cardId  — price history for a single card

import { Router } from 'express';
import { query } from '../db.js';
import { refreshPricesForSet } from '../jobs/priceSync.js';

const router = Router();

// ─── POST /api/prices/refresh/:setId ─────────────────────────────────────────
// The "Refresh Prices" button in the UI calls this.
// Fetches fresh prices from PokéWallet for every card in the set.
router.post('/refresh/:setId', async (req, res, next) => {
  try {
    const { setId } = req.params;

    // Verify the set exists
    const setResult = await query('SELECT id, name FROM sets WHERE id = $1', [setId]);
    if (setResult.rows.length === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }

    console.log(`🔄 Manual price refresh triggered for set: ${setResult.rows[0].name}`);

    // This can take a few seconds for large sets — we kick it off and
    // return immediately with a 202 Accepted ("I got your request and I'm working on it")
    // The frontend can poll or just wait a few seconds and reload.
    refreshPricesForSet(setId).catch(err => {
      console.error(`Price refresh failed for set ${setId}:`, err.message);
    });

    res.status(202).json({
      message: `Price refresh started for "${setResult.rows[0].name}"`,
      note: 'Prices will update in the background. Reload in a few seconds.'
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/prices/history/:cardId ─────────────────────────────────────────
// Returns the full price history for a card — all rows from the prices table.
// Useful for seeing how a card's value has changed over time.
router.get('/history/:cardId', async (req, res, next) => {
  try {
    const { cardId } = req.params;

    const { rows } = await query(`
      SELECT
        fetched_at,
        market_price,
        low_price,
        mid_price,
        reverse_holo_price
      FROM prices
      WHERE card_id = $1
      ORDER BY fetched_at DESC
      LIMIT 90  -- Last 90 data points (roughly 3 months of daily refreshes)
    `, [cardId]);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
