// utils/tcgtracking.js — Requests to the TCGTracking API (TCGplayer's data)
//
// Shared by the set import / price sync (jobs/priceSync.js) and the card
// details fill-in (utils/cardDetails.js). No key needed. The API answers with
// redirects, which fetch follows on its own.

export const TCGTRACKING_BASE = 'https://tcgtracking.com/tcgapi/v1/3';

export async function tcgtrackingFetch(path) {
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
