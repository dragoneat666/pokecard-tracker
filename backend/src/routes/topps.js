// routes/topps.js
// Topps checklists — old Topps Pokemon cards tracked by hand (no price data).
//   GET    /api/topps/sets            — all checklists with progress
//   GET    /api/topps/sets/:id        — one checklist: printings, cards, and what you have
//   PATCH  /api/topps/cells           — mark one card/printing owned or not
//   DELETE /api/topps/sets/:id        — delete a checklist
//   POST   /api/topps/import          — create a checklist from a CSV (see below)
//
// Import CSV format (a grid like the old spreadsheets): first column is the
// card number, second the card name, and every other column is a printing
// (e.g. "Blue Logo - Non Holo"). For each cell:
//   0 or "0"      = this printing does not exist for that card
//   blank         = exists, you don't have it
//   anything else = exists, you have it

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import pool, { query } from '../db.js';
import { parseCsvObjects } from '../utils/parseCsv.js';

const router = Router();
const upload = multer({ dest: '/tmp/pokecard-topps/' });

// ─── GET /api/topps/sets ──────────────────────────────────────────────────────
router.get('/sets', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.id, s.name,
             COUNT(DISTINCT c.id)                          AS card_count,
             COUNT(cl.card_id)                             AS cells,
             COUNT(cl.card_id) FILTER (WHERE cl.owned)     AS owned
      FROM topps_sets s
      LEFT JOIN topps_cards c  ON c.set_id = s.id
      LEFT JOIN topps_cells cl ON cl.card_id = c.id
      GROUP BY s.id
      ORDER BY s.sort_order, s.name
    `);
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      card_count: parseInt(r.card_count, 10),
      cells: parseInt(r.cells, 10),
      owned: parseInt(r.owned, 10),
    })));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/topps/sets/:id ──────────────────────────────────────────────────
// cards[].cells maps variant id -> owned (true/false). A variant missing from
// that map means the printing doesn't exist for that card.
router.get('/sets/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows: setRows } = await query('SELECT id, name FROM topps_sets WHERE id = $1', [id]);
    if (setRows.length === 0) return res.status(404).json({ error: 'Checklist not found' });

    const { rows: variants } = await query(
      'SELECT id, name FROM topps_variants WHERE set_id = $1 ORDER BY sort_order, id', [id]
    );
    const { rows: cards } = await query(
      'SELECT id, number, name FROM topps_cards WHERE set_id = $1 ORDER BY sort_order, id', [id]
    );
    const { rows: cells } = await query(`
      SELECT cl.card_id, cl.variant_id, cl.owned
      FROM topps_cells cl
      JOIN topps_cards c ON c.id = cl.card_id
      WHERE c.set_id = $1
    `, [id]);

    const byCard = new Map(cards.map(c => [c.id, { ...c, cells: {} }]));
    for (const cell of cells) byCard.get(cell.card_id).cells[cell.variant_id] = cell.owned;

    res.json({ set: setRows[0], variants, cards: [...byCard.values()] });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/topps/cells ───────────────────────────────────────────────────
// Body: { card_id, variant_id, owned: true|false } — an absolute value, not a toggle.
router.patch('/cells', async (req, res, next) => {
  try {
    const { card_id, variant_id, owned } = req.body;
    if (!Number.isInteger(card_id) || !Number.isInteger(variant_id) || typeof owned !== 'boolean') {
      return res.status(400).json({ error: 'card_id, variant_id and owned (true/false) are required' });
    }
    const { rowCount } = await query(
      'UPDATE topps_cells SET owned = $3 WHERE card_id = $1 AND variant_id = $2',
      [card_id, variant_id, owned]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'That printing does not exist for this card' });
    res.json({ card_id, variant_id, owned });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/topps/sets/:id ───────────────────────────────────────────────
router.delete('/sets/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM topps_sets WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Checklist not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/topps/import ───────────────────────────────────────────────────
// multipart: "file" (CSV) and "name" (checklist name). Refuses a name that
// already exists so a re-import can never wipe what you've checked off.
router.post('/import', upload.single('file'), async (req, res, next) => {
  const tempPath = req.file?.path;
  try {
    const name = (req.body.name || '').trim();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!name) return res.status(400).json({ error: 'A checklist name is required' });

    const records = parseCsvObjects(fs.readFileSync(tempPath, 'utf8'));
    if (records.length === 0) return res.status(400).json({ error: 'CSV has no data rows' });

    const columns = Object.keys(records[0]);
    if (columns.length < 3) {
      return res.status(400).json({ error: 'CSV needs a number column, a name column and at least one printing column' });
    }
    const [numberCol, nameCol, ...variantCols] = columns;

    const { rows: existing } = await query('SELECT id FROM topps_sets WHERE name = $1', [name]);
    if (existing.length > 0) {
      return res.status(409).json({ error: `A checklist named "${name}" already exists — delete it first to re-import` });
    }

    const seen = new Set();
    for (const r of records) {
      const number = r[numberCol];
      if (!number || !r[nameCol]) return res.status(400).json({ error: 'Every row needs a number and a name' });
      if (seen.has(number)) return res.status(400).json({ error: `Duplicate card number "${number}"` });
      seen.add(number);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [set] } = await client.query(`
        INSERT INTO topps_sets (name, sort_order)
        VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM topps_sets))
        RETURNING id
      `, [name]);

      const variantIds = [];
      for (let i = 0; i < variantCols.length; i++) {
        const { rows: [v] } = await client.query(
          'INSERT INTO topps_variants (set_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
          [set.id, variantCols[i], i]
        );
        variantIds.push(v.id);
      }

      const cellCard = [];
      const cellVariant = [];
      const cellOwned = [];
      let owned = 0;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const { rows: [card] } = await client.query(
          'INSERT INTO topps_cards (set_id, number, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id',
          [set.id, r[numberCol], r[nameCol], i]
        );
        variantCols.forEach((col, j) => {
          const raw = (r[col] || '').trim();
          if (raw === '0') return;                     // printing doesn't exist
          const have = raw !== '';
          cellCard.push(card.id);
          cellVariant.push(variantIds[j]);
          cellOwned.push(have);
          if (have) owned++;
        });
      }

      for (let i = 0; i < cellCard.length; i += 2000) {
        await client.query(`
          INSERT INTO topps_cells (card_id, variant_id, owned)
          SELECT * FROM unnest($1::int[], $2::int[], $3::boolean[])
        `, [cellCard.slice(i, i + 2000), cellVariant.slice(i, i + 2000), cellOwned.slice(i, i + 2000)]);
      }

      await client.query('COMMIT');
      res.status(201).json({
        id: set.id,
        name,
        cards: records.length,
        printings: variantCols.length,
        cells: cellCard.length,
        owned,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

export default router;
