// components/AddSetModal.jsx — Modal dialog for adding a new set
//
// Two tabs:
//   1. Search TCG API — search, select multiple, bulk import with progress
//   2. Manual — fill in name/series/total yourself

import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function AddSetModal({ onClose, onAdded }) {
  const [tab, setTab]             = useState('search');
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError]         = useState(null);

  // Set of set_id strings the user has checked
  const [selected, setSelected]   = useState(new Set());

  // Set of tcg_id values already in the DB — fetched on mount
  const [importedIds, setImportedIds] = useState(new Set());

  // Bulk import progress: null when idle, object when running or done
  // { current, total, currentName, done, results: [{ name, ok, error }] }
  const [bulkProgress, setBulkProgress] = useState(null);

  // Manual form state
  const [manual, setManual] = useState({ name: '', series: '', total_cards: '' });
  const [saving, setSaving] = useState(false);

  // ── Fetch already-imported set IDs on mount ───────────────────────────────
  // We load all sets from the API and pull out their tcg_id values.
  // This lets us show "✓ In collection" on search results without extra backend work.
  useEffect(() => {
    api.sets.list().then(sets => {
      setImportedIds(new Set(sets.map(s => s.tcg_id).filter(Boolean)));
    }).catch(() => {}); // non-fatal — badge just won't show
  }, []);

  // ── TCG Search ────────────────────────────────────────────────────────────
  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      setSearching(true);
      setError(null);
      setSelected(new Set()); // clear selection on new search
      const data = await api.sets.searchTcg(query);
      setResults(data);
      if (data.length === 0) setError('No sets found — try a different name');
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  // Toggle one set in/out of the selection
  function toggleSelect(setId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId);
      else next.add(setId);
      return next;
    });
  }

  // Select all / deselect all results
  function toggleSelectAll() {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map(s => s.set_id)));
    }
  }

  // ── Bulk Import ───────────────────────────────────────────────────────────
  // Loops through selected set IDs one at a time, updating progress after each.
  // Never stops on failure — collects results and shows summary at the end.
  async function handleBulkImport() {
    const toImport = results.filter(s => selected.has(s.set_id));
    if (toImport.length === 0) return;

    const importResults = [];

    setBulkProgress({
      current: 0,
      total: toImport.length,
      currentName: toImport[0].name,
      done: false,
      results: [],
    });

    for (let i = 0; i < toImport.length; i++) {
      const set = toImport[i];

      // Update progress to show which set we're currently importing
      setBulkProgress(prev => ({
        ...prev,
        current: i + 1,
        currentName: set.name,
      }));

      try {
        await api.sets.create({ tcg_id: set.set_id });
        importResults.push({ name: set.name, ok: true });
      } catch (err) {
        importResults.push({ name: set.name, ok: false, error: err.message });
      }
    }

    // All done — show summary
    setBulkProgress({
      current: toImport.length,
      total: toImport.length,
      currentName: null,
      done: true,
      results: importResults,
    });

    // Notify the dashboard to reload sets
    onAdded();
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

  // ── Derived values ────────────────────────────────────────────────────────
  const allSelected = results.length > 0 && selected.size === results.length;
  const progressPct = bulkProgress
    ? Math.round((bulkProgress.current / bulkProgress.total) * 100)
    : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 'var(--space-5)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 560,
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* ── Header ── */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Add Set</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* ── Tabs ── */}
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

        {/* ── Body ── */}
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1 }}>

          {/* ── Import complete summary ── */}
          {/* Shown after bulk import finishes instead of the normal search UI */}
          {bulkProgress?.done ? (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', marginBottom: 'var(--space-4)' }}>
                Import Complete
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
                {bulkProgress.results.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
                    border: `1px solid ${r.ok ? 'var(--success)' : 'var(--danger)'}`,
                    fontSize: '0.875rem',
                  }}>
                    <span>{r.ok ? '✅' : '❌'}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{r.name}</span>
                    {!r.ok && (
                      <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>
                        Failed — check backend logs
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>
                  {bulkProgress.results.filter(r => r.ok).length} imported ·{' '}
                  {bulkProgress.results.filter(r => !r.ok).length} failed
                </span>
                <button className="btn btn-primary" onClick={onClose}>Close</button>
              </div>
            </div>

          ) : tab === 'search' ? (
            <>
              {error && (
                <div style={{ color: 'var(--danger)', marginBottom: 'var(--space-4)', fontSize: '0.875rem' }}>
                  {error}
                </div>
              )}

              {/* Search bar */}
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <input
                  className="input"
                  placeholder="e.g. Prismatic Evolutions, Base Set…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoFocus
                  disabled={!!bulkProgress}
                />
                <button className="btn btn-primary" disabled={searching || !!bulkProgress}>
                  {searching ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Search'}
                </button>
              </form>

              {/* Select all toggle — only shown when there are results */}
              {results.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                    />
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </label>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {results.length} result{results.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {/* Results list */}
              {results.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {results.map(set => {
                    const isImported = importedIds.has(set.set_id);
                    const isSelected = selected.has(set.set_id);

                    return (
                      <div
                        key={set.set_id}
                        onClick={() => toggleSelect(set.set_id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                          padding: 'var(--space-3) var(--space-4)',
                          background: isSelected ? 'var(--accent-light)' : 'var(--bg-elevated)',
                          borderRadius: 'var(--radius-md)',
                          border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                          cursor: 'pointer',
                          transition: 'background var(--transition), border-color var(--transition)',
                        }}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(set.set_id)}
                          onClick={e => e.stopPropagation()}
                          style={{ flexShrink: 0 }}
                        />

                        {/* Set info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{set.name}</span>
                            {isImported && (
                              <span style={{
                                fontSize: '0.65rem', fontWeight: 700,
                                color: 'var(--success)', background: 'var(--success-light, rgba(34,197,94,0.15))',
                                border: '1px solid var(--success)',
                                borderRadius: 'var(--radius-sm)', padding: '1px 6px',
                                fontFamily: 'var(--font-display)', letterSpacing: '0.03em',
                              }}>
                                ✓ In collection
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                            {set.set_code} · {set.card_count || '?'} cards
                            {set.release_date ? ` · ${set.release_date}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>

          ) : (
            /* ── Manual tab ── */
            <form onSubmit={handleManualSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {error && (
                <div style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</div>
              )}
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

        {/* ── Footer — bulk import controls ── */}
        {/* Only shown on search tab when results exist and import isn't done */}
        {tab === 'search' && results.length > 0 && !bulkProgress?.done && (
          <div style={{
            padding: 'var(--space-3) var(--space-5)',
            borderTop: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          }}>

            {/* Progress bar — shown while importing */}
            {bulkProgress && !bulkProgress.done && (
              <>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Importing {bulkProgress.current} of {bulkProgress.total}: <strong>{bulkProgress.currentName}</strong>
                </div>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${progressPct}%`,
                    background: 'var(--accent)', borderRadius: 3,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </>
            )}

            {/* Import button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {selected.size > 0
                  ? `${selected.size} set${selected.size !== 1 ? 's' : ''} selected`
                  : 'Select sets to import'}
              </span>
              <button
                className="btn btn-primary btn-sm"
                disabled={selected.size === 0 || !!bulkProgress}
                onClick={handleBulkImport}
              >
                {bulkProgress && !bulkProgress.done
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Importing…</>
                  : `Import Selected (${selected.size})`}
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
  fontFamily: 'var(--font-display)',
};
