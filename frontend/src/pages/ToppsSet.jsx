// pages/ToppsSet.jsx — One Topps checklist, laid out like a regular set page
//
// A checklist holds tables. Each table is a sheet: named columns (printings —
// logo colors, foils, diecuts...) and rows (cards), where the columns sit in
// the slots a regular set uses for Type / Rarity / etc.
//
// Normal mode: click a box to mark have / need. Cells for a printing that
// doesn't exist show a dash. Hover a card's name to see its front and back.
// Edit mode ("Edit tables"): like editing a sheet — rename the table, rename
// or add or remove columns, add / edit / remove rows, add whole tables, paste
// a whole sheet in from Excel, and click a cell to cycle need -> have ->
// doesn't exist. Each row also has Front / Back picture URL boxes, and the
// pictures panel fills empty ones from the checklist's Bulbapedia page.
//
// Cell toggles and picture changes are optimistic with revert-on-failure, like
// the main card table. Structural edits call the API and then reload.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../hooks/useToast.js';
import ToppsPasteModal from '../components/ToppsPasteModal.jsx';
import ToppsPicturesPanel from '../components/ToppsPicturesPanel.jsx';
import HoverPreview from '../components/HoverPreview.jsx';

const PICTURE_COLUMN = { front: 'image_url', back: 'back_image_url' };

const NEXT_STATE = { need: 'have', have: 'none', none: 'need' };

function cellState(card, variantId) {
  const v = card.cells[variantId];
  return v === undefined ? 'none' : v ? 'have' : 'need';
}

