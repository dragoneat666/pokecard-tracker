// components/ExportModal.jsx — Export a set's cards as phone-friendly images
//
// Opened from Set Tools. Step 1: pick cards (main cards, subsets and
// alternates) with the same quick filters as the set page, each row showing
// whether you own it. Step 2: the picked cards are drawn into tall PNG sheets
// (3 across — see utils/renderCardSheets.js) shown right here. Save them from
// this screen, or "Send to phone" to park them on the backend for 24 hours so
// you can open the Exports page on your phone and save them there.

import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { sortCards } from '../utils/sortCards.js';
import { hasVariant, matchesQuickFilter, matchesSearch } from '../utils/cardFilters.js';
import { renderCardSheets } from '../utils/renderCardSheets.js';

const QUICK_FILTERS = [
  { key: 'all',             label: 'All' },
  { key: 'owned',           label: 'Owned' },
  { key: 'missing_regular', label: 'Missing Regular' },
  { key: 'missing_fullart', label: 'Missing Full Art' },
  { key: 'missing_reverse', label: 'Missing Reverse' },
  { key: 'missing_all',     label: 'Missing All' },
];

// "5/102" as stored, or "045" -> "045/131" using the printed total found on
// the other cards in the same group.
function printedTotalOf(cards) {
  let max = 0;
  for (const c of cards) {
    const digits = (c.card_number.split('/')[1] || '').replace(/\D/g, '');
    if (digits) max = Math.max(max, parseInt(digits, 10));
  }
  return max || null;
}

function displayNumber(card, printedTotal) {
  if (card.card_number.includes('/')) return card.card_number;
  if (printedTotal && /^\d+$/.test(card.card_number)) return `${card.card_number}/${printedTotal}`;
  return card.card_number;
}

function buildGroups(data) {
  const raw = [
    { key: 'main', label: 'Main cards', setName: data.set.name, cards: data.cards },
    ...data.childSets.map(({ set, cards }) => ({ key: `child-${set.id}`, label: set.name, setName: set.name, cards })),
    ...(data.alternateCards.length > 0
      ? [{ key: 'alt', label: 'Alternates', setName: data.set.name, cards: data.alternateCards }]
      : []),
  ];
  return raw.map(g => ({
    ...g,
    cards: sortCards(g.cards, 'number', 'asc'),
    printedTotal: printedTotalOf(g.cards),
  }));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
}

