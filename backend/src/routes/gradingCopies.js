// routes/gradingCopies.js — Saved copies of cards, from the Grading tab
//
//   GET    /api/grading/cards/search?q=   cards to pick from (name, number,
//                                         set name or code; every word must match)
//   GET    /api/grading/queue             cards with 2 copies ticked that haven't
//                                         had a keep/sell decision yet, most
//                                         valuable first
//   GET    /api/grading/cards/:id         one card and its saved copies
//   POST   /api/grading/copies            save a checked copy. Multipart: "meta"
//                                         (JSON: cardId, slot, label, estimate,
//                                         estimateLow, estimateHigh, result) and
//                                         the pictures "front", "frontThumb",
//                                         "back", "backThumb" (JPEG, any missing
//                                         side left out)
//   PATCH  /api/grading/copies/:id        { label } and/or { status }
//   POST   /api/grading/copies/:id/keep   keep this copy: the card's other copies
//                                         in the same slot (not already "sell")
//                                         become "sell"
//   DELETE /api/grading/copies/:id        the copy and its pictures
//   GET    /api/grading/images/<file>     the saved pictures
//   GET    /api/grading/export?since=     every saved copy with its card, its
//                                         full measurements (incl. the nick
//                                         answers and the user's marks) and
//                                         its picture addresses, oldest first.
//                                         For training a checker on another
//                                         computer; since = an ISO time, only
//                                         copies changed after it
//
// What a copy is and what its status means: db/migrations/0.7.36-grading-copies.sql.
// Nothing here ever changes a card's owned count: the user unticks the second
// box themselves once the extra copy is gone.
//
// The pictures are files in the grading volume (/app/grading), named
// <copy id>-<side>-<random>.jpg (thumbnails end in -t.jpg), all in one folder
// so the nightly backup can copy them as plain files.

import { Router } from 'express';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pool, { query } from '../db.js';

const DIR = process.env.GRADING_DIR || '/app/grading';
const MAX_PICTURE = 8 * 1024 * 1024;      // a straightened card is ~0.5 MB
const MAX_RESULT = 512 * 1024;            // the measurements JSON
const PICTURES = ['front', 'frontThumb', 'back', 'backThumb'];
const SLOTS = ['regular', 'reverse'];
const STATUSES = ['checked', 'keep', 'sell'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: PICTURES.length, fileSize: MAX_PICTURE, fieldSize: MAX_RESULT },
}).fields(PICTURES.map(name => ({ name, maxCount: 1 })));

const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

// The card's details the Grading tab shows (a card picked, or one in a list).
const CARD_FIELDS = `
  c.id, c.name, c.card_number, c.rarity, c.image_url, c.owned,
  c.set_id, s.name AS set_name, s.set_code, s.variant_type,
  COALESCE(rh.owned, 0) AS reverse_owned,
  (COALESCE(c.has_reverse_holo, false) OR COALESCE(c.has_first_edition, false)) AS has_reverse,
  cp.market_price, cp.reverse_holo_price
`;
const CARD_JOINS = `
  FROM cards c
  JOIN sets s ON s.id = c.set_id
  LEFT JOIN reverse_holos rh ON rh.card_id = c.id
  LEFT JOIN current_prices cp ON cp.card_id = c.id
`;

// A copy row as the page gets it: picture names become addresses.
function copyOut(row) {
  const images = {};
  for (const [key, file] of Object.entries(row.images || {})) images[key] = `/grading/images/${file}`;
  return { ...row, images };
}

function removeFiles(images) {
  for (const file of Object.values(images || {})) {
    if (typeof file !== 'string' || !/^[\w-]+\.jpg$/.test(file)) continue;
    try { fs.unlinkSync(path.join(DIR, file)); } catch { /* already gone */ }
  }
}

const router = Router();

router.use('/images',
  express.static(DIR, { maxAge: '30d', immutable: true, index: false }),
  (_req, res) => res.status(404).json({ error: 'Picture not found' }));

router.get('/cards/search', async (req, res, next) => {
  try {
    const words = String(req.query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length) return res.json({ cards: [] });
    const params = [];
    const where = words.map((w) => {
      params.push(`%${w.replace(/[\\%_]/g, '\\$&')}%`);
      const n = params.length;
      return `(c.name ILIKE $${n} OR c.card_number ILIKE $${n} OR s.name ILIKE $${n} OR s.set_code ILIKE $${n})`;
    });
    const { rows } = await query(`
      SELECT ${CARD_FIELDS},
        (SELECT COUNT(*)::INT FROM grading_copies g WHERE g.card_id = c.id) AS copies
      ${CARD_JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY (c.owned > 0) DESC, cp.market_price DESC NULLS LAST, c.id
      LIMIT 20`, params);
    res.json({ cards: rows });
  } catch (err) { next(err); }
});

router.get('/queue', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const { rows } = await query(`
      WITH slots AS (
        SELECT c.id AS card_id, 'regular' AS slot FROM cards c WHERE c.owned = 2
        UNION ALL
        SELECT rh.card_id, 'reverse' FROM reverse_holos rh WHERE rh.owned = 2
      )
      SELECT sl.slot, ${CARD_FIELDS},
        CASE WHEN sl.slot = 'reverse' THEN cp.reverse_holo_price ELSE cp.market_price END AS price,
        (SELECT COUNT(*)::INT FROM grading_copies g WHERE g.card_id = c.id AND g.slot = sl.slot) AS copies,
        COUNT(*) OVER ()::INT AS total
      FROM slots sl
      JOIN cards c ON c.id = sl.card_id
      JOIN sets s ON s.id = c.set_id
      LEFT JOIN reverse_holos rh ON rh.card_id = c.id
      LEFT JOIN current_prices cp ON cp.card_id = c.id
      WHERE NOT EXISTS (
        SELECT 1 FROM grading_copies g
        WHERE g.card_id = sl.card_id AND g.slot = sl.slot AND g.status IN ('keep', 'sell')
      )
      ORDER BY price DESC NULLS LAST, c.id
      LIMIT $1`, [limit]);
    res.json({ total: rows[0]?.total || 0, cards: rows.map(({ total, ...r }) => r) });
  } catch (err) { next(err); }
});

