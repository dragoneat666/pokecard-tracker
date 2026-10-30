// utils/coinImportJob.js — Import coins and their pictures from a Bulbapedia coin page
//
// Runs in the background like the Topps picture job: read the page, add every
// generation and coin we don't have yet (in one transaction), then download the
// missing pictures one at a time. Coins already imported are recognised by
// their source key and left alone, so running it again only fills gaps and
// never renumbers anything. New coins are numbered after the highest number
// their generation + region already has, in page (= release) order.
//
// One import at a time. The job lives in memory only, so a backend restart
// forgets it (coins and pictures already saved stay saved).
//
// Politeness rules for Bulbapedia, same as the Topps job: one request at a
// time, a pause between pictures, the app's normal User-Agent only, and the
// job stops at the first 403 / 429 instead of carrying on.

import pool, { query } from '../db.js';
import { extractCoins } from './bulbapediaCoins.js';
import { isBulbagardenUrl } from './bulbapediaPictures.js';
import { downloadImageStrict, deleteLocalImages, DownloadError, USER_AGENT } from './imageDownload.js';

const PAUSE_MS = parseInt(process.env.TOPPS_PICTURE_PAUSE_MS || '1000', 10);   // same setting as the Topps job
let job = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function getImportJob() {
  return job;
}

// Starts an import and returns it, or returns null if one is already running.
export function startImportJob(pageUrl) {
  if (job?.status === 'running') return null;
  const current = {
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
  job = current;
  runImport(pageUrl, current).catch(err => {
    console.error('Coin import failed:', err);
    Object.assign(current, { status: 'failed', error: err.message, step: null });
  });
  return current;
}

async function runImport(pageUrl, job) {
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
  const entries = extractCoins(html);
  if (entries.length === 0) {
    Object.assign(job, { status: 'failed', step: null, error: 'No coins found on that page — use one of Bulbapedia\'s "Coin (TCG)" list pages' });
    return;
  }

  // 2. Add the generations and coins we don't have, all or nothing.
  const generations = [];               // [{ id, name, added, isNew }] in page order
  let alreadyHad = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const byName = new Map();
    for (const name of new Set(entries.map(e => e.generation))) {
      let { rows } = await client.query(`
        INSERT INTO coin_generations (name, sort_order)
        VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM coin_generations))
        ON CONFLICT (name) DO NOTHING RETURNING id
      `, [name]);
      const isNew = rows.length > 0;
      if (!isNew) ({ rows } = await client.query('SELECT id FROM coin_generations WHERE name = $1', [name]));
      const generation = { id: rows[0].id, name, added: 0, isNew };
      byName.set(name, generation);
      generations.push(generation);
    }
    for (const e of entries) {
      const generation = byName.get(e.generation);
      const { rows } = await client.query(`
        INSERT INTO coins (generation_id, region, number, name, released_in, release_date, description, size, source_key)
        SELECT $1, $2, COALESCE(MAX(number), 0) + 1, $3, $4, $5, $6, $7, $8
        FROM coins WHERE generation_id = $1 AND region = $2
        ON CONFLICT (generation_id, source_key) DO NOTHING
        RETURNING id
      `, [generation.id, e.region, e.name, e.releasedIn, e.releaseDate, e.description, e.size, e.key]);
      if (rows.length === 0) { alreadyHad++; continue; }
      await client.query("INSERT INTO coin_varieties (coin_id, name, sort_order) VALUES ($1, 'Regular', 0)", [rows[0].id]);
      generation.added++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 3. Every coin from this page that still has no picture.
  const { rows: empty } = await query(`
    SELECT c.id, c.generation_id, c.region, c.number, c.name, c.source_key, g.name AS generation
    FROM coins c JOIN coin_generations g ON g.id = c.generation_id
    WHERE c.image_url IS NULL AND c.generation_id = ANY ($1)
  `, [generations.map(g => g.id)]);
  const idOf = new Map(generations.map(g => [g.name, g.id]));
  const pictureOf = new Map(entries.map(e => [`${idOf.get(e.generation)}|${e.key}`, e.imageUrl]));
  const todo = [];
  let noPicture = 0;
  for (const coin of empty) {
    const url = pictureOf.get(`${coin.generation_id}|${coin.source_key}`);
    if (url) todo.push({ coin, url });
    else if (pictureOf.has(`${coin.generation_id}|${coin.source_key}`)) noPicture++;
  }

  const failed = [];
  job.report = {
    pageCoins: entries.length,
    added: generations.reduce((n, g) => n + g.added, 0),
    alreadyHad,
    generations: generations.map(g => ({ name: g.name, added: g.added, isNew: g.isNew })),
    noPicture,
    failed,
  };
  Object.assign(job, { total: todo.length, step: todo.length ? 'Downloading pictures…' : null });

  // 4. Download, one at a time. Only empty pictures are filled, re-checked at
  //    save time in case one was typed in by hand meanwhile.
  for (const { coin, url } of todo) {
    if (job.done > 0) await sleep(PAUSE_MS);
    try {
      const local = await downloadImageStrict(url, 'coins', `${coin.id}-front`, {
        allowHost: host => isBulbagardenUrl(`https://${host}/`),
      });
      const { rowCount } = await query('UPDATE coins SET image_url = $1 WHERE id = $2 AND image_url IS NULL', [local, coin.id]);
      if (rowCount > 0) job.saved++;
      else deleteLocalImages([local], 'coins');        // filled by hand meanwhile — keep that one
    } catch (err) {
      failed.push({ coin: `${coin.generation} · ${coin.region} #${coin.number} ${coin.name}`, error: err.message });
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
