// components/SetToolsModal.jsx — Set-level tools: reimport, alternates, move cards, manual add
import { useState, useEffect } from 'react';
import { api } from '../api.js';

const TABS = ['Reimport', 'Search MCAP', 'Move Card', 'Manual Add', 'Edit Type'];

export default function SetToolsModal({ set, onClose, onChanged }) {
  const [activeTab, setActiveTab] = useState('Reimport');
  const [reimporting, setReimporting] = useState(false);
  const [reimportResult, setReimportResult] = useState(null);
  const [reimportError, setReimportError] = useState(null);

  async function handleReimport() {
    try {
      setReimporting(true);
      setReimportError(null);
      setReimportResult(null);
      await api.sets.create({ tcg_id: set.tcg_id });
      setReimportResult('Reimport complete!');
      onChanged();
    } catch (err) {
      setReimportError(err.message);
    } finally {
      setReimporting(false);
    }
  }

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
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 640,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Set Tools — {set.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 var(--space-5)' }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'Reimport' && (
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
                Re-fetches this set's card list and prices from TCGTracking and PokéWallet.
                Existing manually-set values (logo, symbol, release date, series) are protected and won't be overwritten.
              </p>
              {reimportError && (
                <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
                  {reimportError}
                </div>
              )}
              {reimportResult && (
                <div style={{ color: 'var(--success)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
                  {reimportResult}
                </div>
              )}
              <button className="btn btn-primary" onClick={handleReimport} disabled={reimporting}>
                {reimporting ? 'Reimporting…' : '↻ Reimport Set'}
              </button>
            </div>
          )}

          {activeTab === 'Search MCAP' && (
            <SearchMcapTab setId={set.id} onImported={onChanged} />
          )}

          {activeTab === 'Move Card' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Coming soon.
            </div>
          )}

          {activeTab === 'Manual Add' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Coming soon.
            </div>
          )}

          {activeTab === 'Edit Type' && (
            <EditTypeTab setId={set.id} onChanged={onChanged} />
        )}
        </div>
      </div>
    </div>
  );
}

// ── Search MCAP Tab ───────────────────────────────────────────────────────────
function SearchMcapTab({ setId, onImported }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [importingId, setImportingId] = useState(null);

  async function handleSearch() {
    if (!query.trim()) return;
    try {
      setSearching(true);
      setError(null);
      const data = await api.sets.searchMcap(setId, query.trim());
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function handleImport(card) {
    try {
      setImportingId(card.id);
      // Try to extract a card number embedded in the MCAP name, e.g.
      // "Larry's Komala - 175/217 (Cosmo Holo)" → "175/217"
      const match = card.name.match(/(\d+\/\d+)/);
      const cardNumber = match ? match[1] : card.card_number;

      await api.sets.importAlternate(setId, {
        source_card_id: card.id,
        card_number: cardNumber,
      });
      setResults(prev => prev.filter(c => c.id !== card.id));
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        Search Miscellaneous Cards &amp; Products (MCAP) for alternate art versions of cards in this set —
        try a card name or number like "Komala" or "175/217".
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <input
          className="input"
          placeholder="Search by name or card number…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      {results.length === 0 && !searching && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No results yet — try a search above.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {results.map(card => (
          <div
            key={card.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-3)', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{card.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {card.card_number} · {card.rarity || 'Unknown rarity'}
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleImport(card)}
              disabled={importingId === card.id}
            >
              {importingId === card.id ? 'Importing…' : '+ Import'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Edit Type Tab ─────────────────────────────────────────────────────────────
const POKEMON_TYPES = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting',
  'Darkness', 'Metal', 'Dragon', 'Colorless', 'Fairy', 'Trainer', 'Special Energy',
];

function EditTypeTab({ setId, onChanged }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [selectedType, setSelectedType] = useState({});

  useEffect(() => {
    loadMissing();
  }, []);

  async function loadMissing() {
    try {
      setLoading(true);
      const data = await api.sets.missingType(setId);
      setCards(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(card) {
    const type = selectedType[card.id];
    if (!type) return;
    try {
      setSavingId(card.id);
      await api.cards.setType(card.id, type);
      setCards(prev => prev.filter(c => c.id !== card.id));
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        Cards below have no Pokémon type set — likely a data gap from the import APIs.
        Setting a type here protects it from being overwritten on future reimports.
      </p>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>
      ) : cards.length === 0 ? (
        <div style={{ color: 'var(--success)', fontSize: '0.875rem' }}>
          ✅ All cards in this set have a type set.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {cards.map(card => (
            <div
              key={card.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                padding: 'var(--space-3)', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{card.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {card.card_number} · {card.rarity || 'Unknown rarity'}
                  {card.set_name ? ` · ${card.set_name}` : ''}
                  {card.is_alternate ? ' · Alternate' : ''}
                </div>
              </div>
              <select
                className="input"
                value={selectedType[card.id] || ''}
                onChange={e => setSelectedType(prev => ({ ...prev, [card.id]: e.target.value }))}
                style={{ width: 140 }}
              >
                <option value="">Select type…</option>
                {POKEMON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleSave(card)}
                disabled={!selectedType[card.id] || savingId === card.id}
              >
                {savingId === card.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}