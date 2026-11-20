// components/grading/CardCopies.jsx — A card's saved copies, and comparing two
//
// CardView: the card picked on the Grading tab with its saved copies (each
// with its estimate and keep / sell / undecided), and buttons to check
// another copy or compare.
// CompareView: two copies side by side, what differs, which to keep (advice),
// and Keep A / Keep B. Keeping one marks the other "to sell"; nothing ever
// unticks an ownership box.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { gradingImage } from '../../api.js';
import { estimateOf, gradeText, compareCopies } from '../../grading/estimate.js';
import { surfaceText } from '../../grading/surface.js';
import { reverseName } from './CardPicker.jsx';

const STATUS = {
  checked: { text: 'Not decided', color: 'var(--text-secondary)' },
  keep: { text: 'Keeping', color: 'var(--success)' },
  sell: { text: 'To sell', color: 'var(--warning)' },
};

// The copies of one slot that are still in the running (not already "sell"):
// the kept one first, then oldest to newest.
export function candidatesOf(copies, slot) {
  return copies
    .filter(c => c.slot === slot && c.status !== 'sell')
    .sort((a, b) => (b.status === 'keep') - (a.status === 'keep') || new Date(a.created_at) - new Date(b.created_at));
}

export function CardHeader({ card, slot, onSlot }) {
  const owned = slot === 'reverse' ? card.reverse_owned : card.owned;
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
      {card.image_url && <img src={card.image_url} alt="" style={{ width: 56, borderRadius: 4, flex: 'none' }} />}
      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <b>{card.name}{slot === 'reverse' ? ` (${reverseName(card)})` : ''}</b>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <Link to={`/sets/${card.set_id}`}>{card.set_name}</Link> · {card.card_number} · you own {owned}
        </span>
        {card.has_reverse && onSlot && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {['regular', 'reverse'].map(s => (
              <button key={s} className={`btn btn-sm ${slot === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onSlot(s)}>
                {s === 'regular' ? 'Regular' : reverseName(card)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CardView({ data, slot, settings, notice, onSlot, onCheck, onCompare, onDelete, onStatus, onLabel, onBack }) {
  const { card, copies } = data;
  const mine = copies.filter(c => c.slot === slot);
  const candidates = candidatesOf(copies, slot);
  const owned = slot === 'reverse' ? card.reverse_owned : card.owned;
  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <CardHeader card={card} slot={slot} onSlot={onSlot} />
        {notice && <p style={{ margin: 0, color: 'var(--success)' }}>{notice}</p>}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={onCheck}>
            {mine.length ? 'Check another copy' : 'Check a copy'}
          </button>
          {candidates.length >= 2 && <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={onCompare}>Compare copies</button>}
          <button className="btn btn-ghost" onClick={onBack}>Pick another card</button>
        </div>
        {!mine.length && (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {owned >= 2
              ? 'Check each of your 2 copies (front and back) and save them here, then compare them to see which to keep.'
              : 'Check a copy to see what grade it might get, and save it here.'}
          </p>
        )}
      </section>
      {mine.map((copy, n) => (
        <CopyRow key={copy.id} copy={copy} n={n} settings={settings}
          onDelete={() => onDelete(copy)} onStatus={(s) => onStatus(copy, s)} onLabel={() => onLabel(copy)} />
      ))}
    </>
  );
}

function CopyRow({ copy, n, settings, onDelete, onStatus, onLabel }) {
  const est = estimateOf(copy.result?.sides, settings);
  const st = STATUS[copy.status] || STATUS.checked;
  return (
    <section className="panel" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Thumbs copy={copy} />
      <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b>{copy.label || `Copy ${n + 1}`}</b>
          <span style={{ color: st.color, fontSize: '0.85rem', fontWeight: 600 }}>{st.text}</span>
        </div>
        <div>Estimate: up to <b>{gradeText(est)}</b></div>
        {est?.limiting?.length > 0 && est.best < 10 && (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Limited by the {est.limiting.map(p => p.name).join(' and the ')}.</div>
        )}
        {!copy.result?.sides?.back && <div style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>Front only</div>}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saved {new Date(copy.created_at).toLocaleDateString()}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <button className="btn btn-ghost btn-sm" onClick={onLabel}>Rename</button>
          {copy.status === 'sell' && <button className="btn btn-ghost btn-sm" onClick={() => onStatus('checked')}>Not selling it</button>}
          {copy.status === 'keep' && <button className="btn btn-ghost btn-sm" onClick={() => onStatus('checked')}>Undo keep</button>}
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={onDelete}>Remove</button>
        </div>
      </div>
    </section>
  );
}

function Thumbs({ copy, size = 72 }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {['frontThumb', 'backThumb'].map(k => copy.images?.[k] && (
        <a key={k} href={gradingImage(copy.images[k.replace('Thumb', '')] || copy.images[k])} target="_blank" rel="noreferrer">
          <img src={gradingImage(copy.images[k])} alt={k === 'frontThumb' ? 'Front' : 'Back'} loading="lazy"
            style={{ width: size, borderRadius: 4, display: 'block' }} />
        </a>
      ))}
    </div>
  );
}

export function CompareView({ data, slot, settings, onKeep, onBack }) {
  const candidates = candidatesOf(data.copies, slot);
  // A = the kept one (or the first saved), B = the newest; either can be changed
  // when there are more than 2.
  const [pickA, setPickA] = useState(candidates[0]?.id);
  const [pickB, setPickB] = useState(candidates[candidates.length - 1]?.id);
  const a = candidates.find(c => c.id === pickA) || candidates[0];
  const b = candidates.find(c => c.id === pickB && c.id !== a?.id) || candidates.find(c => c.id !== a?.id);
  if (!a || !b) return null;
  const nameOf = (c) => c.label || `Copy ${data.copies.filter(x => x.slot === slot).indexOf(c) + 1}`;
  const v = compareCopies(a.result?.sides, b.result?.sides, settings);
  const missing = ['front', 'back'].flatMap(face => [[a, 'A'], [b, 'B']]
    .filter(([c]) => !c.result?.sides?.[face]).map(([, x]) => `copy ${x}'s ${face}`));

  return (
    <>
      <section className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <CardHeader card={data.card} slot={slot} />
        {candidates.length > 2 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: '0.9rem' }}>
            {[['A', a, setPickA], ['B', b, setPickB]].map(([x, c, set]) => (
              <label key={x} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {x}:
                <select className="input" value={c.id} onChange={e => set(Number(e.target.value))} style={{ width: 'auto' }}>
                  {candidates.map(o => <option key={o.id} value={o.id}>{nameOf(o)}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          {[['A', a], ['B', b]].map(([x, c]) => (
            <div key={x} style={{
              display: 'grid', gap: 6, justifyItems: 'center', padding: 6, borderRadius: 8,
              outline: v.winner === x.toLowerCase() ? '2px solid var(--success)' : 'none',
            }}>
              <b>{x}: {nameOf(c)}</b>
              <Thumbs copy={c} size={64} />
              <div style={{ fontSize: '0.9rem' }}>up to <b>{gradeText(v.estimates[x.toLowerCase()], false)}</b></div>
            </div>
          ))}
        </div>
        <p style={{ margin: 0, fontWeight: 600 }}>{v.headline}</p>
        {missing.length > 0 && (
          <p style={{ margin: 0, color: 'var(--warning)', fontSize: '0.9rem' }}>Not checked: {missing.join(', ')}. That side can change the answer.</p>
        )}
        <table style={{ fontSize: '0.9rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}><th></th><th>A</th><th>B</th></tr>
          </thead>
          <tbody>
            {v.reasons.map(r => (
              <tr key={r.what}>
                <td style={{ color: 'var(--text-muted)', paddingRight: 10, whiteSpace: 'nowrap' }}>{r.what}</td>
                <td style={{ fontWeight: r.better === 'a' ? 700 : 400, color: r.better === 'a' ? 'var(--success)' : undefined }}>{r.a}</td>
                <td style={{ fontWeight: r.better === 'b' ? 700 : 400, color: r.better === 'b' ? 'var(--success)' : undefined }}>{r.b}</td>
              </tr>
            ))}
            {['front', 'back'].map(face => {
              const ta = surfaceText(a.result?.sides?.[face]?.surface, settings);
              const tb = surfaceText(b.result?.sides?.[face]?.surface, settings);
              if (!ta && !tb) return null;
              return (
                <tr key={`s-${face}`}>
                  <td style={{ color: 'var(--text-muted)', paddingRight: 10 }}>{face === 'front' ? 'Front' : 'Back'} surface</td>
                  <td>{ta || '—'}</td><td>{tb || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          This is advice from the photos and your checklist. You pick: the other copy is marked "to sell" (your
          ownership boxes don't change; untick the second one yourself once it's gone).
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {[['A', a], ['B', b]].map(([x, c]) => (
            <button key={x} className={`btn ${v.winner === x.toLowerCase() ? 'btn-primary' : 'btn-ghost'}`} style={{ minHeight: 44 }}
              onClick={() => onKeep(c, x === 'A' ? b : a)}>
              Keep {x}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={onBack}>Back</button>
        </div>
      </section>
    </>
  );
}
