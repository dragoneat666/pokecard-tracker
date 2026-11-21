// grading/estimate.js — The overall estimate for a card, and comparing copies
//
// A side is summed up as
//   { centering: <centering.measure()>, whitening: <measureEdges()> | null,
//     surface: { scratches: 'none' | 'slight' | 'obvious', ... } | null }
// which is also what a saved copy keeps (result.sides), so a saved copy's
// estimate can be worked out again with the settings of the day and two
// copies are always compared by the same rules.
//
// The estimate is the lowest of the caps: centering, edges (whitening) and
// surface. Each says the best grade it allows; the card can only be as good
// as its worst part.

import { centeringCap, ratioText, CENTERING_VERSION } from './centering.js';
import { edgesCap, EDGES_VERSION } from './edges.js';
import { surfaceCap, SURFACE_VERSION } from './surface.js';

export const VERSIONS = { centering: CENTERING_VERSION, edges: EDGES_VERSION, surface: SURFACE_VERSION };

export function estimateOf(sides, settings) {
  const front = sides?.front, back = sides?.back;
  const c = centeringCap(front?.centering, back?.centering, settings);
  const e = edgesCap(front?.whitening, back?.whitening, settings);
  const s = surfaceCap(front?.surface, back?.surface, settings);
  const parts = [
    c && { id: 'centering', name: 'centering', cap: c, floor: settings.centering.floor, why: c.limitedBy },
    e && { id: 'edges', name: 'edges and corners', cap: e, floor: settings.edges.floor, why: e.limitedBy },
    s && { id: 'surface', name: 'surface', cap: s, floor: settings.surface.floor, why: s.limitedBy },
  ].filter(Boolean);
  if (!parts.length) return null;
  const best = Math.min(...parts.map(p => p.cap.cap));
  const limiting = parts.filter(p => p.cap.cap === best);
  return {
    best,
    low: Math.min(...parts.map(p => p.cap.low)),
    high: Math.min(...parts.map(p => p.cap.high)),
    parts, limiting,
    atFloor: limiting.some(p => p.cap.cap === p.floor),
    unchecked: e?.unchecked || 0,
    backChecked: !!back,
  };
}

