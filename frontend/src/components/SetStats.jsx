// components/SetStats.jsx — Aggregated stats for a single set
// Shown at the top of SetView, similar to the totals row in your spreadsheet.

import { formatPrice } from '../rarity.js';

export default function SetStats({ cards }) {
  if (!cards.length) return null;

  const owned      = cards.filter(c => c.owned >= 1).length;
  const total      = cards.length;
  const pct        = total > 0 ? ((owned / total) * 100).toFixed(1) : 0;
  const totalValue = cards.reduce((sum, c) => {
    return sum + (c.owned >= 1 && c.market_price ? parseFloat(c.market_price) * c.owned : 0);
  }, 0);
  const revOwned   = cards.filter(c => c.reverse_owned >= 1).length;
  const revValue   = cards.reduce((sum, c) => {
    return sum + (c.reverse_owned >= 1 && c.reverse_holo_price ? parseFloat(c.reverse_holo_price) * c.reverse_owned : 0);
  }, 0);

  const stats = [
    { label: 'Owned',        value: `${owned} / ${total}` },
    { label: 'Completion',   value: `${pct}%`, highlight: parseFloat(pct) >= 100 },
    { label: 'Card Value',   value: formatPrice(totalValue) },
    { label: 'Rev. Holos',   value: revOwned },
    { label: 'Rev. Value',   value: formatPrice(revValue) },
    { label: 'Total Value',  value: formatPrice(totalValue + revValue), strong: true },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)',
      flexWrap: 'wrap',
    }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 14px',
          minWidth: 110,
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            {s.label}
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1rem',
            color: s.highlight ? 'var(--success)' : s.strong ? 'var(--accent)' : 'var(--text-primary)',
          }}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
