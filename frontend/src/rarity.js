// src/rarity.js — Shared rarity utilities
//
// Centralised here so the badge color logic and the
// "can this card have 2 copies" logic stay in sync.

// Rarities that only get 1 ownership checkbox
const BASIC_RARITIES = new Set([
  'Common',
  'Uncommon',
  'Rare',
  'Rare Holo',
  'Energy',
  'Trainer',
  'Promo',
]);

export function isCollectorRarity(rarity) {
  if (!rarity) return false;
  return !BASIC_RARITIES.has(rarity);
}

// Returns a CSS class suffix and display label for a rarity string.
// Used by the RarityBadge component.
export function rarityMeta(rarity) {
  if (!rarity) return { color: 'var(--rarity-common)', label: '—' };

  const r = rarity.toLowerCase();

  if (r.includes('hyper') || r.includes('gold'))
    return { color: 'var(--rarity-secret)', label: rarity };
  if (r.includes('special illustration') || r.includes('sir'))
    return { color: 'var(--rarity-special)', label: rarity };
  if (r.includes('illustration rare') || r.includes('full art'))
    return { color: 'var(--rarity-ultra)', label: rarity };
  if (r.includes('ultra rare') || r.includes('ex') || r.includes('gx') || r.includes('vstar') || r.includes('vmax'))
    return { color: 'var(--rarity-ultra)', label: rarity };
  if (r.includes('rare holo') || r.includes('holo'))
    return { color: 'var(--rarity-holo)', label: rarity };
  if (r.includes('rare'))
    return { color: 'var(--rarity-rare)', label: rarity };
  if (r.includes('uncommon'))
    return { color: 'var(--rarity-uncommon)', label: rarity };

  return { color: 'var(--rarity-common)', label: rarity };
}

// Formats a price number as "$12.34" or "—" if null
export function formatPrice(value) {
  if (value === null || value === undefined) return '—';
  return `$${parseFloat(value).toFixed(2)}`;
}
