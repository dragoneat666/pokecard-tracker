// pages/Dashboard.jsx — Collection overview (replaces your TOC sheet)
//
// Shows all sets as cards with:
//   - Completion bar and percentage
//   - Cards owned vs total
//   - Total collection value
//   - Quick link into each set's card table

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { formatPrice } from '../rarity.js';
import AddSetModal from '../components/AddSetModal.jsx';

export default function Dashboard() {
  const [sets, setSets]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // useEffect with [] runs once when the component mounts — like componentDidMount
    loadSets();
  }, []);

  async function loadSets() {
    try {
      setLoading(true);
      const data = await api.sets.list();
      setSets(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Aggregate totals across all sets for the header stats bar
  const totals = sets.reduce((acc, s) => ({
    owned:      acc.owned  + (s.cards_owned  || 0),
    total:      acc.total  + (s.total_cards  || 0),
    value:      acc.value  + parseFloat(s.grand_total_value || 0),
    sets:       acc.sets   + 1,
  }), { owned: 0, total: 0, value: 0, sets: 0 });

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}>
      <span className="spinner" />
    </div>
  );

  if (error) return (
    <div className="panel" style={{ color: 'var(--danger)' }}>
      Failed to load collection: {error}
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', marginBottom: 4 }}>My Collection</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {totals.sets} sets · {totals.owned.toLocaleString()} cards owned
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Add Set
        </button>
      </div>

      {/* ── Stats bar ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-5)',
      }}>
        {[
          { label: 'Total Sets',    value: totals.sets },
          { label: 'Cards Owned',   value: totals.owned.toLocaleString() },
          { label: 'Cards Tracked', value: totals.total.toLocaleString() },
          { label: 'Total Value',   value: formatPrice(totals.value) },
        ].map(stat => (
          <div key={stat.label} className="panel" style={{ padding: 'var(--space-4)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--text-primary)' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Set grid ── */}
      {sets.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-7)', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-3)' }}>📦</div>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>No sets yet</div>
          <div style={{ fontSize: '0.875rem' }}>Click "Add Set" to import your first set from the TCG database.</div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--space-4)',
        }}>
          {sets.map(set => (
            <SetCard key={set.id} set={set} onClick={() => navigate(`/sets/${set.id}`, { state: { setName: set.name } })} />
          ))}
        </div>
      )}

      {/* ── Add Set Modal ── */}
      {showAdd && (
        <AddSetModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); loadSets(); }}
        />
      )}
    </div>
  );
}

// ── Set Card Component ────────────────────────────────────────────────────────
function SetCard({ set, onClick }) {
  const pct = parseFloat(set.completion_pct) || 0;
  const owned = set.cards_owned || 0;
  const total = set.total_cards || set.cards_in_db || 0;

  return (
    <div
      className="panel"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        padding: 'var(--space-4)',
        transition: 'background var(--transition), border-color var(--transition)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
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
      {/* Set name + series */}
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', marginBottom: 2 }}>
          {set.name}
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          {set.series}{set.release_date ? ` · ${new Date(set.release_date).getFullYear()}` : ''}
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{owned} / {total} cards</span>
          <span style={{ fontWeight: 700, color: pct >= 100 ? 'var(--success)' : 'var(--text-primary)' }}>
            {pct}%
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(pct, 100)}%`,
            background: pct >= 100 ? 'var(--success)' : 'var(--accent)',
            borderRadius: 3,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Value */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Collection value</span>
        <span style={{ fontWeight: 700, color: 'var(--success)' }}>
          {formatPrice(set.grand_total_value)}
        </span>
      </div>
    </div>
  );
}
