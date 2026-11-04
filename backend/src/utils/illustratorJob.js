// utils/illustratorJob.js — Fill in illustrators for every set you already have
//
// New imports get illustrators on their own (jobs/priceSync.js). This one-off
// job (Admin -> "Fill in illustrators") does the same for sets imported before
// that: for each set it re-reads the TCGTracking card list (one request, a
// pause between sets) and saves each card's artist and any missing type /
// stage, then asks TCGdex, whose names win (utils/cardDetails.js).
// Nothing else about the cards changes — no names, numbers, prices or counts.
//
// Running it again is harmless: it only changes cards where a source has
// something new. One job at a time; it lives in memory, so a backend restart
// forgets the progress (what was saved stays saved).

import { query } from '../db.js';
import { tcgtrackingFetch } from './tcgtracking.js';
import { saveCardDetails, applyTcgdexIllustrators } from './cardDetails.js';

const PAUSE_MS = parseInt(process.env.ILLUSTRATOR_JOB_PAUSE_MS || '1000', 10);
let job = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function getIllustratorJob() {
  return job;
}

// Starts the job and returns it, or returns null if it's already running.
export function startIllustratorJob() {
  if (job?.status === 'running') return null;
  const current = {
    status: 'running',      // running | done | failed
    startedAt: new Date().toISOString(),
    total: 0,               // sets
    done: 0,
    current: null,          // set being worked on
    error: null,
    report: null,
  };
  job = current;
  run(current).catch(err => {
    console.error('Illustrator fill failed:', err);
    Object.assign(current, { status: 'failed', error: err.message, current: null });
  });
  return current;
}

async function run(job) {
  const { rows: sets } = await query(`
    SELECT id, name, tcg_id FROM sets
    WHERE tcg_id IS NOT NULL
    ORDER BY release_date NULLS LAST, id
  `);
  const report = {
    fromTcgtracking: 0,     // illustrators saved from TCGTracking (where TCGdex hadn't given one)
    fromTcgdex: 0,          // blanks TCGdex filled
    tcgdexCorrected: 0,     // TCGTracking names TCGdex replaced with a different one
    typesFilled: 0,
    stagesFilled: 0,
    noTcgdexMatch: [],      // sets TCGdex couldn't be matched to (TCGTracking's names stay)
    failed: [],             // { set, error }
    cards: 0,               // filled in at the end
    withIllustrator: 0,
    fromTcgdexNow: 0,       // of withIllustrator, how many are TCGdex's
    mostMissing: [],        // { set, missing }
  };
  Object.assign(job, { total: sets.length, report });

  for (const set of sets) {
    job.current = set.name;
    if (job.done > 0) await sleep(PAUSE_MS);
    try {
      const data = await tcgtrackingFetch(`/sets/${set.tcg_id}`);
      const saved = await saveCardDetails(data.products || []);
      report.fromTcgtracking += saved.illustrators;
      report.typesFilled += saved.types;
      report.stagesFilled += saved.stages;

      const tcgdex = await applyTcgdexIllustrators(set.id);
      report.fromTcgdex += tcgdex.filled;
      report.tcgdexCorrected += tcgdex.corrected;
      if (tcgdex.checked && !tcgdex.tcgdexSet) report.noTcgdexMatch.push(set.name);
    } catch (err) {
      report.failed.push({ set: set.name, error: err.message });
    }
    job.done++;
  }

  // Where things stand now (Energy cards have no illustrator, so they aren't counted as missing).
  const { rows: totals } = await query(`
    SELECT COUNT(*)::INT AS cards, COUNT(NULLIF(illustrator, ''))::INT AS with_illustrator,
           COUNT(*) FILTER (WHERE COALESCE(illustrator, '') <> '' AND illustrator_source = 'tcgdex')::INT AS from_tcgdex
    FROM cards WHERE NOT is_alternate
  `);
  const { rows: missing } = await query(`
    SELECT s.name, COUNT(*)::INT AS missing
    FROM cards c JOIN sets s ON s.id = c.set_id
    WHERE NOT c.is_alternate AND COALESCE(c.illustrator, '') = ''
      AND CONCAT_WS(' ', c.pokemon_type, c.stage, c.name) !~* 'energy'
    GROUP BY s.name ORDER BY 2 DESC, 1 LIMIT 10
  `);
  report.cards = totals[0].cards;
  report.withIllustrator = totals[0].with_illustrator;
  report.fromTcgdexNow = totals[0].from_tcgdex;
  report.mostMissing = missing.map(r => ({ set: r.name, missing: r.missing }));
  Object.assign(job, { status: 'done', current: null });
}
