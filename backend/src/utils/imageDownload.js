// utils/imageDownload.js
//
// Shared helper for downloading external images (set logos/symbols) and
// saving them locally so the browser never has to load them cross-origin
// from sites like Bulbapedia/Fandom that block hotlinked <img> embeds.
//
// downloadAndLocalizeImage (logos) falls back to the remote URL if the
// download fails. downloadImageStrict (Topps card pictures) throws instead, so
// the caller can report the failure. saveUploadedImage stores a picture sent
// from the browser (a scan) the same way.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const LOGOS_DIR = process.env.LOGOS_DIR || '/app/logos';
const BASE_URL = process.env.BACKEND_PUBLIC_URL || 'http://100.92.56.206:14001';
export const USER_AGENT = 'Mozilla/5.0 (compatible; PokeCardTracker/1.0)';

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
      headers: { 'User-Agent': USER_AGENT },
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

// ─── Strict download (Topps card pictures) ────────────────────────────────────

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const IMAGE_TYPES = {                  // no SVG: it can carry scripts
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export class DownloadError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;              // the remote HTTP status, when there was one
  }
}

export const isLocalImage = url => typeof url === 'string' && url.startsWith(`${BASE_URL}/logos/`);

// Downloads an image into LOGOS_DIR/<subdir>/ and returns its local URL, or
// throws a DownloadError saying why not. The file name ends in a short hash of
// the picture, so a replaced picture gets a new URL and no browser shows the
// old one from its cache. allowHost(hostname), if given, must approve the
// host — checked again after redirects.
export async function downloadImageStrict(remoteUrl, subdir, baseName, { allowHost } = {}) {
  let url;
  try {
    url = new URL(remoteUrl);
  } catch {
    throw new DownloadError('That is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new DownloadError('Only http(s) links can be downloaded');
  if (allowHost && !allowHost(url.hostname)) throw new DownloadError(`Pictures can't be downloaded from ${url.hostname}`);

  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new DownloadError(err.name === 'TimeoutError' ? 'The download timed out' : `Download failed: ${err.message}`);
  }
  if (!response.ok) throw new DownloadError(`The site answered HTTP ${response.status}`, response.status);
  if (allowHost && !allowHost(new URL(response.url).hostname)) {
    throw new DownloadError(`The link redirected to ${new URL(response.url).hostname}`);
  }

  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new DownloadError(`That link isn't a picture (${type || 'unknown type'})`);
  if (parseInt(response.headers.get('content-length') || '0', 10) > MAX_BYTES) {
    throw new DownloadError('That picture is bigger than 5 MB');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new DownloadError('That picture is bigger than 5 MB');
    chunks.push(chunk);
  }
  return saveImage(Buffer.concat(chunks), ext, subdir, baseName);
}

// Writes a picture into LOGOS_DIR/<subdir>/ as "<baseName>-<hash><ext>" and
// returns its local URL. Shared by downloads and uploads.
function saveImage(buffer, ext, subdir, baseName) {
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  const filename = `${baseName}-${hash}${ext}`;
  const dir = path.join(LOGOS_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `${BASE_URL}/logos/${subdir}/${filename}`;
}

// ─── Uploaded pictures (scans) ────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// The picture type from the file's first bytes — not from its name or the
// browser's say-so, so only real JPEG / PNG / GIF / WebP files get stored.
function sniffImageExt(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') return '.gif';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

// Stores an uploaded picture the same way as a downloaded one, or throws a
// DownloadError saying why not.
export function saveUploadedImage(buffer, subdir, baseName) {
  const ext = sniffImageExt(buffer);
  if (!ext) throw new DownloadError('That file isn\'t a JPEG, PNG, GIF or WebP picture');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new DownloadError('That picture is bigger than 10 MB');
  return saveImage(buffer, ext, subdir, baseName);
}

// Deletes stored copies under LOGOS_DIR/<subdir>/ for the given URLs. Anything
// else (remote URLs, other folders) is left alone. Never throws.
export function deleteLocalImages(urls, subdir) {
  const prefix = `${BASE_URL}/logos/${subdir}/`;
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith(prefix)) continue;
    const name = url.slice(prefix.length);
    if (!/^[\w.-]+$/.test(name)) continue;
    try {
      fs.unlinkSync(path.join(LOGOS_DIR, subdir, name));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`   ⚠️  Could not delete ${name}: ${err.message}`);
    }
  }
}
