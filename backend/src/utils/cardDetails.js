// utils/cardDetails.js — Illustrators (and missing card types) for the cards in a set
//
// Illustrators come from two places, and TCGdex wins:
//
// TCGdex (api.tcgdex.net, free, no key) is the main source. TCGplayer's artist
// names (what TCGTracking passes on) have typos ("Kzumasa Yasukuni") and whole
// sets off by one card (Destined Rivals from #035 on); TCGdex had them right
// every time the two were checked against the printed cards.
//
// TCGTracking fills in cards TCGdex has no illustrator for (or sets TCGdex
// can't be matched to). Every card in a set's card list has an ext_data block —
// "Artist", "Card Type / HP / Stage", ... — which is already downloaded on every
// import, so reading it costs nothing extra.
//
// cards.illustrator_source records which one a name came from. TCGTracking
// never overwrites a 'tcgdex' name; TCGdex overwrites anything.
//
// Matching a set to TCGdex: TCGdex's set list (names + release dates, one
// request, cached) gives up to 3 likely sets; each is checked by fetching its
// cards and comparing card number + name with ours (or the name alone, for a
// same-size set where it's unique — reprint collections are numbered
// differently). A set is accepted when at least half of our cards match, so a
// wrong guess (similar name, other set) is thrown away. A card that can't be
// matched keeps what TCGTracking gave it.
//
// Card types: when PokéWallet left a card's type or stage empty, TCGTracking's
// "Card Type" / "Stage" fill it — never over a type set by hand (type_manual).

import { query } from '../db.js';
import { USER_AGENT } from './imageDownload.js';

const TCGDEX_GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const TCGDEX_PAUSE_MS = 500;            // between TCGdex requests for one set
const TCGDEX_SETS_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CANDIDATES = 3;
const MIN_MATCH_SHARE = 0.5;            // of our cards, for a TCGdex set to count as the same set

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── TCGTRACKING DETAILS ──────────────────────────────────────────────────────

// ext_data comes as { "Card Type / HP / Stage": "Grass / 30 / Basic", "Artist": "..." }
// in a set's card list, or as [{ name, value }] in product-detail. Combined
// keys are split so every field can be looked up on its own.
function extFields(ext) {
  const pairs = Array.isArray(ext)
    ? ext.map(e => [e?.name, e?.value])
    : Object.entries(ext || {});
  const fields = {};
  for (const [key, value] of pairs) {
    if (!key || value == null) continue;
    const keys = String(key).split(' / ');
    const values = String(value).split(' / ');
    if (keys.length === 1) fields[key] = String(value);
    else if (values.length === keys.length) keys.forEach((k, i) => { fields[k] = values[i]; });
  }
  return fields;
}

function clean(value) {
  const text = String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

// { illustrator, cardType, stage } for one TCGTracking card; any can be null.
// "Pokemon" isn't a type (TCGplayer uses it on some cards), so it's dropped.
export function readCardDetails(tcgCard) {
  const fields = extFields(tcgCard?.ext_data);
  const cardType = clean(fields['Card Type']);
  return {
    illustrator: clean(fields['Artist']),
    cardType: cardType && !/^pok[eé]mon$/i.test(cardType) ? cardType : null,
    stage: clean(fields['Stage']),
  };
}

// Saves what a set's TCGTracking card list says, matched on tcgtracking_id
// (so it also reaches cards moved to another set). Returns how many cards got
// an illustrator / type / stage. An illustrator from TCGdex is left alone.
export async function saveCardDetails(tcgCards) {
  const rows = tcgCards
    .filter(p => Number.isInteger(p?.id))
    .map(p => ({ id: p.id, ...readCardDetails(p) }))
    .filter(r => r.illustrator || r.cardType || r.stage);
  if (rows.length === 0) return { illustrators: 0, types: 0, stages: 0 };

  const ids = rows.map(r => r.id);
  const illustrators = await query(`
    UPDATE cards c SET illustrator = v.value, illustrator_source = 'tcgtracking'
    FROM unnest($1::int[], $2::text[]) AS v(tid, value)
    WHERE c.tcgtracking_id = v.tid AND v.value IS NOT NULL
      AND c.illustrator_source IS DISTINCT FROM 'tcgdex'
      AND c.illustrator IS DISTINCT FROM v.value
  `, [ids, rows.map(r => r.illustrator)]);
  const types = await query(`
    UPDATE cards c SET pokemon_type = v.value
    FROM unnest($1::int[], $2::text[]) AS v(tid, value)
    WHERE c.tcgtracking_id = v.tid AND v.value IS NOT NULL
      AND NOT c.type_manual AND COALESCE(c.pokemon_type, '') = ''
  `, [ids, rows.map(r => r.cardType)]);
  const stages = await query(`
    UPDATE cards c SET stage = v.value
    FROM unnest($1::int[], $2::text[]) AS v(tid, value)
    WHERE c.tcgtracking_id = v.tid AND v.value IS NOT NULL
      AND COALESCE(c.stage, '') = ''
  `, [ids, rows.map(r => r.stage)]);
  return { illustrators: illustrators.rowCount, types: types.rowCount, stages: stages.rowCount };
}

// ─── TCGDEX ───────────────────────────────────────────────────────────────────

// TCGdex sometimes answers "busy" (503) for a moment — wait and try again,
// twice, before giving up on that set (running the fill-in again picks it up).
const TCGDEX_RETRY_WAITS_MS = [5000, 15000];

async function tcgdexQuery(graphql) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(TCGDEX_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ query: graphql }),
      signal: AbortSignal.timeout(30000),
    });
    const busy = res.status === 429 || res.status >= 500;
    if (!busy || attempt >= TCGDEX_RETRY_WAITS_MS.length) break;
    console.log(`   TCGdex answered HTTP ${res.status} — trying again in ${TCGDEX_RETRY_WAITS_MS[attempt] / 1000}s`);
    await sleep(TCGDEX_RETRY_WAITS_MS[attempt]);
  }
  if (!res.ok) throw new Error(`TCGdex answered HTTP ${res.status}`);
  const json = await res.json();
  // A card with a broken field comes back as null next to an error — the rest is fine.
  if (!json.data) throw new Error(`TCGdex error: ${json.errors?.[0]?.message || 'no data'}`);
  return json.data;
}

