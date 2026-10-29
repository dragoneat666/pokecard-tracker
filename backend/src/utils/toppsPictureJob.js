// utils/toppsPictureJob.js — Fill a Topps checklist's card pictures from Bulbapedia
//
// Runs in the background (a few minutes for ~200 pictures) so the request that
// starts it returns straight away; the page polls getPictureJob for progress.
// One job per checklist at a time. Jobs live in memory only, so a backend
// restart forgets them (the pictures already saved stay saved).
//
// Politeness rules for Bulbapedia: one request at a time, a pause between
// pictures, the app's normal User-Agent only, and the job stops at the first
// 403 / 429 instead of carrying on.

import { query } from '../db.js';
import { extractPictures, matchPictures, isBulbagardenUrl } from './bulbapediaPictures.js';
import { downloadImageStrict, deleteLocalImages, DownloadError, USER_AGENT } from './imageDownload.js';

const PAUSE_MS = parseInt(process.env.TOPPS_PICTURE_PAUSE_MS || '1000', 10);
const jobs = new Map();       // set id -> job

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only https://bulbapedia.bulbagarden.net/wiki/... pages.
export function checkPageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'bulbapedia.bulbagarden.net' || !url.pathname.startsWith('/wiki/')) return null;
  return url.toString();
}

export function getPictureJob(setId) {
  return jobs.get(String(setId)) || null;
}

// Starts a job and returns it, or returns null if one is already running.
export function startPictureJob(setId, pageUrl) {
  const key = String(setId);
  if (jobs.get(key)?.status === 'running') return null;
  const job = {
    status: 'running',      // running | done | stopped | failed
    step: 'Reading the Bulbapedia page…',
    pageUrl,
    startedAt: new Date().toISOString(),
    total: 0,               // pictures to download
    done: 0,                // pictures attempted so far
    saved: 0,
    error: null,            // why the job failed or stopped
    report: null,
  };
  jobs.set(key, job);
  runJob(setId, pageUrl, job).catch(err => {
    console.error(`Topps picture job for checklist ${setId} failed:`, err);
    Object.assign(job, { status: 'failed', error: err.message, step: null });
  });
  return job;
}

async function runJob(setId, pageUrl, job) {
  // 1. The page.
  let html;
  try {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Bulbapedia answered HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    Object.assign(job, { status: 'failed', step: null, error: `Couldn't read the page: ${err.message}` });
    return;
  }

  // 2. Match its cards to ours.
  const entries = extractPictures(html);
  const { rows: cards } = await query(`
    SELECT c.id, c.number, c.name, c.image_url, c.back_image_url
    FROM topps_cards c JOIN topps_tables t ON t.id = c.table_id
    WHERE t.set_id = $1 ORDER BY t.sort_order, t.id, c.sort_order, c.id
  `, [setId]);
  const { matches, ambiguous, unmatchedPage, missingCards } = matchPictures(entries, cards);

  const todo = [];
  let alreadyHad = 0;
  for (const { card, entry } of matches) {
    const sides = [['front', 'image_url', entry.images[0]], ['back', 'back_image_url', entry.images[1]]];
    for (const [side, column, image] of sides) {
      if (!image) continue;
      if (card[column]) { alreadyHad++; continue; }
      todo.push({ card, side, column, url: image.url });
    }
  }

  const failed = [];
  job.report = {
    pageCards: entries.length,
    matched: matches.length,
    alreadyHad,
    ambiguous,
    notOnPage: missingCards.map(c => ({ number: c.number, name: c.name })),
    notInChecklist: unmatchedPage,
    failed,
  };
  Object.assign(job, { total: todo.length, step: todo.length ? 'Downloading pictures…' : null });

  // 3. Download, one at a time. Only empty pictures are filled, re-checked at
  //    save time in case one was typed in by hand meanwhile.
  for (const item of todo) {
    if (job.done > 0) await sleep(PAUSE_MS);
    try {
      const local = await downloadImageStrict(item.url, 'topps', `${item.card.id}-${item.side}`, {
        allowHost: host => isBulbagardenUrl(`https://${host}/`),
      });
      const { rowCount } = await query(
        `UPDATE topps_cards SET ${item.column} = $1 WHERE id = $2 AND ${item.column} IS NULL`, [local, item.card.id]
      );
      if (rowCount > 0) job.saved++;
      else deleteLocalImages([local], 'topps');        // filled by hand meanwhile — keep that one
    } catch (err) {
      failed.push({ number: item.card.number, side: item.side, error: err.message });
      if (err instanceof DownloadError && (err.status === 403 || err.status === 429)) {
        job.done++;
        Object.assign(job, {
          status: 'stopped',
          step: null,
          error: `Bulbapedia refused a download (HTTP ${err.status}), so the rest were skipped. Try again later or add pictures by hand.`,
        });
        return;
      }
    }
    job.done++;
  }
  Object.assign(job, { status: 'done', step: null });
}
