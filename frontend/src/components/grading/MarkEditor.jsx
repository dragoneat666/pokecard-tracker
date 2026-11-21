// components/grading/MarkEditor.jsx — "Add a mark": the user's own marks on
// one side of the card
//
// Tap the card's picture where something is (a nick the edges check missed,
// a dent, a scratch...), then pick what it is. Marks are kept with the copy
// ({ id, kind, x, y }, x/y in mm from the card's top-left corner): a nick
// counts towards the edges, the others tick their checklist item (at least
// Slight) when added. They also record where each thing is, so a trained
// checker could learn from them later.

import { useState } from 'react';
import { MARK_KINDS } from '../../grading/surface.js';
import { EdgesCard } from './EdgesReview.jsx';

export default function MarkEditor({ edges, marks, onAdd, onRemove }) {
  const [open, setOpen] = useState(marks.length > 0);
  const [pending, setPending] = useState(null);       // { x, y } waiting for its kind
  if (!edges) return null;
  if (!open) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={() => setOpen(true)}>Add a mark (something the checks missed)</button>
      </div>
    );
  }
  const shown = pending ? [...marks, { id: 'pending', kind: 'other', ...pending }] : marks;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
      <b>Marks</b>
      <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
        Tap the picture where something is, then pick what it is.
      </span>
      <EdgesCard edges={edges} maxWidth={320} userMarks={shown} onTap={(x, y) => setPending({ x, y })} />
      {pending && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MARK_KINDS.map(k => (
            <button key={k.id} className="btn btn-sm btn-primary" onClick={() => { onAdd({ id: `m${Date.now()}`, kind: k.id, ...pending }); setPending(null); }}>
              {k.label}
            </button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      {marks.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {marks.map(m => {
            const k = MARK_KINDS.find(x => x.id === m.kind);
            return (
              <div key={m.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '0.9rem' }}>
                <b style={{ color: 'rgb(230, 200, 0)', minWidth: 14 }}>{k?.letter || '?'}</b>
                <span style={{ flex: 1 }}>{k?.label || m.kind} <span style={{ color: 'var(--text-muted)' }}>({where(m, edges)})</span></span>
                <button className="btn btn-ghost btn-sm" onClick={() => onRemove(m.id)}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// "near the top edge", "top-left corner", "middle"
function where(m, edges) {
  const w = edges.scan.W / edges.scan.ppm, h = edges.scan.H / edges.scan.ppm;
  const near = 6;
  const v = m.y < near ? 'top' : m.y > h - near ? 'bottom' : '';
  const s = m.x < near ? 'left' : m.x > w - near ? 'right' : '';
  if (v && s) return `${v}-${s} corner`;
  if (v || s) return `near the ${v || s} edge`;
  return 'on the card';
}
