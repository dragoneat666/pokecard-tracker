// routes/coins.js
// TCG coins, grouped by generation and imported from Bulbapedia's coin pages.
// Only North American coins are collected (they count toward progress); the
// other regions are kept for reference. Each coin has one or more varieties,
// each a have/need box.
//
//   GET    /api/coins/generations          — generations with progress
//   GET    /api/coins/generations/:id      — a generation with all its coins
//   DELETE /api/coins/generations/:id
//   POST   /api/coins/generations/:id/coins — add a coin by hand
//   POST   /api/coins/import               — start importing a Bulbapedia coin page
//   GET    /api/coins/import               — progress / result of that
//   PATCH  /api/coins/:id                  — edit number, name, size, released in, date, description
//   PUT    /api/coins/:id/picture          — set or clear a coin's front / back picture
//   POST   /api/coins/:id/picture/upload   — set a front / back picture from a file (a scan)
//   DELETE /api/coins/:id
//   POST   /api/coins/:id/varieties        — add a variety
//   PATCH  /api/coins/varieties/:id        — rename a variety, or set have / need
//   DELETE /api/coins/varieties/:id        — (a coin keeps at least one)
//
// Coin pictures are always copies stored on our server (/logos/coins/...), never
// hotlinks; deleting a coin or generation deletes its copies too.

import { Router } from 'express';
import { query } from '../db.js';
import { downloadImageStrict, deleteLocalImages, isLocalImage, saveUploadedImage } from '../utils/imageDownload.js';
import { acceptPicture } from '../utils/pictureUpload.js';
import { checkPageUrl } from '../utils/toppsPictureJob.js';
import { startImportJob, getImportJob } from '../utils/coinImportJob.js';

const COLLECTED_REGION = 'North America';
const PICTURE_COLUMNS = { front: 'image_url', back: 'back_image_url' };
const TEXT_FIELDS = { name: 200, size: 40, released_in: 300, release_date: 60, description: 5000 };   // max lengths

const router = Router();

const clean = value => (typeof value === 'string' ? value.trim() : '');

function parseNumber(value) {
  const n = typeof value === 'number' ? value : parseInt(clean(String(value ?? '')), 10);
  return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null;
}

// Unique-constraint violations become a friendly 409.
function duplicate(err, res, message) {
  if (err.code === '23505') {
    res.status(409).json({ error: message });
    return true;
  }
  return false;
}

// The stored picture URLs of every coin matching a WHERE clause on c.
async function pictureUrls(where, params) {
  const { rows } = await query(`SELECT c.image_url, c.back_image_url FROM coins c WHERE ${where}`, params);
  return rows.flatMap(r => [r.image_url, r.back_image_url]);
}