let setsCache = null;   // { at, sets }

// Every printed-card set on TCGdex (TCG Pocket is a phone game — left out).
async function tcgdexSets() {
  if (setsCache && Date.now() - setsCache.at < TCGDEX_SETS_TTL_MS) return setsCache.sets;
  console.log('📚 TCGdex: loading the set list');
  const data = await tcgdexQuery('{ sets { id name releaseDate serie { name } } }');
  const sets = (data.sets || []).filter(s => s?.id && s.serie?.name !== 'Pokémon TCG Pocket');
  setsCache = { at: Date.now(), sets };
  return sets;
}

async function tcgdexCards(tcgdexSetId) {
  const prefix = `${tcgdexSetId}-`;
  const data = await tcgdexQuery(`{ cards(filters: { id: ${JSON.stringify(prefix)} }) { id localId name illustrator } }`);
  return (data.cards || []).filter(c => c?.id?.startsWith(prefix));
}

// "SV08: Surging Sparks" -> "surgingsparks"; accents, "&" and punctuation evened out.
function normName(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

// For set names on both sides: the "SV08: " code prefix goes, and "Promos",
// "Promo Cards" and "Black Star Promos" all count as the same ("XY Promos" =
// TCGdex's "XY Black Star Promos").
function setNameForMatch(name) {
  return normName(String(name || '').replace(/^[A-Za-z]{1,5}\d{0,3}(\.\d+)?:\s+/, ''))
    .replace(/blackstar/g, '')
    .replace(/promo(cards|s)?/g, 'promos');
}

// "Cacnea - 005/198" / "Charizard (Black Dot Error)" -> "cacnea" / "charizard"
function cardNameForMatch(name) {
  return normName(String(name || '')
    .replace(/\s+-\s+[A-Za-z]*\d+[A-Za-z]*(\/[A-Za-z]*\d+)?.*$/, '')
    .replace(/\(.*?\)|\[.*?\]/g, ''));
}

function namesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a));
}

// "001/191" -> "1", "TG01/TG30" -> "TG1", "SWSH001" -> "SWSH1"
function normNumber(number) {
  return String(number || '').split('/')[0].trim().toUpperCase().replace(/\d+/g, d => String(parseInt(d, 10)));
}

function daysApart(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000;
}

