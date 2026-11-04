// pages/CardBrowser.jsx — Pictures of every card in your sets, with filters
//
// A grid of 25 card pictures and nothing else; hovering one shows it bigger
// (the larger TCGplayer picture). Clicking does nothing yet — a page per card
// may come later.
//
// With no filter set it shows a random 25 (🔀 Shuffle for another 25). With
// filters it goes oldest set first, in card number order, 25 at a time.
//
// The cards are the ones already in your sets (routes/browse.js), so a set
// shows up here once it's imported. Filters live in the address bar
// (?pokemon=Pikachu&page=2), so Back and a refresh keep them. The two typed
// boxes wait a moment after the last key before searching.

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

const FILTER_KEYS = ['pokemon', 'illustrator', 'set', 'rarity', 'type', 'kind'];
const TYPED_KEYS = ['pokemon', 'illustrator'];
const TYPE_DELAY_MS = 350;
const PREVIEW_WIDTH = 340;
const NAV_HEIGHT = 52;
const NO_OPTIONS = { illustrators: [], sets: [], rarities: [], types: [], kinds: [] };

export default function CardBrowser() {
  const [params, setParams] = useSearchParams();
  const [options, setOptions] = useState(null);
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [shuffles, setShuffles] = useState(0);
  const [preview, setPreview] = useState(null);     // { card, rect } of the hovered card
  const requestRef = useRef(0);

  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  const page = Math.max(parseInt(params.get('page'), 10) || 1, 1);
  const filtered = Object.keys(filters).length > 0;
  const paramsKey = params.toString();

  useEffect(() => {
    api.browse.options().then(setOptions).catch(() => setOptions(NO_OPTIONS));
  }, []);

  // ── Load the cards for the current filters / page / shuffle ──
  useEffect(() => {
    const id = ++requestRef.current;
    setLoading(true);
    setPreview(null);
    api.browse.cards(page > 1 ? { ...filters, page } : filters)
      .then(data => { if (id === requestRef.current) { setResult(data); setError(null); } })
      .catch(err => { if (id === requestRef.current) setError(err.message); })
      .finally(() => { if (id === requestRef.current) setLoading(false); });
    // filters and page are both read from paramsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, shuffles]);

  // A preview is placed next to its card, so it would drift on scroll — drop it.
  useEffect(() => {
    const hide = () => setPreview(null);
    window.addEventListener('scroll', hide, { passive: true });
    return () => window.removeEventListener('scroll', hide);
  }, []);

  // ── Typed filters: the box text, sent to the address bar after a pause ──
  // pushed = what was last sent, so a change coming back from the address bar
  // (Back, Clear filters) can be told apart from our own and copied into the box.
  const [typed, setTyped] = useState(() => Object.fromEntries(TYPED_KEYS.map(k => [k, params.get(k) || ''])));
  const pushed = useRef({ ...typed });

  const pokemonParam = params.get('pokemon') || '';
  const illustratorParam = params.get('illustrator') || '';
  useEffect(() => {
    const fromBar = { pokemon: pokemonParam, illustrator: illustratorParam };
    const changes = {};
    for (const key of TYPED_KEYS) {
      if (fromBar[key] !== pushed.current[key]) {
        changes[key] = fromBar[key];
        pushed.current[key] = fromBar[key];
      }
    }
    if (Object.keys(changes).length > 0) setTyped(current => ({ ...current, ...changes }));
  }, [pokemonParam, illustratorParam]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setParams(prev => {
        const next = new URLSearchParams(prev);
        let changed = false;
        for (const key of TYPED_KEYS) {
          const value = typed[key].trim();
          pushed.current[key] = value;
          if ((prev.get(key) || '') === value) continue;
          changed = true;
          if (value) next.set(key, value); else next.delete(key);
        }
        if (!changed) return prev;
        next.delete('page');
        return next;
      }, { replace: true });
    }, TYPE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, setParams]);

  function setFilter(key, value) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      next.delete('page');
      return next;
    });
  }

  function clearFilters() {
    setParams(new URLSearchParams());
  }

  function goToPage(n) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (n > 1) next.set('page', String(n)); else next.delete('page');
      return next;
    });
    window.scrollTo({ top: 0 });
  }

  const opts = options || NO_OPTIONS;
  const total = result?.total ?? 0;
  const pageSize = result?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cards = result?.cards || [];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>Card Browser</h1>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Every card in your sets — filter by Pokémon, illustrator and more
        </span>
      </div>

      {/* ── Filters ── */}
      <div className="panel" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
          <Field label="Pokémon">
            <input
              className="input" placeholder="e.g. Pikachu"
              value={typed.pokemon}
              onChange={e => setTyped(t => ({ ...t, pokemon: e.target.value }))}
            />
          </Field>
          <Field label="Illustrator">
            <input
              className="input" placeholder="e.g. Mitsuhiro Arita" list="card-browser-illustrators"
              value={typed.illustrator}
              onChange={e => setTyped(t => ({ ...t, illustrator: e.target.value }))}
            />
            <datalist id="card-browser-illustrators">
              {opts.illustrators.map(i => <option key={i.name} value={i.name}>{`${i.cards} card${i.cards !== 1 ? 's' : ''}`}</option>)}
            </datalist>
          </Field>
          <Field label="Set">
            <select className="input" value={filters.set || ''} onChange={e => setFilter('set', e.target.value)}>
              <option value="">Any set</option>
              {opts.sets.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}{s.release_date ? ` (${s.release_date.slice(0, 4)})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rarity">
            <select className="input" value={filters.rarity || ''} onChange={e => setFilter('rarity', e.target.value)}>
              <option value="">Any rarity</option>
              {opts.rarities.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={filters.type || ''} onChange={e => setFilter('type', e.target.value)}>
              <option value="">Any type</option>
              {opts.types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Card kind">
            <select className="input" value={filters.kind || ''} onChange={e => setFilter('kind', e.target.value)}>
              <option value="">Any kind</option>
              {opts.kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
        </div>
        {options && opts.illustrators.length === 0 && (
          <div style={{ marginTop: 'var(--space-3)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            No illustrators saved yet — run Admin → Fill in illustrators once to add them for the sets you already have.
          </div>
        )}
      </div>

      {/* ── What's showing + Shuffle / pages ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)', minHeight: 32 }}>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {result && (result.random
            ? `${cards.length} random cards from the ${total.toLocaleString()} in your sets`
            : total === 0
              ? 'No cards match these filters'
              : `Showing ${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()} of ${total.toLocaleString()} cards`)}
          {loading && <span className="spinner" />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {filtered && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>}
          {result?.random
            ? <button className="btn btn-primary btn-sm" onClick={() => setShuffles(n => n + 1)} disabled={loading}>🔀 Shuffle</button>
            : <Pager page={page} pages={pages} onPage={goToPage} hidden={!result || total <= pageSize} />}
        </div>
      </div>

      {error && <div className="panel" style={{ color: 'var(--danger)', marginBottom: 'var(--space-3)' }}>{error}</div>}

      {/* ── The pictures ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 160px))',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        opacity: loading && result ? 0.5 : 1,
        transition: 'opacity var(--transition)',
      }}>
        {cards.map(card => (
          <div
            key={card.id}
            onMouseEnter={e => setPreview({ card, rect: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setPreview(p => (p?.card.id === card.id ? null : p))}
            style={{ aspectRatio: '63 / 88', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-elevated)' }}
          >
            <img
              src={card.image_url} alt={card.name} loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        ))}
      </div>

      {!result?.random && total > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
          <Pager page={page} pages={pages} onPage={goToPage} />
        </div>
      )}

      {preview && <Preview key={preview.card.id} card={preview.card} rect={preview.rect} />}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4,
        textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--font-display)',
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Pager({ page, pages, onPage, hidden = false }) {
  if (hidden) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.85rem' }}>
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <span style={{ color: 'var(--text-secondary)', minWidth: 90, textAlign: 'center' }}>Page {page} of {pages}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

// The hovered card, bigger, beside it (left side when there's no room on the
// right). The small picture shows underneath until the big one has loaded.
function Preview({ card, rect }) {
  const [bigFailed, setBigFailed] = useState(false);
  const room = window.innerHeight - NAV_HEIGHT - 16;
  let width = Math.min(PREVIEW_WIDTH, window.innerWidth - 16);
  let height = Math.round(width * 88 / 63);
  if (height > room) {
    height = room;
    width = Math.round(height * 63 / 88);
  }
  const gap = 12;
  let left = rect.right + gap;
  if (left + width > window.innerWidth - 8) left = rect.left - gap - width;
  if (left < 8) left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
  const top = Math.max(NAV_HEIGHT + 8, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 8));

  return (
    <div style={{
      position: 'fixed', left, top, width, height, zIndex: 300, pointerEvents: 'none',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      backgroundColor: 'var(--bg-elevated)',
      backgroundImage: `url(${JSON.stringify(card.image_url)})`,
      backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    }}>
      {!bigFailed && card.large_url !== card.image_url && (
        <img
          src={card.large_url} alt=""
          onError={() => setBigFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      )}
    </div>
  );
}
