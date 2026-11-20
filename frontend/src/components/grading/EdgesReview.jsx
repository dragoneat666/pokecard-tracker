// components/grading/EdgesReview.jsx — The edges check for one side of a card
//
// The straightened card with every whitened spot marked just outside its
// edge (numbered), edges that couldn't be checked marked in amber, and a
// close-up of each spot from every photo so it can be judged by eye. A spot
// that isn't whitening (dirt, a glint, a printed mark) can be marked "Not
// whitening" and stops counting.

import { useEffect, useRef } from 'react';
import { trackGeometry, TRACK_NAMES, TRACKS } from '../../grading/edges.js';
import { drawCanvas, imageCanvas, useCanvasWidth } from './canvasTools.js';

const RED = 'rgba(255, 40, 40, 0.95)';
const GREY = 'rgba(150, 150, 150, 0.8)';
const AMBER = 'rgba(255, 180, 0, 0.9)';

// Spots in the order they go round the card.
export function orderedSpots(spots) {
  return [...spots].sort((a, b) => TRACKS.indexOf(a.track) - TRACKS.indexOf(b.track) || a.from - b.from);
}

export default function EdgesReview({ edges, onToggle }) {
  const { scan, spots, ignored, doubtTracks, combined, margin, image, imageB } = edges;
  // the turned photos (the tuning page passes one as imageB)
  const extras = edges.extras || (imageB ? [{ image: imageB, label: 'sideways' }] : []);
  const list = orderedSpots(spots).filter(sp => !sp.doubt);
  const skip = new Set(ignored);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <EdgesCard edges={edges} maxWidth={360} />
      {doubtTracks.length > 0 && (
        <p style={{ margin: 0, color: 'var(--warning)' }}>
          ⚠️ The {namesOf(doubtTracks)} may only be glinting in the light (marked in amber), so
          {' '}they weren't counted. A second photo with the card turned sideways checks them.
        </p>
      )}
      {list.length === 0
        ? <p style={{ margin: 0 }}>No whitening found{doubtTracks.length ? ' on the edges that could be checked' : ''}.</p>
        : (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {list.map((sp, n) => (
              <div key={sp.id} style={{ display: 'grid', gap: 6, opacity: skip.has(sp.id) ? 0.55 : 1 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b>{n + 1}.</b>
                  <span>{cap(TRACK_NAMES[sp.track])}: {sp.lengthMm} mm long, up to {sp.depthMm} mm deep</span>
                  {skip.has(sp.id) && <span style={{ color: 'var(--text-muted)' }}>(not counted)</span>}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <SpotCrop image={image} margin={margin} scan={scan} spot={sp} label={combined ? 'photo 1' : null} />
                  {extras.map((x, i) => x.image && (
                    <SpotCrop key={i} image={x.image} margin={margin} scan={scan} spot={sp} label={`photo ${i + 2} (${x.label})`} />
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => onToggle(sp.id)}>
                    {skip.has(sp.id) ? 'Count it again' : 'Not whitening'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// The card with the spots marked round it. Also used small on the result
// page, and for saved copies, where image is the saved picture (an <img>)
// and marks can be turned off.
export function EdgesCard({ edges, maxWidth = 360, marks = true }) {
  const { scan, spots, ignored, doubtTracks, margin, image } = edges;
  const [wrapRef, cssW] = useCanvasWidth();
  const ref = useRef(null);
  useEffect(() => {
    if (!cssW || !image) return;
    const w = Math.min(cssW, maxWidth), s = w / image.width, h = Math.round(image.height * s);
    const src = image.data ? imageCanvas(image) : image;
    const geo = trackGeometry(scan.W, scan.H, scan.R);
    const skip = new Set(ignored);
    const out = 0.5 * scan.ppm;                 // marks this far outside the edge
    const at = (key, i) => {
      const p = geo.point(key, Math.max(0, Math.min(geo.n[key] - 1, i)));
      return [(p.x - p.nx * out + margin) * s, (p.y - p.ny * out + margin) * s];
    };
    const stroke = (ctx, key, from, to) => {
      ctx.beginPath();
      for (let i = from; i <= to; i += 2) { const [x, y] = at(key, i); i === from ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      const [x, y] = at(key, to); ctx.lineTo(x, y);
      ctx.stroke();
    };
    drawCanvas(ref.current, w, h, (ctx) => {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      if (!marks) return;
      ctx.lineCap = 'round';
      ctx.setLineDash([4, 4]); ctx.strokeStyle = AMBER; ctx.lineWidth = 2;
      for (const key of doubtTracks) stroke(ctx, key, 0, geo.n[key] - 1);
      ctx.setLineDash([]);
      const list = orderedSpots(spots).filter(sp => !sp.doubt);
      ctx.font = 'bold 12px system-ui, sans-serif';
      list.forEach((sp, n) => {
        ctx.strokeStyle = skip.has(sp.id) ? GREY : RED;
        ctx.lineWidth = 4;
        // at least a few pixels long on screen, so a short spot still shows
        const grow = Math.max(0, Math.ceil((6 / s - (sp.to - sp.from)) / 2));
        stroke(ctx, sp.track, sp.from - grow, sp.to + grow);
        // its number on a dot just inside the card
        const p = geo.point(sp.track, Math.round((sp.from + sp.to) / 2));
        const inset = Math.max(3 * scan.ppm, 12 / s);
        const lx = (p.x + p.nx * inset + margin) * s, ly = (p.y + p.ny * inset + margin) * s;
        ctx.fillStyle = skip.has(sp.id) ? GREY : RED;
        ctx.beginPath(); ctx.arc(lx, ly, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(n + 1), lx, ly + 0.5);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      });
    });
  }, [image, scan, spots, ignored, doubtTracks, margin, cssW, maxWidth, marks]);
  return <div ref={wrapRef}><canvas ref={ref} style={{ display: 'block', margin: '0 auto', borderRadius: 6 }} /></div>;
}

// A close-up of one spot: 3.5 mm square round its middle, 4 times bigger.
function SpotCrop({ image, margin, scan, spot, label }) {
  const ref = useRef(null);
  const size = 140;
  useEffect(() => {
    const geo = trackGeometry(scan.W, scan.H, scan.R);
    const p = geo.point(spot.track, Math.round((spot.from + spot.to) / 2));
    const half = 1.75 * scan.ppm;
    const cx = p.x + p.nx * 0.6 * scan.ppm + margin, cy = p.y + p.ny * 0.6 * scan.ppm + margin;
    const src = imageCanvas(image);
    drawCanvas(ref.current, size, size, (ctx) => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, cx - half, cy - half, 2 * half, 2 * half, 0, 0, size, size);
    });
  }, [image, margin, scan, spot]);
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 2, justifyItems: 'center' }}>
      <canvas ref={ref} style={{ borderRadius: 4, background: '#000' }} />
      {label && <figcaption style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</figcaption>}
    </figure>
  );
}

// "left and right edges", "top edge and top-left corner"
function namesOf(tracks) {
  const edges = tracks.filter(t => ['top', 'right', 'bottom', 'left'].includes(t));
  const corners = tracks.filter(t => !edges.includes(t));
  const parts = [];
  if (edges.length) parts.push(`${listText(edges)} edge${edges.length > 1 ? 's' : ''}`);
  if (corners.length) parts.push(`the corners next to ${edges.length > 1 ? 'them' : 'it'}`);
  return parts.join(' and ');
}
function listText(words) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
