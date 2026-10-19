// pages/Bulk.jsx — Bulk Tracker
//
// Completely separate from the card collection. Built from TCGPlayer "My
// Pricing" CSV exports (import as many as you like — the date comes from each
// filename). Shows everything currently in stock and how long it has been
// listed, with filters and sortable columns so you can pull out the cards
// that haven't sold (e.g. commons listed 3+ months at your minimum price).
//
// "Listed since" counts from the first file where the card had stock. If a
// card was already in stock in your oldest imported file, it shows that file's
// date, so the real listing date may be earlier.

import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { formatPrice } from '../rarity.js';

const COLUMNS = [
  { key: 'set_name',     label: 'Set',          type: 'text' },
  { key: 'number',       label: '#',            type: 'text' },
  { key: 'product_name', label: 'Name',         type: 'text' },
  { key: 'rarity',       label: 'Rarity',       type: 'text' },
  { key: 'condition',    label: 'Condition',    type: 'text' },
  { key: 'quantity',     label: 'Qty',          type: 'num', right: true },
  { key: 'listed_price', label: 'Listed',       type: 'num', right: true, price: true },
  { key: 'market_price', label: 'Market',       type: 'num', right: true, price: true },
  { key: 'low_price',    label: 'Low',          type: 'num', right: true, price: true },
  { key: 'listed_since', label: 'Listed Since', type: 'text' },
  { key: 'days_listed',  label: 'Days Listed',  type: 'num', right: true },
];

