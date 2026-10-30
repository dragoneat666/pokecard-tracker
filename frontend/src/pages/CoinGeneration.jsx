// pages/CoinGeneration.jsx — One generation's coins
//
// The North American table is the checklist: the number (what's written on the
// coin sleeve, in release order), the coin, its size (Regular / Large / Jumbo /
// Metal, read from the description on import), the product it came in, its
// release date, and a have / need box per variety. Hover a coin to see its picture and
// Bulbapedia's description. Coins from other regions are listed underneath for
// reference — collapsed, without boxes, and numbered J1, J2... / K1... so they
// never look like one of yours.
//
// Edit mode ("Edit coins"): change any field in place, set Front / Back picture
// URLs (downloaded and stored on our server), add / rename / remove varieties,
// add coins by hand and delete coins.
//
// Have / need toggles and picture changes are optimistic with revert-on-failure,
// like the main card table. Other edits call the API and then reload.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../hooks/useToast.js';
import HoverPreview from '../components/HoverPreview.jsx';
import { EditableText, PictureField, CellBox } from '../components/SheetControls.jsx';

const PICTURE_COLUMN = { front: 'image_url', back: 'back_image_url' };
const REGION_PREFIX = { 'North America': '', Japan: 'J', 'South Korea': 'K' };
const COIN_PICTURE = { w: 240, h: 240 };

// "J", "K"... for reference regions; any other region gets its initials.
function prefixOf(region) {
  return REGION_PREFIX[region] ?? region.split(/\s+/).map(w => w[0]).join('').toUpperCase();
}

