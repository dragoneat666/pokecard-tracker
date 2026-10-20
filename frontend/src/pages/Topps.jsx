// pages/Topps.jsx — Topps checklists overview
//
// Old Topps Pokemon cards (1999-2000s) aren't in any card database, so each
// release is a hand-built checklist: cards down the side, printings (logo
// colors, foils, diecuts...) across the top. This page lists the releases with
// progress, and imports new ones from a CSV grid (see routes/topps.js for the
// format: 0 = printing doesn't exist, blank = need it, anything else = have it).

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Topps() {
  const navigate = useNavigate();
  const [sets, setSets]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting]   = useState(false);
  const [importError, setImportError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      setSets(await api.topps.sets());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handlePickFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    if (!importName) setImportName(file.name.replace(/\.csv$/i, '').replace(/[-_]+/g, ' ').trim());
  }

  async function handleImport() {
    try {
      setImporting(true);
      setImportError(null);
      const formData = new FormData();
      formData.append('name', importName.trim());
      formData.append('file', importFile);
      const result = await api.topps.importSet(formData);
      navigate(`/topps/${result.id}`);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>Topps</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Checklists for the Topps Pokémon cards — no prices, just what you have and need
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowImport(s => !s)}>
          {showImport ? 'Cancel' : '⬆ Import checklist'}
        </button>
      </div>

      {showImport && (
        <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            Pick a CSV grid: number, name, then one column per printing. In each cell, <strong>0</strong> means
            that printing doesn't exist for the card, <strong>blank</strong> means you need it, and anything
            else (like 1) means you have it.
          </p>
          {importError && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>{importError}</div>}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              {importFile ? importFile.name : 'Choose CSV…'}
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handlePickFile} />
            <input
              className="input"
              placeholder="Checklist name"
              value={importName}
              onChange={e => setImportName(e.target.value)}
              style={{ width: 260 }}
            />
            <button className="btn btn-primary" onClick={handleImport} disabled={importing || !importFile || !importName.trim()}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>
      ) : error ? (
        <div className="panel" style={{ color: 'var(--danger)' }}>{error}</div>
      ) : sets.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-7)', color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>No checklists yet</div>
          <div style={{ fontSize: '0.875rem' }}>Use “Import checklist” to add your first release.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
          {sets.map(s => {
            const pct = s.cells > 0 ? (s.owned / s.cells) * 100 : 0;
            return (
              <div
                key={s.id}
                onClick={() => navigate(`/topps/${s.id}`)}
                style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', cursor: 'pointer',
                  transition: 'background var(--transition), border-color var(--transition)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border-focus)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                  {s.card_count} cards · {s.owned} of {s.cells} printings checked
                </div>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--success)' : 'var(--accent)', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textAlign: 'right', color: pct >= 100 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {pct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