// TCGdex sets that could be ours, best first: similar name and / or the same release date.
function rankCandidates(ourSet, sets) {
  const ours = setNameForMatch(ourSet.name);
  const scored = [];
  for (const s of sets) {
    const theirs = setNameForMatch(s.name);
    let nameScore = 0;
    if (theirs && theirs === ours) nameScore = 3;
    else if (theirs && ours && Math.min(theirs.length, ours.length) >= 3 && (ours.includes(theirs) || theirs.includes(ours))) nameScore = 2;
    const gap = daysApart(ourSet.release_date, s.releaseDate);
    const dateScore = gap <= 7 ? 2 : gap <= 45 ? 1 : 0;
    const score = nameScore * 2 + dateScore;
    if (nameScore > 0 || dateScore === 2) scored.push({ set: s, score, lengthGap: Math.abs(theirs.length - ours.length) });
  }
  scored.sort((a, b) => b.score - a.score || a.lengthGap - b.lengthGap);
  return scored.slice(0, MAX_CANDIDATES).map(c => c.set);
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Saves TCGdex's illustrator for every card in a set it can match — over
// whatever TCGTracking gave. Answers
//   { checked, tcgdexSet, matched, cards, filled, corrected }
// checked = TCGdex was asked (not for a set with no cards, e.g. sealed only);
// tcgdexSet = the TCGdex set that matched ({ id, name }), or null;
// filled = cards that had no illustrator; corrected = cards whose name changed.
export async function applyTcgdexIllustrators(setId) {
  const none = { checked: false, tcgdexSet: null, matched: 0, cards: 0, filled: 0, corrected: 0 };
  const { rows: setRows } = await query('SELECT id, name, release_date::text AS release_date FROM sets WHERE id = $1', [setId]);
  const set = setRows[0];
  if (!set) return none;

  const { rows: cards } = await query(`
    SELECT id, card_number, name, illustrator, illustrator_source
    FROM cards WHERE set_id = $1 AND NOT is_alternate
  `, [setId]);
  if (cards.length === 0) return none;

  const ours = cards
    .map(c => ({ ...c, number: normNumber(c.card_number), match: cardNameForMatch(c.name) }))
    .filter(c => c.number || c.match);
  const minMatches = Math.min(3, ours.length);
  const ourNameCount = countBy(ours, c => c.match);

  const candidates = rankCandidates(set, await tcgdexSets());
  for (let i = 0; i < candidates.length; i++) {
    await sleep(TCGDEX_PAUSE_MS);
    const theirCards = (await tcgdexCards(candidates[i].id)).map(t => ({ ...t, match: cardNameForMatch(t.name) }));
    const byNumber = new Map();
    for (const t of theirCards) {
      const key = normNumber(t.localId);
      if (!byNumber.has(key)) byNumber.set(key, []);
      byNumber.get(key).push(t);
    }
    // Number + name first. Failing that, a name that appears only once in both
    // sets — reprint sets like Celebrations: Classic Collection keep each card's
    // original number on TCGplayer but are numbered 1-25 on TCGdex. Only when
    // the two sets are about the same size, so a small reprint collection can't
    // match the big main set it came out with (same names, other cards).
    const sameSize = Math.abs(theirCards.length - ours.length) <= Math.max(3, ours.length * 0.2);
    const theirNameCount = countBy(theirCards, t => t.match);
    const byUniqueName = new Map(sameSize
      ? theirCards.filter(t => theirNameCount.get(t.match) === 1).map(t => [t.match, t])
      : []);
    const findTheirs = c =>
      (byNumber.get(c.number) || []).find(t => namesMatch(c.match, t.match)) ||
      (ourNameCount.get(c.match) === 1 ? byUniqueName.get(c.match) : undefined);

    const matched = ours.filter(findTheirs).length;
    if (ours.length === 0 || matched < minMatches || matched / ours.length < MIN_MATCH_SHARE) continue;

    // Cards TCGdex has a name for that isn't already saved as TCGdex's.
    const updates = ours
      .map(c => ({ card: c, illustrator: clean(findTheirs(c)?.illustrator) }))
      .filter(u => u.illustrator && (u.card.illustrator !== u.illustrator || u.card.illustrator_source !== 'tcgdex'));
    if (updates.length > 0) {
      await query(`
        UPDATE cards c SET illustrator = v.illustrator, illustrator_source = 'tcgdex'
        FROM unnest($1::int[], $2::text[]) AS v(id, illustrator)
        WHERE c.id = v.id
      `, [updates.map(u => u.card.id), updates.map(u => u.illustrator)]);
    }
    const filled = updates.filter(u => !u.card.illustrator).length;
    const corrected = updates.filter(u => u.card.illustrator && u.card.illustrator !== u.illustrator).length;
    console.log(`   TCGdex: "${set.name}" = ${candidates[i].id} "${candidates[i].name}" — ${matched}/${ours.length} cards matched, ${filled} illustrators filled, ${corrected} corrected`);
    return {
      checked: true, tcgdexSet: { id: candidates[i].id, name: candidates[i].name },
      matched, cards: ours.length, filled, corrected,
    };
  }
  console.log(`   TCGdex: no matching set for "${set.name}" (${candidates.length} tried)`);
  return { ...none, checked: true, cards: ours.length };
}
