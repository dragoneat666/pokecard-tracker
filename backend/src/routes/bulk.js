// routes/bulk.js
// Bulk Tracker — history of TCGPlayer "My Pricing" CSV exports. Completely
// separate from the card collection.
//   POST /api/bulk/import    — upload one or more export CSVs (field "files")
//   GET  /api/bulk/listings  — everything currently in stock, with how long
//                              it has been listed, plus the imported files
//
// Each export is stored as a snapshot dated from its filename
// (e.g. TCGplayer__MyPricing_20261019_011915.csv). Only Pokemon rows are kept,
// including quantity 0, so comparing snapshots shows when something started
// being listed or stopped (sold or pulled).

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import pool, { query } from '../db.js';
import { parseCsvObjects } from '../utils/parseCsv.js';

const router = Router();
const upload = multer({ dest: '/tmp/pokecard-bulk/' });

const REQUIRED_COLUMNS = ['TCGplayer Id', 'Product Line', 'Product Name', 'Total Quantity', 'TCG Marketplace Price'];
const BATCH_SIZE = 2000;

function parsePrice(value) {
  if (value === undefined || value === '') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

// "..._20261019_011915.csv" -> "2026-10-19 01:19:15"
function snapshotTimeFromFilename(filename) {
  const m = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const stamp = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  if (Number.isNaN(new Date(stamp.replace(' ', 'T')).getTime())) return null;
  return stamp;
}

async function importFile(file) {
  const snapshotAt = snapshotTimeFromFilename(file.originalname);
  if (!snapshotAt) {
    throw new Error('No date found in the filename (expected something like ..._20261019_011915.csv)');
  }

  const records = parseCsvObjects(fs.readFileSync(file.path, 'utf8'));
  if (records.length === 0) throw new Error('File has no data rows');
  const missing = REQUIRED_COLUMNS.filter(col => !(col in records[0]));
  if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(', ')}`);

  // Keyed by TCGplayer Id so a repeated id can't trip the batch upsert.
  const products = new Map();
  for (const r of records) {
    if (r['Product Line'] !== 'Pokemon') continue;
    const id = parseInt(r['TCGplayer Id'], 10);
    if (!id) continue;
    products.set(id, {
      id,
      set_name:     r['Set Name'] || null,
      product_name: r['Product Name'] || '(unnamed)',
      number:       r['Number'] || null,
      rarity:       r['Rarity'] || null,
      condition:    r['Condition'] || null,
      quantity:     parseInt(r['Total Quantity'], 10) || 0,
      listed_price: parsePrice(r['TCG Marketplace Price']),
      market_price: parsePrice(r['TCG Market Price']),
      low_price:    parsePrice(r['TCG Low Price']),
    });
  }
  const items = [...products.values()];
  if (items.length === 0) throw new Error('No Pokemon rows found in this file');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-importing a file with the same timestamp replaces that snapshot.
    const snap = await client.query(`
      INSERT INTO bulk_snapshots (snapshot_at, source_filename, row_count)
      VALUES ($1, $2, $3)
      ON CONFLICT (snapshot_at) DO UPDATE SET
        source_filename = EXCLUDED.source_filename,
        row_count       = EXCLUDED.row_count
      RETURNING id, (xmax = 0) AS inserted
    `, [snapshotAt, file.originalname, items.length]);
    const snapshotId = snap.rows[0].id;
    const replaced = !snap.rows[0].inserted;
    if (replaced) {
      await client.query('DELETE FROM bulk_listing_rows WHERE snapshot_id = $1', [snapshotId]);
    }

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      await client.query(`
        INSERT INTO bulk_products (tcgplayer_id, set_name, product_name, number, rarity, condition)
        SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
        ON CONFLICT (tcgplayer_id) DO UPDATE SET
          set_name     = EXCLUDED.set_name,
          product_name = EXCLUDED.product_name,
          number       = EXCLUDED.number,
          rarity       = EXCLUDED.rarity,
          condition    = EXCLUDED.condition
      `, [
        batch.map(b => b.id), batch.map(b => b.set_name), batch.map(b => b.product_name),
        batch.map(b => b.number), batch.map(b => b.rarity), batch.map(b => b.condition),
      ]);

      await client.query(`
        INSERT INTO bulk_listing_rows (snapshot_id, tcgplayer_id, quantity, listed_price, market_price, low_price)
        SELECT $1::int, * FROM unnest($2::int[], $3::int[], $4::numeric[], $5::numeric[], $6::numeric[])
      `, [
        snapshotId, batch.map(b => b.id), batch.map(b => b.quantity),
        batch.map(b => b.listed_price), batch.map(b => b.market_price), batch.map(b => b.low_price),
      ]);
    }

    await client.query('COMMIT');
    return {
      filename: file.originalname,
      ok: true,
      snapshot_at: snapshotAt,
      rows: items.length,
      in_stock: items.filter(b => b.quantity > 0).length,
      replaced,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── POST /api/bulk/import ────────────────────────────────────────────────────
// A bad file doesn't stop the others; each file gets its own result entry.
router.post('/import', upload.array('files'), async (req, res, next) => {
  const files = req.files || [];
  try {
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];
    for (const file of files) {
      try {
        results.push(await importFile(file));
      } catch (err) {
        results.push({ filename: file.originalname, ok: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (err) {
    next(err);
  } finally {
    for (const file of files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }
});

// ─── GET /api/bulk/listings ───────────────────────────────────────────────────
// Everything with quantity > 0 in the most recent snapshot. listed_since is
// the first snapshot of the current unbroken run of stock: it walks back to
// the latest earlier snapshot where the product had no stock (quantity 0 or
// absent) and takes the snapshot right after that. With no such break it's the
// earliest imported snapshot, so it means "at least since".
router.get('/listings', async (_req, res, next) => {
  try {
    const { rows: snapshots } = await query(`
      SELECT id, source_filename, row_count,
             to_char(snapshot_at, 'YYYY-MM-DD HH24:MI') AS snapshot_at
      FROM bulk_snapshots
      ORDER BY bulk_snapshots.snapshot_at DESC
    `);

    const { rows: listings } = await query(`
      WITH latest AS (
        SELECT id, snapshot_at FROM bulk_snapshots ORDER BY snapshot_at DESC LIMIT 1
      )
      SELECT
        p.tcgplayer_id, p.set_name, p.product_name, p.number, p.rarity, p.condition,
        r.quantity, r.listed_price, r.market_price, r.low_price,
        to_char(since.listed_since, 'YYYY-MM-DD') AS listed_since,
        (latest.snapshot_at::date - since.listed_since::date) AS days_listed
      FROM latest
      JOIN bulk_listing_rows r ON r.snapshot_id = latest.id AND r.quantity > 0
      JOIN bulk_products p ON p.tcgplayer_id = r.tcgplayer_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          (SELECT MIN(s.snapshot_at) FROM bulk_snapshots s
           WHERE s.snapshot_at > COALESCE(
             (SELECT MAX(b.snapshot_at) FROM bulk_snapshots b
              WHERE b.snapshot_at < latest.snapshot_at
                AND NOT EXISTS (
                  SELECT 1 FROM bulk_listing_rows x
                  WHERE x.snapshot_id = b.id AND x.tcgplayer_id = r.tcgplayer_id AND x.quantity > 0
                )),
             '-infinity'::timestamp)),
          latest.snapshot_at
        ) AS listed_since
      ) since
      ORDER BY days_listed DESC, p.set_name, p.product_name
    `);

    res.json({ snapshots, listings });
  } catch (err) {
    next(err);
  }
});

export default router;
