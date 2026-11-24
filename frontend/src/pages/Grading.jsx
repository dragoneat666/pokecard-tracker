// pages/Grading.jsx — Pre-grade a card from phone photos (/grading)
//
// Start by picking the card (search, or the list of cards you have 2 copies
// of that haven't been compared), or just check one without saying which.
// A picked card shows its saved copies; /grading?card=<id> opens it straight
// away (the set page links here).
//
// Checking a copy, front then back:
//   1. photo         live camera (or the phone's camera app / gallery)
//   2. corners       the card's outline as found; corners can be moved
//   3. centering     the straightened card with its border lines; lines can
//                    be moved
//   4. turned        (can be skipped) a second photo with the card turned a
//                    quarter turn, for the edges check: light glinting off
//                    the card's edges looks like whitening in one photo, but
//                    moves to other edges when the card is turned. If
//                    whitening is still found, a third photo (sideways the
//                    other way) and then a fourth (upside down) are offered:
//                    it has to be in every photo to count
//   5. edges         whitening on the edges and corners, each spot shown
//                    close up; spots that aren't whitening can be left out
//   6. surface       a checklist ticked by eye (scratches, dents, creases...)
// then the result for both sides together, which can be saved as a copy of
// the card. With 2 copies saved they're compared side by side and you pick
// which to keep; the other is marked "to sell" (grading/estimate.js).
//
// This is an estimate from photos, not a grade: it says the best grade the
// centering, the edges and the surface allow.
//
// Everything is worked out on the phone. Only saving a copy sends anything to
// the server (the first photo of each side straightened, and the numbers:
// the spots found, so the page can mark them on the picture, and the grade
// with its reasons; the extra turned photos aren't kept), and "Send for
// testing" (the photos as taken, for tuning the photo steps).

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLeaveGuard } from '../leaveGuard.js';
import { mergeSettings, labOverrides } from '../grading/config.js';
import { loadPhoto, findCard, refineEdges, straighten, turnQuad, warmUp, worstBend, detailOf, edgeStrips } from '../grading/vision.js';
import { scanEdges, sameWayUp, turnImage, combineScans, findSpots, maybeSpots, matchScore, findNicks, nicksUnchecked, doubtTracksOf, measureEdges, markSpots, edgesCap, glareShare } from '../grading/edges.js';
import { analyzer } from '../grading/analyzers.js';
import { slopesInUse, ratioWords } from '../grading/centering.js';
import { emptySurface, surfaceText, MARK_KINDS } from '../grading/surface.js';
import { imageGrey, sharpnessOf } from '../grading/sharpness.js';
import { estimateOf, whiteningText, VERSIONS } from '../grading/estimate.js';
import { api, isNative } from '../api.js';
import { APP_VERSION } from '../version.js';
import CameraCapture from '../components/grading/CameraCapture.jsx';
import CornerEditor from '../components/grading/CornerEditor.jsx';
import CenteringEditor from '../components/grading/CenteringEditor.jsx';
import EdgesReview, { EdgesCard } from '../components/grading/EdgesReview.jsx';
import SurfaceChecklist from '../components/grading/SurfaceChecklist.jsx';
import MarkEditor from '../components/grading/MarkEditor.jsx';
import CardPicker from '../components/grading/CardPicker.jsx';
import { CardView, CompareView, CardHeader, candidatesOf } from '../components/grading/CardCopies.jsx';
import { drawCanvas, imageCanvas, useCanvasWidth } from '../components/grading/canvasTools.js';

const centering = analyzer('centering');
const NAMES = { front: 'front', back: 'back' };
// The extra photos for the edges check, by photo number. A glint has to land
// in the same place in every photo to pass for whitening, which a light
// almost never manages once the card has been turned three ways.
const TURNS = {
  2: { label: 'sideways', guide: 'landscape',
    how: 'turn the card a quarter turn where it lies, so it\'s sideways, and take another photo with the phone held the same way as before.' },
  3: { label: 'sideways the other way', guide: 'landscape',
    how: 'turn the card so it\'s sideways the other way (half a turn from the last photo), with the phone held the same way as before.' },
  4: { label: 'upside down', guide: 'portrait',
    how: 'turn the card upside down compared with the first photo, with the phone held the same way as before.' },
};
const MAX_PHOTOS = 4;

