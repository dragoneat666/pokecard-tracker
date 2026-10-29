// pages/Coins.jsx — Coins overview, one row per generation
//
// TCG coins are grouped by generation because that's what gets written on the
// coin sleeve along with the coin's number. Only North American coins are
// collected, so the counts and progress here cover those; the other regions
// are kept on each generation's page for reference.
//
// Coins come from Bulbapedia's coin list pages through the import panel
// ("Import from Bulbapedia"), which also downloads their pictures.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import CoinImportPanel from '../components/CoinImportPanel.jsx';

export default function Coins() {
  const navigate = useNavigate();
  const [generations, setGenerations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [job, setJob]         = useState(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    load();
    api.coins.importJob().then(setJob).catch(() => {});
  }, []);

  async function load() {
    try {
      setGenerations(await api.coins.generations());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const importOpen = showImport || job?.status === 'running' || (!loading && !error && generations.length === 0);

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>Coins</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {generations.length} generation{generations.length !== 1 ? 's' : ''} · the North American coins you have and need
          </span>
        </div>
        <button className="btn btn-ghost" onClick={() => setShowImport(s => !s)}>
          {showImport ? 'Hide import' : 'Import from Bulbapedia'}
        </button>
      </div>

      {importOpen && <CoinImportPanel job={job} setJob={setJob} onProgress={load} />}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>
      ) : error ? (
        <div className="panel" style={{ color: 'var(--danger)' }}>{error}</div>
      ) : generations.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-7)', color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>No coins yet</div>
          <div style={{ fontSize: '0.875rem' }}>Paste a Bulbapedia coin page above to import them.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {generations.map(g => (
            <GenerationRow key={g.id} generation={g} onClick={() => navigate(`/coins/${g.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Same row layout as the Topps and Collection rows: picture, identity, counts,
// progress, completion.
function GenerationRow({ generation: g, onClick }) {
  const pct = g.varieties > 0 ? (g.owned / g.varieties) * 100 : 0;

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'stretch',
        height: 90,
        overflow: 'hidden',
        transition: 'background var(--transition), border-color var(--transition)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-elevated)';
        e.currentTarget.style.borderColor = 'var(--border-focus)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--bg-surface)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      {/* ── Section 1: A coin from this generation ── */}
      <div style={{ width: 120, flexShrink: 0, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {g.cover_url ? (
          <img src={g.cover_url} alt="" style={{ width: 74, height: 74, objectFit: 'contain' }} />
        ) : (
          <div style={{ width: 74, height: 74, borderRadius: '50%', border: '2px dashed var(--border)' }} />
        )}
      </div>

      {/* ── Section 2: Identity ── */}
      <div style={{ ...sectionStyle, width: 220, flex: 'none' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.25, marginBottom: 6 }}>
          {g.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '2px 8px',
            fontSize: '0.68rem', fontFamily: 'var(--font-display)',
            fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.05em',
          }}>
            COINS
          </span>
          {g.reference > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>+ {g.reference} from other regions</span>
          )}
        </div>
      </div>

      {/* ── Section 3: Counts ── */}
      <div style={sectionStyle}>
        <div style={statLineStyle}>
          <span style={{ color: 'var(--text-muted)' }}>Coins</span>
          <span style={{ fontWeight: 700 }}>{g.coins}</span>
        </div>
        <div style={statLineStyle}>
          <span style={{ color: 'var(--text-muted)' }}>Varieties</span>
          <span style={{ fontWeight: 700 }}>{g.varieties}</span>
        </div>
        <div style={{ ...statLineStyle, marginTop: 2, paddingTop: 2, borderTop: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Checked</span>
          <span style={{ fontWeight: 800 }}>{g.owned}</span>
        </div>
      </div>

      {/* ── Section 4: Progress ── */}
      <div style={{ ...sectionStyle, flex: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.78rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            North America
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{g.owned} / {g.varieties}</span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${Math.min(100, pct)}%`,
            background: pct >= 100 ? 'var(--success)' : 'var(--accent)',
            borderRadius: 3, transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* ── Section 5: Completion ── */}
      <div style={{ ...sectionStyle, textAlign: 'right', minWidth: 100 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Completion
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', color: pct >= 100 ? 'var(--success)' : 'var(--text-primary)' }}>
          {pct.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

const sectionStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '0 var(--space-4)',
};

const statLineStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: '0.78rem',
  lineHeight: 1.6,
};
