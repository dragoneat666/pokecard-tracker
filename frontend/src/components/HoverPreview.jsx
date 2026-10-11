// components/HoverPreview.jsx — Card image popup on hover
//
// Wraps a card name; hovering it shows the card picture next to the name.
// The popup is position: fixed so the table's overflow clipping can't cut it
// off, and it flips to the left / clamps vertically to stay on screen.
//
// Images come from the CDN URL already saved on each card (image_url, a
// _200w thumbnail). The same CDN serves a _400w version, which looks much
// better at popup size, so we try that first and fall back to the saved URL.

import { useState } from 'react';

const POPUP_W = 260;
const POPUP_H = 364;   // cards are 5:7
const GAP = 12;

export default function HoverPreview({ imageUrl, children }) {
  const [pos, setPos]       = useState(null);
  const [useSmall, setUseSmall] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!imageUrl) return children;

  function handleEnter(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    let left = rect.right + GAP;
    if (left + POPUP_W > window.innerWidth - 8) {
      left = Math.max(8, rect.left - POPUP_W - GAP);
    }
    const top = Math.min(
      Math.max(8, rect.top + rect.height / 2 - POPUP_H / 2),
      window.innerHeight - POPUP_H - 8
    );
    setPos({ left, top });
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
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            width: POPUP_W,
            height: POPUP_H,
            objectFit: 'contain',
            zIndex: 300,
            pointerEvents: 'none',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        />
      )}
    </span>
  );
}
