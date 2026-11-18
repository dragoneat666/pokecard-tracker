// components/grading/CenteringEditor.jsx — Check / move the border lines
//
// The straightened card with the 4 inner border lines that were found
// (magenta). Tap a line (or its name) to pick it, then drag anywhere on the
// card, use the zoomed view, or the arrow buttons (one pixel = 0.05 mm per
// tap; hold to keep going). The card's own edges (cyan) can be shown and moved
// too, for a photo where the cut edge isn't quite where the corners put it.
//
// A line the finder wasn't sure about is drawn dashed: check that one.
// The numbers below follow the lines as they move.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasWidth, drawCanvas, imageCanvas, useHoldToRepeat } from './canvasTools.js';
import { measure } from '../../grading/centering.js';

const INNER = ['innerLeft', 'innerRight', 'innerTop', 'innerBottom'];
const OUTER = ['outerLeft', 'outerRight', 'outerTop', 'outerBottom'];
const LABEL = {
  innerLeft: 'Left', innerRight: 'Right', innerTop: 'Top', innerBottom: 'Bottom',
  outerLeft: 'Left edge', outerRight: 'Right edge', outerTop: 'Top edge', outerBottom: 'Bottom edge',
};
const SIDE_OF = { innerLeft: 'left', innerRight: 'right', innerTop: 'top', innerBottom: 'bottom' };
const vertical = (key) => /Left|Right/.test(key);
const ZOOM = 2;              // css px per card px in the zoomed view
const ZOOM_H = 140;

