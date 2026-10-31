// components/SheetControls.jsx — Small controls shared by the hand-built checklists
//
// Used by the Topps checklist and Coins pages, which are both edited like a
// sheet:
//   EditableText  — a text box that saves when you leave it
//   PictureField  — a picture URL box with a small preview (and optional file upload)
//   CellBox       — the have / need checkbox (or a dash when it doesn't exist)

import { useState, useRef } from 'react';
import HoverPreview from './HoverPreview.jsx';

// A text box that saves when you leave it (or press Enter); Escape undoes.
// The key makes it pick up the server's value after each edit, including when
// an edit was rejected and the box should snap back.
export function EditableText({ value, resetKey, onSave, required = false, placeholder, style }) {
  return (
    <input
      key={`${value}|${resetKey}`}
      className="input"
      defaultValue={value}
      placeholder={placeholder}
      style={{ padding: '4px 8px', ...style }}
      onBlur={e => {
        const next = e.target.value.trim();
        if (next === value) return;
        if (required && !next) { e.target.value = value; return; }
        onSave(next);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
      }}
    />
  );
}

// A picture URL box with a small preview (hover it for full size). Saving
// downloads the picture on the server, so the box shows a spinner meanwhile
// and then the stored copy's URL. Empty = no picture. round = coin-shaped preview.
// onUpload(file), if given, adds a ⬆ button to pick a picture file (a scan)
// instead of pasting a link.
export function PictureField({ url, resetKey, placeholder, onSave, onUpload, round = false }) {
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const value = url || '';
  const thumb = round ? { width: 30, height: 30, borderRadius: '50%' } : { width: 24, height: 34, borderRadius: 3 };

  async function save(action) {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  }

  function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = '';             // so the same file can be picked again
    if (file) save(() => onUpload(file));
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: thumb.width, height: thumb.height, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {saving ? (
          <span className="spinner" style={{ width: 14, height: 14 }} />
        ) : url ? (
          <HoverPreview images={[url]} imageSize={round ? { w: 240, h: 240 } : undefined}>
            <img src={url} alt="" style={{ ...thumb, objectFit: 'cover', display: 'block' }} />
          </HoverPreview>
        ) : null}
      </div>
      <input
        key={`${value}|${resetKey}`}
        className="input"
        defaultValue={value}
        placeholder={placeholder}
        disabled={saving}
        title={value}
        style={{ padding: '4px 8px', width: 170, fontSize: '0.75rem' }}
        onBlur={e => {
          const next = e.target.value.trim();
          if (next !== value) save(() => onSave(next));
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
        }}
      />
      {onUpload && (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Upload a picture file (a scan)"
            disabled={saving}
            onClick={() => fileRef.current?.click()}
            style={{ padding: '2px 8px', fontSize: '0.8rem' }}
          >
            ⬆
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={pickFile} />
        </>
      )}
    </div>
  );
}

// Same look as the checkboxes on the card table; "none" is a dash.
export function CellBox({ state, editable, onClick, title }) {
  if (state === 'none') {
    return (
      <div
        title={editable ? `${title} (doesn't exist — click to add)` : undefined}
        onClick={editable ? onClick : undefined}
        style={{
          width: 18, height: 18, margin: '0 auto', borderRadius: 4,
          border: editable ? '2px dashed rgba(255,255,255,0.3)' : 'none',
          color: 'var(--text-muted)', opacity: 0.6, lineHeight: '14px', textAlign: 'center',
          cursor: editable ? 'pointer' : 'default',
        }}
      >
        —
      </div>
    );
  }
  const checked = state === 'have';
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      style={{
        width: 18,
        height: 18,
        margin: '0 auto',
        borderRadius: 4,
        border: `2px solid ${checked ? 'var(--success)' : 'rgba(255,255,255,0.5)'}`,
        background: checked ? 'var(--success)' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all var(--transition)',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}