export default function Grading() {
  const [step, setStep] = useState('home');      // home | card | compare | capture | working | corners | centering | turned | edges | surface | result
  const [side, setSide] = useState('front');
  const [busyText, setBusyText] = useState('');
  const [error, setError] = useState('');
  const [work, setWork] = useState(null);        // the side being worked on
  const [done, setDone] = useState({});          // { front: {...}, back: {...} } finished sides
  // Test photos being sent / sent (an upload can take a minute over a slow
  // link, so it carries on while the next steps are done).
  const [uploads, setUploads] = useState([]);
  // The card picked (if any): { card, copies } from the server, which slot
  // ('regular' or 'reverse'), a message to show on it, and the copy saved
  // from the result on screen.
  const [cardData, setCardData] = useState(null);
  const [slot, setSlot] = useState('regular');
  const [notice, setNotice] = useState('');
  const [savedCopy, setSavedCopy] = useState(null);
  const [params, setParams] = useSearchParams();
  // the address follows the card on screen, so a reload opens it again
  // A check with photos or results not saved yet: Back (the phone's or the
  // browser's), the top-bar links and reloading ask before throwing it away.
  const unsaved = !savedCopy && !['home', 'card', 'compare'].includes(step) && (!!work || Object.keys(done).length > 0);
  useLeaveGuard(unsaved, LEAVE_TEXT);
  const okToDrop = () => !unsaved || window.confirm(LEAVE_TEXT);
  const showCardInAddress = (id, which) => setParams(id ? { card: String(id), ...(which === 'reverse' ? { slot: which } : {}) } : {}, { replace: true });
  const settings = useRef(mergeSettings(labOverrides())).current;
  const usingLab = Object.keys(labOverrides()).length > 0;
  const bitmapRef = useRef(null);

  // OpenCV is ~10 MB: start loading it while the photo is being lined up.
  useEffect(() => { warmUp().catch(() => {}); }, []);
  useEffect(() => () => { bitmapRef.current?.close?.(); }, []);
  // /grading?card=123 (from the set page) opens that card
  useEffect(() => {
    const id = parseInt(params.get('card'));
    if (id) openCard(id, params.get('slot') === 'reverse' ? 'reverse' : 'regular');
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

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
    setSavedCopy(null);
    setSide('front');
    setError('');
    setStep('capture');
  }

  // ── The card picked, its saved copies ──
  const openCard = (id, which = 'regular') => busy('Loading the card…', async () => {
    const data = await api.grading.card(id);
    setCardData(data);
    setSlot(which === 'reverse' && data.card.has_reverse ? 'reverse' : 'regular');
    showCardInAddress(id, which);
    setNotice('');
    setStep('card');
  });

  const copyName = (copy) => copy.label || `Copy ${cardData.copies.filter(c => c.slot === copy.slot).findIndex(c => c.id === copy.id) + 1}`;

  const keepCopy = (copy, other) => busy('Saving your choice…', async () => {
    const { copies } = await api.grading.keepCopy(copy.id);
    setCardData(d => ({ ...d, copies }));
    setNotice(`Keeping ${copyName(copy)}. ${copyName(other)} is marked to sell: the set page shows "1 to sell" until you untick the second box.`);
    setStep('card');
  });

  const deleteCopy = (copy) => {
    if (!window.confirm(`Remove ${copyName(copy)} and its pictures?`)) return;
    busy('Removing…', async () => {
      await api.grading.deleteCopy(copy.id);
      setCardData(d => ({ ...d, copies: d.copies.filter(c => c.id !== copy.id) }));
      setNotice('');
      setStep('card');
    });
  };

  const changeCopy = (copy, changes) => busy('Saving…', async () => {
    const { copy: updated } = await api.grading.updateCopy(copy.id, changes);
    setCardData(d => ({ ...d, copies: d.copies.map(c => (c.id === updated.id ? updated : c)) }));
    setStep('card');
  });

  const renameCopy = (copy) => {
    const label = window.prompt('A name for this copy (e.g. "binder" or "top loader"):', copy.label || '');
    if (label !== null) changeCopy(copy, { label });
  };

  // Saves the result on screen as a copy of the picked card: the numbers,
  // and each side's straightened picture (with the bit of background round it
  // the edges check used) plus a small one for lists.
  const saveCopy = (label) => busy('Saving the copy…', async () => {
    const sides = sidesOf(done);
    const est = estimateOf(sides, settings);
    const pictures = {};
    const details = {};
    for (const s of ['front', 'back']) {
      const d = done[s];
      if (!d) continue;
      pictures[s] = await jpegOf(d.edges?.image || d.image, 0.85);
      pictures[`${s}Thumb`] = await jpegOf(d.image, 0.8, 300);
      // every photo's edge strips (kept on the server until they're fetched)
      const strips = d.edges ? await Promise.all([d.stripA, ...(d.edges.extras || []).map(x => x.strip)]) : [];
      const stripInfo = [];
      strips.forEach((st, i) => {
        if (!st) return;
        pictures[`strip-${s}-${i + 1}`] = st.blob;
        const { blob, ...info } = st;
        stripInfo.push({ photo: i + 1, turn: i ? d.edges.extras[i - 1].label : null, ...info, outMm: settings.edges.strips.outMm, inMm: settings.edges.strips.inMm });
      });
      details[s] = {
        lines: d.lines, foundLines: d.foundLines, slopes: d.slopes || null, followTilt: d.followTilt !== false, noBorder: d.noBorder || null, bendMm: d.bendMm,
        detailPxPerMm: Math.round(detailOf(d.quad) * 10) / 10,
        pictureMargin: d.edges ? d.edges.margin : 0,
        edges: d.edges ? {
          combined: d.edges.combined, photos: d.edges.photos || (d.edges.combined ? 2 : 1),
          ignored: d.edges.ignored, doubtTracks: d.edges.doubtTracks,
          spots: d.edges.spots.map(({ id, track, from, to, lengthMm, depthMm, doubt, maybe, votes, photos }) => ({ id, track, from, to, lengthMm, depthMm, doubt, ...(maybe ? { maybe, votes, photos } : {}) })),
          // the possible nicks and the user's answer (yes = "It's a nick")
          nicks: (d.edges.nicks || []).map(n => ({ ...n, yes: (d.edges.nickYes || []).includes(n.id) })),
          nicksUnchecked: d.edges.nicksUnchecked || [],
        } : null,
        marks: d.marks || [],
        strips: stripInfo,
        // each photo's sharpness as taken (first, then the turned ones)
        sharpness: [d.sharp ?? null, ...(d.edges?.extras || []).map(x => x.sharp ?? null)],
      };
    }
    const result = {
      version: 1, appVersion: APP_VERSION, versions: VERSIONS, settings, sides, details,
      estimate: est && { best: est.best, low: est.low, high: est.high, parts: est.parts.map(p => ({ id: p.id, cap: p.cap.cap, low: p.cap.low, high: p.cap.high, why: p.why })) },
    };
    const cardId = cardData.card.id;
    const { copy } = await api.grading.saveCopy({
      cardId, slot, label, estimate: est?.best, estimateLow: est?.low, estimateHigh: est?.high, result,
    }, pictures);
    setSavedCopy(copy);
    const data = await api.grading.card(cardId);
    setCardData(data);
    if (candidatesOf(data.copies, slot).length >= 2) {
      setNotice('');
      setStep('compare');
    } else {
      const owned = slot === 'reverse' ? data.card.reverse_owned : data.card.owned;
      setNotice(owned >= 2 ? 'Saved. Check the other copy to compare them.' : 'Saved.');
      setStep('card');
    }
  });

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
    // how sharp the photo itself came out (warned about on the lines page)
    const sharp = Math.round(sharpnessOf(imageGrey(image)).score * 100) / 100;
    setWork(w => ({ ...w, quad, image, sharp, lines: borders.lines, foundLines: borders.lines, slopes: borders.slopes, sides: borders.sides, followTilt: true, noBorder: null }));
    setStep('centering');
  });

  // After the lines: the first photo straightened again with a margin of
  // background round it (the edges check needs to see where the card stops),
  // then the sideways photo.
  const toEdges = () => busy('Getting the edges ready…', async () => {
    const margin = Math.round(settings.edges.marginMm * settings.image.pxPerMm);
    const imageM = await straighten(work.bitmap, work.quad, { margin });
    const scanA = scanEdges(imageM, margin, settings, { back: side === 'back' });
    const stripA = startStrips(work.bitmap, work.quad);
    setWork(w => ({ ...w, imageM, scanA, margin, extras: [], glare: glareShare(imageM, margin), stripA }));
    setStep('turned');
  });

  // extras: the turned photos so far ({ image, scan, photo, label, ... }).
  const showEdges = (scan, extras = []) => {
    const found = findSpots(scan, settings);
    // seen in some of the photos only: listed, not counted until "Count it"
    // (on a worn back with enough photos, counted until "Not whitening")
    const sure = found.filter(sp => !sp.doubt);
    const maybe = maybeSpots(scan, sure, settings);
    const photos = 1 + extras.length;
    const maybeCounted = side === 'back' && photos >= (settings.edges.countMaybeBackPhotos ?? Infinity)
      && sure.length >= (settings.edges.countMaybeMinSure ?? 0);
    const spots = [...found, ...maybe];
    const doubtTracks = doubtTracksOf(scan, settings);
    // possible nicks: the first photo's outline and the turned photos'
    const scans = [work.scanA, ...extras.map(x => x.scan)];
    const nicks = findNicks(scans, settings);
    setWork(w => ({
      ...w,
      extras,
      edges: {
        scan, spots, ignored: maybeCounted ? [] : maybe.map(sp => sp.id), doubtTracks, combined: !!scan.combined, photos, maybeCounted,
        nicks, nickYes: [], nicksUnchecked: scans.length > 1 ? nicksUnchecked(scans, settings) : [],
        margin: w.margin, image: w.imageM, extras,
      },
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
      let image = await straighten(bitmap, found.quad, { margin: work.margin });
      // straightened upright, the card may have come out upside down
      let flipped = false;
      if (sameWayUp(work.imageM, image, work.margin) < 0) { image = turnImage(image); flipped = true; }
      // an out-of-focus photo, or one whose outline was found wrong, would
      // hide whitening that's really there
      if (matchScore(work.imageM, image, work.margin) < settings.edges.minMatch) {
        throw new Error('This photo doesn\'t line up with the first one: it may be out of focus, or the card wasn\'t found right. Take it again.');
      }
      // out of focus (the camera checks its preview, but the photo itself is
      // focused and taken separately and can come out blurrier)
      const sharp = Math.round(sharpnessOf(imageGrey(image, work.margin)).score * 100) / 100;
      const need = Math.max(settings.edges.minSharp, (work.sharp || 0) * settings.edges.minSharpShare);
      if (sharp < need) {
        throw new Error(`This photo came out out of focus (sharpness ${sharp.toFixed(2)}, needs ${need.toFixed(2)}), so small whitening would be missed. Take it again: hold still a moment after it focuses on the card.`);
      }
      const scan = scanEdges(image, work.margin, settings, { back: side === 'back' });
      const n = (work.extras?.length || 0) + 2;
      const strip = startStrips(bitmap, flipped ? turnQuad(found.quad) : found.quad);
      const extras = [...(work.extras || []), {
        image, scan, label: TURNS[n].label, photo, camera, photoSize: [bitmap.width, bitmap.height], quad: found.quad, strip, sharp,
      }];
      showEdges(combineScans([work.scanA, ...extras.map(x => x.scan)], settings), extras);
    } finally {
      bitmap.close?.();
    }
  });

  // A photo's edge strips (vision.js edgeStrips), made in the background and
  // only waited for when the copy is saved. A failure just means no strips.
  const startStrips = (bitmap, quad) => edgeStrips(bitmap, quad, settings.edges.strips).catch(() => null);

  const toSurface = () => {
    setWork(w => ({ ...w, surface: w.surface || emptySurface(settings) }));
    setStep('surface');
  };

  const toggleSpot = (id) => setWork(w => {
    const ignored = w.edges.ignored.includes(id) ? w.edges.ignored.filter(x => x !== id) : [...w.edges.ignored, id];
    return { ...w, edges: { ...w.edges, ignored } };
  });

  // every "seen in some photos" spot counted at once (then "Not whitening"
  // on the ones that aren't)
  const countAllMaybe = () => setWork(w => {
    const maybe = new Set(w.edges.spots.filter(sp => sp.maybe).map(sp => sp.id));
    return { ...w, edges: { ...w.edges, ignored: w.edges.ignored.filter(id => !maybe.has(id)) } };
  });

  const toggleNick = (id) => setWork(w => {
    const yes = w.edges.nickYes || [];
    return { ...w, edges: { ...w.edges, nickYes: yes.includes(id) ? yes.filter(x => x !== id) : [...yes, id] } };
  });

  // "Add a mark": a nick or whitening counts towards the edges, the others tick their
  // checklist item (at least Slight).
  const addMark = (mark) => setWork(w => {
    const item = MARK_KINDS.find(k => k.id === mark.kind)?.item;
    const surface = { ...(w.surface || emptySurface(settings)) };
    if (item && (surface[item] || 'none') === 'none') surface[item] = 'slight';
    return { ...w, marks: [...(w.marks || []), mark], surface };
  });
  const removeMark = (id) => setWork(w => ({ ...w, marks: (w.marks || []).filter(m => m.id !== id) }));

  function finishSide() {
    const measured = centering.measure(work, settings);
    const e = work.edges;
    // the turned photos' pictures are let go (only their photos stay, for "Send for testing")
    const extras = (e?.extras || []).map(({ image, scan, ...rest }) => rest);
    const edges = e && { ...e, extras, measured: measureEdges([...e.spots, ...markSpots(work.marks, settings)], e.ignored, e.doubtTracks, nickCount(e, work.marks)) };
    const result = { ...work, bitmap: null, scanA: null, extras: null, measured, edges };
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
        nicks: data.edges.nicks || [], nickYes: data.edges.nickYes || [], nicksUnchecked: data.edges.nicksUnchecked || [],
      } : null,
      marks: data.marks || [],
      labSettings: labOverrides(),
    };
    const set = (status) => setUploads(u => u.map(x => (x.id === id ? { ...x, status } : x)));
    api.grading.sendTestPhoto(data.photo, meta).then(() => set('sent'), err => set(err.message || 'failed'));
    // the turned photos too, each as its own upload
    (data.edges?.extras || []).forEach((x, i) => {
      const idB = `${id}-turned-${i}`;
      setUploads(u => [...u.slice(-5), { id: idB, photo: x.photo, stage, side: data.side, status: 'sending' }]);
      const setB = (status) => setUploads(u => u.map(y => (y.id === idB ? { ...y, status } : y)));
      const metaB = { side: data.side, turned: true, photoNumber: i + 2, turn: x.label, stage, appVersion: APP_VERSION, native: isNative, camera: x.camera, photoSize: x.photoSize, quad: x.quad };
      api.grading.sendTestPhoto(x.photo, metaB).then(() => setB('sent'), err => setB(err.message || 'failed'));
    });
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
        {CHECKING.includes(step) && <span style={{ color: 'var(--text-secondary)' }}>{side === 'front' ? 'Front' : 'Back'} of the card</span>}
        <span style={{ flex: 1 }} />
        {step !== 'home' && step !== 'card' && step !== 'working' && (
          <button className="btn btn-ghost btn-sm" onClick={() => { if (!okToDrop()) return; freeBitmap(); setWork(null); setStep(cardData ? 'card' : 'home'); }}>
            {cardData ? 'Back to the card' : 'Start over'}
          </button>
        )}
      </div>
      {cardData && (CHECKING.includes(step) || step === 'result') && (
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 'calc(-1 * var(--space-2))' }}>
          Checking: <b>{cardData.card.name}</b> · {cardData.card.set_name} · {cardData.card.card_number}
          {slot === 'reverse' ? ' (reverse slot)' : ''}
        </div>
      )}
      {usingLab && <p style={{ margin: 0, color: 'var(--warning)', fontSize: '0.85rem' }}>Using settings changed on the tuning page.</p>}
      {error && <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
      <UploadStatus uploads={uploads} />

      {step === 'home' && <Home onStart={() => { setCardData(null); showCardInAddress(null); start(); }} onPick={(card, s) => openCard(card.id, s)} />}

      {step === 'card' && cardData && (
        <CardView data={cardData} slot={slot} settings={settings} notice={notice}
          onSlot={(s) => { setSlot(s); setNotice(''); showCardInAddress(cardData.card.id, s); }}
          onCheck={start}
          onCompare={() => { setNotice(''); setStep('compare'); }}
          onDelete={deleteCopy}
          onStatus={(copy, status) => changeCopy(copy, { status })}
          onLabel={renameCopy}
          onBack={() => { setCardData(null); showCardInAddress(null); setStep('home'); }} />
      )}

      {step === 'compare' && cardData && (
        <CompareView key={cardData.copies.length} data={cardData} slot={slot} settings={settings}
          onKeep={keepCopy} onBack={() => setStep('card')} />
      )}

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
          {work.sharp != null && work.sharp < settings.edges.minSharp && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', color: 'var(--warning, #e0a030)', fontSize: '0.9rem' }}>
              <span>⚠ This photo came out a little out of focus (sharpness {work.sharp.toFixed(2)}): small whitening may be missed and the lines are harder to place. Retaking it is best.</span>
              <button className="btn btn-sm" onClick={() => redoSide(side)}>Retake</button>
            </div>
          )}
          <CenteringEditor image={work.image} lines={work.lines} sides={work.sides} pxPerMm={settings.image.pxPerMm}
            foundLines={work.foundLines} slopes={work.slopes} followTilt={work.followTilt !== false} noBorder={work.noBorder}
            onChange={lines => setWork(w => ({ ...w, lines }))}
            onOptions={opts => setWork(w => ({ ...w, ...opts }))} />
          <div style={rowStyle}>
            <button className="btn btn-primary" onClick={toEdges}>Next: edges and corners</button>
            <button className="btn btn-ghost" onClick={() => setWork(w => ({ ...w, lines: w.foundLines }))}>Reset lines</button>
            <button className="btn btn-ghost" onClick={() => toCentering(turnQuad(work.quad))} title="The card is upside down">Turn 180°</button>
            <button className="btn btn-ghost" onClick={() => setStep('corners')}>Redo corners</button>
          </div>
        </section>
      )}

      {step === 'turned' && work && (() => {
        const n = (work.extras?.length || 0) + 2;
        const turn = TURNS[n];
        return (
          <>
            <section className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <p style={{ margin: 0 }}>
                <b>Edges check, photo {n} of {n === 2 ? 2 : MAX_PHOTOS}:</b> {turn.how}
              </p>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {n === 2
                  ? 'Light glinting off a card\'s cut edges looks just like whitening in one photo. With the card turned, the glints move to other edges while real whitening stays put, so the two photos tell them apart.'
                  : 'With the card turned another way the light lands differently: glints move to other edges, real whitening stays put, and small flecks the light hid can show up. Spots seen in only some of the photos are listed for you to check.'}
              </p>
            </section>
            <CameraCapture key={`${side}-turned-${n}`} sideName={`${NAMES[side]} (${turn.label})`} onPhoto={onTurnedPhoto} guide={turn.guide} />
            {n === 2
              ? <button className="btn btn-ghost" onClick={() => showEdges(work.scanA)}>Skip: check the edges from the first photo only</button>
              : <button className="btn btn-ghost" onClick={() => setStep('edges')}>Skip: keep the result from {n - 1} photos</button>}
            <button className="btn btn-ghost" onClick={() => setStep('centering')}>Back to the lines</button>
          </>
        );
      })()}

      {step === 'edges' && work?.edges && (
        <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            Whitening on the edges and corners is marked in red and shown close up below. If a spot isn't
            whitening (dust, a glint, part of the print), tap "Not whitening".
          </p>
          <EdgesNumbers edges={work.edges} marks={work.marks} face={side} settings={settings} />
          {work.glare > settings.edges.glareWarnShare && (
            <p style={{ margin: 0, color: 'var(--warning)' }}>
              ⚠️ Glare on part of the card: whitening under it can't be seen. If it's near an edge, move the light and retake.
            </p>
          )}
          <EdgesReview edges={work.edges} onToggle={toggleSpot} onToggleNick={toggleNick} onCountAllMaybe={countAllMaybe} />
          <MorePhotos edges={work.edges} onMore={() => setStep('turned')} />
          <div style={rowStyle}>
            <button className={`btn ${wantsMorePhotos(work.edges) ? 'btn-ghost' : 'btn-primary'}`} onClick={toSurface}>Next: surface</button>
            <button className="btn btn-ghost" onClick={() => { setWork(w => ({ ...w, extras: [] })); setStep('turned'); }}>
              {work.edges.combined ? 'Start the turned photos again' : 'Add a sideways photo'}
            </button>
            <button className="btn btn-ghost" onClick={() => setStep('centering')}>Back to the lines</button>
          </div>
        </section>
      )}

      {step === 'surface' && work && (
        <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0 }}>
            <b>Surface:</b> hold the {NAMES[side]} of the card under a light and tilt it slowly. Tick anything
            you can see; leave it on None if it looks clean. (A phone photo can't show these reliably, so this part is by eye.)
          </p>
          <SurfaceChecklist value={work.surface} onChange={surface => setWork(w => ({ ...w, surface }))} settings={settings} />
          <MarkEditor edges={work.edges} marks={work.marks || []} onAdd={addMark} onRemove={removeMark} />
          <div style={rowStyle}>
            <button className="btn btn-primary" onClick={finishSide}>Done with the {NAMES[side]}</button>
            <button className="btn btn-ghost" onClick={() => setStep('edges')}>Back to the edges</button>
          </div>
        </section>
      )}

      {step === 'result' && <Result done={done} settings={settings} onRedo={redoSide} onAnother={() => { if (okToDrop()) start(); }}
        save={<SavePanel cardData={cardData} slot={slot} savedCopy={savedCopy} onSave={saveCopy}
          onPickCard={(card, s) => busy('Loading the card…', async () => {
            setCardData(await api.grading.card(card.id));
            setSlot(s);
            showCardInAddress(card.id, s);
            setStep('result');
          })}
          onSeeCard={() => setStep(candidatesOf(cardData.copies, slot).length >= 2 ? 'compare' : 'card')} />}
        sendButton={s => <SendTest upload={uploadOf(done[s].photo, 'result')} onSend={() => sendTest({ ...done[s], side: s }, 'result')} hasPhoto={!!done[s].photo} small />} />}
    </div>
  );
}

