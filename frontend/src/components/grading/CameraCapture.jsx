// components/grading/CameraCapture.jsx — Take the photo of one side of a card
//
// Live camera view with the card's outline drawn on it as it is found. When
// the card is big enough in the picture, held still and has no glare on it,
// the photo is taken by itself (can be turned off), or with the shutter
// button. The photo is taken at the camera's full resolution, not from the
// smaller preview.
//
// The live camera only works on a secure page (the app, or https). On the
// website over plain http the browser doesn't allow it, so this shows
// buttons that open the phone's own camera app or the gallery instead.

import { useEffect, useRef, useState } from 'react';
import { detectInFrame } from '../../grading/vision.js';

const FRAME_SIDE = 480;      // live checks run on a frame this size (long side)
const CHECK_EVERY = 250;     // ms between live checks
const STEADY_FRAMES = 3;     // checks in a row with the corners still
const STEADY_MOVE = 0.015;   // ...moving less than this share of the frame
const MIN_AREA = 0.25;       // the card must cover this share of the frame
const GLARE_LEVEL = 252;     // a pixel this bright in all 3 colours is glare
const GLARE_SHARE = 0.005;   // more than this share of the card is too much

export const canUseLiveCamera = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

export default function CameraCapture({ sideName, onPhoto }) {
  const live = canUseLiveCamera();
  const [failed, setFailed] = useState('');
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {live && !failed
        ? <LiveCamera sideName={sideName} onPhoto={onPhoto} onFail={setFailed} />
        : (
          <div className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {failed && <p style={{ margin: 0, color: 'var(--danger)' }}>{failed}</p>}
            <p style={{ margin: 0 }}>Take a photo of the <b>{sideName}</b> of the card.</p>
            <FileButton label="📷 Take a photo" capture onFile={onPhoto} primary />
          </div>
        )}
      <FileButton label="🖼️ Choose from gallery" onFile={onPhoto} />
    </div>
  );
}

function FileButton({ label, capture = false, onFile, primary = false }) {
  const ref = useRef(null);
  return (
    <>
      <button className={`btn ${primary ? 'btn-primary' : 'btn-ghost'}`} onClick={() => ref.current.click()}>{label}</button>
      <input ref={ref} type="file" accept="image/*" {...(capture ? { capture: 'environment' } : {})} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
    </>
  );
}