export default function ExportModal({ set, onClose }) {
  const [data, setData]       = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [quickFilter, setQuickFilter] = useState('all');
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState(new Set());
  const [title, setTitle]     = useState(set.name);
  const [perImage, setPerImage] = useState(12);

  const [phase, setPhase]     = useState('pick');          // 'pick' | 'rendering' | 'done'
  const [progress, setProgress] = useState(null);
  const [error, setError]     = useState(null);
  const [sheets, setSheets]   = useState([]);              // [{ blob, url }]
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const urlsRef = useRef([]);

  useEffect(() => {
    api.sets.get(set.id).then(setData).catch(err => setLoadError(err.message));
  }, [set.id]);

  useEffect(() => () => urlsRef.current.forEach(u => URL.revokeObjectURL(u)), []);

  if (loadError) {
    return <Overlay onClose={onClose}><div style={{ padding: 'var(--space-5)', color: 'var(--danger)' }}>{loadError}</div></Overlay>;
  }
  if (!data) {
    return (
      <Overlay onClose={onClose}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>
      </Overlay>
    );
  }

  const variantType = data.set.variant_type;
  const groups = buildGroups(data);
  const entries = groups.flatMap(group => group.cards.map(card => ({ card, group })));
  const shown = entries.filter(({ card }) =>
    matchesQuickFilter(card, quickFilter, variantType) && matchesSearch(card, search)
  );
  const showVariant = variantType !== 'none';
  const variantLabel = variantType === 'first_edition' ? '1st Ed' : 'Rev';

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectShown() {
    setSelected(prev => {
      const next = new Set(prev);
      shown.forEach(({ card }) => next.add(card.id));
      return next;
    });
  }

  function toExportCard({ card, group }) {
    const tags = [
      card.owned >= 1
        ? { text: card.owned >= 2 ? 'Owned x2' : 'Owned', tone: 'good' }
        : { text: 'Need', tone: 'bad' },
    ];
    if (showVariant && hasVariant(card, variantType)) {
      tags.push(card.reverse_owned >= 1
        ? { text: `${variantLabel}: Owned`, tone: 'good' }
        : { text: `${variantLabel}: Need`, tone: 'bad' });
    }
    return {
      id: card.id,
      name: card.name,
      number: displayNumber(card, group.printedTotal),
      setName: group.setName,
      dim: card.owned < 1 && !(card.reverse_owned >= 1),
      tags,
    };
  }

  async function handleCreate() {
    try {
      setError(null);
      setSent(false);
      setPhase('rendering');
      urlsRef.current.forEach(u => URL.revokeObjectURL(u));
      const exportCards = entries.filter(({ card }) => selected.has(card.id)).map(toExportCard);
      const blobs = await renderCardSheets(exportCards, {
        title,
        perImage,
        onProgress: (page, total) => setProgress({ page, total }),
      });
      const made = blobs.map(blob => ({ blob, url: URL.createObjectURL(blob) }));
      urlsRef.current = made.map(s => s.url);
      setSheets(made);
      setPhase('done');
    } catch (err) {
      setError(err.message);
      setPhase('pick');
    }
  }

  function downloadAll() {
    sheets.forEach((s, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = s.url;
        a.download = `${slugify(title)}-${i + 1}.png`;
        a.click();
      }, i * 350);
    });
  }

  async function handleSend() {
    try {
      setSending(true);
      setError(null);
      const formData = new FormData();
      formData.append('title', title);
      sheets.forEach((s, i) => formData.append('images', s.blob, `${slugify(title)}-${i + 1}.png`));
      await api.exports.create(formData);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const filterCount = key => entries.filter(({ card }) => matchesQuickFilter(card, key, variantType)).length;

  return (
    <Overlay onClose={onClose}>
      {/* Header */}
      <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Export — {set.name}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      {error && (
        <div style={{ padding: 'var(--space-3) var(--space-5)', color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</div>
      )}

      {phase === 'rendering' && (
        <div style={{ padding: 'var(--space-7)', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <span className="spinner" />
          <div style={{ marginTop: 'var(--space-3)' }}>
            Creating image {progress?.page || 1} of {progress?.total || '…'}…
          </div>
        </div>
      )}

      {phase === 'pick' && (
        <>
          {/* Filters */}
          <div style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            {QUICK_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={`btn btn-sm ${quickFilter === key ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setQuickFilter(key)}
              >
                {label}{key !== 'all' ? ` (${filterCount(key)})` : ''}
              </button>
            ))}
            <input
              className="input"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 180, marginLeft: 'auto' }}
            />
          </div>

          <div style={{ padding: 'var(--space-2) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <button className="btn btn-ghost btn-sm" onClick={selectShown}>Select all shown ({shown.length})</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear selection</button>
            <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{selected.size} selected</span>
          </div>

          {/* Card list */}
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 200 }}>
            {groups.map(group => {
              const rows = shown.filter(e => e.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group.key}>
                  <div style={{ padding: '6px var(--space-5)', background: 'var(--bg-elevated)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {group.label}
                  </div>
                  {rows.map(({ card }) => (
                    <label
                      key={card.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        padding: '6px var(--space-5)', cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        background: selected.has(card.id) ? 'var(--accent-light)' : 'transparent',
                      }}
                    >
                      <input type="checkbox" checked={selected.has(card.id)} onChange={() => toggle(card.id)} />
                      {card.image_url
                        ? <img src={card.image_url} alt="" loading="lazy" style={{ width: 36, height: 50, objectFit: 'contain', flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 50, flexShrink: 0 }} />}
                      <span style={{ width: 70, flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem' }}>
                        {displayNumber(card, group.printedTotal)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.name}
                        <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{card.rarity}</span>
                      </span>
                      <StatusBadge owned={card.owned >= 1} text={card.owned >= 2 ? 'Owned x2' : card.owned >= 1 ? 'Owned' : 'Need'} />
                      {showVariant && hasVariant(card, variantType) && (
                        <StatusBadge owned={card.reverse_owned >= 1} text={`${variantLabel}: ${card.reverse_owned >= 1 ? 'Owned' : 'Need'}`} />
                      )}
                    </label>
                  ))}
                </div>
              );
            })}
            {shown.length === 0 && (
              <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>No cards match the current filter.</div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: 'var(--space-3) var(--space-5)', borderTop: '1px solid var(--border)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={optLabel}>
              Title
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} style={{ width: 220 }} />
            </label>
            <label style={optLabel}>
              Cards per image
              <select className="input" value={perImage} onChange={e => setPerImage(parseInt(e.target.value, 10))} style={{ width: 'auto' }}>
                {[6, 9, 12, 15, 18].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={handleCreate} disabled={selected.size === 0}>
              Create images ({selected.size} card{selected.size !== 1 ? 's' : ''})
            </button>
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-4) var(--space-5)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              {sheets.length} image{sheets.length !== 1 ? 's' : ''} ready. Download them here, or use “Send to phone”
              to open them from the Exports page on your phone.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
              {sheets.map((s, i) => (
                <div key={s.url}>
                  <img src={s.url} alt={`Page ${i + 1}`} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }} />
                  <a
                    className="btn btn-ghost btn-sm"
                    href={s.url}
                    download={`${slugify(title)}-${i + 1}.png`}
                    style={{ marginTop: 6, display: 'inline-block', textDecoration: 'none' }}
                  >
                    ⬇ Download {i + 1}
                  </a>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: 'var(--space-3) var(--space-5)', borderTop: '1px solid var(--border)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => setPhase('pick')}>← Back to selection</button>
            {sent && (
              <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>
                Saved for 24 hours — on your phone, open <strong>{window.location.origin}/exports</strong>
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
              <button className="btn btn-ghost" onClick={downloadAll}>⬇ Download all</button>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending || sent}>
                {sending ? 'Sending…' : sent ? 'Sent ✓' : '📱 Send to phone'}
              </button>
            </div>
          </div>
        </>
      )}
    </Overlay>
  );
}

function Overlay({ onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300, padding: 'var(--space-5)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 960,
          height: '90vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ owned, text }) {
  return (
    <span style={{
      flexShrink: 0, padding: '2px 8px', borderRadius: 99,
      fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-display)',
      background: owned ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: owned ? 'var(--success)' : 'var(--danger)',
    }}>
      {text}
    </span>
  );
}

const optLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
