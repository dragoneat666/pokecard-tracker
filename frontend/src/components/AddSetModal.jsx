// components/AddSetModal.jsx — Modal dialog for adding a new set
//
// Two tabs:
//   1. Search TCG API — type a name, pick from results, import automatically
//   2. Manual — fill in name/series/total yourself

import { useState } from 'react';
import { api } from '../api.js';

export default function AddSetModal({ onClose, onAdded }) {
  const [tab, setTab]           = useState('search'); // 'search' | 'manual'
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(null); // tcg_id being imported
  const [error, setError]       = useState(null);

  // Manual form state
  const [manual, setManual] = useState({ name: '', series: '', total_cards: '' });
  const [saving, setSaving] = useState(false);

  // ── TCG Search ────────────────────────────────────────────────────────────
  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      setSearching(true);
      setError(null);
      const data = await api.sets.searchTcg(query);
      setResults(data);
      if (data.length === 0) setError('No sets found — try a different name');
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function handleImport(set) {
    try {
      setImporting(set.id);
      setError(null);
      await api.sets.create({ tcg_id: set.id });
      onAdded();
    } catch (err) {
      setError(err.message);
      setImporting(null);
    }
  }

  // ── Manual Create ─────────────────────────────────────────────────────────
  async function handleManualSave(e) {
    e.preventDefault();
    if (!manual.name.trim()) return;
    try {
      setSaving(true);
      setError(null);
      await api.sets.create({
        name: manual.name,
        series: manual.series || null,
        total_cards: manual.total_cards ? parseInt(manual.total_cards) : null,
      });
      onAdded();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 'var(--space-5)',
      }}
    >
      {/* Modal */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 560,
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Add Set</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 var(--space-5)' }}>
          {[['search', 'Search TCG Database'], ['manual', 'Manual Entry']].map(([t, label]) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 0', marginRight: 'var(--space-5)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.875rem',
                color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'color var(--transition)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ color: 'var(--danger)', marginBottom: 'var(--space-4)', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          {tab === 'search' ? (
            <>
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <input
                  className="input"
                  placeholder="e.g. Prismatic Evolutions, Base Set…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-primary" disabled={searching}>
                  {searching ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Search'}
                </button>
              </form>

              {results.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {results.map(set => (
                    <div key={set.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{set.name}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                          {set.series} · {set.total || set.printedTotal || '?'} cards
                          {set.releaseDate ? ` · ${set.releaseDate}` : ''}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={importing === set.id}
                        onClick={() => handleImport(set)}
                      >
                        {importing === set.id
                          ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Importing…</>
                          : 'Import'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleManualSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <label>
                <div style={labelStyle}>Set Name *</div>
                <input className="input" value={manual.name} onChange={e => setManual(m => ({ ...m, name: e.target.value }))} autoFocus required />
              </label>
              <label>
                <div style={labelStyle}>Series</div>
                <input className="input" placeholder="e.g. Scarlet & Violet" value={manual.series} onChange={e => setManual(m => ({ ...m, series: e.target.value }))} />
              </label>
              <label>
                <div style={labelStyle}>Total Cards in Set</div>
                <input className="input" type="number" min="1" value={manual.total_cards} onChange={e => setManual(m => ({ ...m, total_cards: e.target.value }))} />
              </label>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? 'Creating…' : 'Create Set'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
  fontFamily: 'var(--font-display)',
};
