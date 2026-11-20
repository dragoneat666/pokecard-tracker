// pages/Grading.jsx — Pre-grade a card from phone photos (/grading)
//
// One card at a time, front then back:
//   1. photo         live camera (or the phone's camera app / gallery)
//   2. corners       the card's outline as found; corners can be moved
//   3. centering     the straightened card with its border lines; lines can
//                    be moved
//   4. turned        (can be skipped) a second photo with the card turned a
//                    quarter turn, for the edges check: light glinting off
//                    the card's edges looks like whitening in one photo, but
//                    moves to other edges when the card is turned
//   5. edges         whitening on the edges and corners, each spot shown
//                    close up; spots that aren't whitening can be left out
// then the result for both sides together.
//
// This is an estimate from photos, not a grade: it says the best grade the
// centering and the edges allow. The surface comes in a later step.
//
// Everything is worked out on the phone. Nothing is sent anywhere unless
// "Send for testing" is tapped: that sends the photo and what was found in it
// to the server, for tuning the photo steps (saving copies of cards comes
// with the compare step).

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { mergeSettings, labOverrides } from '../grading/config.js';
import { loadPhoto, findCard, refineEdges, straighten, turnQuad, warmUp, worstBend, detailOf } from '../grading/vision.js';
import { scanEdges, sameWayUp, turnImage, combineScans, findSpots, doubtTracksOf, measureEdges, edgesCap, glareShare } from '../grading/edges.js';
import { analyzer } from '../grading/analyzers.js';
import { api, isNative } from '../api.js';
import { APP_VERSION } from '../version.js';
import CameraCapture from '../components/grading/CameraCapture.jsx';
import CornerEditor from '../components/grading/CornerEditor.jsx';
import CenteringEditor from '../components/grading/CenteringEditor.jsx';
import EdgesReview, { EdgesCard } from '../components/grading/EdgesReview.jsx';
import { drawCanvas, imageCanvas, useCanvasWidth } from '../components/grading/canvasTools.js';

const centering = analyzer('centering');
const NAMES = { front: 'front', back: 'back' };

