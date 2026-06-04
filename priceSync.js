// jobs/priceSync.js
//
// This file does three things:
//   1. Provides searchSets()         — search PokéWallet for TCG sets by name
//   2. Provides importSetCards()     — pull a full set's card list into our DB
//   3. Provides refreshPricesForSet() — fetch fresh prices for a set's cards
//   4. Provides startPriceSync()     — schedules the 24hr auto-refresh
//
// PokéWallet API base URL: https://api.pokewallet.io
// Auth: X-API-Key header

import cron from 'node-cron';
import { query } from '../db.js';

const POKEWALLET_BASE = 'https://api.pokewallet.io';
const API_KEY = process.env.TCG_API_KEY;

// ─── API HELPER ───────────────────────────────────────────────────────────────
// A thin wrapper around fetch() that adds auth headers and handles errors.
// Every PokéWallet call goes through here.
async function pokewalletFetch(path) {
  if (!API_KEY) {
    throw new Error('TCG_API_KEY is not set in environment variables');
  }

  const url = `${POKEWALLET_BASE}${path}`;
  console.log(`📡 PokéWallet API: GET ${path}`);

  const response = await fetch(url, {
    headers: {
      'X-API-Key': API_KEY,
      'Accept': 'application/json',
    },
  });

  // Log rate limit headers so you can monitor usage in Dozzle
  const remaining = response.headers.get('X-RateLimit-Remaining-Day');
  const limit     = response.headers.get('X-RateLimit-Limit-Day');
  if (remaining !== null) {
    console.log(`   Rate limit: ${remaining}/${limit} daily requests remaining`);
  }

  if (response.status === 429) {
    throw new Error('PokéWallet rate limit exceeded — try again later');
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PokéWallet API error ${response.status}: ${body}`);
  }

  return response.json();
}

// ─── SEARCH SETS ──────────────────────────────────────────────────────────────
// Called from POST /api/sets/search-tcg
// Returns a list of sets matching the search term from PokéWallet.
export async function searchSets(searchQuery) {
  // PokéWallet's /sets endpoint returns all sets; we filter client-side
  // since their API doesn't have a search param for sets yet.
  const data = await pokewalletFetch('/sets');

  // data is expected to be an array of set objects
  const sets = Array.isArray(data) ? data : (data.data || data.sets || []);

  const q = searchQuery.toLowerCase();
  return sets.filter(s =>
    s.name?.toLowerCase().includes(q) ||
    s.series?.toLowerCase().includes(q) ||
    s.set_code?.toLowerCase().includes(q)
  ).slice(0, 20); // Return max 20 results
}

// ─── IMPORT SET CARDS ─────────────────────────────────────────────────────────
// Called from POST /api/sets when a tcg_id is provided.
// Fetches the full card list for a set and inserts everything into our DB.
export async function importSetCards(tcgSetId) {
  // Step 1: Fetch set metadata — PokéWallet uses set_id as the identifier
  const allSets = await pokewalletFetch(`/sets`);
  const sets = Array.isArray(allSets) ? allSets : (allSets.data || []);
  const setData = sets.find(s => s.set_id === tcgSetId);

  if (!setData) {
    throw new Error(`Set with set_id "${tcgSetId}" not found in PokéWallet`);
  }

  // Step 2: Insert (or update) the set in our DB
  // ON CONFLICT (tcg_id) DO UPDATE means if you try to import the same
  // set twice, it updates the metadata instead of erroring.
  const setResult = await query(`
    INSERT INTO sets (tcg_id, name, series, total_cards, release_date, logo_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tcg_id) DO UPDATE SET
      name         = EXCLUDED.name,
      series       = EXCLUDED.series,
      total_cards  = EXCLUDED.total_cards,
      release_date = EXCLUDED.release_date,
      logo_url     = EXCLUDED.logo_url
    RETURNING *
  `, [
    tcgSetId,
    setData.name,
    setData.series || null,
    setData.card_count || null,
    setData.release_date || null,
    setData.logo_url || null,
  ]);

  const set = setResult.rows[0];
  console.log(`📦 Importing set: ${set.name} (${tcgSetId})`);

  // Step 3: Fetch all cards for this set
  const cardsData = await pokewalletFetch(`/sets/${tcgSetId}/cards`);
  const cards = Array.isArray(cardsData) ? cardsData : (cardsData.data || cardsData.cards || []);

  console.log(`   Found ${cards.length} cards`);

  // Step 4: Insert each card
  // We do this in a loop rather than one big INSERT for readability.
  // For 200 cards this is fast enough — Postgres handles it fine.
  let inserted = 0;
  for (const card of cards) {
    await query(`
      INSERT INTO cards (set_id, tcg_card_id, card_number, name, pokemon_type, rarity)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tcg_card_id) DO UPDATE SET
        card_number  = EXCLUDED.card_number,
        name         = EXCLUDED.name,
        pokemon_type = EXCLUDED.pokemon_type,
        rarity       = EXCLUDED.rarity
    `, [
      set.id,
      card.id || card.tcg_id || null,
      card.number || card.card_number || '',
      card.name,
      // PokéWallet returns types as an array e.g. ["Fire"] — we store as string
      Array.isArray(card.types) ? card.types[0] : (card.type || null),
      card.rarity || null,
    ]);
    inserted++;
  }

  console.log(`   ✅ Inserted/updated ${inserted} cards for ${set.name}`);

  // Step 5: Kick off an initial price fetch for the new set
  // We don't await this — let it run in the background
  refreshPricesForSet(set.id).catch(err => {
    console.error(`Initial price fetch failed for ${set.name}:`, err.message);
  });

  return set;
}

// ─── REFRESH PRICES FOR SET ───────────────────────────────────────────────────
// Fetches current prices for all cards in a set and inserts new price rows.
// Called by: the 24hr scheduler, the manual refresh button, and after import.
export async function refreshPricesForSet(setId) {
  // Get all cards in this set that have a tcg_card_id (needed to query PokéWallet)
  const { rows: cards } = await query(`
    SELECT id, tcg_card_id, name
    FROM cards
    WHERE set_id = $1 AND tcg_card_id IS NOT NULL
  `, [setId]);

  if (cards.length === 0) {
    console.log(`   No TCG-linked cards found for set ${setId}, skipping price refresh`);
    return;
  }

  // Get the set's tcg_id so we can use PokéWallet's per-set price endpoint
  const { rows: setRows } = await query('SELECT tcg_id, name FROM sets WHERE id = $1', [setId]);
  if (!setRows[0]?.tcg_id) {
    console.log(`   Set ${setId} has no tcg_id, skipping price refresh`);
    return;
  }

  const { tcg_id, name: setName } = setRows[0];
  console.log(`💰 Refreshing prices for: ${setName}`);

  try {
    // PokéWallet's /prices/:setCode endpoint returns prices for the whole set
    // in one request — much more efficient than one request per card.
    const priceData = await pokewalletFetch(`/prices/${tcg_id}`);
    const prices = Array.isArray(priceData) ? priceData : (priceData.data || priceData.prices || []);

    // Build a lookup map: tcg_card_id → price data
    // This lets us match prices to our cards in O(1) instead of O(n²)
    const priceMap = new Map();
    for (const p of prices) {
      const cardId = p.id || p.card_id || p.tcg_id;
      if (cardId) priceMap.set(cardId, p);
    }

    // Insert price rows for each of our cards
    let updated = 0;
    for (const card of cards) {
      const priceEntry = priceMap.get(card.tcg_card_id);
      if (!priceEntry) continue;

      // Extract prices — PokéWallet returns TCGPlayer and CardMarket data
      // We prioritize TCGPlayer (USD) market price
      const marketPrice      = extractPrice(priceEntry, 'Normal',        'market') ||
                               extractPrice(priceEntry, 'Holofoil',      'market');
      const lowPrice         = extractPrice(priceEntry, 'Normal',        'low') ||
                               extractPrice(priceEntry, 'Holofoil',      'low');
      const reverseHoloPrice = extractPrice(priceEntry, 'Reverse Holo',  'market');
      const holofoilPrice    = extractPrice(priceEntry, 'Holofoil',      'market');

      await query(`
        INSERT INTO prices (card_id, market_price, low_price, reverse_holo_price, holofoil_price)
        VALUES ($1, $2, $3, $4, $5)
      `, [card.id, marketPrice, lowPrice, reverseHoloPrice, holofoilPrice]);

      updated++;
    }

    console.log(`   ✅ Updated prices for ${updated}/${cards.length} cards in ${setName}`);
  } catch (err) {
    console.error(`   ❌ Price refresh failed for ${setName}:`, err.message);
    throw err;
  }
}

// Helper to dig into PokéWallet's nested price structure.
// Their API returns prices as an array of variants, each with a sub_type_name.
// e.g. [{ sub_type_name: "Normal", market: 1.25, low: 0.99 }, ...]
function extractPrice(priceEntry, subTypeName, priceField) {
  // Handle flat structure
  if (priceEntry[priceField] !== undefined && !priceEntry.prices) {
    return parseFloat(priceEntry[priceField]) || null;
  }

  // Handle nested prices array
  const variants = priceEntry.prices || priceEntry.tcgplayer?.prices || [];
  if (Array.isArray(variants)) {
    const variant = variants.find(v =>
      v.sub_type_name === subTypeName ||
      v.name === subTypeName ||
      v.type === subTypeName
    );
    if (variant) return parseFloat(variant[priceField]) || null;
  }

  return null;
}

// ─── SCHEDULED AUTO-REFRESH ───────────────────────────────────────────────────
// Runs at 3:00 AM every day and refreshes prices for all sets in the DB.
// 3 AM is a good time — low usage, prices have settled from the trading day.
export function startPriceSync() {
  // Cron syntax: minute hour day-of-month month day-of-week
  // '0 3 * * *' = "at minute 0 of hour 3, every day"
  cron.schedule('0 3 * * *', async () => {
    console.log('🕐 Scheduled price sync starting...');

    const { rows: sets } = await query(
      'SELECT id, name FROM sets WHERE tcg_id IS NOT NULL'
    );

    console.log(`   Refreshing prices for ${sets.length} sets`);

    // Refresh sets one at a time to avoid hammering the API
    for (const set of sets) {
      try {
        await refreshPricesForSet(set.id);
        // Small delay between sets to be a good API citizen
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error(`   Skipping ${set.name} due to error:`, err.message);
      }
    }

    console.log('✅ Scheduled price sync complete');
  });

  console.log('⏰ Price sync scheduled for 3:00 AM daily');
}
