// routes/import.js
//
// Handles collection data import from CSV:
//   POST /api/import/collection — parse CSV, update owned/reverse_owned for matched cards

import { Router } from 'express';
import { query }  from '../db.js';
import multer     from 'multer';
import fs         from 'fs';

const router = Router();
const upload = multer({ dest: '/tmp/pokecard-import/' });

// ─── POST /api/import/collection ─────────────────────────────────────────────
// Accepts a CSV with columns: set_name, card_number, card_name, regular_owned, reverse_holo_owned
// Blanks and 0s are skipped. 1 or 2 triggers an update.
// Returns a log of what was updated, skipped, and why.
router.post('/collection', upload.single('file'), async (req, res, next) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read and parse the CSV
    const raw = fs.readFileSync(tempPath, 'utf8');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV is empty or has no data rows' });
    }

    // Parse header row — normalize to lowercase with no spaces
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const requiredCols = ['set_name', 'card_number', 'regular_owned', 'reverse_holo_owned'];
    const missing = requiredCols.filter(col => !headers.includes(col));
    if (missing.length > 0) {
      return res.status(400).json({ error: `CSV missing required columns: ${missing.join(', ')}` });
    }

    // Parse data rows into objects
    const rows = lines.slice(1).map(line => {
      // Handle quoted fields with commas inside
      const cols = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || line.split(',');
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (cols[i] || '').replace(/^"|"$/g, '').trim();
      });
      return obj;
    }).filter(r => r.set_name && r.card_number);

    // Load all sets into a map for fast lookup: name → id
    const { rows: sets } = await query('SELECT id, name FROM sets');
    const setMap = new Map(sets.map(s => [s.name.toLowerCase(), s.id]));

    const log = {
      updated:  [],
      skipped:  [],
      errors:   [],
    };

    for (const row of rows) {
      const setId = setMap.get(row.set_name.toLowerCase());
      if (!setId) {
        log.errors.push({ row: `${row.set_name} / ${row.card_number}`, reason: 'Set not found in DB' });
        continue;
      }

      // Parse owned values — blank or 0 = skip
      const regularOwned = parseInt(row.regular_owned) || 0;
      const reverseOwned = parseInt(row.reverse_holo_owned) || 0;

      if (regularOwned === 0 && reverseOwned === 0) {
        log.skipped.push(`${row.set_name} / ${row.card_number} — both values are 0 or blank`);
        continue;
      }

      // Find the card by set_id + card_number
      const { rows: cards } = await query(
        'SELECT id FROM cards WHERE set_id = $1 AND card_number = $2',
        [setId, row.card_number]
      );

      if (cards.length === 0) {
        log.errors.push({ row: `${row.set_name} / ${row.card_number}`, reason: 'Card not found in set' });
        continue;
      }

      const cardId = cards[0].id;

      // Update regular owned if > 0
      if (regularOwned > 0) {
        const clampedOwned = Math.min(regularOwned, 2);
        await query('UPDATE cards SET owned = $1 WHERE id = $2', [clampedOwned, cardId]);
      }

      // Update reverse holo owned if > 0
      if (reverseOwned > 0) {
        const clampedReverse = Math.min(reverseOwned, 2);
        await query(`
          INSERT INTO reverse_holos (card_id, owned)
          VALUES ($1, $2)
          ON CONFLICT (card_id) DO UPDATE SET owned = EXCLUDED.owned
        `, [cardId, clampedReverse]);
      }

      log.updated.push(`${row.set_name} / ${row.card_number} — regular: ${regularOwned}, reverse: ${reverseOwned}`);
    }

    // Refresh materialized view cache
    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );

    // Clean up temp file
    fs.unlinkSync(tempPath);

    res.json({
      success: true,
      summary: {
        total:   rows.length,
        updated: log.updated.length,
        skipped: log.skipped.length,
        errors:  log.errors.length,
      },
      log,
    });
  } catch (err) {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    next(err);
  }
});

export default router;