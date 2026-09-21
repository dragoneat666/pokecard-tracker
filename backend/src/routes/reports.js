// routes/reports.js
// Collection-wide reports (not scoped to a single set):
//   GET /api/reports/top-valuable        — top 50 most valuable owned cards
//   GET /api/reports/storage-audit-safe       — $50+ cards not stored in a safe
//   GET /api/reports/storage-audit-toploader  — $10-$49.99 cards not in a toploader
//
// All three share the same base query: owned cards (owned >= 1) priced with
// the graded price instead of market price when the card is graded — the
// same CASE WHEN used for total_value in routes/sets.js.

import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

const OWNED_PRICED_CARDS = `
  SELECT
    c.id, c.card_number, c.name, c.storage,
    s.id AS set_id, s.name AS set_name,
    (CASE WHEN c.is_graded THEN c.graded_price ELSE cp.market_price END) AS price
  FROM cards c
  JOIN sets s ON s.id = c.set_id
  LEFT JOIN current_prices cp ON cp.card_id = c.id
  WHERE c.owned >= 1
`;

// ─── GET /api/reports/top-valuable ─────────────────────────────────────────────
router.get('/top-valuable', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT * FROM (${OWNED_PRICED_CARDS}) owned_cards
      WHERE price IS NOT NULL
      ORDER BY price DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/storage-audit-safe ───────────────────────────────────────
// Cards worth $50+ that aren't stored in the safe.
router.get('/storage-audit-safe', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT * FROM (${OWNED_PRICED_CARDS}) owned_cards
      WHERE price >= 50 AND storage != 'safe'
      ORDER BY price DESC
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reports/storage-audit-toploader ──────────────────────────────────
// Cards worth $10.00-$49.99 that aren't stored in a toploader.
router.get('/storage-audit-toploader', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT * FROM (${OWNED_PRICED_CARDS}) owned_cards
      WHERE price >= 10 AND price < 50 AND storage != 'toploader'
      ORDER BY price DESC
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
