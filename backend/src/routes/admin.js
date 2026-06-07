// routes/admin.js
// Admin-only routes:
//   GET    /api/admin/series-map         — list all series map entries
//   POST   /api/admin/series-map         — add a new entry
//   PATCH  /api/admin/series-map/:code   — update series name and/or is_manual
//   DELETE /api/admin/series-map/:code   — remove an entry

import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

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
