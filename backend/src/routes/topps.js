// routes/topps.js
// Topps checklists — old Topps Pokemon cards tracked by hand (no price data),
// edited like a spreadsheet. A checklist holds tables; a table has named
// columns (printings) and rows (cards); each cell is have / need / doesn't exist.
// The same engine backs the Burger King Cards tab: each checklist has a kind
// ('topps' or 'burger_king') saying which tab lists it.
//
//   GET    /api/topps/sets?kind=…           — checklists of one kind (default topps) with progress
//   POST   /api/topps/sets                  — new checklist (with one starter table)
//   GET    /api/topps/sets/:id              — a checklist with all its tables
//   PATCH  /api/topps/sets/:id              — edit name, logo URL and release date
//   DELETE /api/topps/sets/:id
//   POST   /api/topps/sets/:id/pictures     — start filling card pictures from a Bulbapedia page
//   GET    /api/topps/sets/:id/pictures     — progress / result of that
//   POST   /api/topps/sets/:id/tables       — add a table
//   PATCH  /api/topps/tables/:id            — rename a table
//   DELETE /api/topps/tables/:id
//   POST   /api/topps/tables/:id/variants   — add a column
//   PATCH  /api/topps/variants/:id          — rename a column
//   DELETE /api/topps/variants/:id
//   POST   /api/topps/tables/:id/cards      — add a row
//   POST   /api/topps/tables/:id/paste      — add many rows (and columns) from pasted Excel cells
//   PATCH  /api/topps/cards/:id             — edit a row's number / name
//   PUT    /api/topps/cards/:id/picture     — set or clear a card's front / back picture
//   DELETE /api/topps/cards/:id
//   PUT    /api/topps/cells                 — set one cell: none | need | have
//
// New columns and rows get a "need" cell for every row/column already there;
// "doesn't exist" (none) means there is simply no cell.
//
// Card pictures are always copies stored on our server (/logos/topps/...), never
// hotlinks; deleting a card, table or checklist deletes its copies too.

import { Router } from 'express';
import pool, { query } from '../db.js';
import { downloadAndLocalizeImage, downloadImageStrict, deleteLocalImages, isLocalImage } from '../utils/imageDownload.js';
import { parsePasted, applyPaste, PasteError } from '../utils/toppsPaste.js';
import { checkPageUrl, startPictureJob, getPictureJob } from '../utils/toppsPictureJob.js';

const PICTURE_COLUMNS = { front: 'image_url', back: 'back_image_url' };
const KINDS = ['topps', 'burger_king'];

// The stored picture URLs of every card matching a WHERE clause on c / t.
async function pictureUrls(where, params) {
  const { rows } = await query(`
    SELECT c.image_url, c.back_image_url
    FROM topps_cards c JOIN topps_tables t ON t.id = c.table_id
    WHERE ${where}
  `, params);
  return rows.flatMap(r => [r.image_url, r.back_image_url]);
}

const router = Router();

const clean = value => (typeof value === 'string' ? value.trim() : '');

// Unique-constraint violations become a friendly 409.
function duplicate(err, res, message) {
  if (err.code === '23505') {
    res.status(409).json({ error: message });
    return true;
  }
  return false;
}

// ─── GET /api/topps/sets ──────────────────────────────────────────────────────
router.get('/sets', async (req, res, next) => {
  try {
    const kind = req.query.kind ?? 'topps';
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(', ')}` });
    const { rows } = await query(`
      SELECT s.id, s.name, s.logo_url,
             to_char(s.release_date, 'YYYY-MM-DD')         AS release_date,
             COUNT(DISTINCT c.id)                          AS card_count,
             COUNT(cl.card_id)                             AS cells,
             COUNT(cl.card_id) FILTER (WHERE cl.owned)     AS owned
      FROM topps_sets s
      LEFT JOIN topps_tables t ON t.set_id = s.id
      LEFT JOIN topps_cards c  ON c.table_id = t.id
      LEFT JOIN topps_cells cl ON cl.card_id = c.id
      WHERE s.kind = $1
      GROUP BY s.id
      ORDER BY s.sort_order, s.name
    `, [kind]);
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      logo_url: r.logo_url,
      release_date: r.release_date,
      card_count: parseInt(r.card_count, 10),
      cells: parseInt(r.cells, 10),
      owned: parseInt(r.owned, 10),
    })));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/topps/sets ─────────────────────────────────────────────────────
// Body: { name, kind } (kind defaults to topps). A new checklist starts with
// one table and one column ("Owned") to build on.
router.post('/sets', async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const kind = req.body.kind ?? 'topps';
    if (!name) return res.status(400).json({ error: 'A name is required' });
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(', ')}` });

    const { rows } = await query(`
      WITH s AS (
        INSERT INTO topps_sets (name, kind, sort_order)
        VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM topps_sets))
        RETURNING id
      ), t AS (
        INSERT INTO topps_tables (set_id, title, sort_order)
        SELECT id, '', 0 FROM s RETURNING id
      ), v AS (
        INSERT INTO topps_variants (table_id, name, sort_order)
        SELECT id, 'Owned', 0 FROM t RETURNING id
      )
      SELECT id FROM s
    `, [name, kind]);
    res.status(201).json({ id: rows[0].id, name, kind });
  } catch (err) {
    if (!duplicate(err, res, 'A checklist with that name already exists')) next(err);
  }
});

