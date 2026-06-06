// jobs/priceSync.js
//
// Hybrid import using two APIs:
//   1. TCGTracking (primary)  — card list, has_reverse_holo, image_url, prices, symbol_url
//   2. PokéWallet  (secondary) — pokemon_type, stage, tcg_card_id, set metadata
//
// Import flow (per set):
//   Step 1: TCGTracking search  — find set ID and symbol URL
//   Step 2: TCGTracking cards   — full card list with reverse holo flags and images
//   Step 3: PokéWallet cards    — paginated card list for type/stage/tcg_card_id
//   Step 4: PokéWallet sets     — set metadata (release_date, set_code, language, series)
//   Step 5: Insert set into DB
//   Step 6: Insert cards merging both sources
//   Step 7: Kick off price refresh
//
// Price refresh flow (per set, 1 API call):
//   TCGTracking /sets/{id}/pricing — returns all prices keyed by TCGTracking product ID

import cron from 'node-cron';
import { query } from '../db.js';

const POKEWALLET_BASE  = 'https://api.pokewallet.io';
const TCGTRACKING_BASE = 'https://tcgtracking.com/tcgapi/v1/3';
const API_KEY = process.env.TCG_API_KEY;

// ─── POKEWALLET FETCH ─────────────────────────────────────────────────────────
async function pokewalletFetch(path) {
  if (!API_KEY) throw new Error('TCG_API_KEY is not set');

  const url = `${POKEWALLET_BASE}${path}`;
  console.log(`📡 PokéWallet API: GET ${path}`);

  const response = await fetch(url, {
    headers: { 'X-API-Key': API_KEY, 'Accept': 'application/json' },
  });

  const remaining = response.headers.get('X-RateLimit-Remaining-Day');
  const limit     = response.headers.get('X-RateLimit-Limit-Day');
  if (remaining !== null) {
    console.log(`   Rate limit: ${remaining}/${limit} daily requests remaining`);
  }

  if (response.status === 429) throw new Error('PokéWallet rate limit exceeded');
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PokéWallet API error ${response.status}: ${body}`);
  }
  return response.json();
}

// ─── TCGTRACKING FETCH ────────────────────────────────────────────────────────
async function tcgtrackingFetch(path) {
  const url = `${TCGTRACKING_BASE}${path}`;
  console.log(`🔍 TCGTracking API: GET ${path}`);

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TCGTracking API error ${response.status}: ${body}`);
  }
  return response.json();
}

