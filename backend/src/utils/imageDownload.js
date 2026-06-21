// utils/imageDownload.js
//
// Shared helper for downloading external images (set logos/symbols) and
// saving them locally so the browser never has to load them cross-origin
// from sites like Bulbapedia/Fandom that block hotlinked <img> embeds.

import fs from 'fs';
import path from 'path';

const LOGOS_DIR = '/app/logos';
const BASE_URL = process.env.BACKEND_PUBLIC_URL || 'http://100.92.56.206:14001';

if (!fs.existsSync(LOGOS_DIR)) {
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
}

// Downloads a remote image and returns the new local URL.
// prefix distinguishes logo vs symbol files for the same set (e.g. "93-logo.png" vs "93-symbol.png")
export async function downloadAndLocalizeImage(remoteUrl, setId, prefix) {
  if (!remoteUrl) return null;

  // Already local — don't re-download
  if (remoteUrl.startsWith(BASE_URL)) return remoteUrl;

  try {
    const response = await fetch(remoteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PokeCardTracker/1.0)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const ext = path.extname(new URL(remoteUrl).pathname) || '.png';
    const filename = `${setId}-${prefix}${ext}`;
    const destPath = path.join(LOGOS_DIR, filename);

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));

    return `${BASE_URL}/logos/${filename}`;
  } catch (err) {
    console.error(`   ⚠️  Failed to download image (${prefix}) for set ${setId}: ${err.message}`);
    return remoteUrl; // fall back to remote URL if download fails
  }
}