// ─── GET /api/topps/sets/:id ──────────────────────────────────────────────────
// tables[].cards[].cells maps column id -> owned (true/false). A column missing
// from that map means the printing doesn't exist for that card.
router.get('/sets/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows: setRows } = await query(`
      SELECT id, name, kind, logo_url, to_char(release_date, 'YYYY-MM-DD') AS release_date
      FROM topps_sets WHERE id = $1
    `, [id]);
    if (setRows.length === 0) return res.status(404).json({ error: 'Checklist not found' });

    const { rows: tables } = await query(
      'SELECT id, title FROM topps_tables WHERE set_id = $1 ORDER BY sort_order, id', [id]
    );
    const { rows: variants } = await query(`
      SELECT v.id, v.table_id, v.name
      FROM topps_variants v JOIN topps_tables t ON t.id = v.table_id
      WHERE t.set_id = $1 ORDER BY v.sort_order, v.id
    `, [id]);
    const { rows: cards } = await query(`
      SELECT c.id, c.table_id, c.number, c.name, c.image_url, c.back_image_url
      FROM topps_cards c JOIN topps_tables t ON t.id = c.table_id
      WHERE t.set_id = $1 ORDER BY c.sort_order, c.id
    `, [id]);
    const { rows: cells } = await query(`
      SELECT cl.card_id, cl.variant_id, cl.owned
      FROM topps_cells cl
      JOIN topps_cards c ON c.id = cl.card_id
      JOIN topps_tables t ON t.id = c.table_id
      WHERE t.set_id = $1
    `, [id]);

    const tableMap = new Map(tables.map(t => [t.id, { ...t, variants: [], cards: [] }]));
    const cardMap = new Map();
    for (const v of variants) tableMap.get(v.table_id).variants.push({ id: v.id, name: v.name });
    for (const c of cards) {
      const card = {
        id: c.id, number: c.number, name: c.name,
        image_url: c.image_url, back_image_url: c.back_image_url, cells: {},
      };
      cardMap.set(c.id, card);
      tableMap.get(c.table_id).cards.push(card);
    }
    for (const cell of cells) cardMap.get(cell.card_id).cells[cell.variant_id] = cell.owned;

    res.json({ set: setRows[0], tables: [...tableMap.values()] });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/topps/sets/:id ────────────────────────────────────────────────
// Body: { name, logo_url, release_date }. An empty/null logo_url or release_date
// clears it. A new logo URL is downloaded and stored on our server so sites that
// block hotlinking (Bulbapedia, Fandom) can't break it — same as set logos.
router.patch('/sets/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const name = clean(req.body.name);
    let logoUrl = clean(req.body.logo_url) || null;
    const releaseDate = clean(req.body.release_date) || null;

    if (!name) return res.status(400).json({ error: 'A name is required' });
    if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      return res.status(400).json({ error: 'release_date must look like YYYY-MM-DD' });
    }

    if (logoUrl) logoUrl = await downloadAndLocalizeImage(logoUrl, id, 'topps-logo');

    const { rowCount } = await query(
      'UPDATE topps_sets SET name = $1, logo_url = $2, release_date = $3::date WHERE id = $4',
      [name, logoUrl, releaseDate, id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Checklist not found' });
    res.json({ id: parseInt(id, 10), name, logo_url: logoUrl, release_date: releaseDate });
  } catch (err) {
    if (!duplicate(err, res, 'A checklist with that name already exists')) next(err);
  }
});

// ─── DELETE /api/topps/sets/:id ───────────────────────────────────────────────
router.delete('/sets/:id', async (req, res, next) => {
  try {
    const urls = await pictureUrls('t.set_id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM topps_sets WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Checklist not found' });
    deleteLocalImages(urls, 'topps');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/topps/sets/:id/pictures ────────────────────────────────────────
// Body: { url } — a Bulbapedia series page. Starts a background job that fills
// in every card picture that's still empty; poll GET for progress.
router.post('/sets/:id/pictures', async (req, res, next) => {
  try {
    const { id } = req.params;
    const pageUrl = checkPageUrl(req.body.url);
    if (!pageUrl) {
      return res.status(400).json({ error: 'Use a Bulbapedia page link (https://bulbapedia.bulbagarden.net/wiki/...)' });
    }
    const { rows } = await query('SELECT id FROM topps_sets WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Checklist not found' });

    const job = startPictureJob(id, pageUrl);
    if (!job) return res.status(409).json({ error: 'Pictures are already being fetched for this checklist' });
    res.status(202).json(job);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/topps/sets/:id/pictures ─────────────────────────────────────────
// The latest picture job for this checklist (since the backend started), or null.
router.get('/sets/:id/pictures', (req, res) => {
  res.json(getPictureJob(req.params.id));
});

// ─── POST /api/topps/sets/:id/tables ──────────────────────────────────────────
router.post('/sets/:id/tables', async (req, res, next) => {
  try {
    const { id } = req.params;
    const title = clean(req.body.title).slice(0, 120);
    const { rows: setRows } = await query('SELECT id FROM topps_sets WHERE id = $1', [id]);
    if (setRows.length === 0) return res.status(404).json({ error: 'Checklist not found' });

    const { rows } = await query(`
      WITH t AS (
        INSERT INTO topps_tables (set_id, title, sort_order)
        VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM topps_tables WHERE set_id = $1))
        RETURNING id
      ), v AS (
        INSERT INTO topps_variants (table_id, name, sort_order)
        SELECT id, 'Owned', 0 FROM t RETURNING id
      )
      SELECT id FROM t
    `, [id, title]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/topps/tables/:id ──────────────────────────────────────────────
router.patch('/tables/:id', async (req, res, next) => {
  try {
    const title = clean(req.body.title).slice(0, 120);
    const { rowCount } = await query('UPDATE topps_tables SET title = $1 WHERE id = $2', [title, req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Table not found' });
    res.json({ id: parseInt(req.params.id, 10), title });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/topps/tables/:id ─────────────────────────────────────────────
router.delete('/tables/:id', async (req, res, next) => {
  try {
    const urls = await pictureUrls('t.id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM topps_tables WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Table not found' });
    deleteLocalImages(urls, 'topps');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/topps/tables/:id/variants ──────────────────────────────────────
// Adds a column; every existing row gets a "need" cell in it.
router.post('/tables/:id/variants', async (req, res, next) => {
  try {
    const { id } = req.params;
    const name = clean(req.body.name).slice(0, 120);
    if (!name) return res.status(400).json({ error: 'A column name is required' });
    const { rows: found } = await query('SELECT id FROM topps_tables WHERE id = $1', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Table not found' });

    const { rows } = await query(`
      WITH v AS (
        INSERT INTO topps_variants (table_id, name, sort_order)
        VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM topps_variants WHERE table_id = $1))
        RETURNING id
      ), cells AS (
        INSERT INTO topps_cells (card_id, variant_id, owned)
        SELECT c.id, v.id, false FROM topps_cards c, v WHERE c.table_id = $1
        RETURNING 1
      )
      SELECT id FROM v
    `, [id, name]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (!duplicate(err, res, 'This table already has a column with that name')) next(err);
  }
});

// ─── PATCH /api/topps/variants/:id ────────────────────────────────────────────
router.patch('/variants/:id', async (req, res, next) => {
  try {
    const name = clean(req.body.name).slice(0, 120);
    if (!name) return res.status(400).json({ error: 'A column name is required' });
    const { rowCount } = await query('UPDATE topps_variants SET name = $1 WHERE id = $2', [name, req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Column not found' });
    res.json({ id: parseInt(req.params.id, 10), name });
  } catch (err) {
    if (!duplicate(err, res, 'This table already has a column with that name')) next(err);
  }
});

// ─── DELETE /api/topps/variants/:id ───────────────────────────────────────────
router.delete('/variants/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM topps_variants WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Column not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/topps/tables/:id/cards ─────────────────────────────────────────
// Adds a row; it gets a "need" cell in every column the table has.
router.post('/tables/:id/cards', async (req, res, next) => {
  try {
    const { id } = req.params;
    const number = clean(req.body.number).slice(0, 40);
    const name = clean(req.body.name).slice(0, 200);
    if (!number || !name) return res.status(400).json({ error: 'A number and a name are required' });
    const { rows: found } = await query('SELECT id FROM topps_tables WHERE id = $1', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Table not found' });

    const { rows } = await query(`
      WITH c AS (
        INSERT INTO topps_cards (table_id, number, name, sort_order)
        VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM topps_cards WHERE table_id = $1))
        RETURNING id
      ), cells AS (
        INSERT INTO topps_cells (card_id, variant_id, owned)
        SELECT c.id, v.id, false FROM c, topps_variants v WHERE v.table_id = $1
        RETURNING 1
      )
      SELECT id FROM c
    `, [id, number, name]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (!duplicate(err, res, 'This table already has a card with that number')) next(err);
  }
});

// ─── POST /api/topps/tables/:id/paste ─────────────────────────────────────────
// Body: { text } — cells copied from Excel (tab-separated) or CSV text. Format
// and rules are in utils/toppsPaste.js. All or nothing: if anything fails, no
// rows or columns are added.
router.post('/tables/:id/paste', async (req, res, next) => {
  try {
    const { id } = req.params;
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const parsed = parsePasted(text);
    if (parsed.rows.length === 0) {
      return res.status(400).json({ error: 'Nothing to add — paste rows that have a number and a name' });
    }
    const { rows: found } = await query('SELECT id FROM topps_tables WHERE id = $1', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Table not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await applyPaste(client, id, parsed);
      await client.query('COMMIT');
      res.json(result);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof PasteError) return res.status(400).json({ error: err.message });
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/topps/cards/:id ───────────────────────────────────────────────
router.patch('/cards/:id', async (req, res, next) => {
  try {
    const number = clean(req.body.number).slice(0, 40);
    const name = clean(req.body.name).slice(0, 200);
    if (!number || !name) return res.status(400).json({ error: 'A number and a name are required' });
    const { rowCount } = await query(
      'UPDATE topps_cards SET number = $1, name = $2 WHERE id = $3', [number, name, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Card not found' });
    res.json({ id: parseInt(req.params.id, 10), number, name });
  } catch (err) {
    if (!duplicate(err, res, 'This table already has a card with that number')) next(err);
  }
});

// ─── PUT /api/topps/cards/:id/picture ─────────────────────────────────────────
// Body: { side: 'front' | 'back', url }. A new URL is downloaded and stored on
// our server (a failed download changes nothing and says why); an empty url
// clears the picture. A URL that's already our stored copy is kept as is.
router.put('/cards/:id/picture', async (req, res, next) => {
  try {
    const { id } = req.params;
    const column = PICTURE_COLUMNS[req.body.side];
    if (!column) return res.status(400).json({ error: "side must be 'front' or 'back'" });
    const url = clean(req.body.url);

    const { rows } = await query(`SELECT ${column} AS current FROM topps_cards WHERE id = $1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    const { current } = rows[0];
    if (url === (current || '')) return res.json({ id: parseInt(id, 10), side: req.body.side, url: current });
    if (url && isLocalImage(url)) return res.status(400).json({ error: 'That is a stored picture of another card — paste the original link instead' });

    let local = null;
    if (url) {
      try {
        local = await downloadImageStrict(url, 'topps', `${id}-${req.body.side}`);
      } catch (err) {
        return res.status(400).json({ error: `Couldn't download that picture: ${err.message}` });
      }
    }
    await query(`UPDATE topps_cards SET ${column} = $1 WHERE id = $2`, [local, id]);
    if (current !== local) deleteLocalImages([current], 'topps');
    res.json({ id: parseInt(id, 10), side: req.body.side, url: local });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/topps/cards/:id ──────────────────────────────────────────────
