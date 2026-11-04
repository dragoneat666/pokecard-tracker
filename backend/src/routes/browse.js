// routes/browse.js — The Card Browser: pictures of every card in your sets
//
//   GET /api/browse          — 25 cards. With no filter: a random 25. With
//                              filters: oldest set first, in card number order,
//                              a page at a time (?page=2 ...)
//   GET /api/browse/options  — the values the filters can take
//
// Filters (query string, all optional, combined with AND):
//   pokemon      whole words in the card name — "Mew" finds "Mew ex", not "Mewtwo"
//                (TCGplayer's bracketed notes like "(Let's Play, Pikachu!)" don't count)
//   illustrator  part of the illustrator's name ("arita" finds Mitsuhiro Arita)
//   set          a set id
//   rarity       exact rarity
//   type         Grass, Fire, ... (Darkness also covers the older "Dark")
//   kind         pokemon | trainer | energy (worked out from the card's type and stage)
//
// Only cards with a picture are shown, and cards in a set's Alternates section
// are left out so a card never shows up twice.

import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

const PAGE_SIZE = 25;

const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'];
const TYPE_ALIASES = { Darkness: ['darkness', 'dark'] };

const KINDS = [
  { value: 'pokemon', label: 'Pokémon' },
  { value: 'trainer', label: 'Trainer' },
  { value: 'energy',  label: 'Energy' },
];

// Card kind from the mixed type / stage values the sources use ("Trainer - Supporter",
// "Basic Energy", "Stage 1", ...). NULL when there's nothing to go on.
const KIND_SQL = `
  CASE
    WHEN CONCAT_WS(' ', c.pokemon_type, c.stage) ~* 'energy' THEN 'energy'
    WHEN c.pokemon_type ~* '(trainer|supporter|item|stadium|tool|technical machine)'
      OR c.stage ~* '^(trainer|supporter|item|stadium|tool)$' THEN 'trainer'
    WHEN c.pokemon_type ~* '^(grass|fire|water|lightning|psychic|fighting|darkness|dark|metal|fairy|dragon|colorless)$'
      OR c.stage ~* '(basic|stage|vmax|vstar|mega|level|break|restored|legend|union|gx|ex)' THEN 'pokemon'
  END
`;

const SHOWABLE = `NOT c.is_alternate AND COALESCE(c.image_url, '') <> ''`;

// Same card-number order as the set page.
const NUMBER_ORDER = `
  CASE WHEN REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[0-9]', '', 'g') = '' THEN 0 ELSE 1 END,
  NULLIF(REGEXP_REPLACE(SPLIT_PART(c.card_number, '/', 1), '[^0-9]', '', 'g'), '')::BIGINT NULLS LAST,
  c.card_number, c.id
`;

