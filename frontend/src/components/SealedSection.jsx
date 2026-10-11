// components/SealedSection.jsx — Sealed product table for a set
//
// Rendered below the main card table and the Alternates table. Sealed items
// (boxes, ETBs, blisters, cases) come from TCGTracking automatically and live
// in their own table, so they never affect completion stats. Owned is a plain
// count with +/- buttons since you can own several of the same product.

import { formatPrice } from '../rarity.js';

export default function SealedSection({ products, onOwnedChange }) {
  if (products.length === 0) return null;

  const totalValue = products.reduce(
    (sum, p) => sum + (p.market_price ? parseFloat(p.market_price) * p.owned : 0), 0
  );

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{
          fontSize: '1.1rem', fontFamily: 'var(--font-display)', fontWeight: 700,
          color: 'var(--text-secondary)', whiteSpace: 'nowrap',
        }}>
          Sealed Product
          {totalValue > 0 && (
            <span style={{ marginLeft: 'var(--space-3)', fontSize: '0.85rem', color: 'var(--success)' }}>
              {formatPrice(totalValue)}
            </span>
          )}
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle} />
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Owned</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => {
                const rowTotal = p.market_price && p.owned >= 1 ? parseFloat(p.market_price) * p.owned : null;
                return (
                  <tr
                    key={p.id}
                    style={{
                      background: p.owned >= 1 ? 'var(--bg-elevated)' : (idx % 2 === 1 ? 'var(--bg-elevated)' : 'transparent'),
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <td style={{ ...tdStyle, width: 56 }}>
                      {p.image_url && (
                        <img
                          src={p.image_url}
                          alt=""
                          loading="lazy"
                          style={{ width: 40, height: 40, objectFit: 'contain', display: 'block' }}
                        />
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={p.owned === 0}
                          onClick={() => onOwnedChange(p.id, p.owned - 1)}
                          style={{ padding: '0 8px' }}
                        >
                          −
                        </button>
                        <span style={{ minWidth: 24, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                          {p.owned}
                        </span>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => onOwnedChange(p.id, p.owned + 1)}
                          style={{ padding: '0 8px' }}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
                      <span style={{ color: p.market_price ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {formatPrice(p.market_price)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-display)' }}>
                      <span style={{ color: rowTotal ? 'var(--success)' : 'var(--text-muted)' }}>
                        {formatPrice(rowTotal)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