// ─── DATE PARSER ─────────────────────────────────────────────────────────────
// PokéWallet returns dates like "22nd May, 2026" — convert to YYYY-MM-DD
function parsePokeWalletDate(dateStr) {
  if (!dateStr) return null;
  try {
    const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1');
    const date = new Date(cleaned);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// ─── SEARCH SETS ──────────────────────────────────────────────────────────────
// Called from POST /api/sets/search-tcg
// Uses TCGTracking search which is fast and accurate
export async function searchSets(searchQuery) {
  const data = await tcgtrackingFetch(`/search?q=${encodeURIComponent(searchQuery)}`);
  const sets = data.sets || [];

  // Normalize to the shape the frontend expects
  return sets.map(s => ({
    set_id:       String(s.id),
    name:         s.name,
    set_code:     s.abbreviation,
    card_count:   s.product_count,
    release_date: s.published_on,
    symbol_url:   s.set_symbol_url,
  }));
}

// ─── IMPORT SET CARDS ─────────────────────────────────────────────────────────
export async function importSetCards(tcgSetId) {
  // ── Step 1: TCGTracking — full card list ───────────────────────────────────
  console.log(`\n📦 Starting import for set ${tcgSetId}`);
  console.log('   Step 1: Fetching cards from TCGTracking...');

  const tcgData = await tcgtrackingFetch(`/sets/${tcgSetId}`);
  const tcgCards = (tcgData.products || []).filter(p => p.number !== null);

  console.log(`   TCGTracking: ${tcgCards.length} cards found`);

  // Build a map of card_number → TCGTracking card data
  // This lets us look up by card number when merging with PokéWallet data
  const tcgMap = new Map();
  for (const card of tcgCards) {
    tcgMap.set(card.number, card);
  }

  // Also get TCGTracking search result for symbol URL
  const searchData = await tcgtrackingFetch(`/search?q=${encodeURIComponent(tcgData.set_name)}`);
  const tcgSet = searchData.sets?.find(s => String(s.id) === String(tcgSetId));
  const symbolUrl = tcgSet?.set_symbol_url || null;

  // ── Step 2: PokéWallet — set metadata + card types/stages ─────────────────
  console.log('   Step 2: Fetching set metadata from PokéWallet...');

  let pokeSet = null;
  let pokeCardMap = new Map(); // card_number → { pokemon_type, stage, tcg_card_id }

  try {
    const allSets = await pokewalletFetch('/sets');
    const sets = Array.isArray(allSets) ? allSets : (allSets.data || []);
    pokeSet = sets.find(s => s.set_id === String(tcgSetId));

    if (pokeSet) {
      console.log(`   PokéWallet: Found set "${pokeSet.name}" (${pokeSet.set_code})`);

      // Paginate through cards to get type/stage data
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const cardsData = await pokewalletFetch(`/sets/${pokeSet.set_code}?page=${page}&limit=50`);
        const pageCards = Array.isArray(cardsData) ? cardsData : (cardsData.cards || []);

        for (const card of pageCards) {
          const num = card.card_info?.card_number || card.number || '';
          if (num) {
            pokeCardMap.set(num, {
              pokemon_type: card.card_info?.card_type || null,
              stage:        card.card_info?.stage || null,
              tcg_card_id:  card.id || null,
            });
          }
        }

        hasMore = pageCards.length === 50;
        page++;
      }
      console.log(`   PokéWallet: Got type/stage data for ${pokeCardMap.size} cards`);
    } else {
      console.log(`   PokéWallet: Set ${tcgSetId} not found — type/stage will be null`);
    }
  } catch (err) {
    console.error(`   PokéWallet fetch failed (non-fatal): ${err.message}`);
  }

  // ── Step 3: Insert set into DB ─────────────────────────────────────────────
  console.log('   Step 3: Inserting set into database...');

  const setResult = await query(`
    INSERT INTO sets (tcg_id, name, series, total_cards, release_date, logo_url, set_code, symbol_url, language)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (tcg_id) DO UPDATE SET
      name         = EXCLUDED.name,
      series       = EXCLUDED.series,
      total_cards  = EXCLUDED.total_cards,
      release_date = EXCLUDED.release_date,
      set_code     = EXCLUDED.set_code,
      symbol_url   = EXCLUDED.symbol_url,
      language     = EXCLUDED.language
    RETURNING *
  `, [
    String(tcgSetId),
    tcgData.set_name,
    pokeSet?.series || null,
    tcgCards.length,
    pokeSet ? parsePokeWalletDate(pokeSet.release_date) : (tcgSet?.published_on || null),
    null, // logo_url — manually uploaded
    tcgSet?.abbreviation || pokeSet?.set_code || null,
    symbolUrl,
    pokeSet?.language || 'eng',
  ]);

  const set = setResult.rows[0];
  console.log(`   ✅ Set "${set.name}" saved (DB id: ${set.id})`);

  // ── Step 4: Insert cards ───────────────────────────────────────────────────
  console.log('   Step 4: Inserting cards...');

  let inserted = 0;
  let skipped  = 0;

  for (const tcgCard of tcgCards) {
    const cardName = tcgCard.name;
    if (!cardName) { skipped++; continue; }

    // Look up PokéWallet data for this card number
    const pokeCard = pokeCardMap.get(tcgCard.number) || {};

    // Determine has_reverse_holo from cardtrader properties
    const hasReverseHolo = tcgCard.cardtrader?.[0]?.properties
      ?.some(p => p.name === 'pokemon_reverse') ?? null;

    const tcgCardId = pokeCard.tcg_card_id || null;

    await query(`
      INSERT INTO cards (
        set_id, tcg_card_id, tcgtracking_id, card_number, name,
        pokemon_type, rarity, has_reverse_holo, image_url, stage
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tcgtracking_id) WHERE tcgtracking_id IS NOT NULL DO UPDATE SET
        card_number      = EXCLUDED.card_number,
        name             = EXCLUDED.name,
        pokemon_type     = EXCLUDED.pokemon_type,
        rarity           = EXCLUDED.rarity,
        has_reverse_holo = EXCLUDED.has_reverse_holo,
        image_url        = EXCLUDED.image_url,
        stage            = EXCLUDED.stage,
        tcgtracking_id   = EXCLUDED.tcgtracking_id
    `, [
      set.id,
      tcgCardId,
      tcgCard.id,
      tcgCard.number,
      cardName,
      pokeCard.pokemon_type || null,
      tcgCard.rarity || null,
      hasReverseHolo,
      tcgCard.image_url || null,
      pokeCard.stage || null,
    ]);
    inserted++;
  }

  console.log(`   ✅ Inserted/updated ${inserted} cards (${skipped} skipped) for ${set.name}`);

  // ── Step 5: Kick off price refresh ────────────────────────────────────────
  refreshPricesForSet(set.id).catch(err => {
    console.error(`Initial price fetch failed for ${set.name}:`, err.message);
  });

  return set;
}

// ─── REFRESH PRICES FOR SET ───────────────────────────────────────────────────
// One API call to TCGTracking gets all prices for the whole set.
export async function refreshPricesForSet(setId) {
  // Get the set's tcg_id (= TCGTracking set ID)
  const { rows: setRows } = await query(
    'SELECT tcg_id, name FROM sets WHERE id = $1', [setId]
  );

  if (!setRows[0]?.tcg_id) {
    console.log(`   Set ${setId} has no tcg_id, skipping price refresh`);
    return;
  }

  const { tcg_id, name: setName } = setRows[0];
  console.log(`💰 Refreshing prices for: ${setName}`);

  // Get all cards in this set that have a tcgtracking_id
  const { rows: cards } = await query(`
    SELECT id, tcgtracking_id, name
    FROM cards
    WHERE set_id = $1 AND tcgtracking_id IS NOT NULL
  `, [setId]);

  if (cards.length === 0) {
    console.log(`   No TCGTracking-linked cards found for set ${setId}, skipping`);
    return;
  }

  // Fetch all prices for the set in one call
  const priceData = await tcgtrackingFetch(`/sets/${tcg_id}/pricing`);
  const prices = priceData.prices || {};

  let updated = 0;
  for (const card of cards) {
    const cardPrices = prices[String(card.tcgtracking_id)]?.tcg || {};

    const normalPrices      = cardPrices['Normal']            || {};
    const holofoilPrices    = cardPrices['Holofoil']          || {};
    const reverseHoloPrices = cardPrices['Reverse Holofoil']  || {};

    const marketPrice      = normalPrices.market      || holofoilPrices.market    || null;
    const lowPrice         = normalPrices.low         || holofoilPrices.low       || null;
    const reverseHoloPrice = reverseHoloPrices.market || null;
    const holofoilPrice    = holofoilPrices.market    || null;

    if (!marketPrice && !reverseHoloPrice) continue;

    await query(`
      INSERT INTO prices (card_id, market_price, low_price, reverse_holo_price, holofoil_price)
      VALUES ($1, $2, $3, $4, $5)
    `, [card.id, marketPrice, lowPrice, reverseHoloPrice, holofoilPrice]);

    updated++;
  }

  console.log(`   ✅ Updated prices for ${updated}/${cards.length} cards in ${setName}`);
}

// ─── SCHEDULED AUTO-REFRESH ───────────────────────────────────────────────────
export function startPriceSync() {
  cron.schedule('0 3 * * *', async () => {
    console.log('🕐 Scheduled price sync starting...');

    const { rows: sets } = await query(
      'SELECT id, name FROM sets WHERE tcg_id IS NOT NULL'
    );

    console.log(`   Refreshing prices for ${sets.length} sets`);

    for (const set of sets) {
      try {
        await refreshPricesForSet(set.id);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`   Skipping ${set.name} due to error:`, err.message);
      }
    }

    console.log('✅ Scheduled price sync complete');
  });

  console.log('⏰ Price sync scheduled for 3:00 AM daily');
}