export default function CenteringEditor({ image, lines, sides, pxPerMm, onChange }) {
  const [picked, setPicked] = useState('innerLeft');
  const [showEdges, setShowEdges] = useState(false);
  const [wrapRef, cssW] = useCanvasWidth();
  const cardRef = useRef(null), zoomRef = useRef(null);
  const drag = useRef(null);
  const hold = useHoldToRepeat();
  const latest = useRef(lines);
  latest.current = lines;

  const source = useMemo(() => imageCanvas(image), [image]);
  const W = image.width, H = image.height;
  const scale = cssW ? cssW / W : 0;
  const cssH = Math.round(H * scale);
  const keys = showEdges ? [...INNER, ...OUTER] : INNER;
  const unsure = (key) => SIDE_OF[key] && sides?.[SIDE_OF[key]] && sides[SIDE_OF[key]].confidence < 0.6;

  useEffect(() => {
    if (!cssW) return;
    drawCanvas(cardRef.current, cssW, cssH, (ctx) => {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, cssW, cssH);
      for (const key of keys) drawLine(ctx, key, lines[key] * scale, cssW, cssH, key === picked, unsure(key));
    });
  });

  // Zoomed view around the middle of the picked line.
  useEffect(() => {
    if (!cssW) return;
    const v = vertical(picked);
    const cx = v ? lines[picked] : W / 2, cy = v ? H / 2 : lines[picked];
    drawCanvas(zoomRef.current, cssW, ZOOM_H, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cssW, ZOOM_H);
      ctx.imageSmoothingEnabled = false;
      const sw = cssW / ZOOM, sh = ZOOM_H / ZOOM;
      ctx.drawImage(source, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, cssW, ZOOM_H);
      const toZoom = (key) => vertical(key) ? (lines[key] - cx) * ZOOM + cssW / 2 : (lines[key] - cy) * ZOOM + ZOOM_H / 2;
      for (const key of keys) {
        if (vertical(key) !== v) continue;
        drawLine(ctx, key, toZoom(key), cssW, ZOOM_H, key === picked, unsure(key), 1);
      }
    });
  });

  // Keeps each line between its card edge and the opposite line.
  function place(key, value) {
    const l = latest.current;
    const limits = {
      outerLeft: [-0.25 * W, l.innerLeft - 1], innerLeft: [l.outerLeft + 1, l.innerRight - 1],
      innerRight: [l.innerLeft + 1, l.outerRight - 1], outerRight: [l.innerRight + 1, 1.25 * W],
      outerTop: [-0.25 * H, l.innerTop - 1], innerTop: [l.outerTop + 1, l.innerBottom - 1],
      innerBottom: [l.innerTop + 1, l.outerBottom - 1], outerBottom: [l.innerBottom + 1, 1.25 * H],
    }[key];
    const v = Math.round(Math.max(limits[0], Math.min(limits[1], value)) * 100) / 100;
    if (v !== l[key]) onChange({ ...l, [key]: v });
  }

  function start(e, where) {
    let key = picked;
    if (where === 'card') {
      // Tapping near a line picks it.
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      let best = 24;
      for (const k of keys) {
        const d = Math.abs((vertical(k) ? px : py) - lines[k] * scale);
        if (d < best) { best = d; key = k; }
      }
      if (key !== picked) setPicked(key);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { key, x: e.clientX, y: e.clientY, from: lines[key], rate: where === 'card' ? 1 : 1 / ZOOM };
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    const delta = vertical(d.key) ? e.clientX - d.x : e.clientY - d.y;
    place(d.key, d.from + delta * d.rate);
  }
  const end = () => { drag.current = null; };

  const nudge = (step) => hold(() => place(picked, latest.current[picked] + step));
  const m = measure(lines, pxPerMm);
  const v = vertical(picked);

  return (
    <div ref={wrapRef} style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <canvas ref={cardRef} style={{ touchAction: 'none', display: 'block', borderRadius: 6 }}
        onPointerDown={e => start(e, 'card')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {keys.map(k => (
          <button key={k} className={`btn btn-sm ${k === picked ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPicked(k)}>
            {LABEL[k]}{unsure(k) ? ' ⚠' : ''}
          </button>
        ))}
      </div>

      <canvas ref={zoomRef} style={{ touchAction: 'none', display: 'block', borderRadius: 6 }}
        onPointerDown={e => start(e, 'zoom')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" style={nudgeBtn} {...nudge(-1)} aria-label="Move the line one pixel">{v ? '◀' : '▲'}</button>
        <button className="btn" style={nudgeBtn} {...nudge(1)} aria-label="Move the line one pixel the other way">{v ? '▶' : '▼'}</button>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {LABEL[picked]}: each tap moves it 0.05 mm
        </span>
      </div>
      {unsure(picked) && (
        <span style={{ color: 'var(--warning, #e0a030)', fontSize: '0.85rem' }}>
          ⚠ Not sure about this line: check it sits where the border ends.
        </span>
      )}

      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9rem' }}>
        <input type="checkbox" checked={showEdges} onChange={e => {
          setShowEdges(e.target.checked);
          if (!e.target.checked && OUTER.includes(picked)) setPicked(picked.replace('outer', 'inner'));
        }} />
        Card edge lines (only if the card's cut edge needs moving)
      </label>

      <table style={{ fontSize: '0.9rem', borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={cellKey}>Left / right</td><td><b>{m.leftRightText}</b> ({m.mm.left} mm / {m.mm.right} mm)</td></tr>
          <tr><td style={cellKey}>Top / bottom</td><td><b>{m.topBottomText}</b> ({m.mm.top} mm / {m.mm.bottom} mm)</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function drawLine(ctx, key, pos, w, h, picked, dashed, widthScale = 1) {
  ctx.save();
  ctx.strokeStyle = key.startsWith('inner') ? 'rgba(255, 0, 255, 0.95)' : 'rgba(0, 230, 255, 0.95)';
  ctx.lineWidth = (picked ? 2.5 : 1.25) * widthScale;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.beginPath();
  if (vertical(key)) { ctx.moveTo(pos, 0); ctx.lineTo(pos, h); } else { ctx.moveTo(0, pos); ctx.lineTo(w, pos); }
  ctx.stroke();
  ctx.restore();
}

const nudgeBtn = { minWidth: 52, minHeight: 44, fontSize: '1.1rem', touchAction: 'none', userSelect: 'none' };
const cellKey = { color: 'var(--text-muted)', paddingRight: 12, whiteSpace: 'nowrap' };