export default function CoinGeneration() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast, showToast } = useToast();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [editMode, setEditMode] = useState(searchParams.get('edit') === '1');
  const [resetKey, setResetKey] = useState(0);            // bumps after each edit so text boxes show the server's value

  const [search, setSearch]   = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.coins.generation(id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Runs an edit, then reloads so the page matches the server (on failure too,
  // which also resets any text box that was mid-edit).
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

  function patchCoin(coinId, change) {
    setData(d => ({ ...d, coins: d.coins.map(c => (c.id === coinId ? { ...c, ...change(c) } : c)) }));
  }

  // Optimistic have / need.
  async function toggleVariety(coin, variety) {
    const owned = !variety.owned;
    const setOwned = value => patchCoin(coin.id, c => ({
      varieties: c.varieties.map(v => (v.id === variety.id ? { ...v, owned: value } : v)),
    }));
    setOwned(owned);
    try {
      await api.coins.updateVariety(variety.id, { owned });
    } catch (err) {
      setOwned(!owned);
      showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  // Optimistic picture change. The server downloads the picture and answers
  // with the URL of its stored copy, which then replaces the typed one.
  async function changePicture(coin, side, url) {
    const column = PICTURE_COLUMN[side];
    const prev = coin[column];
    patchCoin(coin.id, () => ({ [column]: url || null }));
    try {
      const saved = await api.coins.setPicture(coin.id, side, url);
      patchCoin(coin.id, () => ({ [column]: saved.url }));
    } catch (err) {
      patchCoin(coin.id, () => ({ [column]: prev }));
      showToast(err.message, 'error');
    }
  }

  async function handleDeleteGeneration() {
    if (!confirm(`Delete "${data.generation.name}" and all its coins? This can't be undone.`)) return;
    try {
      await api.coins.deleteGeneration(id);
      navigate('/coins');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>;
  }
  if (error) {
    return <div className="panel" style={{ color: 'var(--danger)' }}>{error} — <Link to="/coins">back to Coins</Link></div>;
  }

  const { generation, collectedRegion, coins } = data;

  // ── Regions: the collected one first (even when empty), then the others ────
  const regions = [collectedRegion, ...new Set(coins.map(c => c.region).filter(r => r !== collectedRegion))];
  const byRegion = region => coins.filter(c => c.region === region);

  // ── Progress (collected region only) ───────────────────────────────────────
  const mine = byRegion(collectedRegion);
  const total = mine.reduce((n, c) => n + c.varieties.length, 0);
  const owned = mine.reduce((n, c) => n + c.varieties.filter(v => v.owned).length, 0);
  const complete = mine.filter(c => c.varieties.every(v => v.owned)).length;
  const pct = total > 0 ? (owned / total) * 100 : 0;

  // ── Filters (normal mode only) ─────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtering = !editMode && (!!q || onlyMissing);
  const keep = c => {
    if (!filtering) return true;
    if (q && !`${prefixOf(c.region)}${c.number} ${c.name} ${c.size || ''} ${c.released_in} ${c.release_date}`.toLowerCase().includes(q)) return false;
    if (onlyMissing && !c.varieties.some(v => !v.owned)) return false;
    return true;
  };
  const shownMine = mine.filter(keep);

  const statBoxes = [
    { label: 'Coins',      value: mine.length },
    { label: 'Complete',   value: `${complete} / ${mine.length}` },
    { label: 'Checked',    value: `${owned} / ${total}` },
    { label: 'Completion', value: `${pct.toFixed(1)}%`, highlight: pct >= 100 },
  ];

  const tableProps = {
    editMode, resetKey, run,
    onToggle: toggleVariety,
    onPicture: changePicture,
    onAdd: (region, number, name) => run(() => api.coins.addCoin(id, region, number, name)),
  };

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <Link to="/coins" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Coins</Link>
        {' / '}<span>{generation.name}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: '1.5rem' }}>{generation.name} coins</h1>
        <button className={`btn ${editMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEdit(!editMode)}>
          {editMode ? '✓ Done editing' : '✎ Edit coins'}
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
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          Change anything in place — it saves when you leave the box. A coin that came in several versions can have
          a box per variety (“+ Variety”); it counts as complete once every variety is checked.
        </p>
      ) : (
        /* ── Filters ── */
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={`btn btn-sm ${onlyMissing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOnlyMissing(o => !o)}>
            Coins I still need
          </button>
          <input className="input" placeholder="Search number, coin, size, product or date…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 300 }} />
          {filtering && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setSearch(''); setOnlyMissing(false); }}>Clear</button>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {shownMine.length} coin{shownMine.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* ── The collected region ── */}
      <RegionTable {...tableProps} region={collectedRegion} coins={shownMine} collected filtering={filtering} />

      {/* ── Other regions, for reference ── */}
      {!onlyMissing && regions.slice(1).map(region => {
        const list = byRegion(region).filter(keep);
        if (filtering && list.length === 0) return null;
        return (
          <details key={region} open={editMode || filtering} style={{ marginTop: 'var(--space-6)' }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
              {region}
              <span style={{ marginLeft: 'var(--space-3)', fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                {list.length} coin{list.length !== 1 ? 's' : ''} · for reference, not collected
              </span>
            </summary>
            <RegionTable {...tableProps} region={region} coins={list} filtering={filtering} />
          </details>
        );
      })}

      <div style={{ marginTop: 'var(--space-6)', textAlign: 'right' }}>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={handleDeleteGeneration}>
          Delete this generation
        </button>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

// ── One region's table ────────────────────────────────────────────────────────
function RegionTable({ region, coins, collected = false, filtering, editMode, resetKey, run, onToggle, onPicture, onAdd }) {
  const prefix = prefixOf(region);
  const nextNumber = coins.reduce((n, c) => Math.max(n, c.number), 0) + 1;
  const columns = editMode ? (collected ? 10 : 9) : (collected ? 6 : 5);

  function confirmDelete(coin) {
    const have = coin.varieties.filter(v => v.owned).length;
    const message = have > 0
      ? `Delete ${prefix}${coin.number} ${coin.name}? It has ${have} checked variet${have !== 1 ? 'ies' : 'y'}, which will be lost.`
      : `Delete ${prefix}${coin.number} ${coin.name}?`;
    if (confirm(message)) run(() => api.coins.deleteCoin(coin.id));
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...thStyle, width: 60 }}>#</th>
              <th style={thStyle}>Coin</th>
              <th style={thStyle}>Size</th>
              <th style={thStyle}>Released in</th>
              <th style={thStyle}>Date</th>
              {editMode && <th style={thStyle}>Description</th>}
              {editMode && <th style={thStyle}>Front picture URL</th>}
              {editMode && <th style={thStyle}>Back picture URL</th>}
              {collected && <th style={{ ...thStyle, textAlign: editMode ? 'left' : 'center' }}>{editMode ? 'Varieties' : 'Have'}</th>}
              {editMode && <th style={thStyle} />}
            </tr>
          </thead>
          <tbody>
            {coins.map((coin, idx) => (
              <CoinRow
                key={coin.id}
                coin={coin}
                prefix={prefix}
                collected={collected}
                zebra={idx % 2 === 1}
                editMode={editMode}
                resetKey={resetKey}
                run={run}
                onToggle={variety => onToggle(coin, variety)}
                onPicture={(side, url) => onPicture(coin, side, url)}
                onDelete={() => confirmDelete(coin)}
              />
            ))}
            {coins.length === 0 && !editMode && (
              <tr>
                <td colSpan={columns} style={{ textAlign: 'center', padding: 'var(--space-5)', color: 'var(--text-muted)' }}>
                  {filtering ? 'No coins match the current filter.' : 'No coins yet.'}
                </td>
              </tr>
            )}
            {editMode && (
              <AddCoinRow
                prefix={prefix}
                nextNumber={nextNumber}
                colSpan={columns - 2}
                onAdd={(number, name) => onAdd(region, number, name)}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoinRow({ coin, prefix, collected, zebra, editMode, resetKey, run, onToggle, onPicture, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const save = change => run(() => api.coins.updateCoin(coin.id, change));
  const thumb = coin.image_url ? (
    <img src={coin.image_url} alt="" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
  ) : (
    <span style={{ width: 28, height: 28, borderRadius: '50%', border: '1px dashed var(--border)', flexShrink: 0 }} />
  );

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {prefix && <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{prefix}</span>}
              <EditableText value={String(coin.number)} resetKey={resetKey} required style={{ width: 56, fontSize: '0.8rem' }}
                onSave={number => save({ number })} />
            </div>
          </td>
          <td style={tdStyle}>
            <EditableText value={coin.name} resetKey={resetKey} required style={{ width: 200, fontSize: '0.85rem' }}
              onSave={name => save({ name })} />
          </td>
          <td style={tdStyle}>
            <EditableText value={coin.size || ''} resetKey={resetKey} style={{ width: 90, fontSize: '0.8rem' }}
              onSave={size => save({ size })} />
          </td>
          <td style={tdStyle}>
            <EditableText value={coin.released_in} resetKey={resetKey} style={{ width: 220, fontSize: '0.8rem' }}
              onSave={released_in => save({ released_in })} />
          </td>
          <td style={tdStyle}>
            <EditableText value={coin.release_date} resetKey={resetKey} style={{ width: 140, fontSize: '0.8rem' }}
              onSave={release_date => save({ release_date })} />
          </td>
          <td style={tdStyle}>
            <EditableArea value={coin.description} resetKey={resetKey} onSave={description => save({ description })} />
          </td>
          <td style={tdStyle}>
            <PictureField round url={coin.image_url} resetKey={resetKey} placeholder="Front picture URL" onSave={url => onPicture('front', url)} />
          </td>
          <td style={tdStyle}>
            <PictureField round url={coin.back_image_url} resetKey={resetKey} placeholder="Back picture URL" onSave={url => onPicture('back', url)} />
          </td>
          {collected && (
            <td style={tdStyle}>
              <VarietyEditor coin={coin} resetKey={resetKey} run={run} onToggle={onToggle} />
            </td>
          )}
          <td style={{ ...tdStyle, textAlign: 'right' }}>
            <button className="btn btn-ghost btn-sm" title="Delete coin" style={iconBtn} onClick={onDelete}>×</button>
          </td>
        </>
      ) : (
        <>
          <td style={tdStyle}>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '0.8rem', fontWeight: 700 }}>
              {prefix}{coin.number}
            </span>
          </td>
          <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <HoverPreview images={[coin.image_url, coin.back_image_url]} imageSize={COIN_PICTURE} caption={coin.description || null}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                {thumb}
                {coin.name}
              </span>
            </HoverPreview>
          </td>
          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}><SizeBadge size={coin.size} /></td>
          <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{coin.released_in}</td>
          <td style={{ ...tdStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{coin.release_date}</td>
          {collected && (
            <td style={{ ...tdStyle, textAlign: 'center' }}>
              <Varieties coin={coin} onToggle={onToggle} />
            </td>
          )}
        </>
      )}
    </tr>
  );
}

// A small pill so Large / Jumbo stand out when picking sleeves. Sizes typed by
// hand that aren't one of these get the plain look.
const SIZE_COLORS = {
  Regular: 'var(--text-muted)',
  Large:   'var(--rarity-rare)',
  Jumbo:   'var(--rarity-ultra)',
  Metal:   'var(--rarity-common)',
};

function SizeBadge({ size }) {
  if (!size) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = SIZE_COLORS[size] || 'var(--text-secondary)';
  return (
    <span className="rarity-badge" style={{ background: color + '22', color, border: `1px solid ${color}44`, fontWeight: 700 }}>
      {size}
    </span>
  );
}

// Normal mode: one box, or a labelled box per variety.
function Varieties({ coin, onToggle }) {
  if (coin.varieties.length === 1) {
    const v = coin.varieties[0];
    return <CellBox state={v.owned ? 'have' : 'need'} onClick={() => onToggle(v)} title={coin.name} />;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
      {coin.varieties.map(v => (
        <span key={v.id} onClick={() => onToggle(v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
          <CellBox state={v.owned ? 'have' : 'need'} title={`${coin.name} — ${v.name}`} />
          {v.name}
        </span>
      ))}
    </div>
  );
}

// ── Edit-mode helpers ─────────────────────────────────────────────────────────

// Each variety: its box, its name, and × (not on the last one); then + Variety.
function VarietyEditor({ coin, resetKey, run, onToggle }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const only = coin.varieties.length === 1;

  function submit() {
    const trimmed = name.trim();
    if (trimmed) run(() => api.coins.addVariety(coin.id, trimmed));
    setName('');
    setAdding(false);
  }

  function confirmDelete(v) {
    if (v.owned && !confirm(`Delete the variety "${v.name}"? It's checked, and that will be lost.`)) return;
    run(() => api.coins.deleteVariety(v.id));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {coin.varieties.map(v => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CellBox state={v.owned ? 'have' : 'need'} onClick={() => onToggle(v)} title={`${coin.name} — ${v.name}`} />
          <EditableText value={v.name} resetKey={resetKey} required style={{ width: 150, fontSize: '0.75rem' }}
            onSave={next => run(() => api.coins.updateVariety(v.id, { name: next }))} />
          {!only && (
            <button className="btn btn-ghost btn-sm" title="Delete variety" style={iconBtn} onClick={() => confirmDelete(v)}>×</button>
          )}
        </div>
      ))}
      {adding ? (
        <input
          className="input"
          autoFocus
          placeholder="Variety name"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={submit}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') { setName(''); setAdding(false); }
          }}
          style={{ padding: '4px 8px', fontSize: '0.75rem', width: 174, marginLeft: 24 }}
        />
      ) : (
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', fontSize: '0.72rem' }} onClick={() => setAdding(true)}>
          + Variety
        </button>
      )}
    </div>
  );
}

// Like EditableText, for the long description: saves when you leave it;
// Escape undoes.
function EditableArea({ value, resetKey, onSave }) {
  return (
    <textarea
      key={`${value}|${resetKey}`}
      className="input"
      defaultValue={value}
      rows={2}
      style={{ padding: '4px 8px', width: 280, fontSize: '0.75rem', resize: 'vertical', fontFamily: 'inherit' }}
      onBlur={e => {
        const next = e.target.value.trim();
        if (next !== value) onSave(next);
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
      }}
    />
  );
}

function AddCoinRow({ prefix, nextNumber, colSpan, onAdd }) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const nameRef = useRef(null);

  function submit() {
    if (!name.trim()) return;
    onAdd(number.trim() || nextNumber, name.trim());
    setNumber('');
    setName('');
    nameRef.current?.focus();
  }

  const onEnter = e => { if (e.key === 'Enter') submit(); };
  return (
    <tr style={{ background: 'var(--bg-elevated)' }}>
      <td style={tdStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {prefix && <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{prefix}</span>}
          <input className="input" placeholder={String(nextNumber)} value={number} onChange={e => setNumber(e.target.value)} onKeyDown={onEnter}
            style={{ padding: '4px 8px', width: 56, fontSize: '0.8rem' }} />
        </div>
      </td>
      <td style={tdStyle}>
        <input ref={nameRef} className="input" placeholder="New coin name" value={name} onChange={e => setName(e.target.value)} onKeyDown={onEnter}
          style={{ padding: '4px 8px', width: 200, fontSize: '0.85rem' }} />
      </td>
      <td style={tdStyle} colSpan={colSpan}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={!name.trim()}>+ Add coin</button>
      </td>
    </tr>
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