export default function ToppsSet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast, showToast } = useToast();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [editMode, setEditMode] = useState(searchParams.get('edit') === '1');
  const [resetKey, setResetKey] = useState(0);            // bumps after each edit so text boxes show the server's value
  const [pasteTable, setPasteTable] = useState(null);     // the table the paste window is open for

  const [search, setSearch]       = useState('');
  const [missingIn, setMissingIn] = useState(null);     // column id, or null
  const [onlyMissing, setOnlyMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.topps.set(id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Runs a structural edit, then reloads so the page matches the server (on
  // failure too, which also resets any text box that was mid-edit).
  async function run(action) {
    try {
      await action();
    } catch (err) {
      showToast(err.message, 'error');
    }
    await load();
    setResetKey(k => k + 1);
  }

  function setEdit(on) {
    setEditMode(on);
    setSearchParams(on ? { edit: '1' } : {});
  }

  // Optimistic cell change. value: true (have), false (need), undefined (doesn't exist).
  async function changeCell(card, variantId, state) {
    const prev = data;
    const value = state === 'none' ? undefined : state === 'have';
    setData(d => ({
      ...d,
      tables: d.tables.map(t => ({
        ...t,
        cards: t.cards.map(c => {
          if (c.id !== card.id) return c;
          const cells = { ...c.cells };
          if (value === undefined) delete cells[variantId]; else cells[variantId] = value;
          return { ...c, cells };
        }),
      })),
    }));
    try {
      await api.topps.setCell(card.id, variantId, state);
    } catch (err) {
      setData(prev);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  function patchCard(cardId, patch) {
    setData(d => ({
      ...d,
      tables: d.tables.map(t => ({ ...t, cards: t.cards.map(c => (c.id === cardId ? { ...c, ...patch } : c)) })),
    }));
  }

  // Optimistic picture change. The server downloads the picture and answers
  // with the URL of its stored copy, which then replaces the typed one.
  async function changePicture(card, side, url) {
    const column = PICTURE_COLUMN[side];
    const prev = card[column];
    patchCard(card.id, { [column]: url || null });
    try {
      const saved = await api.topps.setPicture(card.id, side, url);
      patchCard(card.id, { [column]: saved.url });
    } catch (err) {
      patchCard(card.id, { [column]: prev });
      showToast(err.message, 'error');
    }
  }

  function handleCellClick(card, variantId) {
    const state = cellState(card, variantId);
    if (editMode) {
      changeCell(card, variantId, NEXT_STATE[state]);
    } else if (state !== 'none') {
      changeCell(card, variantId, state === 'have' ? 'need' : 'have');
    }
  }

  async function handleDeleteChecklist() {
    if (!confirm(`Delete "${data.set.name}" and everything in it? This can't be undone.`)) return;
    try {
      await api.topps.deleteSet(id);
      navigate('/topps');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>;
  }
  if (error) {
    return <div className="panel" style={{ color: 'var(--danger)' }}>{error} — <Link to="/topps">back to Topps</Link></div>;
  }

  const { set, tables } = data;

  // ── Progress ───────────────────────────────────────────────────────────────
  const perVariant = {};
  let totalCards = 0, totalOwned = 0, totalCells = 0;
  for (const t of tables) {
    t.variants.forEach(v => { perVariant[v.id] = { owned: 0, total: 0 }; });
    totalCards += t.cards.length;
    for (const c of t.cards) {
      for (const [vid, owned] of Object.entries(c.cells)) {
        perVariant[vid].total++;
        totalCells++;
        if (owned) { perVariant[vid].owned++; totalOwned++; }
      }
    }
  }
  const pct = totalCells > 0 ? (totalOwned / totalCells) * 100 : 0;

  // ── Filters (normal mode only) ─────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtering = !editMode && (!!q || missingIn !== null || onlyMissing);
  const keep = c => {
    if (!filtering) return true;
    if (q && !`${c.number} ${c.name}`.toLowerCase().includes(q)) return false;
    if (missingIn !== null && c.cells[missingIn] !== false) return false;
    if (onlyMissing && !Object.values(c.cells).some(v => v === false)) return false;
    return true;
  };
  const visible = tables
    .map(t => ({ ...t, shown: t.cards.filter(keep) }))
    .filter(t => !filtering || t.shown.length > 0);
  const shownCount = visible.reduce((n, t) => n + t.shown.length, 0);

  const statBoxes = [
    { label: 'Cards',      value: totalCards },
    { label: 'Checked',    value: `${totalOwned} / ${totalCells}` },
    { label: 'Completion', value: `${pct.toFixed(1)}%`, highlight: pct >= 100 },
  ];

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <Link to="/topps" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Topps</Link>
        {' / '}<span>{set.name}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: '1.5rem' }}>{set.name}</h1>
        <button className={`btn ${editMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEdit(!editMode)}>
          {editMode ? '✓ Done editing' : '✎ Edit tables'}
        </button>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {statBoxes.map(s => (
          <div key={s.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 14px', minWidth: 110 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: s.highlight ? 'var(--success)' : 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {editMode ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            Edit like a sheet: change names and titles in place, add or remove columns and rows, and click a
            box to cycle it — <strong>need</strong> (empty) → <strong>have</strong> (checked) → <strong>doesn't exist</strong> (dash).
          </p>
          <ToppsPicturesPanel setId={id} onFinished={load} />
        </>
      ) : (
        /* ── Filters ── */
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={`btn btn-sm ${onlyMissing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOnlyMissing(o => !o)}>
            Cards missing something
          </button>
          <select
            className="input"
            value={missingIn ?? ''}
            onChange={e => setMissingIn(e.target.value === '' ? null : parseInt(e.target.value, 10))}
            style={{ width: 'auto', maxWidth: 300 }}
          >
            <option value="">Missing in any printing</option>
            {tables.map((t, i) => (
              <optgroup key={t.id} label={t.title || (tables.length > 1 ? `Table ${i + 1}` : 'Printings')}>
                {t.variants.map(v => <option key={v.id} value={v.id}>Missing in: {v.name}</option>)}
              </optgroup>
            ))}
          </select>
          <input className="input" placeholder="Search number or name…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
          {filtering && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setSearch(''); setMissingIn(null); setOnlyMissing(false); }}>Clear</button>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {shownCount} card{shownCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* ── Tables ── */}
      {visible.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
          {filtering ? 'No cards match the current filter.' : 'No tables yet — use “Edit tables” to add one.'}
        </div>
      )}

      {visible.map((table, idx) => (
        <TableSection
          key={table.id}
          table={table}
          first={idx === 0}
          editMode={editMode}
          perVariant={perVariant}
          missingIn={missingIn}
          setMissingIn={setMissingIn}
          onCellClick={handleCellClick}
          onPicture={changePicture}
          run={run}
          resetKey={resetKey}
          onPaste={() => setPasteTable(table)}
        />
      ))}

      {pasteTable && (
        <ToppsPasteModal
          table={pasteTable}
          onClose={changed => {
            setPasteTable(null);
            if (changed) run(async () => {});          // just reloads
          }}
        />
      )}

      {editMode && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn-ghost" onClick={() => run(() => api.topps.addTable(id, ''))}>
            + Add table
          </button>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-6)', textAlign: 'right' }}>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={handleDeleteChecklist}>
          Delete this checklist
        </button>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

// ── One table ─────────────────────────────────────────────────────────────────
function TableSection({ table, first, editMode, perVariant, missingIn, setMissingIn, onCellClick, onPicture, run, resetKey, onPaste }) {
  const titled = table.title !== '';
  const compact = !editMode && !first && table.variants.length <= 2;     // keep tiny tables from stretching across the page
  const cells = table.cards.reduce((n, c) => n + Object.keys(c.cells).length, 0);
  const owned = table.cards.reduce((n, c) => n + Object.values(c.cells).filter(Boolean).length, 0);
  const multi = table.variants.length > 1;

  function confirmDeleteColumn(v) {
    const have = perVariant[v.id].owned;
    if (have > 0 && !confirm(`Delete the column "${v.name}"? It has ${have} checked card${have !== 1 ? 's' : ''}, which will be lost.`)) return;
    run(() => api.topps.deleteVariant(v.id));
  }

  function confirmDeleteRow(card) {
    const have = Object.values(card.cells).filter(Boolean).length;
    if (have > 0 && !confirm(`Delete "${card.name}"? It has ${have} checked printing${have !== 1 ? 's' : ''}, which will be lost.`)) return;
    run(() => api.topps.deleteCard(card.id));
  }

  function confirmDeleteTable() {
    const label = titled ? `"${table.title}"` : 'this table';
    if (!confirm(`Delete ${label} and its ${table.cards.length} card${table.cards.length !== 1 ? 's' : ''}? This can't be undone.`)) return;
    run(() => api.topps.deleteTable(table.id));
  }

  return (
    <div style={{ marginTop: first ? 0 : 'var(--space-6)' }}>
      {/* Heading (normal mode) or title box (edit mode) */}
      {editMode ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <EditableText
            value={table.title}
            resetKey={resetKey}
            placeholder="Table title (optional)"
            onSave={title => run(() => api.topps.updateTable(table.id, title))}
            style={{ width: 280, fontFamily: 'var(--font-display)', fontWeight: 700 }}
          />
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={onPaste}>
            Paste from Excel
          </button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={confirmDeleteTable}>
            Delete table
          </button>
        </div>
      ) : titled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: '1.1rem', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {table.title}
            <span style={{ marginLeft: 'var(--space-3)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{owned} / {cells}</span>
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
      )}

      <div className="panel" style={{ padding: 0, overflow: 'hidden', maxWidth: compact ? 640 : undefined }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Name</th>
                {editMode && <th style={thStyle}>Front picture URL</th>}
                {editMode && <th style={thStyle}>Back picture URL</th>}
                {table.variants.map(v => editMode ? (
                  <th key={v.id} style={{ ...thStyle, textAlign: 'center', minWidth: 130 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <EditableText
                        value={v.name}
                        resetKey={resetKey}
                        required
                        onSave={name => run(() => api.topps.updateVariant(v.id, name))}
                        style={{ width: 120, fontSize: '0.75rem', textAlign: 'center' }}
                      />
                      <button className="btn btn-ghost btn-sm" title="Delete column" style={iconBtn} onClick={() => confirmDeleteColumn(v)}>×</button>
                    </div>
                  </th>
                ) : (
                  <th
                    key={v.id}
                    onClick={() => setMissingIn(missingIn === v.id ? null : v.id)}
                    title={`Click to show cards missing in ${v.name}`}
                    style={{
                      ...thStyle,
                      textAlign: 'center',
                      whiteSpace: 'normal',
                      minWidth: 90,
                      cursor: 'pointer',
                      userSelect: 'none',
                      color: missingIn === v.id ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {v.name}
                    {multi && (
                      <div style={{ marginTop: 3, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'none' }}>
                        {perVariant[v.id].owned} / {perVariant[v.id].total}
                      </div>
                    )}
                  </th>
                ))}
                {editMode && (
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: 130 }}>
                    <AddColumn onAdd={name => run(() => api.topps.addVariant(table.id, name))} />
                  </th>
                )}
                {editMode && <th style={thStyle} />}
              </tr>
            </thead>
            <tbody>
              {table.shown.map((card, idx) => (
                <Row
                  key={card.id}
                  card={card}
                  variants={table.variants}
                  zebra={idx % 2 === 1}
                  editMode={editMode}
                  onCellClick={onCellClick}
                  onPicture={(side, url) => onPicture(card, side, url)}
                  onEditCard={(number, name) => run(() => api.topps.updateCard(card.id, number, name))}
                  onDelete={() => confirmDeleteRow(card)}
                  resetKey={resetKey}
                />
              ))}
              {table.shown.length === 0 && !editMode && (
                <tr>
                  <td colSpan={table.variants.length + 2} style={{ textAlign: 'center', padding: 'var(--space-5)', color: 'var(--text-muted)' }}>
                    No cards yet.
                  </td>
                </tr>
              )}
              {editMode && (
                <AddRow
                  colSpan={table.variants.length + 4}
                  onAdd={(number, name) => run(() => api.topps.addCard(table.id, number, name))}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ card, variants, zebra, editMode, onCellClick, onPicture, onEditCard, onDelete, resetKey }) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      style={{
        background: hovered ? 'var(--bg-elevated)' : (zebra ? 'var(--bg-elevated)' : 'transparent'),
        borderBottom: '1px solid var(--border)',
        transition: 'background var(--transition)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editMode ? (
        <>
          <td style={tdStyle}>
            <EditableText value={card.number} resetKey={resetKey} required style={{ width: 80, fontSize: '0.8rem' }}
              onSave={number => onEditCard(number, card.name)} />
          </td>
          <td style={tdStyle}>
            <EditableText value={card.name} resetKey={resetKey} required style={{ width: 240, fontSize: '0.85rem' }}
              onSave={name => onEditCard(card.number, name)} />
          </td>
          <td style={tdStyle}>
            <PictureField url={card.image_url} resetKey={resetKey} placeholder="Front picture URL" onSave={url => onPicture('front', url)} />
          </td>
          <td style={tdStyle}>
            <PictureField url={card.back_image_url} resetKey={resetKey} placeholder="Back picture URL" onSave={url => onPicture('back', url)} />
          </td>
        </>
      ) : (
        <>
          <td style={tdStyle}>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '0.8rem', fontWeight: 700 }}>
              {card.number}
            </span>
          </td>
          <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <HoverPreview images={[card.image_url, card.back_image_url]}>{card.name}</HoverPreview>
          </td>
        </>
      )}
      {variants.map(v => (
        <td key={v.id} style={{ ...tdStyle, textAlign: 'center' }}>
          <CellBox
            state={cellState(card, v.id)}
            editable={editMode}
            onClick={() => onCellClick(card, v.id)}
            title={`${card.name} — ${v.name}`}
          />
        </td>
      ))}
      {editMode && <td />}
      {editMode && (
        <td style={{ ...tdStyle, textAlign: 'right' }}>
          <button className="btn btn-ghost btn-sm" title="Delete row" style={iconBtn} onClick={onDelete}>×</button>
        </td>
      )}
    </tr>
  );
}

// ── Edit-mode helpers ─────────────────────────────────────────────────────────

// A text box that saves when you leave it (or press Enter); Escape undoes.
// The key makes it pick up the server's value after each edit, including when
// an edit was rejected and the box should snap back.
function EditableText({ value, resetKey, onSave, required = false, placeholder, style }) {
  return (
    <input
      key={`${value}|${resetKey}`}
      className="input"
      defaultValue={value}
      placeholder={placeholder}
      style={{ padding: '4px 8px', ...style }}
      onBlur={e => {
        const next = e.target.value.trim();
        if (next === value) return;
        if (required && !next) { e.target.value = value; return; }
        onSave(next);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
      }}
    />
  );
}

// A picture URL box with a small preview (hover it for full size). Saving
// downloads the picture on the server, so the box shows a spinner meanwhile
// and then the stored copy's URL. Empty = no picture.
function PictureField({ url, resetKey, placeholder, onSave }) {
  const [saving, setSaving] = useState(false);
  const value = url || '';

  async function save(next) {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 24, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {saving ? (
          <span className="spinner" style={{ width: 14, height: 14 }} />
        ) : url ? (
          <HoverPreview images={[url]}>
            <img src={url} alt="" style={{ width: 24, height: 34, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
          </HoverPreview>
        ) : null}
      </div>
      <input
        key={`${value}|${resetKey}`}
        className="input"
        defaultValue={value}
        placeholder={placeholder}
        disabled={saving}
        title={value}
        style={{ padding: '4px 8px', width: 170, fontSize: '0.75rem' }}
        onBlur={e => {
          const next = e.target.value.trim();
          if (next !== value) save(next);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
        }}
      />
    </div>
  );
}

function AddColumn({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
    setName('');
    setOpen(false);
  }

  if (!open) {
    return <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>+ Column</button>;
  }
  return (
    <input
      className="input"
      autoFocus
      placeholder="Column name"
      value={name}
      onChange={e => setName(e.target.value)}
      onBlur={submit}
      onKeyDown={e => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') { setName(''); setOpen(false); }
      }}
      style={{ padding: '4px 8px', fontSize: '0.75rem', width: 120 }}
    />
  );
}

function AddRow({ colSpan, onAdd }) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const numberRef = useRef(null);

  function submit() {
    if (!number.trim() || !name.trim()) return;
    onAdd(number.trim(), name.trim());
    setNumber('');
    setName('');
    numberRef.current?.focus();
  }

  const onEnter = e => { if (e.key === 'Enter') submit(); };
  return (
    <tr style={{ background: 'var(--bg-elevated)' }}>
      <td style={tdStyle}>
        <input ref={numberRef} className="input" placeholder="#" value={number} onChange={e => setNumber(e.target.value)} onKeyDown={onEnter}
          style={{ padding: '4px 8px', width: 80, fontSize: '0.8rem' }} />
      </td>
      <td style={tdStyle}>
        <input className="input" placeholder="New card name" value={name} onChange={e => setName(e.target.value)} onKeyDown={onEnter}
          style={{ padding: '4px 8px', width: 240, fontSize: '0.85rem' }} />
      </td>
      <td style={tdStyle} colSpan={colSpan}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={!number.trim() || !name.trim()}>+ Add row</button>
      </td>
    </tr>
  );
}

// Same look as the checkboxes on the card table; "none" is a dash.
function CellBox({ state, editable, onClick, title }) {
  if (state === 'none') {
    return (
      <div
        title={editable ? `${title} (doesn't exist — click to add)` : undefined}
        onClick={editable ? onClick : undefined}
        style={{
          width: 18, height: 18, margin: '0 auto', borderRadius: 4,
          border: editable ? '2px dashed rgba(255,255,255,0.3)' : 'none',
          color: 'var(--text-muted)', opacity: 0.6, lineHeight: '14px', textAlign: 'center',
          cursor: editable ? 'pointer' : 'default',
        }}
      >
        —
      </div>
    );
  }
  const checked = state === 'have';
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      style={{
        width: 18,
        height: 18,
        margin: '0 auto',
        borderRadius: 4,
        border: `2px solid ${checked ? 'var(--success)' : 'rgba(255,255,255,0.5)'}`,
        background: checked ? 'var(--success)' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all var(--transition)',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

const iconBtn = { padding: '0 8px', fontSize: '1rem', lineHeight: 1.4, color: 'var(--danger)' };

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

const tdStyle = {
  padding: '8px 12px',
  fontSize: '0.85rem',
  verticalAlign: 'middle',
};