export default function Grading() {
  const [step, setStep] = useState('home');      // home | capture | working | corners | centering | turned | edges | result
  const [side, setSide] = useState('front');
  const [busyText, setBusyText] = useState('');
  const [error, setError] = useState('');
  const [work, setWork] = useState(null);        // the side being worked on
  const [done, setDone] = useState({});          // { front: {...}, back: {...} } finished sides
  // Test photos being sent / sent (an upload can take a minute over a slow
  // link, so it carries on while the next steps are done).
  const [uploads, setUploads] = useState([]);
  const settings = useRef(mergeSettings(labOverrides())).current;
  const usingLab = Object.keys(labOverrides()).length > 0;
  const bitmapRef = useRef(null);

  // OpenCV is ~10 MB: start loading it while the photo is being lined up.
  useEffect(() => { warmUp().catch(() => {}); }, []);
  useEffect(() => () => { bitmapRef.current?.close?.(); }, []);

  function freeBitmap() {
    bitmapRef.current?.close?.();
    bitmapRef.current = null;
  }

  async function busy(text, fn) {
    setError('');
    setBusyText(text);
    const back = step;
    setStep('working');
    try {
      await fn();
    } catch (err) {
      setError(err.message || String(err));
      setStep(back);
    }
  }

  function start() {
    freeBitmap();
    setWork(null);
    setDone({});
    setSide('front');
    setError('');
    setStep('capture');
  }

  const onPhoto = (photo, camera = {}) => busy('Finding the card…', async () => {
    freeBitmap();
    const bitmap = await loadPhoto(photo);
    bitmapRef.current = bitmap;
    const found = await findCard(bitmap);
    const quad = found.quad || guessQuad(bitmap);
    setWork({
      bitmap, quad, foundQuad: quad, found: !!found.quad, cutOff: !!found.cutOff,
      bendMm: found.bendMm || null, strategy: found.strategy || null,
      photo, camera, photoSize: [bitmap.width, bitmap.height],
    });
    setStep('corners');
  });

  const snap = () => busy('Lining the corners up with the edges…', async () => {
    const { quad, bendMm } = await refineEdges(work.bitmap, work.quad);
    setWork(w => ({ ...w, quad, bendMm }));
    setStep('corners');
  });

  // Straighten with these corners and find the border lines.
  const toCentering = (quad = work.quad) => busy('Straightening the card…', async () => {
    const image = await straighten(work.bitmap, quad);
    const borders = centering.find(image, settings, { face: side });
    setWork(w => ({ ...w, quad, image, lines: borders.lines, foundLines: borders.lines, sides: borders.sides }));
    setStep('centering');
  });

  // After the lines: the first photo straightened again with a margin of
  // background round it (the edges check needs to see where the card stops),
  // then the sideways photo.
  const toEdges = () => busy('Getting the edges ready…', async () => {
    const margin = Math.round(settings.edges.marginMm * settings.image.pxPerMm);
    const imageM = await straighten(work.bitmap, work.quad, { margin });
    const scanA = scanEdges(imageM, margin, settings);
    setWork(w => ({ ...w, imageM, scanA, margin, glare: glareShare(imageM, margin) }));
    setStep('turned');
  });

  const showEdges = (scan, extra = {}) => {
    const spots = findSpots(scan, settings);
    const doubtTracks = doubtTracksOf(scan, settings);
    setWork(w => ({
      ...w,
      edges: { scan, spots, ignored: [], doubtTracks, combined: !!scan.combined, margin: w.margin, image: w.imageM, imageB: null, ...extra },
    }));
    setStep('edges');
  };

  const onTurnedPhoto = (photo, camera = {}) => busy('Finding the card in the sideways photo…', async () => {
    const bitmap = await loadPhoto(photo);
    try {
      const found = await findCard(bitmap);
      if (!found.quad) {
        throw new Error(found.cutOff
          ? 'The card runs off the edge of the sideways photo. Take it again with a gap all round the card.'
          : 'Couldn\'t find the card in the sideways photo. Take it again, or skip it.');
      }
      let imageB = await straighten(bitmap, found.quad, { margin: work.margin });
      // straightened upright, the card may have come out upside down
      if (sameWayUp(work.imageM, imageB, work.margin) < 0) imageB = turnImage(imageB);
      const scanB = scanEdges(imageB, work.margin, settings);
      showEdges(combineScans(work.scanA, scanB, settings), {
        imageB, photoB: photo, cameraB: camera, photoSizeB: [bitmap.width, bitmap.height], quadB: found.quad,
      });
    } finally {
      bitmap.close?.();
    }
  });

  const toggleSpot = (id) => setWork(w => {
    const ignored = w.edges.ignored.includes(id) ? w.edges.ignored.filter(x => x !== id) : [...w.edges.ignored, id];
    return { ...w, edges: { ...w.edges, ignored } };
  });

  function finishSide() {
    const measured = centering.measure({ lines: work.lines }, settings);
    const e = work.edges;
    const edges = e && { ...e, imageB: null, measured: measureEdges(e.spots, e.ignored, e.doubtTracks) };
    const result = { ...work, bitmap: null, scanA: null, measured, edges };
    const next = { ...done, [side]: result };
    setDone(next);
    freeBitmap();
    setWork(null);
    if (side === 'front' && !next.back) { setSide('back'); setStep('capture'); }
    else setStep('result');
  }

  // Sends a side's photo (exactly as taken) and what was found in it to the
  // server, for tuning (routes/gradingTests.js). stage: 'corners' (before the
  // lines are set) or 'result' (with the measurements).
  function sendTest(data, stage) {
    const id = `${Date.now()}-${Math.random()}`;
    setUploads(u => [...u.slice(-5), { id, photo: data.photo, stage, side: data.side, status: 'sending' }]);
    const meta = {
      side: data.side, stage, appVersion: APP_VERSION, native: isNative,
      camera: data.camera, photoSize: data.photoSize,
      found: { ok: data.found, cutOff: data.cutOff, strategy: data.strategy, quad: data.foundQuad },
      quad: data.quad, bendMm: data.bendMm, detailPxPerMm: Math.round(detailOf(data.quad) * 10) / 10,
      lines: data.lines || null, foundLines: data.foundLines || null, measured: data.measured || null,
      edges: data.edges ? {
        combined: data.edges.combined, spots: data.edges.spots, ignored: data.edges.ignored,
        doubtTracks: data.edges.doubtTracks, lit: data.edges.scan.lit, unread: data.edges.scan.unread,
        measured: data.edges.measured || null, glare: data.glare ?? null,
      } : null,
      labSettings: labOverrides(),
    };
    const set = (status) => setUploads(u => u.map(x => (x.id === id ? { ...x, status } : x)));
    api.grading.sendTestPhoto(data.photo, meta).then(() => set('sent'), err => set(err.message || 'failed'));
    // the sideways photo too, as its own upload
    if (data.edges?.photoB) {
      const idB = `${id}-turned`;
      setUploads(u => [...u.slice(-5), { id: idB, photo: data.edges.photoB, stage, side: data.side, status: 'sending' }]);
      const setB = (status) => setUploads(u => u.map(x => (x.id === idB ? { ...x, status } : x)));
      const metaB = { side: data.side, turned: true, stage, appVersion: APP_VERSION, native: isNative, camera: data.edges.cameraB, photoSize: data.edges.photoSizeB, quad: data.edges.quadB };
      api.grading.sendTestPhoto(data.edges.photoB, metaB).then(() => setB('sent'), err => setB(err.message || 'failed'));
    }
  }
  const uploadOf = (photo, stage) => [...uploads].reverse().find(u => u.photo === photo && u.stage === stage);

  function redoSide(which) {
    freeBitmap();
    setWork(null);
    setSide(which);
    setStep('capture');
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Grading</h1>
        {step !== 'home' && step !== 'result' && <span style={{ color: 'var(--text-secondary)' }}>{side === 'front' ? 'Front' : 'Back'} of the card</span>}
        <span style={{ flex: 1 }} />
        {step !== 'home' && <button className="btn btn-ghost btn-sm" onClick={() => { freeBitmap(); setWork(null); setStep('home'); }}>Start over</button>}
      </div>
      {usingLab && <p style={{ margin: 0, color: 'var(--warning)', fontSize: '0.85rem' }}>Using settings changed on the tuning page.</p>}
      {error && <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
      <UploadStatus uploads={uploads} />

      {step === 'home' && <Home onStart={start} />}

      {step === 'capture' && (
        <>
          <CameraCapture key={side} sideName={NAMES[side]} onPhoto={onPhoto} />
          {side === 'back' && done.front && (
            <button className="btn btn-ghost" onClick={() => setStep('result')}>Skip the back (front only)</button>
          )}
        </>
      )}

      {step === 'working' && <div className="panel" style={{ textAlign: 'center' }}>{busyText}</div>}

      {step === 'corners' && work && (
        <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            {work.found
              ? 'Check the green outline sits on the card\'s outer edges all the way round (not on the frame inside the border). Move a corner if it doesn\'t.'
              : work.cutOff
                ? 'The card seems to run off the edge of the photo. Retake it with a little space all round the card, or drag the corners onto the card\'s corners.'
                : 'Couldn\'t find the card by itself. Drag the 4 corners onto the card\'s corners, then tap "Snap to edges".'}
          </p>
          <PhotoChecks work={work} settings={settings} />
          <CornerEditor bitmap={work.bitmap} quad={work.quad} onChange={quad => setWork(w => ({ ...w, quad }))} />
          <div style={rowStyle}>
            <button className="btn btn-primary" onClick={() => toCentering()}>Looks right</button>
            <button className="btn btn-ghost" onClick={snap}>Snap to edges</button>
            <button className="btn btn-ghost" onClick={() => setWork(w => ({ ...w, quad: w.foundQuad }))}>Reset</button>
            <button className="btn btn-ghost" onClick={() => redoSide(side)}>Retake</button>
          </div>
          <SendTest upload={uploadOf(work.photo, 'corners')} onSend={() => sendTest({ ...work, side }, 'corners')} hasPhoto={!!work.photo} />
        </section>
      )}

      {step === 'centering' && work?.image && (
        <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            The magenta lines should sit where the border ends and the picture's frame
            {side === 'back' ? ' (the blue swirl)' : ''} begins. Move any that don't.
          </p>
          <CenteringEditor image={work.image} lines={work.lines} sides={work.sides} pxPerMm={settings.image.pxPerMm}
            onChange={lines => setWork(w => ({ ...w, lines }))} />
          <div style={rowStyle}>
            <button className="btn btn-primary" onClick={toEdges}>Next: edges and corners</button>
            <button className="btn btn-ghost" onClick={() => setWork(w => ({ ...w, lines: w.foundLines }))}>Reset lines</button>
            <button className="btn btn-ghost" onClick={() => toCentering(turnQuad(work.quad))} title="The card is upside down">Turn 180°</button>
            <button className="btn btn-ghost" onClick={() => setStep('corners')}>Redo corners</button>
          </div>
        </section>
      )}

      {step === 'turned' && work && (
        <>
          <section className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <p style={{ margin: 0 }}>
              <b>Edges check:</b> turn the card a quarter turn where it lies, so it's sideways, and take
              another photo with the phone held the same way as before.
            </p>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Light glinting off a card's cut edges looks just like whitening in one photo. With the card
              turned, the glints move to other edges while real whitening stays put, so the two photos tell them apart.
            </p>
          </section>
          <CameraCapture key={`${side}-turned`} sideName={`${NAMES[side]} (sideways)`} onPhoto={onTurnedPhoto} guide="landscape" />
          <button className="btn btn-ghost" onClick={() => showEdges(work.scanA)}>Skip: check the edges from the first photo only</button>
          <button className="btn btn-ghost" onClick={() => setStep('centering')}>Back to the lines</button>
        </>
      )}

      {step === 'edges' && work?.edges && (
        <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            Whitening on the edges and corners is marked in red and shown close up below. If a spot isn't
            whitening (dust, a glint, part of the print), tap "Not whitening".
          </p>
          <EdgesNumbers edges={work.edges} face={side} settings={settings} />
          {work.glare > settings.edges.glareWarnShare && (
            <p style={{ margin: 0, color: 'var(--warning)' }}>
              ⚠️ Glare on part of the card: whitening under it can't be seen. If it's near an edge, move the light and retake.
            </p>
          )}
          <EdgesReview edges={work.edges} onToggle={toggleSpot} />
          <div style={rowStyle}>
            <button className="btn btn-primary" onClick={finishSide}>Done with the {NAMES[side]}</button>
            <button className="btn btn-ghost" onClick={() => setStep('turned')}>
              {work.edges.combined ? 'Retake the sideways photo' : 'Add a sideways photo'}
            </button>
            <button className="btn btn-ghost" onClick={() => setStep('centering')}>Back to the lines</button>
          </div>
        </section>
      )}

      {step === 'result' && <Result done={done} settings={settings} onRedo={redoSide} onAnother={start}
        sendButton={s => <SendTest upload={uploadOf(done[s].photo, 'result')} onSend={() => sendTest({ ...done[s], side: s }, 'result')} hasPhoto={!!done[s].photo} small />} />}
    </div>
  );
}

function Home({ onStart }) {
  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <p style={{ margin: 0 }}>
          Photograph a card's front and back to check its centering (how even the borders are) and
          its edges and corners (whitening). The result is the best grade those allow: an estimate, not a real grade.
        </p>
        <button className="btn btn-primary" style={{ minHeight: 48 }} onClick={onStart}>Check a card</button>
      </section>
      <section className="panel">
        <h2 style={{ fontSize: '1rem', margin: '0 0 var(--space-2)' }}>For a good photo</h2>
        <ul style={{ margin: 0, paddingLeft: '1.2em', display: 'grid', gap: 4 }}>
          <li>Take the card out of its sleeve or top loader (the plastic adds glare and hides the edges).</li>
          <li>Lay it on a plain dark surface, like a black mouse mat or cloth.</li>
          <li>Even light from the side, no flash. Move the light if there's glare on the card.</li>
          <li>Hold the phone flat, straight above the card, so the card fills most of the picture. Too close and the camera can't focus: if it says "Blurry", move back a little.</li>
          <li>Keep the card in the middle of the picture (the dashed outline). A gently curled card is fine for centering there; a badly bent one should be flattened first.</li>
          <li>Keep tall things out of the picture: the camera may focus on them instead of the card.</li>
          <li>Hold still. The photo is taken by itself when the card is steady.</li>
          <li>For the edges check, a second photo of each side with the card turned sideways tells real whitening from light glinting off the edges. Soft light (a lamp pointed at a white wall or the ceiling) makes fewer glints.</li>
        </ul>
      </section>
      {!isNative && (
        <p style={{ margin: 0 }}>
          📲 <a href="/download">Get the Android app</a>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>for the live camera view (the website can only use the phone's camera app).</span>
        </p>
      )}
      <p style={{ margin: 0, fontSize: '0.85rem' }}>
        <Link to="/grading/lab">Tuning page</Link> <span style={{ color: 'var(--text-muted)' }}>(try the steps on any picture and adjust the settings)</span>
      </p>
    </>
  );
}

function Result({ done, settings, onRedo, onAnother, sendButton }) {
  const cCap = centering.cap({ front: done.front?.measured, back: done.back?.measured }, settings);
  const eCap = edgesCap(done.front?.edges?.measured, done.back?.edges?.measured, settings);
  const parts = [
    cCap && { name: 'centering', cap: cCap, floor: settings.centering.floor, why: cCap.limitedBy },
    eCap && { name: 'edges and corners', cap: eCap, floor: settings.edges.floor, why: eCap.limitedBy },
  ].filter(Boolean);
  const best = parts.length ? Math.min(...parts.map(p => p.cap.cap)) : null;
  const low = parts.length ? Math.min(...parts.map(p => p.cap.low)) : null;
  const high = parts.length ? Math.min(...parts.map(p => p.cap.high)) : null;
  const limiting = parts.filter(p => p.cap.cap === best);
  const atFloor = limiting.some(p => p.cap.cap === p.floor);
  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Estimate: up to</div>
        <div style={{ fontSize: '2.2rem', fontWeight: 800, lineHeight: 1 }}>
          {best === null ? '—' : atFloor ? `${best} or lower` : best}
        </div>
        {low !== high && <div style={{ color: 'var(--text-secondary)' }}>Close call: could be {low}–{high}.</div>}
        {limiting.length > 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Limited by the {limiting.map(p => `${p.name} (${p.why})`).join(' and the ')}.
          </div>
        )}
        <table style={{ fontSize: '0.9rem', marginTop: 4 }}>
          <tbody>
            {parts.map(p => (
              <tr key={p.name}>
                <td style={cellKey}>{p.name.charAt(0).toUpperCase() + p.name.slice(1)}</td>
                <td>up to <b>{p.cap.cap === p.floor ? `${p.cap.cap} or lower` : p.cap.cap}</b>
                  {p.cap.low !== p.cap.high && <span style={{ color: 'var(--text-muted)' }}> (could be {p.cap.low}–{p.cap.high})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {eCap?.unchecked > 0 && (
          <div style={{ color: 'var(--warning)', fontSize: '0.9rem' }}>
            Some edges weren't checked (they may only have been glinting): a sideways photo checks them.
          </div>
        )}
        {!done.back && <div style={{ color: 'var(--warning)', fontSize: '0.9rem' }}>Front only: the back can lower this.</div>}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>The surface (scratches, dents, print lines) isn't checked yet.</div>
      </section>
      <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {['front', 'back'].map(s => done[s] && (
          <section key={s} className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>{s === 'front' ? 'Front' : 'Back'}</h2>
            <CardPreview image={done[s].image} lines={done[s].lines} />
            <table style={{ fontSize: '0.9rem' }}>
              <tbody>
                <tr><td style={cellKey}>Left / right</td><td><b>{done[s].measured.leftRightText}</b></td></tr>
                <tr><td style={cellKey}></td><td>{done[s].measured.mm.left} mm / {done[s].measured.mm.right} mm</td></tr>
                <tr><td style={cellKey}>Top / bottom</td><td><b>{done[s].measured.topBottomText}</b></td></tr>
                <tr><td style={cellKey}></td><td>{done[s].measured.mm.top} mm / {done[s].measured.mm.bottom} mm</td></tr>
              </tbody>
            </table>
            {done[s].edges && (
              <>
                <EdgesCard edges={done[s].edges} maxWidth={260} />
                <div style={{ fontSize: '0.9rem' }}>{whiteningText(done[s].edges.measured)}</div>
                {!done[s].edges.combined && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Edges checked from one photo.</div>}
              </>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => onRedo(s)}>Redo the {s}</button>
            {sendButton(s)}
          </section>
        ))}
      </div>
      <div style={rowStyle}>
        <button className="btn btn-primary" onClick={onAnother}>Check another card</button>
        {!done.back && <button className="btn btn-ghost" onClick={() => onRedo('back')}>Add the back</button>}
      </div>
    </>
  );
}

// "Whitening: 3.1 mm along the edges, up to 0.25 mm deep (2 corners)"
function whiteningText(m) {
  if (!m || !m.counted) return 'No whitening counted.';
  const where = [m.corners && `${m.corners} corner${m.corners > 1 ? 's' : ''}`, m.edges && `${m.edges} edge${m.edges > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  return `Whitening: ${m.lengthMm} mm in all, up to ${m.depthMm} mm deep (${where}).`;
}

// The edges step's numbers for the side being checked, and what they allow.
function EdgesNumbers({ edges, face, settings }) {
  const m = measureEdges(edges.spots, edges.ignored, edges.doubtTracks);
  const c = edgesCap(face === 'front' ? m : null, face === 'back' ? m : null, settings);
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <div><b>{whiteningText(m)}</b></div>
      {c && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          The {face}'s edges allow up to {c.cap === settings.edges.floor ? `${c.cap} or lower` : c.cap}
          {c.low !== c.high ? ` (could be ${c.low}–${c.high})` : ''}.
          {' '}{edges.combined ? 'Checked with both photos.' : 'Checked from one photo.'}
        </div>
      )}
    </div>
  );
}

function CardPreview({ image, lines }) {
  const [wrapRef, cssW] = useCanvasWidth();
  const ref = useRef(null);
  useEffect(() => {
    if (!cssW) return;
    const w = Math.min(cssW, 260), s = w / image.width, h = Math.round(image.height * s);
    const src = imageCanvas(image);
    drawCanvas(ref.current, w, h, (ctx) => {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of [lines.innerLeft, lines.innerRight]) { ctx.moveTo(x * s, 0); ctx.lineTo(x * s, h); }
      for (const y of [lines.innerTop, lines.innerBottom]) { ctx.moveTo(0, y * s); ctx.lineTo(w, y * s); }
      ctx.stroke();
    });
  }, [image, lines, cssW]);
  return <div ref={wrapRef}><canvas ref={ref} style={{ display: 'block', margin: '0 auto', borderRadius: 6 }} /></div>;
}

// Warnings about the photo itself: a bent card, too little detail, blurry.
function PhotoChecks({ work, settings }) {
  const bend = worstBend(work.bendMm);
  const detail = detailOf(work.quad);
  const warnings = [];
  if (bend !== null && bend >= settings.photo.bentWarnMm) {
    warnings.push(`The card looks bent: an edge curves by about ${bend.toFixed(1)} mm. The centering may be off by a point or so. For the most accurate result, flatten it and retake, with the card in the middle of the picture.`);
  }
  if (detail < settings.photo.minDetailPxPerMm) {
    warnings.push(`Not much detail: ${detail.toFixed(0)} pixels per mm of card (${settings.image.pxPerMm} is ideal). Move a little closer, or pick a sharper camera under the camera view.`);
  }
  if (work.camera?.maybeBlurry) warnings.push('The camera never got the card fully sharp, so this photo may be blurry. Moving the phone back a little usually helps.');
  return (
    <>
      {warnings.map(w => <p key={w} style={{ margin: 0, color: 'var(--warning)' }}>⚠️ {w}</p>)}
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        {[`detail ${detail.toFixed(0)} px/mm`, bend !== null && `bend ${bend.toFixed(2)} mm`, `photo ${work.photoSize.join('×')}`, work.camera?.how === 'file' ? 'from a file' : work.camera?.how]
          .filter(Boolean).join(' · ')}
      </div>
    </>
  );
}

// The "Send for testing" button for one side, or how its upload is going.
function SendTest({ upload, onSend, hasPhoto, small = false }) {
  if (!hasPhoto) return null;
  if (upload?.status === 'sent') return <div style={{ fontSize: '0.85rem', color: 'var(--success)' }}>✓ Sent for testing</div>;
  if (upload?.status === 'sending') {
    return <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>📤 Sending… you can carry on, it keeps going.</div>;
  }
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <button className={`btn btn-ghost${small ? ' btn-sm' : ''}`} onClick={onSend}>
        {upload ? '📤 Try sending again' : '📤 Send for testing'}
      </button>
      {upload && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Didn't send: {upload.status}</span>}
    </div>
  );
}

// One line at the top of the page while test photos are on their way, so an
// upload started on an earlier step can still be seen finishing.
function UploadStatus({ uploads }) {
  const sending = uploads.filter(u => u.status === 'sending');
  const failed = uploads.filter(u => u.status !== 'sending' && u.status !== 'sent');
  const sent = uploads.filter(u => u.status === 'sent');
  if (!sending.length && !failed.length) {
    return sent.length ? <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--success)' }}>✓ Test photos sent: {sent.length}</p> : null;
  }
  return (
    <p style={{ margin: 0, fontSize: '0.85rem', color: failed.length ? 'var(--danger)' : 'var(--text-secondary)' }}>
      {sending.length > 0 && `📤 Sending ${sending.length} test photo${sending.length > 1 ? 's' : ''}… `}
      {sent.length > 0 && `✓ ${sent.length} sent. `}
      {failed.length > 0 && `${failed.length} didn't send (${failed[failed.length - 1].status}).`}
    </p>
  );
}

// Where to start the corners when the card wasn't found: a card-shaped
// outline in the middle of the photo.
function guessQuad(bitmap) {
  const W = bitmap.width, H = bitmap.height;
  let h = H * 0.7, w = h * 63 / 88;
  if (w > W * 0.9) { w = W * 0.9; h = w * 88 / 63; }
  const x = (W - w) / 2, y = (H - h) / 2;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

const rowStyle = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' };
const cellKey = { color: 'var(--text-muted)', paddingRight: 12, whiteSpace: 'nowrap' };
