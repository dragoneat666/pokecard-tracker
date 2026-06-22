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
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../hooks/useToast.js';
import { isCollectorRarity, formatPrice } from '../rarity.js';
import CardRow from '../components/CardRow.jsx';
import SetStats from '../components/SetStats.jsx';
import { getAdjacentSets } from '../utils/sortSets.js';

export default function SetView() {
  const { id }  = useParams();   // The set ID from the URL /sets/:id
  const navigate = useNavigate();

  const [setData, setSetData]   = useState(null);
  const [cards, setCards]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]     = useState('');
  const [sortCol, setSortCol]       = useState('number');
  const [sortDir, setSortDir]       = useState('asc');
  const [quickFilter, setQuickFilter] = useState('all');
  const [childSets, setChildSets]     = useState([]);
  const [allSets, setAllSets] = useState([]);

  const { toast, showToast } = useToast();

  // Load the set and all its cards
  const loadSet = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.sets.get(id);
      setSetData(data.set);
      setCards(data.cards);
      setChildSets(data.childSets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadSet(); }, [loadSet]);

  useEffect(() => {
  api.sets.list().then(setAllSets).catch(() => {});
}, []);

  // ── Ownership update ─────────────────────────────────────────────────────
  // Called by CardRow when a checkbox is clicked.
  // We update local state immediately (optimistic update) so the UI feels
  // instant, then fire the API call. If it fails, we revert.
  async function handleOwnedChange(cardId, newOwned) {
    const prev = cards;
    const prevChildSets = childSets;
    setCards(c => c.map(card =>
      card.id === cardId ? { ...card, owned: newOwned } : card
    ));
    setChildSets(cs => cs.map(({ set, cards }) => ({
      set,
      cards: cards.map(card => card.id === cardId ? { ...card, owned: newOwned } : card)
    })));
    try {
      await api.cards.setOwned(cardId, newOwned);
    } catch (err) {
      setCards(prev);
      setChildSets(prevChildSets);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function handleReverseOwnedChange(cardId, newOwned) {
    const prev = cards;
    const prevChildSets = childSets;
    setCards(c => c.map(card =>
      card.id === cardId ? { ...card, reverse_owned: newOwned } : card
    ));
    setChildSets(cs => cs.map(({ set, cards }) => ({
      set,
      cards: cards.map(card => card.id === cardId ? { ...card, reverse_owned: newOwned } : card)
    })));
    try {
      await api.cards.setReverseOwned(cardId, newOwned);
    } catch (err) {
      setCards(prev);
      setChildSets(prevChildSets);
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

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
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
    const matchesQuickFilter =
      quickFilter === 'all'             ? true :
      quickFilter === 'missing_regular' ? (card.owned === 0 && !isCollectorRarity(card.rarity)) :
      quickFilter === 'missing_fullart' ? (card.owned === 0 && isCollectorRarity(card.rarity)) :
      quickFilter === 'missing_reverse' ? ((setData?.variant_type === 'first_edition' ? card.has_first_edition : card.has_reverse_holo) && card.reverse_owned === 0) :
      quickFilter === 'missing_all'     ? (card.owned === 0 || ((setData?.variant_type === 'first_edition' ? card.has_first_edition : card.has_reverse_holo) && card.reverse_owned === 0)) : true;

    const matchesSearch = !search ||
      card.name.toLowerCase().includes(search.toLowerCase()) ||
      card.card_number.includes(search) ||
      card.pokemon_type?.toLowerCase().includes(search.toLowerCase()) ||
      card.rarity?.toLowerCase().includes(search.toLowerCase()) ||
      card.storage?.toLowerCase().includes(search.toLowerCase());

    return matchesQuickFilter && matchesSearch;
  });

  const sortedCards = [...filteredCards].sort((a, b) => {
    let aVal, bVal;
    if (sortCol === 'number') {
      // Split card number into three parts:
      // leadingLetters — letters BEFORE the number (H, TG, AR etc)
      // num            — the numeric part
      // trailingSuffix — letters AFTER the number (a, b in 050a, 050b)
      const parse = n => {
        const base = n.split('/')[0];
        const match = base.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
        if (!match) return { leading: base, num: 0, suffix: '' };
        return { leading: match[1], num: parseInt(match[2]) || 0, suffix: match[3] };
      };
      const a$ = parse(a.card_number);
      const b$ = parse(b.card_number);
    
      // Pure numeric cards (no leading letters) always come first
      const aIsLetter = a$.leading !== '' ? 1 : 0;
      const bIsLetter = b$.leading !== '' ? 1 : 0;
      if (aIsLetter !== bIsLetter) return aIsLetter - bIsLetter;
    
      // Within same group: sort by leading prefix alphabetically
      if (a$.leading !== b$.leading) {
        return sortDir === 'asc'
          ? a$.leading.localeCompare(b$.leading)
          : b$.leading.localeCompare(a$.leading);
      }
    
      // Then by number
      if (a$.num !== b$.num) {
        return sortDir === 'asc' ? a$.num - b$.num : b$.num - a$.num;
      }
    
      // Then by trailing suffix (a before b, no suffix before a)
      return sortDir === 'asc'
        ? a$.suffix.localeCompare(b$.suffix)
        : b$.suffix.localeCompare(a$.suffix);
    } else if (sortCol === 'name') {
      aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase();
    } else if (sortCol === 'rarity') {
      aVal = a.rarity || ''; bVal = b.rarity || '';
    } else if (sortCol === 'price') {
      aVal = parseFloat(a.market_price) || 0;
      bVal = parseFloat(b.market_price) || 0;
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const { prev, next } = getAdjacentSets(allSets, id);

  const showVariantCol = setData?.variant_type !== 'none';
  
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => prev && navigate(`/sets/${prev.id}`)}
            disabled={!prev}
            title={prev ? `Previous: ${prev.name}` : 'No previous set'}
            style={{ opacity: prev ? 1 : 0.3 }}
          >
            ←
          </button>
          <div>
            <h1 style={{ fontSize: '1.5rem' }}>{setData?.name}</h1>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {setData?.series}{setData?.release_date ? ` · ${new Date(setData.release_date).getFullYear()}` : ''}
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => next && navigate(`/sets/${next.id}`)}
            disabled={!next}
            title={next ? `Next: ${next.name}` : 'No next set'}
            style={{ opacity: next ? 1 : 0.3 }}
          >
            →
          </button>
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
      <SetStats cards={cards} childSets={childSets} />

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { key: 'all',
            label: 'Clear' },
          { key: 'missing_regular',
            label: `Missing Regular (${cards.filter(c => c.owned === 0 && !isCollectorRarity(c.rarity)).length})` },
          { key: 'missing_fullart',
            label: `Missing Full Art (${cards.filter(c => c.owned === 0 && isCollectorRarity(c.rarity)).length})` },
          { key: 'missing_reverse',
            label: `Missing ${setData?.variant_type === 'first_edition' ? 'First Edition' : 'Reverse'} (${cards.filter(c => (setData?.variant_type === 'first_edition' ? c.has_first_edition : c.has_reverse_holo) && c.reverse_owned === 0).length})` },
          { key: 'missing_all',
            label: `Missing All (${cards.filter(c => c.owned === 0 || ((setData?.variant_type === 'first_edition' ? c.has_first_edition : c.has_reverse_holo) && c.reverse_owned === 0)).length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`btn btn-sm ${quickFilter === key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setQuickFilter(key)}
          >
            {label}
          </button>
        ))}
        <input
          className="input"
          placeholder="Search name, number, type, rarity, storage…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 280 }}
        />
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {sortedCards.length} card{sortedCards.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Card Table ── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                  {[
                    { label: '#',            col: 'number' },
                    { label: 'Name',         col: 'name' },
                    { label: 'Type',         col: null },
                    { label: 'Rarity',       col: 'rarity' },
                    { label: 'Regular',      col: null },
                    ...(showVariantCol ? [{ label: setData?.variant_type === 'first_edition' ? 'First Edition' : 'Reverse Holo', col: null }] : []),
                    { label: 'Storage',      col: null },
                    { label: 'Condition',    col: null },
                    { label: 'Price',        col: 'price' },
                    { label: 'Total',        col: null },
                    ...(showVariantCol ? [
                      { label: setData?.variant_type === 'first_edition' ? '1st Ed Price' : 'Rev Price', col: null },
                      { label: setData?.variant_type === 'first_edition' ? '1st Ed Total' : 'Rev Total', col: null },
                    ] : []),
                  ].map(({ label, col }) => (
                    <th
                      key={label}
                      style={{
                        ...thStyle,
                        cursor: col ? 'pointer' : 'default',
                        userSelect: 'none',
                        color: col && sortCol === col ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => col && handleSort(col)}
                    >
                      {label}
                      {col && sortCol === col && (
                        <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
            <tbody>
              {sortedCards.map((card, idx) => (
                <CardRow
                  key={card.id}
                  card={card}
                  zebra={idx % 2 === 1}
                  variantType={setData?.variant_type}
                  showVariantCol={showVariantCol}
                  onOwnedChange={handleOwnedChange}
                  onReverseOwnedChange={handleReverseOwnedChange}
                  onStorageChange={handleStorageChange}
                  onConditionChange={handleConditionChange}
                />
              ))}
              {sortedCards.length === 0 && (
                <tr>
                 <td colSpan={showVariantCol ? 12 : 9} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
                    No cards match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Child Set Sections ── */}
      {childSets.map(({ set: childSet, cards: childCards }) => (
        <div key={childSet.id} style={{ marginTop: 'var(--space-6)' }}>
          {/* Child set divider header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{
              fontSize: '1.1rem',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}>
              {childSet.name}
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Child card table */}
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    {[
                      { label: '#' }, { label: 'Name' }, { label: 'Type' },
                      { label: 'Rarity' }, { label: 'Regular' },
                      ...(showVariantCol ? [{ label: setData?.variant_type === 'first_edition' ? 'First Edition' : 'Reverse Holo' }] : []),
                      { label: 'Storage' }, { label: 'Condition' },
                      { label: 'Price' }, { label: 'Total' },
                      ...(showVariantCol ? [
                        { label: setData?.variant_type === 'first_edition' ? '1st Ed Price' : 'Rev Price' },
                        { label: setData?.variant_type === 'first_edition' ? '1st Ed Total' : 'Rev Total' },
                      ] : []),
                    ].map(({ label }) => (
                      <th key={label} style={{ ...thStyle, color: 'var(--text-secondary)' }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {childCards.map((card, idx) => (
                    <CardRow
                      key={card.id}
                      card={card}
                      zebra={idx % 2 === 1}
                      variantType={setData?.variant_type}
                      showVariantCol={showVariantCol}
                      onOwnedChange={handleOwnedChange}
                      onReverseOwnedChange={handleReverseOwnedChange}
                      onStorageChange={handleStorageChange}
                      onConditionChange={handleConditionChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
      
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
