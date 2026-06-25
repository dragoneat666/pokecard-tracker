// utils/gradedPricing.js
//
// Fetches graded card prices (PSA/BGS/CGC) from pokemon-api.com via RapidAPI.
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

// Searches for a card by name and number, returns the first match's
// graded price data (PSA/BGS/CGC from both Cardmarket and eBay sold listings).
export async function searchGradedPrices(cardName, cardNumber) {
  const searchTerm = `${cardName} ${cardNumber}`.trim();
  const data = await rapidApiFetch(`/cards?search=${encodeURIComponent(searchTerm)}`);

  const results = data.data || data || [];
  if (results.length === 0) return null;

  const match = results[0];
  return {
    name: match.name,
    card_number: match.card_number,
    cardmarket_graded: match.prices?.cardmarket?.graded || null,
    ebay_graded: match.prices?.ebay?.graded || null,
    raw_market_price: match.prices?.tcg_player?.market_price || null,
  };
}