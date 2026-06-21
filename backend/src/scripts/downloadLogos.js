// scripts/downloadLogos.js
//
// One-time backfill script: downloads any remaining remote logo_url and
// symbol_url images and saves them locally to /app/logos.
// Updates the DB so both fields point to our own server instead of the remote URL.
//
// Run once via: docker exec pokecard_backend node src/scripts/downloadLogos.js

import { query } from '../db.js';
import { downloadAndLocalizeImage } from '../utils/imageDownload.js';

const BASE_URL = process.env.BACKEND_PUBLIC_URL || 'http://100.92.56.206:14001';

async function main() {
  const { rows: sets } = await query(`
    SELECT id, name, logo_url, symbol_url FROM sets
    WHERE (logo_url IS NOT NULL AND logo_url NOT LIKE '${BASE_URL}%')
       OR (symbol_url IS NOT NULL AND symbol_url NOT LIKE '${BASE_URL}%')
  `);

  console.log(`Found ${sets.length} sets with remote image URLs to download.\n`);

  let success = 0;
  let failed  = 0;

  for (const set of sets) {
    try {
      let newLogoUrl = set.logo_url;
      let newSymbolUrl = set.symbol_url;

      if (set.logo_url && !set.logo_url.startsWith(BASE_URL)) {
        newLogoUrl = await downloadAndLocalizeImage(set.logo_url, set.id, 'logo');
      }
      if (set.symbol_url && !set.symbol_url.startsWith(BASE_URL)) {
        newSymbolUrl = await downloadAndLocalizeImage(set.symbol_url, set.id, 'symbol');
      }

      if (newLogoUrl !== set.logo_url || newSymbolUrl !== set.symbol_url) {
        await query('UPDATE sets SET logo_url = $1, symbol_url = $2 WHERE id = $3', [newLogoUrl, newSymbolUrl, set.id]);
        console.log(`✅ ${set.name}`);
        success++;
      }
    } catch (err) {
      console.log(`❌ ${set.name} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});