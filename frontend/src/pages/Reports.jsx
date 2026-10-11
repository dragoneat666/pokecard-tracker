// pages/Reports.jsx — Collection-wide reports
//
// Three reports, each backed by its own /api/reports/* endpoint:
//   - Top 50 most valuable owned cards — shown as a grid of card tiles
//     (picture left, details right), loosely modeled on a TCGPlayer listing
//   - Storage audit (safe): $50+ cards that aren't in the safe
//   - Storage audit (toploader): $10-$49.99 cards that aren't in a toploader
//     (both shown as tables, since they're working lists)
//
// Every report row links back to the card's set page so you can go fix it.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatPrice } from '../rarity.js';

const REPORTS = [
  { key: 'top_valuable', label: 'Top 50 Most Valuable', fetch: api.reports.topValuable, view: 'tiles' },
  { key: 'audit_safe',   label: 'Storage Audit — Safe', fetch: api.reports.storageAuditSafe, view: 'table' },
  { key: 'audit_toploader', label: 'Storage Audit — Toploader', fetch: api.reports.storageAuditToploader, view: 'table' },
];

const STORAGE_LABELS = {
  binder: 'Binder',
  sleeve: 'Sleeve',
  toploader: 'Toploader',
  safe: 'Safe',
};

export default function Reports() {
  const [activeKey, setActiveKey] = useState(REPORTS[0].key);
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const active = REPORTS.find(r => r.key === activeKey);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    active.fetch()
      .then(data => { if (!cancelled) setRows(data); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeKey]);

  const isTiles = active.view === 'tiles';

  return (
    <div style={{ maxWidth: isTiles ? 1700 : 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-4)' }}>Reports</h1>

      {/* ── Report tabs ── */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {REPORTS.map(r => (
          <button
            key={r.key}
            className={`btn btn-sm ${activeKey === r.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveKey(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Report body ── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}>
          <span className="spinner" />
        </div>
      ) : error ? (
        <div className="panel" style={{ color: 'var(--danger)' }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
          No cards match this report.
        </div>
      ) : isTiles ? (
        <TileGrid rows={rows} />
      ) : (
        <ReportTable rows={rows} />
      )}
    </div>
  );
}

// ── Tile grid ─────────────────────────────────────────────────────────────────
function TileGrid({ rows }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
      gap: 'var(--space-4)',
    }}>
      {rows.map((card, idx) => (
        <CardTile key={card.id} card={card} rank={idx + 1} />
      ))}
    </div>
  );
}

// Picture takes the left half; name, set, rarity/number and price stack on
// the right. The saved image_url is a small _200w thumbnail, so we try the
// CDN's _400w version first and fall back to the saved one.
function CardTile({ card, rank }) {
  const [useSmall, setUseSmall] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const imgSrc = card.image_url && !useSmall ? card.image_url.replace('_200w', '_400w') : card.image_url;

  const graded = card.is_graded && card.grading_company && card.grade;

  return (
    <Link
      to={`/sets/${card.set_id}`}
      style={{
        display: 'flex',
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        textDecoration: 'none',
        color: 'inherit',
        position: 'relative',
        transition: 'background var(--transition), border-color var(--transition)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border-focus)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Rank badge */}
      <span style={{
        position: 'absolute', top: 10, right: 12,
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.8rem',
        color: 'var(--text-muted)',
      }}>
        #{rank}
      </span>

      {/* Picture — left half */}
      <div style={{ width: '50%', flexShrink: 0, aspectRatio: '5 / 7', display: 'flex' }}>
        {card.image_url && !imgFailed ? (
          <img
            src={imgSrc}
            alt={card.name}
            loading="lazy"
            onError={() => (useSmall ? setImgFailed(true) : setUseSmall(true))}
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)', fontSize: '0.8rem',
          }}>
            No image
          </div>
        )}
      </div>

      {/* Details — right half */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingRight: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.2rem', lineHeight: 1.2 }}>
          {card.name}
        </div>
        <div style={{ marginTop: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.4 }}>
          {card.set_name}
          <br />
          {card.rarity ? `${card.rarity}, ` : ''}#{card.card_number}
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', lineHeight: 1.1 }}>
            {formatPrice(card.price)}
          </div>
          <div style={{ marginTop: 4, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            {graded
              ? <>Graded: <span style={{ color: 'var(--success)' }}>{card.grading_company} {card.grade}</span></>
              : <>Market Price</>}
          </div>
          <div style={{ marginTop: 2, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Stored in: {STORAGE_LABELS[card.storage] || card.storage}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Table (storage audits) ────────────────────────────────────────────────────
function ReportTable({ rows }) {
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Set</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
              <th style={thStyle}>Storage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((card, idx) => (
              <tr
                key={card.id}
                style={{
                  background: idx % 2 === 1 ? 'var(--bg-elevated)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <td style={tdStyle}>{card.card_number}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>
                  <Link to={`/sets/${card.set_id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                    {card.name}
                  </Link>
                </td>
                <td style={tdStyle}>
                  <Link to={`/sets/${card.set_id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {card.set_name}
                  </Link>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)', color: 'var(--success)' }}>
                  {formatPrice(card.price)}
                </td>
                <td style={tdStyle}>{STORAGE_LABELS[card.storage] || card.storage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

const tdStyle = {
  padding: '8px 12px',
  fontSize: '0.85rem',
  verticalAlign: 'middle',
};
