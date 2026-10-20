// pages/ToppsSet.jsx — One Topps checklist as a grid
//
// Cards are rows, printings (logo colors, foils, diecuts...) are columns.
// Click a cell to mark that card/printing as owned; greyed "—" cells are
// printings that don't exist for that card. Click a column heading to filter to
// what you're still missing in that printing. Toggling is optimistic with
// revert-on-failure, like the main card table.

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../hooks/useToast.js';

export default function ToppsSet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [search, setSearch]       = useState('');
  const [missingIn, setMissingIn] = useState(null);     // variant id, or null
  const [onlyMissing, setOnlyMissing] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.topps.set(id)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleToggle(card, variant) {
    const current = card.cells[variant.id];
    if (current === undefined) return;
    const next = !current;
    const prev = data;
    const apply = value => setData(d => ({
      ...d,
      cards: d.cards.map(c => c.id === card.id ? { ...c, cells: { ...c.cells, [variant.id]: value } } : c),
    }));
    apply(next);
    try {
      await api.topps.setCell(card.id, variant.id, next);
    } catch (err) {
      setData(prev);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${data.set.name}" and everything you've checked off in it? This can't be undone.`)) return;
    try {
      await api.topps.deleteSet(id);
      navigate('/topps');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>;
  }
  if (error) {
    return <div className="panel" style={{ color: 'var(--danger)' }}>{error} — <Link to="/topps">back to Topps</Link></div>;
  }

  const { set, variants, cards } = data;

  const perVariant = {};
  variants.forEach(v => { perVariant[v.id] = { owned: 0, total: 0 }; });
  let totalOwned = 0;
  let totalCells = 0;
  for (const c of cards) {
    for (const [vid, owned] of Object.entries(c.cells)) {
      perVariant[vid].total++;
      totalCells++;
      if (owned) { perVariant[vid].owned++; totalOwned++; }
    }
  }
  const pct = totalCells > 0 ? (totalOwned / totalCells) * 100 : 0;

  const q = search.trim().toLowerCase();
  const shown = cards.filter(c => {
    if (q && !`${c.number} ${c.name}`.toLowerCase().includes(q)) return false;
    if (missingIn !== null && c.cells[missingIn] !== false) return false;
    if (onlyMissing && !Object.values(c.cells).some(v => v === false)) return false;
    return true;
  });

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-3)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <Link to="/topps" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Topps</Link>
        {' / '}<span>{set.name}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <h1 style={{ fontSize: '1.5rem' }}>{set.name}</h1>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {totalOwned} of {totalCells} printings checked · {pct.toFixed(1)}%
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" placeholder="Search number or name…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
        <select
          className="input"
          value={missingIn ?? ''}
          onChange={e => setMissingIn(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          style={{ width: 'auto', maxWidth: 260 }}
        >
          <option value="">Missing in any printing</option>
          {variants.map(v => <option key={v.id} value={v.id}>Missing in: {v.name}</option>)}
        </select>
        <button className={`btn btn-sm ${onlyMissing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOnlyMissing(o => !o)}>
          Cards missing something
        </button>
        {(search || missingIn !== null || onlyMissing) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setSearch(''); setMissingIn(null); setOnlyMissing(false); }}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {shown.length} card{shown.length !== 1 ? 's' : ''} · click a heading to filter by printing
        </span>
      </div>

      {/* Grid */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: '72vh' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, ...stickyLeft(0, 70), background: 'var(--bg-elevated)', textAlign: 'left', zIndex: 4 }}>#</th>
                <th style={{ ...headStyle, ...stickyLeft(70, 230), background: 'var(--bg-elevated)', textAlign: 'left', zIndex: 4 }}>Name</th>
                {variants.map(v => (
                  <th
                    key={v.id}
                    onClick={() => setMissingIn(missingIn === v.id ? null : v.id)}
                    title={`Click to show cards missing in ${v.name}`}
                    style={{
                      ...headStyle,
                      minWidth: 96,
                      cursor: 'pointer',
                      color: missingIn === v.id ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    <div style={{ whiteSpace: 'normal', lineHeight: 1.25 }}>{v.name}</div>
                    <div style={{ marginTop: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                      {perVariant[v.id].owned} / {perVariant[v.id].total}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(card => (
                <tr key={card.id}>
                  <td style={{ ...cellStyle, ...stickyLeft(0, 70), fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem' }}>
                    {card.number}
                  </td>
                  <td style={{ ...cellStyle, ...stickyLeft(70, 230), fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {card.name}
                  </td>
                  {variants.map(v => {
                    const state = card.cells[v.id];
                    return (
                      <td
                        key={v.id}
                        style={{ ...cellStyle, textAlign: 'center', background: state === undefined ? 'var(--bg-elevated)' : 'var(--bg-surface)' }}
                      >
                        {state === undefined
                          ? <span style={{ color: 'var(--text-muted)', opacity: 0.4 }}>—</span>
                          : <Box checked={state} onClick={() => handleToggle(card, v)} title={`${card.name} — ${v.name}`} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={variants.length + 2} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
                    No cards match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-5)', textAlign: 'right' }}>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={handleDelete}>
          Delete this checklist
        </button>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function Box({ checked, onClick, title }) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      style={{
        width: 20, height: 20, margin: '0 auto', borderRadius: 4, cursor: 'pointer',
        border: `2px solid ${checked ? 'var(--success)' : 'rgba(255,255,255,0.5)'}`,
        background: checked ? 'var(--success)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all var(--transition)',
      }}
    >
      {checked && (
        <svg width="11" height="9" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

// First two columns stay put while the printings scroll sideways.
function stickyLeft(left, width) {
  return { position: 'sticky', left, minWidth: width, maxWidth: width, width, background: 'var(--bg-surface)', zIndex: 1 };
}

const headStyle = {
  position: 'sticky',
  top: 0,
  zIndex: 3,
  padding: '10px 10px',
  textAlign: 'center',
  verticalAlign: 'bottom',
  fontSize: '0.68rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-display)',
};

const cellStyle = {
  padding: '7px 10px',
  fontSize: '0.85rem',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
};
