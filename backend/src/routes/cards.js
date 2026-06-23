// routes/cards.js
//
// Handles card-level operations:
//   PATCH  /api/cards/:id/owned          — update owned count (checkbox clicks)
//   PATCH  /api/cards/:id/reverse-owned  — update reverse holo owned count
//   PATCH  /api/cards/:id/storage        — change storage type
//   PATCH  /api/cards/:id/extra          — toggle has_extra flag
//   POST   /api/cards                    — manually add a single card to a set
//   DELETE /api/cards/:id                — remove a card
//
// Why PATCH instead of PUT?
//   PUT means "replace the entire resource with this data"
//   PATCH means "update only these specific fields"
//   Since we're changing one field at a time (just owned, just storage, etc.)
//   PATCH is semantically correct and keeps requests small.

import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// ─── RARITY HELPERS ───────────────────────────────────────────────────────────
// These match what PokéWallet returns for rarity values.
// Used to determine whether a card gets 1 checkbox or 2.

const BASIC_RARITIES = new Set([
  'Common',
  'Uncommon',
  'Rare',         // Plain Rare (no holo)
  'Rare Holo',
  'Energy',
  'Trainer',      // Some sets use this
]);

// Returns true if this rarity gets the 2-checkbox treatment (can own 2 copies)
function isCollectorRarity(rarity) {
  if (!rarity) return false;
  return !BASIC_RARITIES.has(rarity);
}

// ─── PATCH /api/cards/:id/owned ───────────────────────────────────────────────
// The core checkbox endpoint. Called whenever you click a checkbox in the UI.
//
// Request body: { owned: 0 | 1 | 2 }
//
// The frontend sends the NEW value directly (not a toggle).
// This avoids race conditions — if you click twice fast, both requests
// specify an absolute value, so the last one wins correctly.
router.patch('/:id/owned', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { owned } = req.body;

    // Validate: must be 0, 1, or 2
    if (![0, 1, 2].includes(owned)) {
      return res.status(400).json({
        error: 'owned must be 0, 1, or 2'
      });
    }

    // Fetch the card to check its rarity before allowing owned=2
    const cardResult = await query(
      'SELECT rarity FROM cards WHERE id = $1',
      [id]
    );

    if (cardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const { rarity } = cardResult.rows[0];

    // Enforce: only collector-rarity cards can have owned=2
    if (owned === 2 && !isCollectorRarity(rarity)) {
      return res.status(400).json({
        error: `Cards with rarity "${rarity}" can only be owned 0 or 1 times`
      });
    }

    const { rows } = await query(
      'UPDATE cards SET owned = $1 WHERE id = $2 RETURNING *',
      [owned, id]
    );

    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/reverse-owned ───────────────────────────────────────
// Same logic but for the reverse holo version of a card.
// Uses an "upsert" — INSERT if the row doesn't exist, UPDATE if it does.
// (Not every card has a reverse_holos row until you interact with it.)
router.patch('/:id/reverse-owned', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { owned } = req.body;

    if (![0, 1, 2].includes(owned)) {
      return res.status(400).json({ error: 'owned must be 0, 1, or 2' });
    }

    // INSERT ... ON CONFLICT DO UPDATE is PostgreSQL's upsert syntax.
    // If a row with card_id = $2 already exists, update it.
    // If not, insert a new one.
    // RETURNING * gives us back the resulting row either way.
    const { rows } = await query(`
      INSERT INTO reverse_holos (card_id, owned)
      VALUES ($2, $1)
      ON CONFLICT (card_id) DO UPDATE SET owned = EXCLUDED.owned
      RETURNING *
    `, [owned, id]);

    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/storage ─────────────────────────────────────────────
// Updates where a card is physically stored.
router.patch('/:id/storage', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { storage } = req.body;

    const valid = ['binder', 'sleeve', 'toploader', 'safe'];
    if (!valid.includes(storage)) {
      return res.status(400).json({
        error: `storage must be one of: ${valid.join(', ')}`
      });
    }

    const { rows } = await query(
      'UPDATE cards SET storage = $1 WHERE id = $2 RETURNING *',
      [storage, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/condition ──────────────────────────────────────────
// Updates the condition of a card.
router.patch('/:id/condition', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { condition } = req.body;

    const valid = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
    if (!valid.includes(condition)) {
      return res.status(400).json({
        error: `condition must be one of: ${valid.join(', ')}`
      });
    }

    const { rows } = await query(
      'UPDATE cards SET condition = $1 WHERE id = $2 RETURNING *',
      [condition, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/extra ───────────────────────────────────────────────
// Toggles the has_extra flag — marks that you're intentionally holding
// a 2nd copy (tracked separately from owned so set completion counts aren't skewed).
router.patch('/:id/extra', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { has_extra } = req.body;

    if (typeof has_extra !== 'boolean') {
      return res.status(400).json({ error: 'has_extra must be a boolean' });
    }

    const { rows } = await query(
      'UPDATE cards SET has_extra = $1 WHERE id = $2 RETURNING *',
      [has_extra, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/type ────────────────────────────────────────────────
// Manually sets a card's pokemon_type and protects it from being overwritten
// by future reimports (same pattern as date_manual for sets).
router.patch('/:id/type', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pokemon_type } = req.body;

    const { rows } = await query(
      'UPDATE cards SET pokemon_type = $1, type_manual = true WHERE id = $2 RETURNING *',
      [pokemon_type, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/move ────────────────────────────────────────────────
// Moves a card between main/alternates within its set family, or to a
// completely different set. Used by the Move Card tab in Set Tools.
router.patch('/:id/move', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { target_set_id, is_alternate } = req.body;

    const { rows } = await query(`
      UPDATE cards SET
        set_id       = COALESCE($1, set_id),
        is_alternate = COALESCE($2, is_alternate)
      WHERE id = $3
      RETURNING *
    `, [target_set_id ?? null, is_alternate ?? null, id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });

    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/cards/:id/notes ───────────────────────────────────────────────
// Updates the notes/notes_url for an alternate card.
router.patch('/:id/notes', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes, notes_url } = req.body;

    const { rows } = await query(
      'UPDATE cards SET notes = $1, notes_url = $2 WHERE id = $3 RETURNING *',
      [notes || null, notes_url || null, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/cards ──────────────────────────────────────────────────────────
// Manually add a single card to a set.
// Used for the manual entry path (sets not in the TCG API, promos, etc.)
router.post('/', async (req, res, next) => {
  try {
    const { set_id, card_number, name, pokemon_type, rarity, storage, is_alternate, notes, notes_url } = req.body;

    if (!set_id || !card_number || !name) {
      return res.status(400).json({
        error: 'set_id, card_number, and name are required'
      });
    }

    const { rows } = await query(`
      INSERT INTO cards (set_id, card_number, name, pokemon_type, rarity, storage, is_alternate, type_manual, notes, notes_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      set_id, card_number, name, pokemon_type || null, rarity || null,
      storage || 'binder', is_alternate ?? false, !!pokemon_type,
      notes || null, notes_url || null,
    ]);

    query('REFRESH MATERIALIZED VIEW CONCURRENTLY set_summary_cache').catch(err =>
      console.error('Cache refresh failed:', err.message)
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/cards/:id ────────────────────────────────────────────────────
// Removes a single card (and its reverse holo + prices via CASCADE).
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query('DELETE FROM cards WHERE id = $1', [id]);

    if (rowCount === 0) return res.status(404).json({ error: 'Card not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
