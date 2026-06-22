// utils/sortSets.js
//
// Shared sorting logic for the dashboard's series-grouped set order.
// Used by Dashboard.jsx for display, and SetView.jsx for prev/next navigation,
// so both always agree on what "adjacent" means.

// Groups a flat set array into [{ series, sets[] }, ...] using the same
// rules as the dashboard: series sorted newest-first (excluding promos from
// that calculation), sets within a series sorted newest-first with promos
// always at the bottom.
export function groupBySeries(sets) {
  const buckets = sets.reduce((acc, set) => {
    const key = set.series || 'Unknown';
    if (!acc[key]) acc[key] = { series: key, sets: [] };
    acc[key].sets.push(set);
    return acc;
  }, {});

  Object.values(buckets).forEach(bucket => {
    bucket.sets.sort((a, b) => {
      const aPromo = a.set_type === 'Promo' ? 1 : 0;
      const bPromo = b.set_type === 'Promo' ? 1 : 0;
      if (aPromo !== bPromo) return aPromo - bPromo;
      return new Date(b.release_date) - new Date(a.release_date);
    });
  });

  return Object.values(buckets).sort((a, b) => {
    const nonPromo = sets => sets.filter(s => s.set_type !== 'Promo');
    const aSets = nonPromo(a.sets).length > 0 ? nonPromo(a.sets) : a.sets;
    const bSets = nonPromo(b.sets).length > 0 ? nonPromo(b.sets) : b.sets;
    const aDate = Math.max(...aSets.map(s => new Date(s.release_date)));
    const bDate = Math.max(...bSets.map(s => new Date(s.release_date)));
    return bDate - aDate;
  });
}

// Flattens groupBySeries output into a single ordered array of sets —
// this is the exact visual top-to-bottom order shown on the dashboard.
export function flattenSeriesOrder(sets) {
  const grouped = groupBySeries(sets);
  return grouped.flatMap(group => group.sets);
}

// Given a flat ordered set list and a current set id, returns
// { prev, next } — each either a set object or null at the boundaries.
export function getAdjacentSets(sets, currentId) {
  const ordered = flattenSeriesOrder(sets);
  const index = ordered.findIndex(s => s.id === Number(currentId));
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? ordered[index - 1] : null,
    next: index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}