// utils/bulbapediaCoins.js — Read the coin list from a Bulbapedia coin page
//
// Bulbapedia's "Coin (TCG)/Generations ..." pages list every coin as its own
// small box (a "roundy" table): the coin's picture, then Release date, Region
// and Release (the product it came in) rows, then a Description row. The boxes
// sit under one heading per generation ("Generation I"...), in release order.
//
// Coins have no names on the page, so one is made from the picture's file
// name: "Wizards_Silver_Chansey_Coin.png" -> "Silver Chansey" (the first part
// is a product code).
//
// extractCoins is pure (HTML in, data out) so it can be tested against a saved
// page without touching the network or the database.

import { pickImageUrl, textOf } from './bulbapediaPictures.js';

// "Wizards_Silver_Chansey_Coin.png" -> "Silver Chansey",
// "VS_Alto_Mare_LatiasLatios_Coin.png" -> "Alto Mare Latias Latios".
export function coinName(file) {
  const words = (file || '').replace(/\.[a-z]+$/i, '').split('_').filter(Boolean);
  if (words.length > 0 && /^coin$/i.test(words[words.length - 1])) words.pop();
  if (words.length > 2) words.shift();
  return words.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// The original file name behind a picture URL, thumbnail or not:
// ".../thumb/c/cb/SP_Silver_Chansey_Coin.png/120px-SP_Silver_Chansey_Coin.png" -> "SP_Silver_Chansey_Coin.png"
function fileOf(url) {
  const parts = url.split('/');
  const last = parts[parts.length - 1];
  const file = /^\d+px-/.test(last) ? parts[parts.length - 2] : last;
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
}

const cellText = html => textOf(html.replace(/<br\s*\/?>/gi, ' / '));

// Returns [{ generation, region, releasedIn, releaseDate, description, imageUrl,
// file, name, key }] in page order. key identifies the entry on later imports:
// boxes that look identical (same region, product, date and picture) get #2, #3.
export function extractCoins(html) {
  const start = html.search(/class="[^"]*\bmw-parser-output\b/);
  const body = start >= 0 ? html.slice(start) : html;
  const coins = [];
  const seen = new Map();
  let generation = null;

  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>|<table\b[^>]*\bclass="roundy"[^>]*>([\s\S]*?)<\/table>/gi;
  for (const m of body.matchAll(re)) {
    if (m[1]) {
      generation = textOf(m[2]).replace(/\[edit\]/gi, '').trim();
      continue;
    }
    const box = m[3];
    if (!generation || !/<b>\s*Release date\s*<\/b>/i.test(box)) continue;

    const field = label => {
      const f = box.match(new RegExp(`<b>\\s*${label}\\s*</b>\\s*</t[dh]>\\s*<t[dh][^>]*>([\\s\\S]*?)</t[dh]>`, 'i'));
      return f ? cellText(f[1]) : '';
    };
    const desc = box.match(/<b>\s*Description:?\s*<\/b>([\s\S]*?)<\/t[dh]>/i);
    const img = box.match(/<img\b[^>]*>/i);
    const imageUrl = img ? pickImageUrl(img[0]) : null;
    const file = imageUrl ? fileOf(imageUrl) : '';

    const coin = {
      generation,
      region: field('Region') || 'Unknown',
      releasedIn: field('Release'),
      releaseDate: field('Release date'),
      description: desc ? cellText(desc[1]) : '',
      imageUrl,
      file,
      name: coinName(file) || 'Coin',
    };
    const base = [coin.region, coin.releasedIn, coin.releaseDate, file].join('|');
    const n = (seen.get(`${generation}|${base}`) || 0) + 1;
    seen.set(`${generation}|${base}`, n);
    coin.key = n > 1 ? `${base}#${n}` : base;
    coins.push(coin);
  }
  return coins;
}
