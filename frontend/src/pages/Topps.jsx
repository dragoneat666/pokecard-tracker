// pages/Topps.jsx — Topps checklists overview
//
// Old Topps Pokemon cards (1999-2000s) aren't in any card database, so each
// release is a hand-built checklist made of tables you edit like a sheet. This
// page lists the releases as wide rows like the Collection page (logo, name and
// release date, counts, progress), with Edit for the name / logo / release
// date, and "New checklist" to start a blank one.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import ToppsEditModal from '../components/ToppsEditModal.jsx';

export default function Topps() {
  const navigate = useNavigate();
  const [sets, setSets]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [editing, setEditing] = useState(null);

  const [showNew, setShowNew]   = useState(false);
  const [newName, setNewName]   = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

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

  // A new checklist opens straight in edit mode so you can build its tables.
  async function handleCreate() {
    try {
      setCreating(true);
      setCreateError(null);
      const { id } = await api.topps.createSet(newName.trim());
      navigate(`/topps/${id}?edit=1`);
    } catch (err) {
      setCreateError(err.message);
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>Topps</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {sets.length} checklist{sets.length !== 1 ? 's' : ''} · what you have and need of the Topps Pokémon cards
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(s => !s)}>
          {showNew ? 'Cancel' : '+ New checklist'}
        </button>
      </div>

      {showNew && (
        <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            Name the checklist (for example “Topps Series 2”). You'll land in edit mode with a starter
            table, where you set the columns and add the cards.
          </p>
          {createError && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>{createError}</div>}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Checklist name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && !creating) handleCreate(); }}
              style={{ width: 300 }}
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create'}
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
          <div style={{ fontSize: '0.875rem' }}>Use “New checklist” to add your first release.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {sets.map(set => (
            <ToppsRow
              key={set.id}
              set={set}
              onClick={() => navigate(`/topps/${set.id}`)}
              onEdit={e => { e.stopPropagation(); setEditing(set); }}
            />
          ))}
        </div>
      )}

      {editing && (
        <ToppsEditModal
          set={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// Same row layout as the Collection page's SetRow: logo, identity, counts,
// progress, then the Edit button with the completion percentage.
function ToppsRow({ set, onClick, onEdit }) {
  const pct = set.cells > 0 ? (set.owned / set.cells) * 100 : 0;

  // release_date is a plain YYYY-MM-DD string; build the date locally so it
  // can't shift a day with the timezone.
  let releaseDate = null;
  if (set.release_date) {
    const [y, m, d] = set.release_date.split('-').map(Number);
    releaseDate = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

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
      {/* ── Section 1: Logo ── */}
      <div style={{ width: 200, flexShrink: 0, overflow: 'hidden', padding: '4px 8px', display: 'flex', alignItems: 'center' }}>
        {set.logo_url ? (
          <img
            src={set.logo_url}
            alt={set.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', color: 'var(--text-muted)',
          }}>
            No logo — add one in Edit
          </div>
        )}
      </div>

      {/* ── Section 2: Identity ── */}
      <div style={{ ...sectionStyle, width: 220, flex: 'none' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.25, marginBottom: 6 }}>
          {set.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '2px 8px',
            fontSize: '0.68rem', fontFamily: 'var(--font-display)',
            fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.05em',
          }}>
            TOPPS
          </span>
          {releaseDate && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{releaseDate}</span>
          )}
        </div>
      </div>

      {/* ── Section 3: Counts ── */}
      <div style={sectionStyle}>
        <div style={statLineStyle}>
          <span style={{ color: 'var(--text-muted)' }}>Cards</span>
          <span style={{ fontWeight: 700 }}>{set.card_count}</span>
        </div>
        <div style={statLineStyle}>
          <span style={{ color: 'var(--text-muted)' }}>Printings</span>
          <span style={{ fontWeight: 700 }}>{set.cells}</span>
        </div>
        <div style={{ ...statLineStyle, marginTop: 2, paddingTop: 2, borderTop: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Checked</span>
          <span style={{ fontWeight: 800 }}>{set.owned}</span>
        </div>
      </div>

      {/* ── Section 4: Progress ── */}
      <div style={{ ...sectionStyle, flex: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.78rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            Checklist
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{set.owned} / {set.cells}</span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${Math.min(100, pct)}%`,
            background: pct >= 100 ? 'var(--success)' : 'var(--accent)',
            borderRadius: 3, transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* ── Section 5: Edit + completion ── */}
      <div style={{ ...sectionStyle, textAlign: 'right', minWidth: 100 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onEdit}
          style={{ marginBottom: 6, fontSize: '0.7rem', alignSelf: 'flex-end' }}
        >
          ✎ Edit
        </button>
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
