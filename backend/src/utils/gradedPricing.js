// utils/gradedPricing.js
//
// Fetches graded card prices (PSA/BGS/CGC/ACE/TAG) from pokemon-api.com via
// RapidAPI, keyed by tcgplayer_id — the same TCGPlayer product ID already
// stored as cards.tcgtracking_id, since both APIs source from the same
// canonical TCGPlayer catalog. No name search needed.
//
// Hard rate-limited to 90 calls/day and 25 calls/minute — see rateLimiter.js.
// This is a paid-on-overage API (billing attached), so the limiter is a
// strict pre-flight check, not a best-effort throttle.

import { checkAndRecordApiCall } from './rateLimiter.js';

const RAPIDAPI_HOST = 'pokemon-tcg-api.p.rapidapi.com';
const API_NAME = 'pokemon-api-graded';

async function rapidApiFetch(path) {
  const key = process.env.POKEMON_API_RAPIDAPI_KEY;
  if (!key) throw new Error('POKEMON_API_RAPIDAPI_KEY is not set');

  // Hard rate-limit check BEFORE making the call
  await checkAndRecordApiCall(API_NAME);

  const url = `https://${RAPIDAPI_HOST}${path}`;
  const response = await fetch(url, {
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': key,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`pokemon-api.com error ${response.status}: ${body}`);
  }
  return response.json();
}

// Looks up a card directly by its TCGPlayer product ID (same value stored
// in cards.tcgtracking_id) and returns its eBay graded sales data, broken
// down by grading company -> grade -> { median_price, sample_size }.
export async function getGradedPricesByTcgPlayerId(tcgPlayerId) {
  const data = await rapidApiFetch(`/cards?tcgplayer_id=${tcgPlayerId}`);

  const results = data.data || [];
  if (results.length === 0) return null;

  const match = results[0];
  return {
    name: match.name,
    card_number: match.card_number,
    graded: match.prices?.ebay?.graded || null,
    raw_market_price: match.prices?.tcg_player?.market_price || null,
  };
}
