// utils/cardFilters.js — Shared card filtering
//
// The set page and the export builder both filter cards with these, so the
// quick filters (Missing Regular, Missing Reverse, ...) always mean the same
// thing in both places.

import { isCollectorRarity } from '../rarity.js';

// Whether a card has a reverse holo (or 1st edition) version in this set.
export function hasVariant(card, variantType) {
  return variantType === 'first_edition' ? card.has_first_edition : card.has_reverse_holo;
}

export function matchesQuickFilter(card, quickFilter, variantType) {
  const variant = hasVariant(card, variantType);
  switch (quickFilter) {
    case 'missing_regular': return card.owned === 0 && !isCollectorRarity(card.rarity);
    case 'missing_fullart': return card.owned === 0 && isCollectorRarity(card.rarity);
    case 'missing_reverse': return !!variant && card.reverse_owned === 0;
    case 'missing_all':     return card.owned === 0 || (!!variant && card.reverse_owned === 0);
    case 'owned':           return card.owned >= 1 || card.reverse_owned >= 1;
    default:                return true;
  }
}

export function matchesSearch(card, search) {
  if (!search) return true;
  const q = search.toLowerCase();
  return card.name.toLowerCase().includes(q) ||
    card.card_number.includes(search) ||
    card.pokemon_type?.toLowerCase().includes(q) ||
    card.rarity?.toLowerCase().includes(q) ||
    card.storage?.toLowerCase().includes(q);
}