// The bigger picture for the hover preview (the stored one is 200 px wide).
// Both picture hosts have larger sizes of the same file, named differently.
function largePicture(url) {
  if (/^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/\d+_200w\.jpg$/.test(url)) {
    return url.replace(/_200w\.jpg$/, '_in_1000x1000.jpg');
  }
  if (/^https:\/\/cdn\.tcgtracking\.com\/product\/\d+_200w\.jpg$/.test(url)) {
    return url.replace(/_200w\.jpg$/, '_1000w.jpg');
  }
  return url;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

// WHERE clauses + params for the filters in the query string. Unknown or empty
// values are ignored.
function readFilters(q) {
  const where = [SHOWABLE];
  const params = [];
  const add = (clause, value) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  const pokemon = String(q.pokemon || '').trim();
  if (pokemon) {
    // TCGplayer writes Nidoran♀ / ♂ as "Nidoran F", "Nidoran (F)", "Nidoran M".
    const gender = { '♀': 'F', '♂': 'M' };
    const pattern = escapeRegex(pokemon.replace(/\s*([♀♂])/g, ' $1'))
      .replace(/ ([♀♂])/g, (_, sign) => `\\s*\\(?${gender[sign]}\\M\\)?`);
    // Word boundaries only where the text starts / ends with a letter or digit.
    const start = /^[\p{L}\p{N}]/u.test(pokemon) ? '\\m' : '';
    const end = /[\p{L}\p{N}]$/u.test(pokemon) ? '\\M' : '';
    // Bracketed notes are TCGplayer's, not the card's name: "Raikou (Let's Play, Pikachu!)".
    add(`REGEXP_REPLACE(c.name, '\\([^)]*\\)|\\[[^]]*\\]', '', 'g') ~* ?`, `${start}${pattern}${end}`);
  }
  const illustrator = String(q.illustrator || '').trim();
  if (illustrator) add('c.illustrator ILIKE ?', `%${escapeLike(illustrator)}%`);

  const setId = parseInt(q.set, 10);
  if (Number.isInteger(setId) && setId > 0) add('c.set_id = ?', setId);

  const rarity = String(q.rarity || '').trim();
  if (rarity) add('c.rarity = ?', rarity);

  if (TYPES.includes(q.type)) add('LOWER(c.pokemon_type) = ANY (?)', TYPE_ALIASES[q.type] || [q.type.toLowerCase()]);

  if (KINDS.some(k => k.value === q.kind)) add(`(${KIND_SQL}) = ?`, q.kind);

  return { where: where.join(' AND '), params, filtered: params.length > 0 };
}

function toCard(row) {
  return { id: row.id, name: row.name, image_url: row.image_url, large_url: largePicture(row.image_url) };
}

// ─── GET /api/browse ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { where, params, filtered } = readFilters(req.query);

    if (!filtered) {
      const [{ rows }, { rows: count }] = await Promise.all([
        query(`SELECT c.id, c.name, c.image_url FROM cards c WHERE ${where} ORDER BY random() LIMIT ${PAGE_SIZE}`, params),
        query(`SELECT COUNT(*)::INT AS total FROM cards c WHERE ${where}`, params),
      ]);
      return res.json({ random: true, total: count[0].total, page: 1, pageSize: PAGE_SIZE, cards: rows.map(toCard) });
    }

    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 100000);
    const { rows } = await query(`
      SELECT c.id, c.name, c.image_url, COUNT(*) OVER ()::INT AS total
      FROM cards c JOIN sets s ON s.id = c.set_id
      WHERE ${where}
      ORDER BY s.release_date ASC NULLS LAST, s.id, ${NUMBER_ORDER}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `, params);

    // Past the last page there are no rows to carry the total, so count separately.
    let total = rows[0]?.total;
    if (total === undefined) {
      const { rows: count } = await query(`SELECT COUNT(*)::INT AS total FROM cards c WHERE ${where}`, params);
      total = count[0].total;
    }
    res.json({ random: false, total, page, pageSize: PAGE_SIZE, cards: rows.map(toCard) });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/browse/options ─────────────────────────────────────────────────
router.get('/options', async (_req, res, next) => {
  try {
    const [illustrators, sets, rarities] = await Promise.all([
      query(`
        SELECT c.illustrator AS name, COUNT(*)::INT AS cards
        FROM cards c WHERE ${SHOWABLE} AND COALESCE(c.illustrator, '') <> ''
        GROUP BY c.illustrator ORDER BY LOWER(c.illustrator)
      `),
      query(`
        SELECT s.id, s.name, s.release_date::text AS release_date
        FROM sets s
        WHERE EXISTS (SELECT 1 FROM cards c WHERE c.set_id = s.id AND ${SHOWABLE})
        ORDER BY s.release_date DESC NULLS LAST, s.name
      `),
      query(`
        SELECT DISTINCT c.rarity FROM cards c
        WHERE ${SHOWABLE} AND COALESCE(c.rarity, '') <> ''
        ORDER BY c.rarity
      `),
    ]);
    res.json({
      illustrators: illustrators.rows,
      sets: sets.rows,
      rarities: rarities.rows.map(r => r.rarity),
      types: TYPES,
      kinds: KINDS,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
