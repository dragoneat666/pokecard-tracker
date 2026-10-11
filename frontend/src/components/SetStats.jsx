// components/SetStats.jsx — Aggregated stats for a single set
// Shown at the top of SetView, similar to the totals row in your spreadsheet.
//
// Owned/completion only count the main cards and subsets. Value counts
// everything in the set: main cards, subsets, alternates and sealed product,
// using the graded price for graded slots (same as the row totals).

import { formatPrice } from '../rarity.js';

export default function SetStats({ cards, childSets = [], alternateCards = [], sealedProducts = [] }) {
  const allCards = [
    ...cards,
    ...childSets.flatMap(({ cards }) => cards),
  ];

  if (!allCards.length) return null;

  const valueCards = [...allCards, ...alternateCards];

  const owned      = allCards.filter(c => c.owned >= 1).length;
  const total      = allCards.length;
  const pct        = total > 0 ? ((owned / total) * 100).toFixed(1) : 0;
  const totalValue = valueCards.reduce((sum, c) => {
    const price = c.is_graded ? c.graded_price : c.market_price;
    return sum + (c.owned >= 1 && price ? parseFloat(price) * c.owned : 0);
  }, 0);
  const revOwned   = allCards.filter(c => c.reverse_owned >= 1).length;
  const revValue   = valueCards.reduce((sum, c) => {
    const price = c.reverse_is_graded ? c.reverse_graded_price : c.reverse_holo_price;
    return sum + (c.reverse_owned >= 1 && price ? parseFloat(price) * c.reverse_owned : 0);
  }, 0);
  const sealedValue = sealedProducts.reduce(
    (sum, p) => sum + (p.owned >= 1 && p.market_price ? parseFloat(p.market_price) * p.owned : 0), 0
  );

  const stats = [
    { label: 'Owned',        value: `${owned} / ${total}` },
    { label: 'Completion',   value: `${pct}%`, highlight: parseFloat(pct) >= 100 },
    { label: 'Card Value',   value: formatPrice(totalValue) },
    { label: 'Rev. Holos',   value: revOwned },
    { label: 'Rev. Value',   value: formatPrice(revValue) },
    ...(sealedProducts.length > 0 ? [{ label: 'Sealed Value', value: formatPrice(sealedValue) }] : []),
    { label: 'Total Value',  value: formatPrice(totalValue + revValue + sealedValue), strong: true },
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