// "Whitening: 3.1 mm in all, up to 0.25 mm deep (2 corners, 1 edge)."
// Plus " 1 nick." when there are nicks.
export function whiteningText(m) {
  const nicks = m?.nicks ? ` ${m.nicks} nick${m.nicks > 1 ? 's' : ''}.` : '';
  if (!m || !m.counted) return `No whitening counted.${nicks}`;
  const where = [m.corners && `${m.corners} corner${m.corners > 1 ? 's' : ''}`, m.edges && `${m.edges} edge${m.edges > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  return `Whitening: ${m.lengthMm} mm in all, up to ${m.depthMm} mm deep (${where}).${nicks}`;
}

// "8", "5 or lower", with "(could be 7–8)" when it's a close call.
export function gradeText(est, withRange = true) {
  if (!est) return '—';
  const main = est.atFloor ? `${est.best} or lower` : String(est.best);
  return withRange && est.low !== est.high ? `${main} (could be ${est.low}–${est.high})` : main;
}

// Which of two copies to keep. a and b are side summaries ({ front, back });
// answers { winner: 'a' | 'b' | null, close, headline, reasons: [...] }, each
// reason { what, a, b, better: 'a' | 'b' | null }. The verdict is advice:
// the user picks.
export function compareCopies(a, b, settings) {
  const ea = estimateOf(a, settings), eb = estimateOf(b, settings);
  const t = settings.compare;
  const reasons = [];
  const pick = (va, vb, minDiff, lowerIsBetter = true) => {
    if (va == null || vb == null || Math.abs(va - vb) < minDiff) return null;
    return (va < vb) === lowerIsBetter ? 'a' : 'b';
  };
  const share = (va, vb, minMm) => Math.max(minMm, t.share * Math.max(va, vb));

  reasons.push({ what: 'Estimate', a: gradeText(ea), b: gradeText(eb), better: ea && eb && ea.best !== eb.best ? (ea.best > eb.best ? 'a' : 'b') : null, weight: 0 });
  for (const [face, points, weight] of [['front', t.frontCenteringPoints, 2], ['back', t.backCenteringPoints, 1]]) {
    const ma = a?.[face]?.centering, mb = b?.[face]?.centering;
    if (!ma && !mb) continue;
    reasons.push({
      what: `${cap(face)} centering`, weight,
      a: ma ? (ma.worst == null ? 'no border' : ratioText(ma.worst)) : 'not checked', b: mb ? (mb.worst == null ? 'no border' : ratioText(mb.worst)) : 'not checked',
      better: pick(ma?.worst, mb?.worst, points),
    });
  }
  for (const [face, minMm, weight] of [['front', t.frontWhiteningMm, 2], ['back', t.backWhiteningMm, 1]]) {
    const wa = a?.[face]?.whitening, wb = b?.[face]?.whitening;
    if (!wa && !wb) continue;
    reasons.push({
      what: `${cap(face)} whitening`, weight,
      a: wa ? `${wa.lengthMm} mm` : 'not checked', b: wb ? `${wb.lengthMm} mm` : 'not checked',
      better: wa && wb ? pick(wa.lengthMm, wb.lengthMm, share(wa.lengthMm, wb.lengthMm, minMm)) : null,
    });
  }
  const edgesChecked = (x) => !!(x?.front?.whitening || x?.back?.whitening);
  const na = (a?.front?.whitening?.nicks || 0) + (a?.back?.whitening?.nicks || 0);
  const nb = (b?.front?.whitening?.nicks || 0) + (b?.back?.whitening?.nicks || 0);
  if ((na || nb) && edgesChecked(a) && edgesChecked(b)) {
    reasons.push({ what: 'Nicks', weight: 2, a: String(na), b: String(nb), better: pick(na, nb, 1) });
  }
  const sa = surfaceCap(a?.front?.surface, a?.back?.surface, settings);
  const sb = surfaceCap(b?.front?.surface, b?.back?.surface, settings);
  if (sa || sb) {
    reasons.push({
      what: 'Surface', weight: 2,
      a: sa ? (sa.cap === 10 ? 'nothing ticked' : `up to ${sa.cap}`) : 'not checked',
      b: sb ? (sb.cap === 10 ? 'nothing ticked' : `up to ${sb.cap}`) : 'not checked',
      better: sa && sb ? pick(sa.cap, sb.cap, 1, false) : null,
    });
  }

  let winner = null, close = false, headline;
  if (ea && eb && ea.best !== eb.best) {
    winner = ea.best > eb.best ? 'a' : 'b';
    const w = winner === 'a' ? ea : eb, l = winner === 'a' ? eb : ea;
    close = w.low <= l.high;               // the ranges touch
    headline = `Keep copy ${winner.toUpperCase()}: it estimates ${gradeText(w, false)} against ${gradeText(l, false)}${close ? ' (a close call, both could be the same grade)' : ''}.`;
  } else {
    // Same estimate: the smaller differences decide.
    const score = { a: 0, b: 0 };
    for (const r of reasons) if (r.better) score[r.better] += r.weight;
    if (score.a !== score.b) {
      winner = score.a > score.b ? 'a' : 'b';
      close = true;
      const why = reasons.filter(r => r.better === winner && r.weight).map(r => r.what.toLowerCase());
      headline = `Keep copy ${winner.toUpperCase()}: both estimate ${gradeText(ea || eb, false)}, but it has the better ${listText(why)}.`;
    } else {
      headline = `Too close to call: both estimate ${gradeText(ea || eb, false)} and nothing tells them apart from the photos. Keep whichever you like.`;
    }
  }
  return { winner, close, headline, reasons, estimates: { a: ea, b: eb } };
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function listText(words) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