function LiveCamera({ sideName, onPhoto, onFail }) {
  const videoRef = useRef(null), overlayRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('Starting the camera…');
  const [auto, setAuto] = useState(true);
  const [taking, setTaking] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const takingRef = useRef(false);
  const takeRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const recent = [];

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setStatus('Looking for the card…');
        timer = setTimeout(check, CHECK_EVERY);
      } catch (err) {
        if (!stopped) onFail(err.name === 'NotAllowedError'
          ? 'The camera is blocked for this app. Allow it in the phone\'s settings, or use the buttons below.'
          : `The camera didn't start (${err.message}).`);
      }
    })();

    async function check() {
      if (stopped) return;
      const video = videoRef.current;
      if (!takingRef.current && video?.videoWidth) {
        try {
          const s = FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight);
          const fw = Math.round(video.videoWidth * s), fh = Math.round(video.videoHeight * s);
          const c = new OffscreenCanvas(fw, fh);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, fw, fh);
          const frame = ctx.getImageData(0, 0, fw, fh);
          const pixels = new Uint8ClampedArray(frame.data);     // kept: the frame itself goes to the worker
          const found = await detectInFrame(frame);
          if (stopped) return;
          const quad = found.quad;
          drawOverlay(quad, fw, fh);
          if (!quad) { recent.length = 0; setStatus(found.cutOff ? 'Move back a little: the whole card must be in the picture, with a gap round it' : 'Looking for the card…'); }
          else {
            recent.push(quad);
            if (recent.length > STEADY_FRAMES) recent.shift();
            const area = polygonArea(quad) / (fw * fh);
            const glare = glareShare(pixels, fw, fh, quad);
            const steady = recent.length === STEADY_FRAMES && maxMove(recent) < STEADY_MOVE * Math.hypot(fw, fh);
            if (area < MIN_AREA) setStatus('Move closer: the card should fill most of the picture');
            else if (glare > GLARE_SHARE) setStatus('Glare on the card: move the light or tilt the card a little');
            else if (!steady) setStatus('Hold still…');
            else {
              setStatus('Looks good');
              if (autoRef.current) { take(); return; }
            }
          }
        } catch { /* a missed frame: try the next one */ }
      }
      timer = setTimeout(check, CHECK_EVERY);
    }

    function drawOverlay(quad, fw, fh) {
      const canvas = overlayRef.current, video = videoRef.current;
      if (!canvas || !video) return;
      const w = video.clientWidth, h = video.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // where the video sits inside its box (object-fit: contain)
      const k = Math.min(w / fw, h / fh), ox = (w - fw * k) / 2, oy = (h - fh * k) / 2;
      // a guide in the card's shape
      const gh = fh * k * 0.85, gw = gh * 63 / 88;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect((w - gw) / 2, (h - gh) / 2, gw, gh);
      ctx.setLineDash([]);
      if (quad) {
        ctx.strokeStyle = '#3f6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        quad.forEach(([x, y], i) => (i ? ctx.lineTo(ox + (x + 0.5) * k, oy + (y + 0.5) * k) : ctx.moveTo(ox + (x + 0.5) * k, oy + (y + 0.5) * k)));
        ctx.closePath();
        ctx.stroke();
      }
    }

    async function take() {
      if (takingRef.current) return;
      takingRef.current = true;
      setTaking(true);
      setStatus('Taking the photo…');
      try {
        onPhoto(await fullPhoto(streamRef.current, videoRef.current));
      } catch (err) {
        takingRef.current = false;
        setTaking(false);
        setStatus(`The photo didn't work (${err.message}). Try again.`);
        timer = setTimeout(check, CHECK_EVERY);
      }
    }
    takeRef.current = take;

    return () => {
      stopped = true;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ position: 'relative', background: '#000', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: '65vh', display: 'block', objectFit: 'contain' }} />
        <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      </div>
      <div style={{ fontWeight: 600, minHeight: '1.4em' }}>{status}</div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={taking} onClick={() => takeRef.current?.()} style={{ minWidth: 140, minHeight: 48 }}>
          📸 Take {sideName} photo
        </button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Take it by itself when steady
        </label>
      </div>
    </div>
  );
}

// A photo at the camera's full resolution. ImageCapture gives the camera's
// real still photo where the phone supports it; otherwise the current video
// frame at the video's own resolution.
async function fullPhoto(stream, video) {
  const track = stream?.getVideoTracks()[0];
  if (track && 'ImageCapture' in window) {
    try {
      return await new window.ImageCapture(track).takePhoto();
    } catch { /* fall back to the video frame */ }
  }
  const c = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  c.getContext('2d').drawImage(video, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}

function polygonArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function maxMove(list) {
  let m = 0;
  for (let i = 1; i < list.length; i++) {
    for (let k = 0; k < 4; k++) m = Math.max(m, Math.hypot(list[i][k][0] - list[i - 1][k][0], list[i][k][1] - list[i - 1][k][1]));
  }
  return m;
}

// Share of the card's pixels that are blown out white.
function glareShare(data, w, h, quad) {
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  let inside = 0, bright = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!insideQuad(quad, x, y)) continue;
      inside++;
      const i = (y * w + x) * 4;
      if (data[i] >= GLARE_LEVEL && data[i + 1] >= GLARE_LEVEL && data[i + 2] >= GLARE_LEVEL) bright++;
    }
  }
  return inside ? bright / inside : 0;
}

// Point inside a convex 4-cornered shape (all edges turn the same way).
function insideQuad(q, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
  }
  return true;
}
