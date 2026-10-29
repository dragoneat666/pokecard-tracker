// components/HoverPreview.jsx — Card image popup on hover
//
// Wraps a card name; hovering it shows the card picture next to the name.
// The popup is position: fixed so the table's overflow clipping can't cut it
// off, and it flips to the left / clamps vertically to stay on screen.
//
// Single picture (imageUrl): the CDN URL already saved on each card (a _200w
// thumbnail). The same CDN serves a _400w version, which looks much better at
// popup size, so we try that first and fall back to the saved URL.
//
// Several pictures (images, e.g. [front, back] for Topps cards): shown side by
// side at their stored size. Empty entries are skipped.

import { useState } from 'react';

const POPUP_W = 260;
const POPUP_H = 364;   // cards are 5:7
const SIDE_W = 240;    // each picture in the side-by-side popup
const SIDE_H = 336;
const GAP = 12;

export default function HoverPreview({ imageUrl, images, children }) {
  const [pos, setPos]       = useState(null);
  const [useSmall, setUseSmall] = useState(false);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState({});     // url -> true once it fails to load

  const multi = Array.isArray(images);
  const shown = multi ? images.filter(u => u && !broken[u]) : [];
  if (multi ? shown.length === 0 : !imageUrl) return children;

  const width  = multi ? shown.length * SIDE_W + (shown.length - 1) * 8 + 16 : POPUP_W;
  const height = multi ? SIDE_H + 16 : POPUP_H;

  function handleEnter(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    let left = rect.right + GAP;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - width - GAP);
    }
    const top = Math.min(
      Math.max(8, rect.top + rect.height / 2 - height / 2),
      window.innerHeight - height - 8
    );
    setPos({ left, top });
  }

  const frame = {
    position: 'fixed',
    left: pos?.left,
    top: pos?.top,
    zIndex: 300,
    pointerEvents: 'none',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  };

  if (multi) {
    return (
      <span onMouseEnter={handleEnter} onMouseLeave={() => setPos(null)}>
        {children}
        {pos && (
          <span style={{ ...frame, display: 'flex', gap: 8, padding: 8 }}>
            {shown.map(url => (
              <img
                key={url}
                src={url}
                alt=""
                onError={() => setBroken(b => ({ ...b, [url]: true }))}
                style={{ width: SIDE_W, height: SIDE_H, objectFit: 'contain' }}
              />
            ))}
          </span>
        )}
      </span>
    );
  }

  const src = useSmall ? imageUrl : imageUrl.replace('_200w', '_400w');

  return (
    <span onMouseEnter={handleEnter} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && !failed && (
        <img
          src={src}
          alt=""
          onError={() => (useSmall ? setFailed(true) : setUseSmall(true))}
          style={{
            ...frame,
            width: POPUP_W,
            height: POPUP_H,
            objectFit: 'contain',
          }}
        />
      )}
    </span>
  );
}
