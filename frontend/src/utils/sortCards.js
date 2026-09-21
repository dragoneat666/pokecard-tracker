// utils/sortCards.js — Shared card-list sorting logic
//
// Used by both the main card table and the Alternates table in SetView.jsx
// so their comparators — especially the card-number parser, which handles
// prefixes like "TG" — never drift apart.

// Splits a card number into leading letters, numeric part, and trailing
// suffix so "TG01", "045", "050a" all sort sensibly against each other.
// leadingLetters — letters BEFORE the number (H, TG, AR etc)
// num            — the numeric part
// trailingSuffix — letters AFTER the number (a, b in 050a, 050b)
function parseCardNumber(cardNumber) {
  const base = (cardNumber || '').split('/')[0];
  const match = base.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if (!match) return { leading: base, num: 0, suffix: '' };
  return { leading: match[1], num: parseInt(match[2]) || 0, suffix: match[3] };
}

function compareByNumber(a, b, sortDir) {
  const a$ = parseCardNumber(a.card_number);
  const b$ = parseCardNumber(b.card_number);

  // Pure numeric cards (no leading letters) always come first
  const aIsLetter = a$.leading !== '' ? 1 : 0;
  const bIsLetter = b$.leading !== '' ? 1 : 0;
  if (aIsLetter !== bIsLetter) return aIsLetter - bIsLetter;

  // Within same group: sort by leading prefix alphabetically
  if (a$.leading !== b$.leading) {
    return sortDir === 'asc'
      ? a$.leading.localeCompare(b$.leading)
      : b$.leading.localeCompare(a$.leading);
  }

  // Then by number
  if (a$.num !== b$.num) {
    return sortDir === 'asc' ? a$.num - b$.num : b$.num - a$.num;
  }

  // Then by trailing suffix (a before b, no suffix before a)
  return sortDir === 'asc'
    ? a$.suffix.localeCompare(b$.suffix)
    : b$.suffix.localeCompare(a$.suffix);
}

// Sorts a card array by one of the columns exposed in the card table
// headers: number, name, rarity, price, rev_price. Price/rev_price use the
// graded price instead of market price when that slot is graded, matching
// what CardRow actually displays.
export function sortCards(cards, sortCol, sortDir) {
  return [...cards].sort((a, b) => {
    if (sortCol === 'number') return compareByNumber(a, b, sortDir);

    let aVal, bVal;
    if (sortCol === 'name') {
      aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase();
    } else if (sortCol === 'rarity') {
      aVal = a.rarity || ''; bVal = b.rarity || '';
    } else if (sortCol === 'price') {
      aVal = parseFloat(a.is_graded ? a.graded_price : a.market_price) || 0;
      bVal = parseFloat(b.is_graded ? b.graded_price : b.market_price) || 0;
    } else if (sortCol === 'rev_price') {
      aVal = parseFloat(a.reverse_is_graded ? a.reverse_graded_price : a.reverse_holo_price) || 0;
      bVal = parseFloat(b.reverse_is_graded ? b.reverse_graded_price : b.reverse_holo_price) || 0;
    } else {
      return 0;
    }

    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}
