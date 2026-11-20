// pages/GradingLab.jsx — Tuning page for the grading tools (/grading/lab)
//
// For checking and tuning the picture steps one at a time, on any photo:
// where the card was found (and by which method), the straightened card, the
// border lines found and the numbers behind them. Settings edited here are
// kept in this browser only (they are tried out here before becoming the
// saved settings).
//
// Also used by automated tests: window.gradingLab.run(url, { turned: url2 })
// runs every step on a photo (and its sideways photo for the edges check) and
// answers the numbers (no pictures).

import { useEffect, useRef, useState } from 'react';
import { GRADING_DEFAULTS, mergeSettings, LAB_SETTINGS_KEY as STORE_KEY, labOverrides as loadOverrides } from '../grading/config.js';
import { loadPhoto, findCard, straighten, turnQuad, warmUp, cardFromScan, detailOf } from '../grading/vision.js';
import { analyzer } from '../grading/analyzers.js';
import { scanEdges, sameWayUp, turnImage, combineScans, findSpots, doubtTracksOf, measureEdges, edgesCap, glareShare } from '../grading/edges.js';
import EdgesReview from '../components/grading/EdgesReview.jsx';

// Every step on one photo. Answers the numbers plus the pictures for the page.
// straight: the picture is already just the card (a scan) — skip finding it.
async function runPipeline(source, settings, { turn = false, straight = false, back = false, turned = null } = {}) {
  const times = {};
  const t = async (name, fn) => { const s = performance.now(); const r = await fn(); times[name] = Math.round(performance.now() - s); return r; };
  const bitmap = await t('load', () => loadPhoto(source));
  let found = { quad: null }, image;
  if (straight) {
    image = cardFromScan(bitmap);
  } else {
    found = await t('find', () => findCard(bitmap, { debug: true }));
    if (!found.quad) return { bitmap, found, times, error: 'No card-shaped outline found' };
    if (turn) found = { ...found, quad: turnQuad(found.quad) };
    image = await t('straighten', () => straighten(bitmap, found.quad));
  }
  const centering = analyzer('centering');
  const borders = await t('borders', () => centering.find(image, settings, { face: back ? 'back' : 'front' }));
  const measured = centering.measure(borders, settings);
  // Edges: the photo straightened again with a margin round the card, and
  // the sideways photo if there is one.
  let edges = null;
  if (!straight) {
    const margin = Math.round(settings.edges.marginMm * settings.image.pxPerMm);
    const imageM = await t('straighten+margin', () => straighten(bitmap, found.quad, { margin }));
    let scan = await t('edges', () => scanEdges(imageM, margin, settings));
    let imageB = null, wayB = null, errorB = null;
    if (turned) {
      const bitmapB = await loadPhoto(turned);
      const foundB = await findCard(bitmapB);
      if (foundB.quad) {
        imageB = await straighten(bitmapB, foundB.quad, { margin });
        wayB = sameWayUp(imageM, imageB, margin);
        if (wayB < 0) imageB = turnImage(imageB);
        const scanB = await t('edges 2', () => scanEdges(imageB, margin, settings));
        scan = combineScans(scan, scanB, settings);
      } else errorB = 'No card found in the sideways photo';
      bitmapB.close?.();
    }
    const spots = findSpots(scan, settings);
    const doubtTracks = doubtTracksOf(scan, settings);
    edges = {
      scan, spots, doubtTracks, ignored: [], combined: !!scan.combined, margin, image: imageM, imageB,
      wayB, errorB, glare: glareShare(imageM, margin),
    };
  }
  return { bitmap, found, image, borders, measured, edges, times };
}

