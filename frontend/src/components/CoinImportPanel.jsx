// components/CoinImportPanel.jsx — Import coins from a Bulbapedia coin page
//
// Shown on the Coins page. You paste one of Bulbapedia's "Coin (TCG)" list
// pages; the backend adds every generation and coin it doesn't have yet
// (numbered in release order) and then downloads the missing pictures, a few
// minutes for ~200 coins. This panel starts that job, polls its progress and
// shows what happened. Running it again only fills gaps — coins you have
// already are never renumbered or overwritten.
//
// The last link used is remembered in this browser, just to save pasting it again.

import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

const POLL_MS = 2000;
const STORAGE_KEY = 'coins-import-url';

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function remember(url) {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // private window / storage blocked — nothing to remember then
  }
}

export default function CoinImportPanel({ job, setJob, onProgress }) {
  const [url, setUrl]       = useState(remembered);
  const [error, setError]   = useState(null);
  const [starting, setStarting] = useState(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const running = job?.status === 'running';

  // While a job runs, poll it; reload the page's data as coins arrive and at the end.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(async () => {
      try {
        const next = await api.coins.importJob();
        setJob(next);
        onProgressRef.current();
      } catch {
        // a missed poll is fine — try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, setJob]);

  async function start() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setStarting(true);
    try {
      setJob(await api.coins.startImport(trimmed));
      remember(trimmed);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const report = job?.report;

  return (
    <div className="panel" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 4 }}>Import coins from Bulbapedia</div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
        Paste one of Bulbapedia's coin list pages (for example “Coin (TCG)/Generations I-IV”). New coins are added and
        numbered in release order, then their pictures are downloaded. Running it again only adds what's missing —
        your numbers, edits and checkboxes are never changed. It takes a few minutes.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="https://bulbapedia.bulbagarden.net/wiki/Coin_(TCG)/…"
          value={url}
          disabled={running}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') start(); }}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button className="btn btn-primary btn-sm" onClick={start} disabled={running || starting || !url.trim()}>
          {running ? 'Working…' : 'Import'}
        </button>
      </div>

      {error && <div style={{ marginTop: 'var(--space-3)', color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

      {running && (
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span className="spinner" />
          {job.total > 0 ? `Downloading ${job.done} / ${job.total} pictures…` : job.step}
        </div>
      )}

      {job && !running && (
        <div style={{ marginTop: 'var(--space-3)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {job.error && <div style={{ color: 'var(--danger)' }}>{job.error}</div>}
          {report && (
            <>
              <div>
                <strong>Added {report.added} coin{report.added !== 1 ? 's' : ''}</strong>
                {report.alreadyHad > 0 && <span style={{ color: 'var(--text-secondary)' }}> ({report.alreadyHad} were already here)</span>}
                {report.added > 0 && (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {' — '}{report.generations.filter(g => g.added > 0).map(g => `${g.name}: ${g.added}${g.isNew ? ' (new)' : ''}`).join(', ')}
                  </span>
                )}
              </div>
              <div>
                <strong>Saved {job.saved} picture{job.saved !== 1 ? 's' : ''}</strong>
                {job.total > job.saved && ` of ${job.total}`}.
                {report.noPicture > 0 && (
                  <span style={{ color: 'var(--text-secondary)' }}> {report.noPicture} coin{report.noPicture !== 1 ? 's have' : ' has'} no picture on the page.</span>
                )}
              </div>
              <ReportList label="Failed" color="var(--danger)" items={report.failed.map(f => `${f.coin} — ${f.error}`)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const LIST_MAX = 30;

function ReportList({ label, items, color = 'var(--text-secondary)' }) {
  if (items.length === 0) return null;
  const more = items.length - LIST_MAX;
  return (
    <div style={{ color }}>
      {label}: <span style={{ color: 'var(--text-primary)' }}>
        {items.slice(0, LIST_MAX).join(', ')}{more > 0 && ` … and ${more} more`}
      </span>
    </div>
  );
}
