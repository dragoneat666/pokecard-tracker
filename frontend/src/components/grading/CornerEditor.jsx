// components/grading/CornerEditor.jsx — Check / move the card's 4 corners
//
// Shows the photo with the corners that were found. Tap near a corner to pick
// it and drag it (it follows the finger; the zoomed view below shows it up
// close while the finger covers it). Dragging on the zoomed view moves the
// picked corner in small steps, for placing it exactly. The corners to aim
// for are where the card's straight edges would meet (just outside the
// rounded corner), which is what the finder places them on.
//
// quad = [[x, y] x4] in the photo's pixels: top-left, top-right,
// bottom-right, bottom-left of the card, upright.

import { useEffect, useRef, useState } from 'react';
import { useCanvasWidth, drawCanvas } from './canvasTools.js';

const NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const ZOOM = 1.5;            // css px per photo px in the zoomed view

export default function CornerEditor({ bitmap, quad, onChange }) {
  const [picked, setPicked] = useState(0);
  const [wrapRef, cssW] = useCanvasWidth();
  const photoRef = useRef(null), zoomRef = useRef(null);
  const small = useRef(null);
  const drag = useRef(null);

  // The part of the photo shown: the card with some room round it (fixed for
  // this photo, so it doesn't jump about while a corner is dragged), which
  // keeps the card big on a phone screen even if the photo has lots of table.
  const [view] = useState(() => viewAround(bitmap, quad));
  const scale = cssW ? cssW / view.w : 0;                // css px per photo px
  const cssH = Math.round(view.h * scale);
  const toCss = ([x, y]) => [(x - view.x) * scale, (y - view.y) * scale];

  // A small copy of that part to redraw quickly while dragging.
  useEffect(() => {
    if (!cssW) return;
    const dpr = window.devicePixelRatio || 1;
    const c = new OffscreenCanvas(Math.round(cssW * dpr), Math.round(cssH * dpr));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, view.x, view.y, view.w, view.h, 0, 0, c.width, c.height);
    small.current = c;
  }, [bitmap, view, cssW, cssH]);

  useEffect(() => {
    if (!cssW || !small.current) return;
    drawCanvas(photoRef.current, cssW, cssH, (ctx) => {
      ctx.drawImage(small.current, 0, 0, cssW, cssH);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3f6';
      ctx.beginPath();
      quad.map(toCss).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      quad.map(toCss).forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, i === picked ? 10 : 7, 0, Math.PI * 2);
        ctx.fillStyle = i === picked ? 'rgba(255, 64, 160, 0.9)' : 'rgba(63, 255, 102, 0.8)';
        ctx.fill();
      });
    });
  });

  // Zoomed view: 1 photo pixel = ZOOM css pixels, around the picked corner.
  useEffect(() => {
    if (!cssW) return;
    const h = 160;
    const [cx, cy] = quad[picked];
    drawCanvas(zoomRef.current, cssW, h, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cssW, h);
      ctx.imageSmoothingEnabled = false;
      const sw = cssW / ZOOM, sh = h / ZOOM;
      ctx.drawImage(bitmap, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, cssW, h);
      // the card's outline near the corner
      ctx.strokeStyle = '#3f6';
      ctx.lineWidth = 1.5;
      const map = ([x, y]) => [(x - cx) * ZOOM + cssW / 2, (y - cy) * ZOOM + h / 2];
      const prev = quad[(picked + 3) % 4], next = quad[(picked + 1) % 4];
      ctx.beginPath();
      ctx.moveTo(...map(prev)); ctx.lineTo(...map(quad[picked])); ctx.lineTo(...map(next));
      ctx.stroke();
      // cross-hair on the corner
      ctx.strokeStyle = 'rgba(255, 64, 160, 0.95)';
      ctx.beginPath();
      ctx.moveTo(cssW / 2 - 12, h / 2); ctx.lineTo(cssW / 2 + 12, h / 2);
      ctx.moveTo(cssW / 2, h / 2 - 12); ctx.lineTo(cssW / 2, h / 2 + 12);
      ctx.stroke();
    });
  }, [bitmap, quad, picked, cssW]);

  function start(e, speed) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let which = picked;
    if (speed === 'photo') {
      // Tapping near a corner picks it.
      let best = 36;
      quad.map(toCss).forEach(([x, y], i) => {
        const d = Math.hypot(x - px, y - py);
        if (d < best) { best = d; which = i; }
      });
      if (which !== picked) setPicked(which);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: quad[which], which,
      // photo pixels moved per css pixel of finger movement
      rate: speed === 'photo' ? 1 / scale : 1 / ZOOM };
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    const nx = clamp(d.from[0] + (e.clientX - d.x) * d.rate, 0, bitmap.width - 1);
    const ny = clamp(d.from[1] + (e.clientY - d.y) * d.rate, 0, bitmap.height - 1);
    onChange(quad.map((p, i) => (i === d.which ? [nx, ny] : p)));
  }
  const end = () => { drag.current = null; };

  return (
    <div ref={wrapRef} style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <canvas ref={photoRef} style={{ touchAction: 'none', borderRadius: 'var(--radius-md)', display: 'block' }}
        onPointerDown={e => start(e, 'photo')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        {NAMES.map((n, i) => (
          <button key={n} className={`btn btn-sm ${i === picked ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPicked(i)}>{n}</button>
        ))}
      </div>
      <canvas ref={zoomRef} style={{ touchAction: 'none', borderRadius: 'var(--radius-md)', display: 'block' }}
        onPointerDown={e => start(e, 'zoom')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
        The {NAMES[picked]} corner, close up. Drag here for fine moves. Aim for where the card's two straight edges would meet.
      </span>
    </div>
  );
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The card's outline plus a quarter of its size on every side, inside the photo.
function viewAround(bitmap, quad) {
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const pad = 0.25 * Math.max(w, h);
  const x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad);
  const x1 = Math.min(bitmap.width, Math.max(...xs) + pad), y1 = Math.min(bitmap.height, Math.max(...ys) + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
