// utils/bulbapediaPictures.js — Find Topps card pictures on a Bulbapedia series page
//
// Bulbapedia lists each card as a number cell followed by its front and back
// pictures, in one of two layouts:
//   - main cards: a small table whose first cell is "#12" / "#CL", with the
//     front then back picture further down inside it
//   - plain rows (tin toppers, jumbos, stickers...): | E1 | front | back | name |
//   - sideways tables (Movie 2000 stickers): a "Set #" row of numbers, then a
//     "Front" row and a "Back" row with each card's pictures in its column
// One pass through the page in document order handles them all. A short
// text-only cell that is the FIRST cell of its row and looks like a card number
// starts a card; the next two pictures are its front and back. A row that is a
// heading cell followed only by card numbers sets up a sideways table, whose
// later rows hand their pictures out by column. A section heading ends the
// current card, so pictures in later sections (foil samples, packaging) are
// never taken for a back.
//
// extractPictures and matchPictures are pure (HTML in, data out) so they can be
// tested against saved pages without touching the network or the database.

const NUMBER_RE = /^#?\s*([A-Z]{0,4}[\s-]?\d{1,3}[A-Z]?|CL|NNO)$/i;   // "12", "TV3", "Snap 01", "CL"
const TARGET_WIDTH = 240;   // the hover popup shows each side 240px wide

const decode = s => s
  .replace(/&#160;|&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  .replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const textOf = html => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

function absolute(url) {
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

// Only pictures hosted by Bulbagarden are accepted.
export function isBulbagardenUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'bulbagarden.net' || u.hostname.endsWith('.bulbagarden.net'));
  } catch {
    return false;
  }
}

// From an <img> tag's src / srcset, pick the smallest version at least
// TARGET_WIDTH wide (or the biggest there is, if none are that wide).
export function pickImageUrl(imgTag) {
  const candidates = [];
  const fileWidth = parseInt(attr(imgTag, 'data-file-width') || '0', 10);
  const widthOf = url => {
    const m = url.match(/\/(\d+)px-[^/]*$/);
    return m ? parseInt(m[1], 10) : fileWidth;     // no "NNNpx-" = the original file
  };
  const src = attr(imgTag, 'src');
  if (src) candidates.push(absolute(src));
  for (const part of (attr(imgTag, 'srcset') || '').split(',')) {
    const url = part.trim().split(/\s+/)[0];
    if (url) candidates.push(absolute(url));
  }
  const usable = candidates.filter(isBulbagardenUrl).map(url => ({ url, width: widthOf(url) }));
  if (usable.length === 0) return null;
  const bigEnough = usable.filter(c => c.width >= TARGET_WIDTH).sort((a, b) => a.width - b.width);
  if (bigEnough.length > 0) return bigEnough[0].url;
  return usable.sort((a, b) => b.width - a.width)[0].url;
}