router.delete('/cards/:id', async (req, res, next) => {
  try {
    const urls = await pictureUrls('c.id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM topps_cards WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Card not found' });
    deleteLocalImages(urls, 'topps');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/topps/cells ─────────────────────────────────────────────────────
// Body: { card_id, variant_id, state: 'none' | 'need' | 'have' } — an absolute
// state, not a toggle. The card and column must belong to the same table.
router.put('/cells', async (req, res, next) => {
  try {
    const { card_id, variant_id, state } = req.body;
    if (!Number.isInteger(card_id) || !Number.isInteger(variant_id) || !['none', 'need', 'have'].includes(state)) {
      return res.status(400).json({ error: "card_id, variant_id and state ('none', 'need' or 'have') are required" });
    }

    if (state === 'none') {
      await query('DELETE FROM topps_cells WHERE card_id = $1 AND variant_id = $2', [card_id, variant_id]);
      return res.json({ card_id, variant_id, state });
    }

    const { rowCount } = await query(`
      INSERT INTO topps_cells (card_id, variant_id, owned)
      SELECT c.id, v.id, $3
      FROM topps_cards c
      JOIN topps_variants v ON v.table_id = c.table_id
      WHERE c.id = $1 AND v.id = $2
      ON CONFLICT (card_id, variant_id) DO UPDATE SET owned = EXCLUDED.owned
    `, [card_id, variant_id, state === 'have']);
    if (rowCount === 0) return res.status(404).json({ error: 'That card and column are not in the same table' });
    res.json({ card_id, variant_id, state });
  } catch (err) {
    next(err);
  }
});

export default router;