export default function Bulk() {
  const [data, setData]       = useState({ snapshots: [], listings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [importing, setImporting]       = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [importError, setImportError]   = useState(null);
  const fileRef = useRef(null);

  const [search, setSearch]       = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [rarities, setRarities]   = useState(new Set());   // empty = all
  const [condition, setCondition] = useState('');
  const [maxPrice, setMaxPrice]   = useState('');
  const [minDays, setMinDays]     = useState('');
  const [minQty, setMinQty]       = useState('');
  const [sortCol, setSortCol]     = useState('days_listed');
  const [sortDir, setSortDir]     = useState('desc');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      setData(await api.bulk.listings());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFiles(e) {
    const files = [...e.target.files];
    e.target.value = '';   // so the same files can be picked again
    if (files.length === 0) return;

    try {
      setImporting(true);
      setImportResults(null);
      setImportError(null);
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      const { results } = await api.bulk.importFiles(formData);
      setImportResults(results);
      await load();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  function toggleRarity(r) {
    setRarities(prev => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  }

  const { snapshots, listings } = data;
  const setOptions       = [...new Set(listings.map(l => l.set_name).filter(Boolean))].sort();
  const rarityOptions    = [...new Set(listings.map(l => l.rarity).filter(Boolean))].sort();
  const conditionOptions = [...new Set(listings.map(l => l.condition).filter(Boolean))].sort();

  const filtered = listings.filter(l => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${l.product_name} ${l.set_name} ${l.number}`.toLowerCase().includes(q)) return false;
    }
    if (setFilter && l.set_name !== setFilter) return false;
    if (rarities.size > 0 && !rarities.has(l.rarity)) return false;
    if (condition && l.condition !== condition) return false;
    if (maxPrice !== '' && !(parseFloat(l.listed_price) <= parseFloat(maxPrice))) return false;
    if (minDays !== '' && !(l.days_listed >= parseInt(minDays, 10))) return false;
    if (minQty !== '' && !(l.quantity >= parseInt(minQty, 10))) return false;
    return true;
  });

  const col = COLUMNS.find(c => c.key === sortCol);
  const sorted = [...filtered].sort((a, b) => {
    let cmp;
    if (col.type === 'num') {
      cmp = (parseFloat(a[sortCol]) ?? 0) - (parseFloat(b[sortCol]) ?? 0);
      if (Number.isNaN(cmp)) cmp = 0;
    } else {
      cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', undefined, { numeric: true });
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalUnits = filtered.reduce((sum, l) => sum + l.quantity, 0);
  const latest = snapshots[0];
  const oldest = snapshots[snapshots.length - 1];

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>Bulk Tracker</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {latest
              ? `As of ${latest.snapshot_at.split(' ')[0]} · ${snapshots.length} file${snapshots.length !== 1 ? 's' : ''} imported (since ${oldest.snapshot_at.split(' ')[0]})`
              : 'No exports imported yet'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '⬆ Import export files'}
          </button>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: 'none' }} onChange={handleFiles} />
        </div>
      </div>

      {importError && (
        <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '0.875rem' }}>
          Import failed: {importError}
        </div>
      )}

      {importResults && (
        <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            Import complete — {importResults.filter(r => r.ok).length} of {importResults.length} file{importResults.length !== 1 ? 's' : ''} imported
          </div>
          {importResults.map((r, i) => (
            <div key={i} style={{ padding: '2px 0', color: r.ok ? 'var(--text-secondary)' : 'var(--danger)' }}>
              {r.ok ? '✅' : '❌'} {r.filename} —{' '}
              {r.ok
                ? `${r.rows.toLocaleString()} Pokémon rows, ${r.in_stock.toLocaleString()} in stock${r.replaced ? ' (replaced the existing import for that date)' : ''}`
                : r.error}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}>
          <span className="spinner" />
        </div>
      ) : error ? (
        <div className="panel" style={{ color: 'var(--danger)' }}>{error}</div>
      ) : snapshots.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-7)', color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>No data yet</div>
          <div style={{ fontSize: '0.875rem' }}>
            Import one or more TCGPlayer “My Pricing” CSV exports. Only Pokémon rows are kept,
            and the date is read from each filename.
          </div>
        </div>
      ) : (
        <>
          {/* ── Filters ── */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" placeholder="Search name, set, number…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
            <select className="input" value={setFilter} onChange={e => setSetFilter(e.target.value)} style={{ width: 'auto', maxWidth: 240 }}>
              <option value="">All sets</option>
              {setOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input" value={condition} onChange={e => setCondition(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All conditions</option>
              {conditionOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={filterLabel}>
              Max listed $
              <input className="input" type="number" step="0.01" min="0" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} style={{ width: 80 }} />
            </label>
            <label style={filterLabel}>
              Min days
              <input className="input" type="number" min="0" value={minDays} onChange={e => setMinDays(e.target.value)} style={{ width: 80 }} />
            </label>
            <label style={filterLabel}>
              Min qty
              <input className="input" type="number" min="1" value={minQty} onChange={e => setMinQty(e.target.value)} style={{ width: 70 }} />
            </label>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {sorted.length.toLocaleString()} listing{sorted.length !== 1 ? 's' : ''} · {totalUnits.toLocaleString()} units
            </span>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rarity</span>
            {rarityOptions.map(r => (
              <button key={r} className={`btn btn-sm ${rarities.has(r) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleRarity(r)}>
                {r}
              </button>
            ))}
            {rarities.size > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setRarities(new Set())}>Clear</button>
            )}
          </div>

          {/* ── Table ── */}
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    {COLUMNS.map(c => (
                      <th
                        key={c.key}
                        onClick={() => handleSort(c.key)}
                        style={{
                          ...thStyle,
                          textAlign: c.right ? 'right' : 'left',
                          cursor: 'pointer',
                          userSelect: 'none',
                          color: sortCol === c.key ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >
                        {c.label}
                        {sortCol === c.key && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((l, idx) => (
                    <tr
                      key={l.tcgplayer_id}
                      style={{ background: idx % 2 === 1 ? 'var(--bg-elevated)' : 'transparent', borderBottom: '1px solid var(--border)' }}
                    >
                      {COLUMNS.map(c => (
                        <td
                          key={c.key}
                          style={{
                            ...tdStyle,
                            textAlign: c.right ? 'right' : 'left',
                            fontWeight: c.key === 'product_name' ? 600 : 400,
                            whiteSpace: c.key === 'product_name' ? 'nowrap' : 'normal',
                            fontFamily: c.right ? 'var(--font-display)' : undefined,
                          }}
                        >
                          {c.price ? formatPrice(l[c.key]) : (l[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
                        No listings match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const filterLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

const thStyle = {
  padding: '10px 12px',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-display)',
};

const tdStyle = {
  padding: '8px 12px',
  fontSize: '0.85rem',
  verticalAlign: 'middle',
};