// ─── Extract ──────────────────────────────────────────────────────────────────
// Returns [{ number, section, images: [{ url, file }] }] in page order, where
// images[0] is the front and images[1] the back (when there is one).
export function extractPictures(html) {
  const start = html.search(/class="[^"]*\bmw-parser-output\b/);
  const body = start >= 0 ? html.slice(start) : html;

  const entries = [];
  // Stack of open tables (they nest). Per table: cellIndex / tdIndex within
  // the current row, whether the row began with a heading cell, the card
  // numbers seen in that row, and columnCards once it's a sideways table.
  const tables = [];
  let section = '';
  let current = null;

  // The card number in a text-only cell starting at pos, or null.
  function numberAt(pos) {
    const rest = body.slice(pos, pos + 400);
    const end = rest.search(/<\/?(td|th|tr|table|img)\b/i);
    if (end < 0 || !/^<\/(td|th)/i.test(rest.slice(end))) return null;
    const text = textOf(rest.slice(0, end));
    if (text.length === 0 || text.length > 8 || !NUMBER_RE.test(text)) return null;
    return text.replace(/^#\s*/, '');
  }

  const TOKEN_RE = /<(\/?)(table|tr|td|th|img|h2|h3)\b[^>]*>/gi;
  let m;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const top = tables[tables.length - 1];

    if (tag === 'h2' || tag === 'h3') {
      if (!closing) {
        const end = body.indexOf(`</${tag}>`, TOKEN_RE.lastIndex);
        section = textOf(body.slice(TOKEN_RE.lastIndex, end));
        current = null;
      }
    } else if (tag === 'table') {
      if (closing) tables.pop();
      else tables.push({ cellIndex: 0, tdIndex: 0, headed: false, rowNumbers: [], allNumbers: true, columnCards: null });
    } else if (tag === 'tr' && top) {
      if (!closing) {
        Object.assign(top, { cellIndex: 0, tdIndex: 0, headed: false, rowNumbers: [], allNumbers: true });
      } else if (top.headed && top.allNumbers && top.rowNumbers.length >= 2) {
        // | Set # | S1 | S2 | ... — a sideways table starts here.
        top.columnCards = top.rowNumbers.map(number => ({ number, section, images: [] }));
        entries.push(...top.columnCards);
        current = null;
      }
    } else if ((tag === 'td' || tag === 'th') && !closing) {
      const index = top ? top.cellIndex++ : 0;
      if (tag === 'th') {
        if (top && index === 0) top.headed = true;
        continue;
      }
      if (top) top.tdIndex++;
      if (top?.headed) {
        const number = numberAt(TOKEN_RE.lastIndex);
        if (number) top.rowNumbers.push(number); else top.allNumbers = false;
        continue;
      }
      if (index !== 0) continue;
      const number = numberAt(TOKEN_RE.lastIndex);
      if (!number) continue;
      current = { number, section, images: [] };
      entries.push(current);
    } else if (tag === 'img' && !closing) {
      // In a sideways table the picture belongs to its column's card.
      const target = top?.columnCards && top.headed ? top.columnCards[top.tdIndex - 1] : current;
      if (!target || target.images.length >= 2) continue;
      const url = pickImageUrl(m[0]);
      if (!url) continue;
      const file = decodeURIComponent((url.match(/\/([^/]+)$/) || [, ''])[1]).replace(/^\d+px-/, '');
      target.images.push({ url, file });
    }
  }
  return entries;
}

// ─── Match ────────────────────────────────────────────────────────────────────
// Card numbers are compared ignoring "#", case and spaces; then, if there's no
// exact hit, ignoring leading zeros in the digits ("P01" = "P1", but "00" and
// "0" stay different). A number that fits more than one card in the checklist,
// or shows up more than once on the page, is reported as ambiguous instead of
// guessed.
export const exactKey = n => String(n).toUpperCase().replace(/[#\s]/g, '');
export const looseKey = n => exactKey(n).replace(/(^|[^0-9])0+(?=\d)/g, '$1');

// cards: [{ id, number, ... }]. Returns { matches: [{ card, entry }],
// ambiguous: [number], unmatchedPage: [number], missingCards: [card] }.
export function matchPictures(entries, cards) {
  const group = (items, keyFn, get) => {
    const map = new Map();
    for (const item of items) {
      const k = keyFn(get(item));
      map.set(k, [...(map.get(k) || []), item]);
    }
    return map;
  };
  const cardsExact = group(cards, exactKey, c => c.number);
  const cardsLoose = group(cards, looseKey, c => c.number);
  const pageExact = group(entries, exactKey, e => e.number);
  const pageLoose = group(entries, looseKey, e => e.number);

  const matches = [];
  const ambiguous = new Set();
  const usedCards = new Set();
  const matchedEntries = new Set();

  for (const entry of entries) {
    if (entry.images.length === 0) continue;
    let found = cardsExact.get(exactKey(entry.number)) || [];
    let samePage = pageExact.get(exactKey(entry.number)) || [];
    if (found.length === 0) {
      found = cardsLoose.get(looseKey(entry.number)) || [];
      samePage = pageLoose.get(looseKey(entry.number)) || [];
    }
    if (found.length === 0) continue;
    if (found.length > 1 || samePage.length > 1) {
      ambiguous.add(entry.number);
      found.forEach(c => usedCards.add(c.id));
      matchedEntries.add(entry);
      continue;
    }
    matches.push({ card: found[0], entry });
    usedCards.add(found[0].id);
    matchedEntries.add(entry);
  }

  return {
    matches,
    ambiguous: [...ambiguous],
    unmatchedPage: entries.filter(e => !matchedEntries.has(e)).map(e => e.number),
    missingCards: cards.filter(c => !usedCards.has(c.id)),
  };
}
