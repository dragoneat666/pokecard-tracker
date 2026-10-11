// routes/sealed.js
// Sealed product operations (boxes, ETBs, blisters — see sealed_products):
//   PATCH /api/sealed/:id/owned — set how many of this product you own

import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// ─── PATCH /api/sealed/:id/owned ──────────────────────────────────────────────
// Request body: { owned: <integer >= 0> } — an absolute value, not a delta,
// so fast double-clicks can't drift (same reasoning as cards owned).
router.patch('/:id/owned', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { owned } = req.body;

    if (!Number.isInteger(owned) || owned < 0) {
      return res.status(400).json({ error: 'owned must be a non-negative integer' });
    }

    const { rows } = await query(
      'UPDATE sealed_products SET owned = $1 WHERE id = $2 RETURNING id, owned',
      [owned, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Sealed product not found' });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
