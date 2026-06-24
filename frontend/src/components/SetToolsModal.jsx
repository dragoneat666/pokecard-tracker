// components/SetToolsModal.jsx — Set-level tools: reimport, alternates, move cards, manual add
import { useState, useEffect } from 'react';
import { api } from '../api.js';

const TABS = ['Reimport Set', 'Import Card', 'Edit Card', 'Manual Add', 'Edit Type'];

export default function SetToolsModal({ set, onClose, onChanged }) {
  const [activeTab, setActiveTab] = useState('Reimport Set');
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
          {activeTab === 'Reimport Set' && (
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

          {activeTab === 'Import Card' && (
            <ImportCardTab setId={set.id} onImported={onChanged} />
          )}

          {activeTab === 'Edit Card' && (
            <MoveCardTab setId={set.id} onMoved={onChanged} />
          )}

          {activeTab === 'Manual Add' && (
            <ManualAddTab setId={set.id} onAdded={onChanged} />
          )}

          {activeTab === 'Edit Type' && (
            <EditTypeTab setId={set.id} onChanged={onChanged} />
        )}
        </div>
      </div>
    </div>
  );
}

// ── Import Card Tab ───────────────────────────────────────────────────────────
function ImportCardTab({ setId, onImported }) {
  const [allSets, setAllSets] = useState([]);
  const [sourceSetId, setSourceSetId] = useState(null);
  const [sourceSetName, setSourceSetName] = useState(null);
  const [loadingMcap, setLoadingMcap] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [importingId, setImportingId] = useState(null);

  useEffect(() => {
    api.sets.list().then(setAllSets).catch(() => {});
  }, []);

  async function handleQuickMcap() {
    try {
      setLoadingMcap(true);
      setError(null);
      const mcap = await api.sets.mcapId();
      setSourceSetId(mcap.id);
      setSourceSetName(mcap.name);
      setResults([]);
      setQuery('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMcap(false);
    }
  }

  function handlePickSet(e) {
    const id = e.target.value;
    if (!id) {
      setSourceSetId(null);
      setSourceSetName(null);
      return;
    }
    const picked = allSets.find(s => String(s.id) === id);
    setSourceSetId(picked.id);
    setSourceSetName(picked.name);
    setResults([]);
    setQuery('');
  }

  async function handleSearch() {
    if (!query.trim() || !sourceSetId) return;
    try {
      setSearching(true);
      setError(null);
      const data = await api.sets.searchSource(sourceSetId, query.trim());
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
      // Try to extract a card number embedded in the source name, e.g.
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
        Import a card from another already-imported set — it'll be copied into this set's
        Alternates section. Most often used for Miscellaneous Cards &amp; Products (MCAP)
        alternate-art versions.
      </p>

      {/* Source set picker */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={handleQuickMcap} disabled={loadingMcap}>
          {loadingMcap ? 'Loading…' : '⚡ Import from MCAP'}
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>or</span>
        <select className="input" style={{ width: 260 }} value={sourceSetId || ''} onChange={handlePickSet}>
          <option value="">Choose a different set…</option>
          {allSets.filter(s => s.id !== setId).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {sourceSetId && (
        <>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            Searching within: <strong>{sourceSetName}</strong>
          </div>

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
        </>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}

      {sourceSetId && results.length === 0 && !searching && (
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

// ── Move Card Tab ─────────────────────────────────────────────────────────────
function MoveCardTab({ setId, onMoved }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [destination, setDestination] = useState({});
  const [subsets, setSubsets] = useState([]);
  const [editingNotesId, setEditingNotesId] = useState(null);
  const [notesDraft, setNotesDraft] = useState({});
  const [savingNotesId, setSavingNotesId] = useState(null);

  useEffect(() => {
    api.sets.children(setId).then(setSubsets).catch(() => {});
  }, [setId]);

  async function handleSearch() {
    if (!query.trim()) return;
    try {
      setSearching(true);
      setError(null);
      const data = await api.sets.searchOwnCards(setId, query.trim());
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function handleMove(card) {
    const dest = destination[card.id];
    if (!dest) return;
    const [targetSetId, table] = dest.split('|'); // e.g. "93|alternate" or "93|main"
    try {
      setMovingId(card.id);
      await api.cards.move(card.id, {
        target_set_id: Number(targetSetId),
        is_alternate: table === 'alternate',
      });
      setResults(prev => prev.filter(c => c.id !== card.id));
      onMoved();
    } catch (err) {
      setError(err.message);
    } finally {
      setMovingId(null);
    }
  }

async function handleSaveNotes(card) {
    const draft = notesDraft[card.id] || {};
    try {
      setSavingNotesId(card.id);
      await api.cards.setNotes(card.id, {
        notes: draft.notes ?? card.notes ?? '',
        notes_url: draft.notes_url ?? card.notes_url ?? '',
      });
      setEditingNotesId(null);
      onMoved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNotesId(null);
    }
  }

async function handleDelete(card) {
    if (!confirm(`Delete "${card.name}" (${card.card_number}) permanently? This cannot be undone.`)) return;
    try {
      setMovingId(card.id);
      await api.cards.delete(card.id);
      setResults(prev => prev.filter(c => c.id !== card.id));
      onMoved();
    } catch (err) {
      setError(err.message);
    } finally {
      setMovingId(null);
    }
  }

  // Build the list of valid destinations: this set's main/alternates,
  // plus each subset's main/alternates.
  const destinations = [
    { value: `${setId}|main`,      label: 'Main' },
    { value: `${setId}|alternate`, label: 'Alternates' },
    ...subsets.flatMap(s => [
      { value: `${s.id}|main`,      label: `${s.name} — Main` },
      { value: `${s.id}|alternate`, label: `${s.name} — Alternates` },
    ]),
  ];

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        Find a card currently in this set (main, a subset, or alternates) and move it to a
        different table — most often used to relocate a misprint or promo into Alternates.
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
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
              padding: 'var(--space-3)', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{card.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {card.card_number} · Currently in: {card.set_name} ({card.is_alternate ? 'Alternates' : 'Main'})
              </div>
            </div>
            <select
              className="input"
              style={{ width: 200 }}
              value={destination[card.id] || ''}
              onChange={e => setDestination(prev => ({ ...prev, [card.id]: e.target.value }))}
            >
              <option value="">Move to…</option>
              {destinations.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleMove(card)}
              disabled={!destination[card.id] || movingId === card.id}
            >
              {movingId === card.id ? 'Moving…' : 'Move'}
            </button>
            {card.is_alternate && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingNotesId(editingNotesId === card.id ? null : card.id)}
              >
                📝 Notes
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleDelete(card)}
              disabled={movingId === card.id}
              style={{ color: 'var(--danger)' }}
            >
              🗑 Delete
            </button>
          </div>
        ))}
      </div>

      {results.filter(c => editingNotesId === c.id).map(card => (
        <div
          key={`notes-${card.id}`}
          style={{
            marginTop: 'var(--space-2)', padding: 'var(--space-3)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <label>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Notes</div>
              <input
                className="input"
                defaultValue={card.notes || ''}
                onChange={e => setNotesDraft(prev => ({ ...prev, [card.id]: { ...prev[card.id], notes: e.target.value } }))}
              />
            </label>
            <label>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>Notes Link</div>
              <input
                className="input"
                defaultValue={card.notes_url || ''}
                onChange={e => setNotesDraft(prev => ({ ...prev, [card.id]: { ...prev[card.id], notes_url: e.target.value } }))}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditingNotesId(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => handleSaveNotes(card)} disabled={savingNotesId === card.id}>
              {savingNotesId === card.id ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        </div>
      ))}
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
  const [savingAll, setSavingAll] = useState(false);
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

  async function handleSaveAll() {
    const entries = Object.entries(selectedType).filter(([, type]) => type);
    if (entries.length === 0) return;
    try {
      setSavingAll(true);
      setError(null);
      await Promise.all(entries.map(([cardId, type]) => api.cards.setType(cardId, type)));
      const savedIds = new Set(entries.map(([cardId]) => Number(cardId)));
      setCards(prev => prev.filter(c => !savedIds.has(c.id)));
      setSelectedType({});
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingAll(false);
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
            </div>
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={handleSaveAll}
            disabled={savingAll || Object.values(selectedType).filter(Boolean).length === 0}
          >
            {savingAll ? 'Saving…' : `Save All (${Object.values(selectedType).filter(Boolean).length})`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Manual Add Tab ────────────────────────────────────────────────────────────
const BASIC_RARITIES_LIST = ['Common', 'Uncommon', 'Rare', 'Rare Holo', 'Energy', 'Trainer'];
const COLLECTOR_RARITIES_LIST = [
  'Holo Rare', 'Ultra Rare', 'Secret Rare', 'Rainbow Rare', 'Special Illustration Rare',
  'Illustration Rare', 'Full Art', 'Promo',
];

function ManualAddTab({ setId, onAdded }) {
  const [subsets, setSubsets] = useState([]);
  const [targetSetId, setTargetSetId] = useState(setId);
  const [table, setTable] = useState('main');
  const [cardNumber, setCardNumber] = useState('');
  const [name, setName] = useState('');
  const [pokemonType, setPokemonType] = useState('');
  const [rarity, setRarity] = useState('');
  const [notes, setNotes] = useState('');
  const [notesUrl, setNotesUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    api.sets.children(setId).then(setSubsets).catch(() => {});
  }, [setId]);

  async function handleSubmit() {
    if (!cardNumber.trim() || !name.trim()) {
      setError('Card number and name are required.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await api.cards.create({
        set_id: targetSetId,
        card_number: cardNumber.trim(),
        name: name.trim(),
        pokemon_type: pokemonType || null,
        rarity: rarity || null,
        is_alternate: table === 'alternate',
        notes: notes.trim() || null,
        notes_url: notesUrl.trim() || null,
      });
      setSuccess(`Added "${name.trim()}" successfully.`);
      setCardNumber('');
      setName('');
      setPokemonType('');
      setRarity('');
      setNotes('');
      setNotesUrl('');
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const destinations = [
    { value: setId, label: 'This set' },
    ...subsets.map(s => ({ value: s.id, label: s.name })),
  ];

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        Add a card that doesn't exist in any import source — for example a missing promo
        or a card the API never picked up.
      </p>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ color: 'var(--success)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
          {success}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <label>
            <div style={labelStyle}>Set</div>
            <select className="input" value={targetSetId} onChange={e => setTargetSetId(Number(e.target.value))}>
              {destinations.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label>
            <div style={labelStyle}>Table</div>
            <select className="input" value={table} onChange={e => setTable(e.target.value)}>
              <option value="main">Main</option>
              <option value="alternate">Alternates</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--space-3)' }}>
          <label>
            <div style={labelStyle}>Card Number</div>
            <input className="input" placeholder="e.g. 175/217" value={cardNumber} onChange={e => setCardNumber(e.target.value)} />
          </label>
          <label>
            <div style={labelStyle}>Name</div>
            <input className="input" placeholder="Card name" value={name} onChange={e => setName(e.target.value)} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <label>
            <div style={labelStyle}>Type (optional)</div>
            <select className="input" value={pokemonType} onChange={e => setPokemonType(e.target.value)}>
              <option value="">— None —</option>
              {['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless', 'Fairy', 'Trainer', 'Special Energy'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={labelStyle}>Rarity (optional)</div>
            <select className="input" value={rarity} onChange={e => setRarity(e.target.value)}>
              <option value="">— None —</option>
              {[...BASIC_RARITIES_LIST, ...COLLECTOR_RARITIES_LIST].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>

        {table === 'alternate' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <label>
              <div style={labelStyle}>Notes (optional)</div>
              <input
                className="input"
                placeholder="e.g. Cosmo Holo variant, 1999 misprint"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </label>
            <label>
              <div style={labelStyle}>Notes Link (optional)</div>
              <input
                className="input"
                placeholder="https://bulbapedia.bulbagarden.net/..."
                value={notesUrl}
                onChange={e => setNotesUrl(e.target.value)}
              />
            </label>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Adding…' : '+ Add Card'}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  fontFamily: 'var(--font-display)',
};