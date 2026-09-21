// pages/Reports.jsx — Collection-wide reports
//
// Three reports, each backed by its own /api/reports/* endpoint:
//   - Top 50 most valuable owned cards
//   - Storage audit (safe): $50+ cards that aren't in the safe
//   - Storage audit (toploader): $10-$49.99 cards that aren't in a toploader
//
// Every report row links back to the card's set page so you can go fix it.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatPrice } from '../rarity.js';

const REPORTS = [
  { key: 'top_valuable', label: 'Top 50 Most Valuable', fetch: api.reports.topValuable },
  { key: 'audit_safe',   label: 'Storage Audit — Safe', fetch: api.reports.storageAuditSafe },
  { key: 'audit_toploader', label: 'Storage Audit — Toploader', fetch: api.reports.storageAuditToploader },
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
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
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}>
            <span className="spinner" />
          </div>
        ) : error ? (
          <div style={{ color: 'var(--danger)', padding: 'var(--space-5)' }}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
            No cards match this report.
          </div>
        ) : (
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
        )}
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
