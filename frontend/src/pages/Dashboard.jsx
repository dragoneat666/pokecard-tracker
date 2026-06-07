// pages/Dashboard.jsx — Collection overview (Table of Contents)
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { formatPrice } from '../rarity.js';
import AddSetModal from '../components/AddSetModal.jsx';
import EditSetModal from '../components/EditSetModal.jsx';

const SET_TYPES = ['All', 'Main', 'Special', "McDonald's", 'Promo', 'POP', 'Play! Prize Pack', 'Miscellaneous'];

export default function Dashboard() {
  const [sets, setSets]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [typeFilter, setTypeFilter] = useState('All');
  const navigate = useNavigate();

  useEffect(() => { loadSets(); }, []);

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

  const filteredSets = typeFilter === 'All'
    ? sets
    : sets.filter(s => s.set_type === typeFilter);

  const totals = sets.reduce((acc, s) => ({
    sets:   acc.sets + 1,
    owned:  acc.owned  + (parseInt(s.cards_owned) || 0),
    value:  acc.value  + parseFloat(s.grand_total_value || 0),
  }), { sets: 0, owned: 0, value: 0 });

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
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>My Collection</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {totals.sets} sets · {totals.owned.toLocaleString()} cards owned · {formatPrice(totals.value)} total value
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Set</button>
      </div>

      {/* ── Type filter buttons ── */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {SET_TYPES.map(t => (
          <button
            key={t}
            className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTypeFilter(t)}
          >
            {t}
            {t !== 'All' && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                ({sets.filter(s => s.set_type === t).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Set list ── */}
      {filteredSets.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-7)', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-3)' }}>📦</div>
          <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            {typeFilter === 'All' ? 'No sets yet' : `No ${typeFilter} sets`}
          </div>
          <div style={{ fontSize: '0.875rem' }}>
            {typeFilter === 'All' ? 'Click "Add Set" to import your first set.' : 'Try a different filter.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filteredSets.map(set => (
            <SetRow
              key={set.id}
              set={set}
              onClick={() => navigate(`/sets/${set.id}`)}
              onEdit={e => { e.stopPropagation(); setEditingSet(set); }}
            />
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

      {/* ── Edit Set Modal ── */}
      {editingSet && (
        <EditSetModal
          set={editingSet}
          onClose={() => setEditingSet(null)}
          onSaved={() => { setEditingSet(null); loadSets(); }}
        />
      )}
    </div>
  );
}

// ── Set Row ───────────────────────────────────────────────────────────────────
function SetRow({ set, onClick, onEdit }) {
  const regularCards  = set.regular_cards || 0;
  const secretCards   = set.secret_cards  || 0;
  const cardsInDb     = set.cards_in_db   || 0;
  const masterTotal   = set.master_total  || 0;
  const masterOwned   = set.master_owned  || 0;
  const masterPct     = masterTotal > 0 ? Math.min(100, (masterOwned / masterTotal) * 100) : 0;
  const totalValue    = parseFloat(set.total_value || 0) + parseFloat(set.reverse_holo_value || 0);

  const releaseDate = set.release_date
    ? new Date(set.release_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

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
            padding: '0 var(--space-3)',
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.85rem',
            color: 'var(--text-primary)', textAlign: 'center',
          }}>
            {set.name}
          </div>
        )}
      </div>

      {/* ── Section 2: Identity ── */}
      <div style={{ ...sectionStyle, width: 200, flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {set.symbol_url && (
            <img src={set.symbol_url} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          )}
          {set.set_code && (
            <span style={{
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '2px 8px',
              fontSize: '0.68rem', fontFamily: 'var(--font-display)',
              fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.05em',
            }}>
              {set.set_code}
            </span>
          )}
        </div>
        {releaseDate && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Release: {releaseDate}
          </div>
        )}
      </div>

      {/* ── Section 3: Card counts ── */}
      <div style={sectionStyle}>
        <div style={statLineStyle}>
          <span style={{ color: 'var(--text-muted)' }}>Regular</span>
          <span style={{ fontWeight: 700 }}>{regularCards}</span>
        </div>
        <div style={statLineStyle}>
          <span style={{ color: 'var(--text-muted)' }}>Secret</span>
          <span style={{ fontWeight: 700 }}>{secretCards}</span>
        </div>
        <div style={{ ...statLineStyle, marginTop: 2, paddingTop: 2, borderTop: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Total</span>
          <span style={{ fontWeight: 800 }}>{cardsInDb}</span>
        </div>
      </div>

      {/* ── Section 4: Master Set ── */}
      <div style={{ ...sectionStyle, flex: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.78rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            Master Set
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{masterOwned} / {masterTotal}</span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{
            height: '100%', width: `${masterPct}%`,
            background: masterPct >= 100 ? 'var(--success)' : 'var(--accent)',
            borderRadius: 3, transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{ fontSize: '0.72rem', color: masterPct >= 100 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 700, textAlign: 'right' }}>
          {masterPct.toFixed(1)}%
        </div>
      </div>

      {/* ── Section 5: Value ── */}
      <div style={{ ...sectionStyle, textAlign: 'right', minWidth: 100 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onEdit}
          style={{ marginBottom: 6, fontSize: '0.7rem', alignSelf: 'flex-end' }}
        >
          ✎ Edit
        </button>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Set Value
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', color: 'var(--success)' }}>
          {formatPrice(totalValue)}
        </div>
        {set.set_type && set.set_type !== 'Main' && (
          <div style={{
            display: 'inline-block', marginTop: 4, padding: '1px 6px',
            borderRadius: 'var(--radius-sm)', fontSize: '0.65rem', fontWeight: 700,
            background: 'var(--accent-light)', color: 'var(--accent)',
            fontFamily: 'var(--font-display)',
          }}>
            {set.set_type}
          </div>
        )}
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