router.get('/cards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await query(`SELECT ${CARD_FIELDS} ${CARD_JOINS} WHERE c.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Card not found' });
    const copies = await query('SELECT * FROM grading_copies WHERE card_id = $1 ORDER BY created_at', [id]);
    res.json({ card: rows[0], copies: copies.rows.map(copyOut) });
  } catch (err) { next(err); }
});

router.get('/export', async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.query.since) {
      const since = new Date(String(req.query.since));
      if (Number.isNaN(since.getTime())) return res.status(400).json({ error: "since isn't a valid time" });
      params.push(since.toISOString());
      where = 'WHERE g.updated_at > $1';
    }
    const { rows } = await query(`
      SELECT g.id, g.slot, g.status, g.label, g.estimate, g.estimate_low, g.estimate_high,
        g.result, g.images, g.created_at, g.updated_at,
        c.id AS card_id, c.name AS card_name, c.card_number, c.rarity, s.name AS set_name, s.set_code
      FROM grading_copies g
      JOIN cards c ON c.id = g.card_id
      JOIN sets s ON s.id = c.set_id
      ${where}
      ORDER BY g.updated_at, g.id`, params);
    res.json({
      exportedAt: new Date().toISOString(),
      copies: rows.map(({ images, ...r }) => ({
        ...r,
        pictures: Object.fromEntries(Object.entries(images || {}).map(([key, file]) => [key, `/api/grading/images/${file}`])),
      })),
    });
  } catch (err) { next(err); }
});

router.post('/copies', (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A picture is bigger than 8 MB' : `Upload failed: ${err.message}` });
    }
    let meta;
    try { meta = JSON.parse(req.body.meta || '{}'); } catch { return res.status(400).json({ error: 'The details sent aren\'t valid JSON' }); }
    const cardId = parseInt(meta.cardId);
    const slot = SLOTS.includes(meta.slot) ? meta.slot : 'regular';
    const grade = (v) => (Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);
    const files = req.files || {};
    for (const name of PICTURES) {
      if (files[name] && !isJpeg(files[name][0].buffer)) return res.status(400).json({ error: `The ${name} picture isn't a JPEG` });
    }
    if (!meta.result || typeof meta.result !== 'object') return res.status(400).json({ error: 'No measurements were sent' });

    let copyId = null;
    const images = {};
    try {
      const card = await query('SELECT id FROM cards WHERE id = $1', [cardId]);
      if (!card.rows.length) return res.status(404).json({ error: 'Card not found' });
      const { rows } = await query(`
        INSERT INTO grading_copies (card_id, slot, label, estimate, estimate_low, estimate_high, result)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [cardId, slot, String(meta.label || '').trim().slice(0, 80) || null,
        grade(meta.estimate), grade(meta.estimateLow), grade(meta.estimateHigh), meta.result]);
      copyId = rows[0].id;
      fs.mkdirSync(DIR, { recursive: true });
      const tag = crypto.randomBytes(3).toString('hex');
      for (const name of PICTURES) {
        if (!files[name]) continue;
        const side = name.startsWith('front') ? 'front' : 'back';
        const file = `${copyId}-${side}-${tag}${name.endsWith('Thumb') ? '-t' : ''}.jpg`;
        fs.writeFileSync(path.join(DIR, file), files[name][0].buffer);
        images[name] = file;
      }
      const saved = await query('UPDATE grading_copies SET images = $2 WHERE id = $1 RETURNING *', [copyId, images]);
      res.status(201).json({ copy: copyOut(saved.rows[0]) });
    } catch (e) {
      // don't leave half a copy behind
      removeFiles(images);
      if (copyId) await query('DELETE FROM grading_copies WHERE id = $1', [copyId]).catch(() => {});
      next(e);
    }
  });
});

router.patch('/copies/:id', async (req, res, next) => {
  try {
    const sets = [], params = [parseInt(req.params.id)];
    if ('label' in req.body) { params.push(String(req.body.label || '').trim().slice(0, 80) || null); sets.push(`label = $${params.length}`); }
    if ('status' in req.body) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' });
      params.push(req.body.status); sets.push(`status = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change' });
    const { rows } = await query(`UPDATE grading_copies SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Copy not found' });
    res.json({ copy: copyOut(rows[0]) });
  } catch (err) { next(err); }
});

router.post('/copies/:id/keep', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE grading_copies SET status = 'keep', updated_at = NOW() WHERE id = $1 RETURNING card_id, slot`,
      [parseInt(req.params.id)]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Copy not found' }); }
    await client.query(`
      UPDATE grading_copies SET status = 'sell', updated_at = NOW()
      WHERE card_id = $1 AND slot = $2 AND id <> $3 AND status <> 'sell'`,
    [rows[0].card_id, rows[0].slot, parseInt(req.params.id)]);
    await client.query('COMMIT');
    const copies = await query('SELECT * FROM grading_copies WHERE card_id = $1 ORDER BY created_at', [rows[0].card_id]);
    res.json({ copies: copies.rows.map(copyOut) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.delete('/copies/:id', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM grading_copies WHERE id = $1 RETURNING images', [parseInt(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Copy not found' });
    removeFiles(rows[0].images);
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
