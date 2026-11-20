// pages/Grading.jsx — Pre-grade a card from phone photos (/grading)
//
// One card at a time, front then back:
//   1. photo         live camera (or the phone's camera app / gallery)
//   2. corners       the card's outline as found; corners can be moved
//   3. centering     the straightened card with its border lines; lines can
//                    be moved
// then the centering result for both sides together.
//
// This is an estimate from photos, not a grade: it says the best grade the
// centering allows. Edges, corners and surface come in later steps.
//
// Everything is worked out on the phone. Nothing is sent anywhere unless
// "Send for testing" is tapped: that sends the photo and what was found in it
// to the server, for tuning the photo steps (saving copies of cards comes
// with the compare step).

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { mergeSettings, labOverrides } from '../grading/config.js';
import { loadPhoto, findCard, refineEdges, straighten, turnQuad, warmUp, worstBend, detailOf } from '../grading/vision.js';
import { analyzer } from '../grading/analyzers.js';
import { api, isNative } from '../api.js';
import { APP_VERSION } from '../version.js';
import CameraCapture from '../components/grading/CameraCapture.jsx';
import CornerEditor from '../components/grading/CornerEditor.jsx';
import CenteringEditor from '../components/grading/CenteringEditor.jsx';
import { drawCanvas, imageCanvas, useCanvasWidth } from '../components/grading/canvasTools.js';

const centering = analyzer('centering');
const NAMES = { front: 'front', back: 'back' };

export default function Grading() {
  const [step, setStep] = useState('home');      // home | capture | working | corners | centering | result
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

  function finishSide() {
    const measured = centering.measure({ lines: work.lines }, settings);
    const result = { ...work, bitmap: null, measured };
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
      labSettings: labOverrides(),
    };
    const set = (status) => setUploads(u => u.map(x => (x.id === id ? { ...x, status } : x)));
    api.grading.sendTestPhoto(data.photo, meta).then(() => set('sent'), err => set(err.message || 'failed'));
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
            <button className="btn btn-primary" onClick={finishSide}>Done with the {NAMES[side]}</button>
            <button className="btn btn-ghost" onClick={() => setWork(w => ({ ...w, lines: w.foundLines }))}>Reset lines</button>
            <button className="btn btn-ghost" onClick={() => toCentering(turnQuad(work.quad))} title="The card is upside down">Turn 180°</button>
            <button className="btn btn-ghost" onClick={() => setStep('corners')}>Redo corners</button>
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
          Photograph a card's front and back to measure its centering: how even the borders are.
          The result is the best grade the centering allows (an estimate, not a real grade).
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
  const cap = centering.cap({ front: done.front?.measured, back: done.back?.measured }, settings);
  const range = cap && cap.low !== cap.high ? `${cap.low}–${cap.high}` : null;
  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Centering allows up to</div>
        <div style={{ fontSize: '2.2rem', fontWeight: 800, lineHeight: 1 }}>
          {cap ? (cap.cap === settings.centering.floor ? `${cap.cap} or lower` : cap.cap) : '—'}
        </div>
        {range && <div style={{ color: 'var(--text-secondary)' }}>Close call: could be {range} (a line moved a little either way changes it).</div>}
        {cap && <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Limited by the {cap.limitedBy}.</div>}
        {!done.back && <div style={{ color: 'var(--warning)', fontSize: '0.9rem' }}>Front only: the back can lower this.</div>}
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
