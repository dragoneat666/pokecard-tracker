// pages/SetView.jsx — Per-set card table
//
// This is where you spend most of your time — the spreadsheet replacement.
// Shows every card in a set as a row with:
//   - Card number, name, type, rarity
//   - 1 or 2 ownership checkboxes (based on rarity)
//   - Reverse holo checkbox
//   - Storage selector
//   - Prices (market, total)
//   - Refresh prices button

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../hooks/useToast.js';
import { isCollectorRarity, formatPrice } from '../rarity.js';
import CardRow from '../components/CardRow.jsx';
import SetStats from '../components/SetStats.jsx';

export default function SetView() {
  const { id }  = useParams();   // The set ID from the URL /sets/:id
  const navigate = useNavigate();
  const location = useLocation();

  const [setData, setSetData]   = useState(null);
  const [cards, setCards]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]     = useState('all'); // 'all' | 'owned' | 'missing'
  const [search, setSearch]     = useState('');

  const { toast, showToast } = useToast();

  // Load the set and all its cards
  const loadSet = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.sets.get(id);
      setSetData(data.set);
      setCards(data.cards);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadSet(); }, [loadSet]);

  // ── Ownership update ─────────────────────────────────────────────────────
  // Called by CardRow when a checkbox is clicked.
  // We update local state immediately (optimistic update) so the UI feels
  // instant, then fire the API call. If it fails, we revert.
  async function handleOwnedChange(cardId, newOwned) {
    const prev = cards;
    // Optimistic update — change the card in local state right away
    setCards(c => c.map(card =>
      card.id === cardId ? { ...card, owned: newOwned } : card
    ));

    try {
      await api.cards.setOwned(cardId, newOwned);
    } catch (err) {
      setCards(prev); // Revert on failure
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function handleReverseOwnedChange(cardId, newOwned) {
    const prev = cards;
    setCards(c => c.map(card =>
      card.id === cardId ? { ...card, reverse_owned: newOwned } : card
    ));
    try {
      await api.cards.setReverseOwned(cardId, newOwned);
    } catch (err) {
      setCards(prev);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function handleStorageChange(cardId, storage) {
    const prev = cards;
    setCards(c => c.map(card =>
      card.id === cardId ? { ...card, storage } : card
    ));
    try {
      await api.cards.setStorage(cardId, storage);
    } catch (err) {
      setCards(prev);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function handleConditionChange(cardId, condition) {
    const prev = cards;
    setCards(c => c.map(card =>
      card.id === cardId ? { ...card, condition } : card
    ));
    try {
      await api.cards.setCondition(cardId, condition);
    } catch (err) {
      setCards(prev);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  // ── Price refresh ─────────────────────────────────────────────────────────
  async function handleRefreshPrices() {
    try {
      setRefreshing(true);
      await api.prices.refresh(id);
      showToast('Price refresh started — reload in a few seconds', 'success');
      // Wait 4 seconds then reload to pick up new prices
      setTimeout(loadSet, 4000);
    } catch (err) {
      showToast(`Refresh failed: ${err.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  // ── Filtered card list ────────────────────────────────────────────────────
  const filteredCards = cards.filter(card => {
    const matchesFilter =
      filter === 'all'     ? true :
      filter === 'owned'   ? card.owned >= 1 :
      filter === 'missing' ? card.owned === 0 : true;

    const matchesSearch = !search ||
      card.name.toLowerCase().includes(search.toLowerCase()) ||
      card.card_number.includes(search);

    return matchesFilter && matchesSearch;
  });

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}>
      <span className="spinner" />
    </div>
  );

  if (error) return (
    <div className="panel" style={{ color: 'var(--danger)' }}>
      {error} — <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>Go back</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate('/')}>
          Collection
        </span>
        {' / '}
        <span>{setData?.name}</span>
      </div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem' }}>{setData?.name}</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {setData?.series}{setData?.release_date ? ` · ${new Date(setData.release_date).getFullYear()}` : ''}
          </span>
        </div>
        <button
          className="btn btn-ghost"
          onClick={handleRefreshPrices}
          disabled={refreshing}
          style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          {refreshing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Refreshing...</> : '↻ Refresh Prices'}
        </button>
      </div>

      {/* ── Stats ── */}
      <SetStats cards={cards} />

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', 'owned', 'missing'].map(f => (
          <button
            key={f}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'owned'   && ` (${cards.filter(c => c.owned >= 1).length})`}
            {f === 'missing' && ` (${cards.filter(c => c.owned === 0).length})`}
          </button>
        ))}

        <input
          className="input"
          placeholder="Search by name or number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 220 }}
        />

        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {filteredCards.length} card{filteredCards.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Card Table ── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                {['#', 'Name', 'Type', 'Rarity', 'Own', 'Rev', 'Storage', 'Cond', 'Price', 'Total', 'Rev Price', 'Rev Total'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCards.map((card, idx) => (
                <CardRow
                  key={card.id}
                  card={card}
                  zebra={idx % 2 === 1}
                  onOwnedChange={handleOwnedChange}
                  onReverseOwnedChange={handleReverseOwnedChange}
                  onStorageChange={handleStorageChange}
                  onConditionChange={handleConditionChange}
                />
              ))}
              {filteredCards.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
                    No cards match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
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