// ─── GET /api/coins/generations ──────────────────────────────────────────────
// Counts cover North American coins only; reference = coins from other regions.
// cover_url is a coin picture to show on the row.
router.get('/generations', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT g.id, g.name,
             COUNT(DISTINCT c.id) FILTER (WHERE c.region = $1)    AS coins,
             COUNT(DISTINCT c.id) FILTER (WHERE c.region <> $1)   AS reference,
             COUNT(v.id) FILTER (WHERE c.region = $1)             AS varieties,
             COUNT(v.id) FILTER (WHERE c.region = $1 AND v.owned) AS owned,
             (SELECT c2.image_url FROM coins c2
              WHERE c2.generation_id = g.id AND c2.image_url IS NOT NULL
              ORDER BY (c2.region = $1) DESC, c2.number LIMIT 1)  AS cover_url
      FROM coin_generations g
      LEFT JOIN coins c          ON c.generation_id = g.id
      LEFT JOIN coin_varieties v ON v.coin_id = c.id
      GROUP BY g.id
      ORDER BY g.sort_order, g.id
    `, [COLLECTED_REGION]);
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      coins: parseInt(r.coins, 10),
      reference: parseInt(r.reference, 10),
      varieties: parseInt(r.varieties, 10),
      owned: parseInt(r.owned, 10),
      cover_url: r.cover_url,
    })));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/coins/generations/:id ──────────────────────────────────────────
// coins are ordered North America first, then the other regions, each by number.
router.get('/generations/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows: genRows } = await query('SELECT id, name FROM coin_generations WHERE id = $1', [id]);
    if (genRows.length === 0) return res.status(404).json({ error: 'Generation not found' });

    const { rows: coins } = await query(`
      SELECT id, region, number, name, size, released_in, release_date, description, image_url, back_image_url
      FROM coins WHERE generation_id = $1
      ORDER BY (region = $2) DESC, region, number
    `, [id, COLLECTED_REGION]);
    const { rows: varieties } = await query(`
      SELECT v.id, v.coin_id, v.name, v.owned
      FROM coin_varieties v JOIN coins c ON c.id = v.coin_id
      WHERE c.generation_id = $1 ORDER BY v.sort_order, v.id
    `, [id]);

    const coinMap = new Map(coins.map(c => [c.id, { ...c, varieties: [] }]));
    for (const v of varieties) coinMap.get(v.coin_id).varieties.push({ id: v.id, name: v.name, owned: v.owned });
    res.json({ generation: genRows[0], collectedRegion: COLLECTED_REGION, coins: [...coinMap.values()] });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/coins/generations/:id ───────────────────────────────────────
router.delete('/generations/:id', async (req, res, next) => {
  try {
    const urls = await pictureUrls('c.generation_id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM coin_generations WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Generation not found' });
    deleteLocalImages(urls, 'coins');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/coins/generations/:id/coins ───────────────────────────────────
// Body: { region, number, name }. The new coin gets one "Regular" variety.
router.post('/generations/:id/coins', async (req, res, next) => {
  try {
    const { id } = req.params;
    const region = clean(req.body.region).slice(0, 60);
    const number = parseNumber(req.body.number);
    const name = clean(req.body.name).slice(0, TEXT_FIELDS.name);
    if (!region || !name || number === null) {
      return res.status(400).json({ error: 'A region, a number (1-9999) and a name are required' });
    }
    const { rows: found } = await query('SELECT id FROM coin_generations WHERE id = $1', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Generation not found' });

    const { rows } = await query(`
      WITH c AS (
        INSERT INTO coins (generation_id, region, number, name) VALUES ($1, $2, $3, $4) RETURNING id
      ), v AS (
        INSERT INTO coin_varieties (coin_id, name, sort_order) SELECT id, 'Regular', 0 FROM c RETURNING 1
      )
      SELECT id FROM c
    `, [id, region, number, name]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (!duplicate(err, res, 'This generation already has a coin with that number in that region')) next(err);
  }
});

// ─── POST /api/coins/import ──────────────────────────────────────────────────
// Body: { url } — a Bulbapedia coin list page. Starts a background job; poll GET
// for progress.
router.post('/import', (req, res) => {
  const pageUrl = checkPageUrl(req.body.url);
  if (!pageUrl) {
    return res.status(400).json({ error: 'Use a Bulbapedia page link (https://bulbapedia.bulbagarden.net/wiki/...)' });
  }
  const job = startImportJob(pageUrl);
  if (!job) return res.status(409).json({ error: 'An import is already running' });
  res.status(202).json(job);
});

// ─── GET /api/coins/import ───────────────────────────────────────────────────
// The latest import (since the backend started), or null.
router.get('/import', (_req, res) => {
  res.json(getImportJob());
});

// ─── PATCH /api/coins/varieties/:id ──────────────────────────────────────────
// Body: { name } and / or { owned }.
router.patch('/varieties/:id', async (req, res, next) => {
  try {
    const sets = [];
    const params = [];
    if (req.body.name !== undefined) {
      const name = clean(req.body.name).slice(0, 120);
      if (!name) return res.status(400).json({ error: 'A variety name is required' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (req.body.owned !== undefined) {
      if (typeof req.body.owned !== 'boolean') return res.status(400).json({ error: 'owned must be true or false' });
      params.push(req.body.owned);
      sets.push(`owned = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to change' });

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE coin_varieties SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name, owned`, params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Variety not found' });
    res.json(rows[0]);
  } catch (err) {
    if (!duplicate(err, res, 'This coin already has a variety with that name')) next(err);
  }
});

// ─── DELETE /api/coins/varieties/:id ─────────────────────────────────────────
// A coin's last variety can't be deleted — every coin needs a box.
router.delete('/varieties/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT (SELECT COUNT(*) FROM coin_varieties o WHERE o.coin_id = v.coin_id) AS siblings
      FROM coin_varieties v WHERE v.id = $1
    `, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Variety not found' });
    if (parseInt(rows[0].siblings, 10) <= 1) {
      return res.status(400).json({ error: 'A coin needs at least one variety — rename this one instead' });
    }
    await query('DELETE FROM coin_varieties WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/coins/:id ────────────────────────────────────────────────────
// Body: any of { number, name, size, released_in, release_date, description }.
router.patch('/:id', async (req, res, next) => {
  try {
    const sets = [];
    const params = [];
    if (req.body.number !== undefined) {
      const number = parseNumber(req.body.number);
      if (number === null) return res.status(400).json({ error: 'The number must be a whole number from 1 to 9999' });
      params.push(number);
      sets.push(`number = $${params.length}`);
    }
    for (const [field, max] of Object.entries(TEXT_FIELDS)) {
      if (req.body[field] === undefined) continue;
      const value = clean(req.body[field]).slice(0, max);
      if (field === 'name' && !value) return res.status(400).json({ error: 'A name is required' });
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to change' });

    params.push(req.params.id);
    const { rows } = await query(`
      UPDATE coins SET ${sets.join(', ')} WHERE id = $${params.length}
      RETURNING id, number, name, size, released_in, release_date, description
    `, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Coin not found' });
    res.json(rows[0]);
  } catch (err) {
    if (!duplicate(err, res, 'This generation already has a coin with that number in that region')) next(err);
  }
});

// ─── PUT /api/coins/:id/picture ──────────────────────────────────────────────
// Body: { side: 'front' | 'back', url }. A new URL is downloaded and stored on
// our server (a failed download changes nothing and says why); an empty url
// clears the picture. A URL that's already our stored copy is kept as is.
router.put('/:id/picture', async (req, res, next) => {
  try {
    const { id } = req.params;
    const column = PICTURE_COLUMNS[req.body.side];
    if (!column) return res.status(400).json({ error: "side must be 'front' or 'back'" });
    const url = clean(req.body.url);

    const { rows } = await query(`SELECT ${column} AS current FROM coins WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Coin not found' });
    const { current } = rows[0];
    if (url === (current || '')) return res.json({ id: parseInt(id, 10), side: req.body.side, url: current });
    if (url && isLocalImage(url)) return res.status(400).json({ error: 'That is a stored picture of something else — paste the original link instead' });

    let local = null;
    if (url) {
      try {
        local = await downloadImageStrict(url, 'coins', `${id}-${req.body.side}`);
      } catch (err) {
        return res.status(400).json({ error: `Couldn't download that picture: ${err.message}` });
      }
    }
    await query(`UPDATE coins SET ${column} = $1 WHERE id = $2`, [local, id]);
    if (current !== local) deleteLocalImages([current], 'coins');
    res.json({ id: parseInt(id, 10), side: req.body.side, url: local });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/coins/:id/picture/upload ──────────────────────────────────────
// Multipart form: side ('front' | 'back') and picture (the file). Same result
// as PUT .../picture, for pictures you have as a file instead of a link.
router.post('/:id/picture/upload', acceptPicture, async (req, res, next) => {
  try {
    const { id } = req.params;
    const column = PICTURE_COLUMNS[req.body.side];
    if (!column) return res.status(400).json({ error: "side must be 'front' or 'back'" });

    const { rows } = await query(`SELECT ${column} AS current FROM coins WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Coin not found' });
    const { current } = rows[0];

    let local;
    try {
      local = saveUploadedImage(req.file.buffer, 'coins', `${id}-${req.body.side}`);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    await query(`UPDATE coins SET ${column} = $1 WHERE id = $2`, [local, id]);
    if (current !== local) deleteLocalImages([current], 'coins');
    res.json({ id: parseInt(id, 10), side: req.body.side, url: local });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/coins/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const urls = await pictureUrls('c.id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM coins WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Coin not found' });
    deleteLocalImages(urls, 'coins');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/coins/:id/varieties ───────────────────────────────────────────
// Body: { name }. Starts as "need".
router.post('/:id/varieties', async (req, res, next) => {
  try {
    const { id } = req.params;
    const name = clean(req.body.name).slice(0, 120);
    if (!name) return res.status(400).json({ error: 'A variety name is required' });
    const { rows } = await query(`
      INSERT INTO coin_varieties (coin_id, name, sort_order)
      SELECT c.id, $2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM coin_varieties WHERE coin_id = c.id)
      FROM coins c WHERE c.id = $1
      RETURNING id
    `, [id, name]);
    if (rows.length === 0) return res.status(404).json({ error: 'Coin not found' });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (!duplicate(err, res, 'This coin already has a variety with that name')) next(err);
  }
});

export default router;
