// pages/ToppsSet.jsx — One Topps checklist, laid out like a regular set page
//
// Each card is a table row; the printings (logo colors, foils, ...) are
// checkbox columns where a regular set would have Type / Rarity / etc.
//
// Cards are grouped by which printings they actually have. Most cards share
// the same printings and make up the main table; cards with their own special
// printing (tin toppers, jumbo promos, diecuts, stickers) land in their own
// table below with just a checkbox, like the Alternates section on a set page.
// Toggling is optimistic with revert-on-failure, like the main card table.

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../hooks/useToast.js';

// Title for an extra table: a single printing uses its own name ("Tin Topper");
// several that share the part after the dash use that ("Blue Logo - Diecut" +
// "Black Logo - Diecut" -> "Diecut"); otherwise they're joined.
function groupTitle(variants) {
  if (variants.length === 1) return variants[0].name;
  const tails = variants.map(v => v.name.split(' - ').pop());
  return tails.every(t => t === tails[0]) ? tails[0] : variants.map(v => v.name).join(' / ');
}

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

  async function handleToggle(card, variantId) {
    const current = card.cells[variantId];
    if (current === undefined) return;
    const next = !current;
    const prev = data;
    setData(d => ({
      ...d,
      cards: d.cards.map(c => c.id === card.id ? { ...c, cells: { ...c.cells, [variantId]: next } } : c),
    }));
    try {
      await api.topps.setCell(card.id, variantId, next);
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
  const variantById = Object.fromEntries(variants.map(v => [v.id, v]));

  // ── Overall + per-printing progress ────────────────────────────────────────
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

  // ── Group cards by the printings they have ─────────────────────────────────
  const byShape = new Map();
  for (const card of cards) {
    const ids = variants.filter(v => card.cells[v.id] !== undefined).map(v => v.id);
    if (ids.length === 0) continue;
    const key = ids.join(',');
    if (!byShape.has(key)) byShape.set(key, { key, variants: ids.map(i => variantById[i]), cards: [] });
    byShape.get(key).cards.push(card);
  }
  const shapes = [...byShape.values()];
  const mainShape = shapes.reduce((a, b) => (b.cards.length > a.cards.length ? b : a), shapes[0]);
  const orderedShapes = shapes.length > 0 ? [mainShape, ...shapes.filter(s => s !== mainShape)] : [];

  // ── Filters ────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtering = !!q || missingIn !== null || onlyMissing;
  const keep = c => {
    if (q && !`${c.number} ${c.name}`.toLowerCase().includes(q)) return false;
    if (missingIn !== null && c.cells[missingIn] !== false) return false;
    if (onlyMissing && !Object.values(c.cells).some(v => v === false)) return false;
    return true;
  };
  const visible = orderedShapes
    .map(s => ({ ...s, shown: s.cards.filter(keep) }))
    .filter(s => s.shown.length > 0 || !filtering);
  const shownCount = visible.reduce((n, s) => n + s.shown.length, 0);

  const statBoxes = [
    { label: 'Cards',      value: cards.length },
    { label: 'Checked',    value: `${totalOwned} / ${totalCells}` },
    { label: 'Completion', value: `${pct.toFixed(1)}%`, highlight: pct >= 100 },
  ];

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <Link to="/topps" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Topps</Link>
        {' / '}<span>{set.name}</span>
      </div>

      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-4)' }}>{set.name}</h1>

      {/* ── Stats ── */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {statBoxes.map(s => (
          <div key={s.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 14px', minWidth: 110 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: s.highlight ? 'var(--success)' : 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className={`btn btn-sm ${onlyMissing ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setOnlyMissing(o => !o)}
        >
          Cards missing something
        </button>
        <select
          className="input"
          value={missingIn ?? ''}
          onChange={e => setMissingIn(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          style={{ width: 'auto', maxWidth: 280 }}
        >
          <option value="">Missing in any printing</option>
          {variants.map(v => <option key={v.id} value={v.id}>Missing in: {v.name}</option>)}
        </select>
        <input className="input" placeholder="Search number or name…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
        {filtering && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setSearch(''); setMissingIn(null); setOnlyMissing(false); }}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {shownCount} card{shownCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Tables ── */}
      {visible.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
          No cards match the current filter.
        </div>
      )}

      {visible.map(shape => {
        const isMain = shape === visible[0] && shape.key === mainShape.key;
        const single = shape.variants.length === 1;
        const compact = !isMain && shape.variants.length <= 2;     // keep tiny tables from stretching across the page
        const owned =shape.cards.reduce((n, c) => n + Object.values(c.cells).filter(Boolean).length, 0);
        const total = shape.cards.reduce((n, c) => n + Object.keys(c.cells).length, 0);
        return (
          <div key={shape.key} style={{ marginTop: isMain ? 0 : 'var(--space-6)' }}>
            {!isMain && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: '1.1rem', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {groupTitle(shape.variants)}
                  <span style={{ marginLeft: 'var(--space-3)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{owned} / {total}</span>
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
            )}

            <div className="panel" style={{ padding: 0, overflow: 'hidden', maxWidth: compact ? 640 : undefined }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Name</th>
                      {shape.variants.map(v => (
                        <th
                          key={v.id}
                          onClick={() => setMissingIn(missingIn === v.id ? null : v.id)}
                          title={`Click to show cards missing in ${v.name}`}
                          style={{
                            ...thStyle,
                            textAlign: 'center',
                            whiteSpace: 'normal',
                            minWidth: 90,
                            cursor: 'pointer',
                            userSelect: 'none',
                            color: missingIn === v.id ? 'var(--accent)' : 'var(--text-secondary)',
                          }}
                        >
                          {single && !isMain ? 'Owned' : v.name}
                          {!(single && !isMain) && (
                            <div style={{ marginTop: 3, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none' }}>
                              {perVariant[v.id].owned} / {perVariant[v.id].total}
                            </div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shape.shown.map((card, idx) => (
                      <ToppsRow
                        key={card.id}
                        card={card}
                        variants={shape.variants}
                        zebra={idx % 2 === 1}
                        onToggle={handleToggle}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: 'var(--space-6)', textAlign: 'right' }}>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={handleDelete}>
          Delete this checklist
        </button>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function ToppsRow({ card, variants, zebra, onToggle }) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      style={{
        background: hovered ? 'var(--bg-elevated)' : (zebra ? 'var(--bg-elevated)' : 'transparent'),
        borderBottom: '1px solid var(--border)',
        transition: 'background var(--transition)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td style={tdStyle}>
        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '0.8rem', fontWeight: 700 }}>
          {card.number}
        </span>
      </td>
      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{card.name}</td>
      {variants.map(v => (
        <td key={v.id} style={{ ...tdStyle, textAlign: 'center' }}>
          <Checkbox
            checked={card.cells[v.id]}
            onClick={() => onToggle(card, v.id)}
            title={`${card.name} — ${v.name}`}
          />
        </td>
      ))}
    </tr>
  );
}

// Same look as the checkboxes on the card table.
function Checkbox({ checked, onClick, title }) {
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

const thStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-display)',
};

const tdStyle = {
  padding: '8px 12px',
  fontSize: '0.85rem',
  verticalAlign: 'middle',
};
