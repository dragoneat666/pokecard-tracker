// scripts/downloadLogos.js
//
// One-time backfill script: downloads every set's logo_url image from its
// remote source (Bulbapedia/Fandom) and saves it locally to /app/logos.
// Updates the DB so logo_url points to our own server instead of the remote URL.
//
// Run once via: docker exec pokecard_backend node src/scripts/downloadLogos.js

import fs from 'fs';
import path from 'path';
import { query } from '../db.js';

const LOGOS_DIR = '/app/logos';
const BASE_URL = process.env.BACKEND_PUBLIC_URL || 'http://100.92.56.206:14001';

async function downloadImage(url, destPath) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PokeCardTracker/1.0)' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
}

async function main() {
  if (!fs.existsSync(LOGOS_DIR)) {
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
  }

  // Only grab sets with a remote logo_url (skip already-local or null)
  const { rows: sets } = await query(`
    SELECT id, name, logo_url FROM sets
    WHERE logo_url IS NOT NULL AND logo_url NOT LIKE '%${BASE_URL.replace(/https?:\/\//, '')}%'
  `);

  console.log(`Found ${sets.length} sets with remote logo URLs to download.\n`);

  let success = 0;
  let failed  = 0;

  for (const set of sets) {
    try {
      // Preserve original file extension (png, jpg, etc.)
      const ext = path.extname(new URL(set.logo_url).pathname) || '.png';
      const filename = `${set.id}${ext}`;
      const destPath = path.join(LOGOS_DIR, filename);
      await downloadImage(set.logo_url, destPath);

      const newUrl = `${BASE_URL}/logos/${filename}`;
      await query('UPDATE sets SET logo_url = $1 WHERE id = $2', [newUrl, set.id]);

      console.log(`✅ ${set.name} → ${filename}`);
      success++;
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