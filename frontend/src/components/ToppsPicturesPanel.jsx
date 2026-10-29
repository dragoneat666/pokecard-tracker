// components/ToppsPicturesPanel.jsx — Fill a Topps checklist's card pictures from Bulbapedia
//
// Shown in "Edit tables" mode. You paste the checklist's Bulbapedia page link;
// the backend reads it, matches its cards to this checklist by number and
// downloads the front / back pictures that are still empty (a few minutes for
// a big checklist). This panel starts that job, polls its progress and shows
// what happened: what was saved, what failed, and what needs adding by hand.
//
// The last link used is remembered in this browser per checklist, just to
// save pasting it again.

import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

const POLL_MS = 2000;

function remembered(setId) {
  try {
    return localStorage.getItem(`topps-pictures-url-${setId}`) || '';
  } catch {
    return '';
  }
}

function remember(setId, url) {
  try {
    localStorage.setItem(`topps-pictures-url-${setId}`, url);
  } catch {
    // private window / storage blocked — nothing to remember then
  }
}

export default function ToppsPicturesPanel({ setId, onFinished }) {
  const [url, setUrl]       = useState(() => remembered(setId));
  const [job, setJob]       = useState(null);
  const [error, setError]   = useState(null);
  const [starting, setStarting] = useState(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const running = job?.status === 'running';

  // Pick up a job that's already running (or the last result) when the panel opens.
  useEffect(() => {
    api.topps.pictureJob(setId).then(setJob).catch(() => {});
  }, [setId]);

  // While a job runs, poll it; when it ends, reload the page's data.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(async () => {
      try {
        const next = await api.topps.pictureJob(setId);
        setJob(next);
        if (next?.status !== 'running') onFinishedRef.current();
      } catch {
        // a missed poll is fine — try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, setId]);

  async function start() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setStarting(true);
    try {
      setJob(await api.topps.startPictures(setId, trimmed));
      remember(setId, trimmed);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const report = job?.report;

  return (
    <div className="panel" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 4 }}>Card pictures from Bulbapedia</div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
        Paste this checklist's Bulbapedia page. Cards are matched by number, and only pictures that are still
        empty get filled in — pictures you've set yourself stay as they are. It takes a few minutes for a big checklist.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="https://bulbapedia.bulbagarden.net/wiki/…"
          value={url}
          disabled={running}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') start(); }}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button className="btn btn-primary btn-sm" onClick={start} disabled={running || starting || !url.trim()}>
          {running ? 'Working…' : 'Get pictures'}
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
                <strong>Saved {job.saved} picture{job.saved !== 1 ? 's' : ''}</strong>
                {job.total > job.saved && ` of ${job.total}`}.{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {report.matched} card{report.matched !== 1 ? 's' : ''} matched the page
                  {report.alreadyHad > 0 && `; ${report.alreadyHad} picture${report.alreadyHad !== 1 ? 's were' : ' was'} already set`}.
                </span>
              </div>
              <ReportList label="Failed" color="var(--danger)"
                items={report.failed.map(f => `${f.number} ${f.side} — ${f.error}`)} />
              <ReportList label="Number fits more than one card (add by hand)"
                items={report.ambiguous} />
              <ReportList label="No picture found on the page for"
                items={report.notOnPage.map(c => `${c.number} ${c.name}`)} />
              <ReportList label="On the page but not in this checklist"
                items={report.notInChecklist} />
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
