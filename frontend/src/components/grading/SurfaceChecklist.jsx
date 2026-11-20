// components/grading/SurfaceChecklist.jsx — The surface checklist for one side
//
// Each thing on the list (settings.surface.items) is None / Slight / Obvious,
// picked by eye with the card in hand.

import { LEVELS } from '../../grading/surface.js';

export default function SurfaceChecklist({ value, onChange, settings }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {settings.surface.items.map(it => (
        <div key={it.id} style={{ display: 'grid', gap: 4 }}>
          <div>
            <b>{it.label}</b>
            {it.hint && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> — {it.hint}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {LEVELS.map(level => {
              const on = (value?.[it.id] || 'none') === level.id;
              return (
                <button key={level.id} type="button"
                  className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minWidth: 76, minHeight: 36 }}
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, [it.id]: level.id })}>
                  {level.label}
                </button>
              );
            })}
            {it.caps && (value?.[it.id] === 'slight' || value?.[it.id] === 'obvious') && (
              <span style={{ alignSelf: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                up to {it.caps[value[it.id] === 'slight' ? 0 : 1]}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
