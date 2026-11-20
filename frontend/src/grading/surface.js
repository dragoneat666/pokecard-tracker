// grading/surface.js — The surface checklist (scratches, dents, creases...)
//
// Done by eye: a phone photo can't show fine scratches, print lines or small
// dents reliably, so each side gets a short checklist (settings.surface.items)
// where each thing is 'none', 'slight' or 'obvious'. The worst one ticked sets
// the best grade the surface allows. A camera-based surface check (for
// example on a graphics card) could replace this later as its own analyzer.

export const SURFACE_VERSION = 1;
export const LEVELS = [
  { id: 'none', label: 'None' },
  { id: 'slight', label: 'Slight' },
  { id: 'obvious', label: 'Obvious' },
];

// A side with nothing ticked: { scratches: 'none', ... }.
export function emptySurface(settings) {
  return Object.fromEntries(settings.surface.items.map(it => [it.id, 'none']));
}

function capOfSide(items, settings) {
  let cap = 10;
  const worst = [];
  for (const it of settings.surface.items) {
    const level = items?.[it.id];
    if (level !== 'slight' && level !== 'obvious') continue;
    const c = it.caps[level === 'slight' ? 0 : 1];
    if (c < cap) { cap = c; worst.length = 0; }
    if (c === cap) worst.push(`${level} ${it.label.toLowerCase()}`);
  }
  return { cap, worst };
}

// The best grade the surface allows, from the front and/or back checklists.
// Answers { cap, low, high, limitedBy, front, back } or null.
export function surfaceCap(front, back, settings) {
  const per = {};
  for (const [face, items] of [['front', front], ['back', back]]) if (items) per[face] = capOfSide(items, settings);
  const list = Object.entries(per);
  if (!list.length) return null;
  const cap = Math.min(...list.map(([, p]) => p.cap));
  const limiting = list.filter(([, p]) => p.cap === cap && p.worst.length).map(([face, p]) => `${face}: ${p.worst.join(', ')}`);
  return { cap, low: cap, high: cap, ...per, limitedBy: limiting.length ? limiting.join('; ') : 'nothing ticked' };
}

// "Slight scratches, obvious dents" for a side, or '' when nothing is ticked.
export function surfaceText(items, settings) {
  return settings.surface.items
    .filter(it => items?.[it.id] === 'slight' || items?.[it.id] === 'obvious')
    .map(it => `${items[it.id]} ${it.label.toLowerCase()}`)
    .join(', ')
    .replace(/^./, ch => ch.toUpperCase());
}