export default function GradingLab() {
  const [overrides, setOverrides] = useState(loadOverrides);
  const [settingsText, setSettingsText] = useState(() => JSON.stringify(mergeSettings(loadOverrides()), null, 2));
  const [settingsError, setSettingsError] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [turn, setTurn] = useState(false);
  const [straight, setStraight] = useState(false);
  const [back, setBack] = useState(false);
  const [turned, setTurned] = useState(null);      // the sideways photo (File), for the edges check
  const lastSource = useRef(null);
  const settings = mergeSettings(overrides);

  useEffect(() => { warmUp().catch(() => {}); }, []);

  // For automated tests.
  useEffect(() => {
    window.gradingLab = {
      settings: () => mergeSettings(loadOverrides()),
      run: async (source, options = {}) => {
        const r = await runPipeline(source, mergeSettings(options.overrides || loadOverrides()), options);
        r.bitmap?.close?.();
        return {
          quad: r.found?.quad || null, rough: r.found?.rough, bendMm: r.found?.bendMm, score: r.found?.score, strategy: r.found?.strategy, candidates: r.found?.candidates,
          lines: r.borders?.lines, sides: r.borders?.sides, border: r.borders?.border, threshold: r.borders?.threshold,
          measured: r.measured, times: r.times, error: r.error,
          edges: r.edges && {
            combined: r.edges.combined, wayB: r.edges.wayB, errorB: r.edges.errorB, lit: r.edges.scan.lit, unread: r.edges.scan.unread,
            glare: r.edges.glare, doubtTracks: r.edges.doubtTracks,
            spots: r.edges.spots.map(({ id, track, from, to, lengthMm, depthMm, doubt }) => ({ id, track, from, to, lengthMm, depthMm, doubt })),
            measured: measureEdges(r.edges.spots, [], r.edges.doubtTracks),
          },
        };
      },
    };
    return () => { delete window.gradingLab; };
  }, []);

  async function run(source) {
    lastSource.current = source;
    setBusy(true); setError('');
    try {
      const r = await runPipeline(source, settings, { turn, straight, back, turned });
      if (r.error) setError(r.error);
      setResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    try {
      const parsed = JSON.parse(settingsText);
      localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
      setOverrides(parsed);
      setSettingsError('');
    } catch (err) {
      setSettingsError(err.message);
    }
  }

  function resetSettings() {
    localStorage.removeItem(STORE_KEY);
    setOverrides({});
    setSettingsText(JSON.stringify(GRADING_DEFAULTS, null, 2));
    setSettingsError('');
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 'var(--space-4)' }}>
      <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Grading lab</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Try the picture steps on any photo. Settings changed here only apply in this browser.
      </p>

      <section style={panel}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }}>
          <input type="file" accept="image/*" onChange={e => e.target.files[0] && run(e.target.files[0])} />
          <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="…or a picture address"
            style={{ flex: '1 1 240px', minWidth: 0 }} />
          <button className="btn btn-primary" disabled={!url || busy} onClick={() => run(url)}>Run</button>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={turn} onChange={e => setTurn(e.target.checked)} /> Turn 180°
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="The picture is already just the card, straight (a scan)">
            <input type="checkbox" checked={straight} onChange={e => setStraight(e.target.checked)} /> Already straight
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="The back of a card (its printed frame is a known size)">
            <input type="checkbox" checked={back} onChange={e => setBack(e.target.checked)} /> Card back
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="The same side with the card turned a quarter turn, for the edges check (pick it before the main photo, or tap Run again)">
            Sideways photo <input type="file" accept="image/*" onChange={e => setTurned(e.target.files[0] || null)} />
          </label>
          {lastSource.current && <button className="btn btn-ghost" disabled={busy} onClick={() => run(lastSource.current)}>Run again</button>}
          {busy && <span style={{ color: 'var(--text-muted)' }}>Working…</span>}
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </section>

      {result && (
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <section style={panel}>
            <h2 style={h2}>1. Card found</h2>
            <PhotoOutline bitmap={result.bitmap} quad={result.found?.quad} />
            <Numbers rows={[
              ['Method', result.found?.strategy || '—'],
              ['Score', result.found?.score ?? '—'],
              ['Photo', result.bitmap ? `${result.bitmap.width} × ${result.bitmap.height}` : '—'],
              ['Bend (mm)', result.found?.bendMm ? result.found.bendMm.map(v => v ?? '?').join(' / ') + ' (top / right / bottom / left)' : '—'],
              ['Detail', result.found?.quad ? `${detailOf(result.found.quad).toFixed(1)} px per mm` : '—'],
              ['Corners', result.found?.quad ? result.found.quad.map(p => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`).join(' ') : '—'],
              ['Times (ms)', Object.entries(result.times).map(([k, v]) => `${k} ${v}`).join(', ')],
            ]} />
          </section>
          {result.image && (
            <section style={panel}>
              <h2 style={h2}>2. Straightened, with border lines</h2>
              <CardWithLines image={result.image} lines={result.borders.lines} />
              <Numbers rows={[
                ['Left / right', `${result.measured.leftRightText}  (left ${result.measured.mm.left} mm, right ${result.measured.mm.right} mm)`],
                ['Top / bottom', `${result.measured.topBottomText}  (top ${result.measured.mm.top} mm, bottom ${result.measured.mm.bottom} mm)`],
                ['Border colour', `rgb(${result.borders.border.join(', ')})`],
                ['Threshold', result.borders.threshold],
                ...Object.entries(result.borders.sides).map(([side, s]) =>
                  [`${side}`, `found on ${Math.round(s.share * 100)}% of lines, spread ${s.spreadPx ?? '—'} px, confidence ${s.confidence}${s.fromBackFrame ? " (looked for again where the back's frame has to be)" : ""}`]),
              ]} />
            </section>
          )}
          {result.edges && (
            <section style={panel}>
              <h2 style={h2}>3. Edges and corners</h2>
              <EdgesReview edges={result.edges}
                onToggle={id => setResult(r => ({ ...r, edges: { ...r.edges, ignored: r.edges.ignored.includes(id) ? r.edges.ignored.filter(x => x !== id) : [...r.edges.ignored, id] } }))} />
              <Numbers rows={edgeRows(result.edges, back ? 'back' : 'front', settings)} />
            </section>
          )}
        </div>
      )}

      <section style={panel}>
        <h2 style={h2}>Settings</h2>
        <textarea value={settingsText} onChange={e => setSettingsText(e.target.value)} spellCheck={false}
          style={{ width: '100%', minHeight: 320, fontFamily: 'monospace', fontSize: '0.8rem' }} />
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={saveSettings}>Use these settings</button>
          <button className="btn btn-ghost" onClick={resetSettings}>Back to defaults</button>
          {settingsError && <span style={{ color: 'var(--danger)' }}>{settingsError}</span>}
        </div>
      </section>
    </div>
  );
}

function edgeRows(edges, face, settings) {
  const m = measureEdges(edges.spots, edges.ignored, edges.doubtTracks);
  const c = edgesCap(face === 'front' ? m : null, face === 'back' ? m : null, settings);
  return [
    ['Photos', edges.combined ? `both (sideways photo ${edges.wayB < 0 ? 'turned half a turn to line up' : 'lined up as it was'})` : edges.errorB || 'one'],
    ['Lit share', Object.entries(edges.scan.lit).map(([k, v]) => `${k} ${v}`).join(', ') + ` (in doubt from ${settings.edges.litShare})`],
    ['Not read', `${Math.round(edges.scan.unread * 1000) / 10}% of the outline`],
    ['Glare', `${Math.round(edges.glare * 10000) / 100}% of the card`],
    ['Counted', `${m.lengthMm} mm, up to ${m.depthMm} mm deep, ${m.corners} corners, ${m.edges} edges (${m.counted} spots)`],
    ['Allows', c ? `${c.cap} (${c.low}–${c.high}) as the ${face}` : '—'],
  ];
}

function PhotoOutline({ bitmap, quad }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!bitmap || !ref.current) return;
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const c = ref.current;
    c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    if (quad) {
      ctx.strokeStyle = '#3f6'; ctx.lineWidth = 2;
      ctx.beginPath();
      quad.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#f36';
      ctx.beginPath(); ctx.arc(quad[0][0] * scale, quad[0][1] * scale, 5, 0, Math.PI * 2); ctx.fill();
    }
  }, [bitmap, quad]);
  return <canvas ref={ref} style={{ width: '100%', height: 'auto', borderRadius: 'var(--radius-md, 8px)' }} />;
}

function CardWithLines({ image, lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!image || !ref.current) return;
    const c = ref.current;
    c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d');
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = '#f0f'; ctx.lineWidth = 2;
    const v = x => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); };
    const h = y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); };
    v(lines.innerLeft); v(lines.innerRight); h(lines.innerTop); h(lines.innerBottom);
  }, [image, lines]);
  return <canvas ref={ref} style={{ width: '100%', maxWidth: 420, height: 'auto', display: 'block', margin: '0 auto' }} />;
}

function Numbers({ rows }) {
  return (
    <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', marginTop: 'var(--space-3)' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ color: 'var(--text-muted)', padding: '2px 8px 2px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
            <td style={{ padding: '2px 0', wordBreak: 'break-word' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const panel = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 12px)', padding: 'var(--space-4)' };
const h2 = { fontSize: '1rem', margin: '0 0 var(--space-3)' };