function Home({ onStart, onPick }) {
  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <p style={{ margin: 0 }}>
          Photograph a card's front and back to check its centering (how even the borders are), its
          edges and corners (whitening) and its surface. The result is the best grade those allow: an
          estimate, not a real grade. Got 2 copies? Check and save both, and it tells you which to keep.
        </p>
        <CardPicker onPick={onPick} />
        <button className="btn btn-ghost" onClick={onStart}>Just check a card (save it to a card later)</button>
      </section>
      <section className="panel">
        <h2 style={{ fontSize: '1rem', margin: '0 0 var(--space-2)' }}>For a good photo</h2>
        <ul style={{ margin: 0, paddingLeft: '1.2em', display: 'grid', gap: 4 }}>
          <li>Take the card out of its sleeve or top loader (the plastic adds glare and hides the edges).</li>
          <li>Lay it on a plain, matte surface that stands out from the card's border: dark (a black mouse mat or cloth) for yellow, silver or white borders, lighter (grey card or a coloured cutting mat) for black borders. Where the border and the surface look alike, the edges can't be checked.</li>
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

function Result({ done, settings, onRedo, onAnother, sendButton, save }) {
  const est = estimateOf(sidesOf(done), settings);
  const parts = est?.parts || [];
  const best = est ? est.best : null;
  const low = est?.low, high = est?.high;
  const limiting = est?.limiting || [];
  const atFloor = est?.atFloor;
  const eCap = est?.parts.find(p => p.id === 'edges')?.cap;
  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Estimate: up to</div>
        <div style={{ fontSize: '2.2rem', fontWeight: 800, lineHeight: 1 }}>
          {best === null ? '—' : atFloor ? `${best} or lower` : best}
        </div>
        {low !== high && <div style={{ color: 'var(--text-secondary)' }}>Close call: could be {low}–{high}.</div>}
        {limiting.length > 0 && best < 10 && (
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
      </section>
      {save}
      <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {['front', 'back'].map(s => done[s] && (
          <section key={s} className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>{s === 'front' ? 'Front' : 'Back'}</h2>
            <CardPreview image={done[s].image} lines={done[s].lines} slopes={slopesInUse(done[s], settings.image.pxPerMm)} />
            <table style={{ fontSize: '0.9rem' }}>
              <tbody>
                <tr><td style={cellKey}>Left / right</td><td><b>{ratioWords(done[s].measured, 'leftRight')}</b></td></tr>
                <tr><td style={cellKey}></td><td>{done[s].measured.mm.left} mm / {done[s].measured.mm.right} mm{done[s].measured.leftRightWhere ? ' (middle)' : ''}</td></tr>
                <tr><td style={cellKey}>Top / bottom</td><td><b>{ratioWords(done[s].measured, 'topBottom')}</b></td></tr>
                <tr><td style={cellKey}></td><td>{done[s].measured.mm.top} mm / {done[s].measured.mm.bottom} mm{done[s].measured.topBottomWhere ? ' (middle)' : ''}</td></tr>
              </tbody>
            </table>
            {done[s].measured.tilted && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                The frame is printed a little crooked: centering counts its worst end, as graders do.
              </div>
            )}
            {done[s].edges && (
              <>
                <EdgesCard edges={done[s].edges} maxWidth={260} userMarks={done[s].marks || []} />
                <div style={{ fontSize: '0.9rem' }}>{whiteningText(done[s].edges.measured)}</div>
                {!done[s].edges.combined && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Edges checked from one photo.</div>}
              </>
            )}
            {done[s].surface && <div style={{ fontSize: '0.9rem' }}>Surface: {surfaceText(done[s].surface, settings) || 'nothing ticked'}.</div>}
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

// Whitening still counted after 2 or 3 photos (or, after 3, spots seen in
// only some of them): worth another, turned photo.
function countedSpots(edges) {
  return edges.spots.filter(sp => !sp.doubt && !edges.ignored.includes(sp.id)).length;
}
function maybeLeft(edges) {
  return edges.spots.filter(sp => sp.maybe && edges.ignored.includes(sp.id)).length;
}
function wantsMorePhotos(edges) {
  const photos = edges.photos || 1;
  return photos >= 2 && photos < MAX_PHOTOS && (countedSpots(edges) > 0 || maybeLeft(edges) > 0);
}

// After 2 or 3 photos another turned photo is always offered: with spots
// found it double-checks them; with none, small flecks the light hid can
// show up in it (worn yellow fronts read nothing in 2 photos).
function MorePhotos({ edges, onMore }) {
  const photos = edges.photos || 1;
  const counted = countedSpots(edges), maybe = maybeLeft(edges);
  if (photos < 2) return null;
  const note = { margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' };
  if (photos >= MAX_PHOTOS) {
    if (!counted && !maybe) return null;
    return (
      <>
        {counted > 0 && <p style={note}>{edges.maybeCounted
          ? 'This back has whitening in every photo, so spots seen in at least 2 of the 4 are counted too (on worn backs nearly all of them are real). If you can\'t see one on the card, tap "Not whitening".'
          : 'What\'s counted is in at least 3 of the 4 photos, so it\'s most likely real. If you still can\'t see it on the card, tap "Not whitening".'}</p>}
        {maybe > 0 && <p style={note}>Spots seen in only some of the photos aren't counted. If you can see one on the card, tap "Count it".</p>}
      </>
    );
  }
  const n = photos + 1;
  const how = `take photo ${n} with the card ${TURNS[n].label}`;
  const why = counted
    ? `Whitening was found in ${photos === 2 ? 'both' : `all ${photos}`} photos. If you can't see it on the card, it may be the light: ${how} to double-check.`
    : maybe
      ? `Some spots showed in only some of the ${photos} photos (not counted): ${how} to double-check.`
      : `No whitening found in ${photos} photos. If you can see some on the card, ${how}: the light lands differently and small flecks can show up.`;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
      <span>{why}</span>
      <div><button className={`btn ${counted || maybe ? 'btn-primary' : 'btn-ghost'}`} onClick={onMore}>{counted || maybe ? 'Double-check' : 'Look again'}: photo {n}</button></div>
    </div>
  );
}

// The edges step's numbers for the side being checked, and what they allow.
function EdgesNumbers({ edges, marks, face, settings }) {
  const m = measureEdges([...edges.spots, ...markSpots(marks, settings)], edges.ignored, edges.doubtTracks, nickCount(edges, marks));
  const c = edgesCap(face === 'front' ? m : null, face === 'back' ? m : null, settings);
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <div><b>{whiteningText(m)}</b></div>
      {c && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          The {face}'s edges allow up to {c.cap === settings.edges.floor ? `${c.cap} or lower` : c.cap}
          {c.low !== c.high ? ` (could be ${c.low}–${c.high})` : ''}.
          {' '}{edges.combined ? `Checked with ${edges.photos || 2} photos.` : 'Checked from one photo.'}
        </div>
      )}
    </div>
  );
}

function CardPreview({ image, lines, slopes }) {
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
      // slanted where the frame tilts (centering.js slopes; right / bottom
      // lines move the other way, being measured from the far edge)
      const sl = slopes || {};
      const H = image.height, W = image.width;
      for (const [x, k] of [[lines.innerLeft, sl.left || 0], [lines.innerRight, -(sl.right || 0)]]) { ctx.moveTo((x - k * H / 2) * s, 0); ctx.lineTo((x + k * H / 2) * s, h); }
      for (const [y, k] of [[lines.innerTop, sl.top || 0], [lines.innerBottom, -(sl.bottom || 0)]]) { ctx.moveTo(0, (y - k * W / 2) * s); ctx.lineTo(w, (y + k * W / 2) * s); }
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

// Saving the result as a copy of a card: of the card picked, or pick one here.
function SavePanel({ cardData, slot, savedCopy, onSave, onPickCard, onSeeCard }) {
  const [label, setLabel] = useState('');
  const [picking, setPicking] = useState(false);
  if (savedCopy) {
    return (
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <div style={{ color: 'var(--success)' }}>✓ Saved as a copy of {cardData?.card.name}.</div>
        {cardData && <button className="btn btn-primary" onClick={onSeeCard}>See its copies</button>}
      </section>
    );
  }
  return (
    <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {cardData && !picking ? (
        <>
          <CardHeader card={cardData.card} slot={slot} />
          <input className="input" value={label} onChange={e => setLabel(e.target.value)} maxLength={80}
            placeholder="A name for this copy (optional): binder, top loader…" />
          <div style={rowStyle}>
            <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => onSave(label)}>Save this copy</button>
            <button className="btn btn-ghost" onClick={() => setPicking(true)}>It's a different card</button>
          </div>
        </>
      ) : (
        <>
          <div><b>Save this copy?</b> Which card is it:</div>
          <CardPicker showQueue={false} onPick={(card, s) => { setPicking(false); onPickCard(card, s); }} />
        </>
      )}
    </section>
  );
}

// The sides of a finished check, summed up the way estimates and saved
// copies need them (grading/estimate.js).
// Nicks on a side: the possible nicks the user said yes to, plus nicks they
// marked themselves.
function nickCount(edges, marks) {
  const ids = new Set((edges?.nicks || []).map(n => n.id));
  return (edges?.nickYes || []).filter(id => ids.has(id)).length + (marks || []).filter(m => m.kind === 'nick').length;
}

function sidesOf(done) {
  const out = {};
  for (const s of ['front', 'back']) {
    if (!done[s]) continue;
    out[s] = { centering: done[s].measured, whitening: done[s].edges?.measured || null, surface: done[s].surface || null };
  }
  return out;
}

// A straightened card side (ImageData) as a JPEG, optionally made smaller.
async function jpegOf(image, quality, width = image.width) {
  const height = Math.round(image.height * width / image.width);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageCanvas(image), 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

const CHECKING = ['capture', 'corners', 'centering', 'turned', 'edges', 'surface'];
const LEAVE_TEXT = "Leave this check? The photos and results you haven't saved will be lost.";
const rowStyle = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' };
const cellKey = { color: 'var(--text-muted)', paddingRight: 12, whiteSpace: 'nowrap' };
