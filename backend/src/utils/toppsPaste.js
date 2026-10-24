// utils/toppsPaste.js — Add many rows to a Topps table from pasted spreadsheet cells
//
// Copy cells in Excel and paste them: one line per card, laid out as
//   number | name | (optional) one cell per column
// Cells use the old sheet convention: 0 = that printing doesn't exist for the
// card, blank = need it, anything else = have it.
//
// If the first line is a heading row (a "#"/"Number" or "Name" heading), the
// column headings are matched to the table's existing columns by name (any
// case) and unmatched ones are created, so you can paste a whole sheet in one
// go. Without headings, the cells line up with the table's columns in order.
//
// applyPaste only needs something with a query(sql, params) method, so the
// route passes a transaction client and the tests pass an in-memory Postgres.

import { parseCsvRows } from './parseCsv.js';

const MAX_ROWS = 2000;
const HEADER_FIRST = new Set(['#', 'number', 'no', 'no.', 'card number', 'card no', 'card no.', 'card #', 'card']);
const HEADER_SECOND = new Set(['name', 'card name']);
const norm = s => (s || '').trim().toLowerCase();

export class PasteError extends Error {}

// Excel copies tab-separated text; a pasted CSV uses commas.
export function parsePasted(text) {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = parseCsvRows(text, delimiter)
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c !== ''));
  if (rows.length === 0) return { header: null, rows: [] };

  const first = rows[0];
  const isHeader = HEADER_FIRST.has(norm(first[0])) || HEADER_SECOND.has(norm(first[1]));
  return isHeader
    ? { header: first.slice(2), rows: rows.slice(1) }
    : { header: null, rows };
}

export async function applyPaste(client, tableId, { header, rows }) {
  if (rows.length > MAX_ROWS) {
    throw new PasteError(`That's ${rows.length} rows — paste at most ${MAX_ROWS} at a time`);
  }

  let { rows: variants } = await client.query(
    'SELECT id, name FROM topps_variants WHERE table_id = $1 ORDER BY sort_order, id', [tableId]
  );

  // A brand-new table still has its untouched starter column ("Owned"). When
  // you paste a sheet with its own headings into it, that placeholder would
  // only get in the way, so drop it.
  if (header && header.some(h => h) && variants.length === 1 && norm(variants[0].name) === 'owned'
      && !header.some(h => norm(h) === 'owned')) {
    const { rows: cards } = await client.query('SELECT 1 FROM topps_cards WHERE table_id = $1 LIMIT 1', [tableId]);
    if (cards.length === 0) {
      await client.query('DELETE FROM topps_variants WHERE id = $1', [variants[0].id]);
      variants = [];
    }
  }

  const byName = new Map(variants.map(v => [norm(v.name), v.id]));
  const allVariantIds = variants.map(v => v.id);
  const columnFor = new Map();            // pasted cell position -> column id
  let columnsCreated = 0;

  if (header) {
    const seen = new Set();
    for (let i = 0; i < header.length; i++) {
      const name = header[i].slice(0, 120);
      if (!name) continue;
      if (seen.has(norm(name))) throw new PasteError(`The column "${name}" appears twice in the heading row`);
      seen.add(norm(name));

      let variantId = byName.get(norm(name));
      if (!variantId) {
        // New column; rows already in the table get a "need" cell in it.
        const { rows: [created] } = await client.query(`
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
        `, [tableId, name]);
        variantId = created.id;
        byName.set(norm(name), variantId);
        allVariantIds.push(variantId);
        columnsCreated++;
      }
      columnFor.set(i + 2, variantId);
    }
  } else {
    variants.forEach((v, k) => columnFor.set(k + 2, v.id));
  }

  // Work out which rows to add: both number and name, and a number not already used.
  const { rows: existing } = await client.query('SELECT number FROM topps_cards WHERE table_id = $1', [tableId]);
  const taken = new Set(existing.map(r => r.number));
  const skipped = [];
  const fresh = [];
  rows.forEach((cells, index) => {
    const line = index + 1 + (header ? 1 : 0);
    const number = (cells[0] || '').slice(0, 40);
    const name = (cells[1] || '').slice(0, 200);
    if (!number || !name) { skipped.push({ line, number, reason: 'needs both a number and a name' }); return; }
    if (taken.has(number)) { skipped.push({ line, number, reason: 'a card with this number is already in the table' }); return; }
    taken.add(number);
    fresh.push({ number, name, cells });
  });
  if (fresh.length === 0) return { added: 0, columns_created: columnsCreated, skipped };

  const { rows: [{ base }] } = await client.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS base FROM topps_cards WHERE table_id = $1', [tableId]
  );
  const { rows: inserted } = await client.query(`
    INSERT INTO topps_cards (table_id, number, name, sort_order)
    SELECT $1::int, u.n, u.nm, $4::int + u.ord - 1
    FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS u(n, nm, ord)
    RETURNING id, number
  `, [tableId, fresh.map(f => f.number), fresh.map(f => f.name), base]);
  const idByNumber = new Map(inserted.map(r => [r.number, r.id]));

  // One cell per column the card has: pasted columns follow their cell
  // (0 = doesn't exist, blank = need, else have); any other column is "need".
  const cardIds = [];
  const variantIds = [];
  const owned = [];
  for (const card of fresh) {
    const cardId = idByNumber.get(card.number);
    const pasted = new Map();
    for (const [position, variantId] of columnFor) pasted.set(variantId, (card.cells[position] ?? '').trim());
    for (const variantId of allVariantIds) {
      const token = pasted.has(variantId) ? pasted.get(variantId) : '';
      if (token === '0') continue;
      cardIds.push(cardId);
      variantIds.push(variantId);
      owned.push(token !== '');
    }
  }
  if (cardIds.length > 0) {
    await client.query(
      'INSERT INTO topps_cells (card_id, variant_id, owned) SELECT * FROM unnest($1::int[], $2::int[], $3::boolean[])',
      [cardIds, variantIds, owned]
    );
  }

  return { added: fresh.length, columns_created: columnsCreated, skipped };
}
