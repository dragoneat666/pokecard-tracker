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
// side at their stored size. Empty entries are skipped. imageSize changes the
// size of each picture (coins are round, not card-shaped), and caption adds a
// paragraph of text under them (a coin's description); the popup is measured
// once it's on screen so a long caption still can't push it off the bottom.

import { useState, useRef, useLayoutEffect } from 'react';

const POPUP_W = 260;
const POPUP_H = 364;   // cards are 5:7
const SIDE_W = 240;    // each picture in the side-by-side popup
const SIDE_H = 336;
const CAPTION_W = 400; // the popup is at least this wide when it has a caption
const GAP = 12;

export default function HoverPreview({ imageUrl, images, imageSize, caption, children }) {
  const [pos, setPos]       = useState(null);
  const [useSmall, setUseSmall] = useState(false);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState({});     // url -> true once it fails to load
  const popupRef = useRef(null);

  // Once a captioned popup is showing, move it up if it's taller than guessed.
  useLayoutEffect(() => {
    if (!pos || !caption || !popupRef.current) return;
    const maxTop = Math.max(8, window.innerHeight - popupRef.current.offsetHeight - 8);
    if (pos.top > maxTop) setPos(p => ({ ...p, top: maxTop }));
  }, [pos, caption]);

  const multi = Array.isArray(images);
  const shown = multi ? images.filter(u => u && !broken[u]) : [];
  if (multi ? shown.length === 0 && !caption : !imageUrl) return children;

  const sideW = imageSize?.w ?? SIDE_W;
  const sideH = imageSize?.h ?? SIDE_H;
  const picturesW = shown.length * sideW + Math.max(0, shown.length - 1) * 8 + 16;
  const width  = multi ? (caption ? Math.max(picturesW, CAPTION_W) : picturesW) : POPUP_W;
  const height = multi ? (shown.length > 0 ? sideH + 16 : 0) + (caption ? 120 : 0) : POPUP_H;

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
          <span
            ref={popupRef}
            style={{
              ...frame,
              display: 'flex', flexDirection: 'column', gap: 8, padding: 8,
              ...(caption && { width, boxSizing: 'border-box' }),
            }}
          >
            {shown.length > 0 && (
              <span style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {shown.map(url => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    onError={() => setBroken(b => ({ ...b, [url]: true }))}
                    style={{ width: sideW, height: sideH, objectFit: 'contain' }}
                  />
                ))}
              </span>
            )}
            {caption && (
              <span style={{
                fontSize: '0.75rem', lineHeight: 1.45, color: 'var(--text-secondary)',
                fontWeight: 400, whiteSpace: 'normal', padding: '0 4px 2px',
              }}>
                {caption}
              </span>
            )}
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
