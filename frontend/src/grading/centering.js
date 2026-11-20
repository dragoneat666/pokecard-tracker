// grading/centering.js — Centering: border widths, ratios and the grade cap
//
// Works on a straightened card (vision.js), where the card's outer edge is
// the picture's edge. For each side it finds the inner border line — where the
// plain border stops and the art's frame (or, on the back, the blue swirl)
// begins. Each side is read along many short lines straight in from the edge,
// across the middle part of the side:
//
//   1. On each line, learn the border's colour from the line itself, a little
//      way in from the edge. Done per line because borders aren't one flat
//      colour: the silver borders of newer cards have a sheen that runs from
//      light to dark along a side, and lighting is never perfectly even.
//   2. Find roughly where the frame starts for the whole side: the first depth
//      at which nearly all the lines (80%) have stopped looking like border,
//      and keep doing so. Counting lines at each depth, instead of taking
//      each line's first change, is what keeps small print inside the border
//      (the copyright line at the bottom of newer cards) from being taken for
//      the frame: letters only cover some of the lines at any one depth.
//   3. Near that rough depth, the frame's edge is the strongest colour change
//      (averaged over all the lines), or a slightly weaker one just outside it
//      (a thin highlight along the frame belongs to the frame). Then each
//      line places it exactly, between pixels, following the frame even if
//      it was printed a little crooked.
//   4. The side's border width is the median of the lines (the middle value,
//      so a few odd lines don't move it). How much the lines agree is the
//      confidence.
//
// Tested on made-up photos with known borders (within about 1 point of the
// true ratio) and on photos made from real card scans of several eras
// (yellow, faded-yellow and silver borders), where the lines landed on the
// frame on every side.
//
// The lines can then be dragged by hand on the page; measure() works from
// wherever the lines end up, found or adjusted.
//
// Ratios are written the way graders do: the bigger side's share first, so a
// card 3.6 mm on the left and 2.6 mm on the right is 58/42.

export const CENTERING_VERSION = 1;

const SIDES = ['left', 'right', 'top', 'bottom'];

// Finds the inner border lines. Answers
//   { lines, sides: { left: { found, share, spreadPx, confidence }, ... }, border: [r,g,b], threshold }
// lines = x positions of the left / right lines and y positions of the top /
// bottom lines, in the straightened image, measured from its top-left corner
// (the card's edges are at 0 and the picture's width / height).
// face: 'front' or 'back' (the back's printed frame is the same size on every
// card, which helps where its edge is faint: see backFrame in config.js).
export function findBorders(image, settings, { face = 'front' } = {}) {
  const { width: W, height: H, data } = image;
  const b = settings.centering.border;
  const pxPerMm = W / 63;
  const from = Math.max(2, Math.round(b.learnFromMm * pxPerMm));
  const to = Math.max(from + 2, Math.round(b.learnToMm * pxPerMm));
  const near = Math.round(b.windowMm * pxPerMm);

  // A point d pixels in from a side, t pixels along it.
  const index = (side, d, t) => {
    if (side === 'left') return (t * W + d) * 4;
    if (side === 'right') return (t * W + (W - 1 - d)) * 4;
    if (side === 'top') return (d * W + t) * 4;
    return ((H - 1 - d) * W + t) * 4;
  };
  // Three pixels side by side along the edge, averaged, to calm noise.
  const colourAt = (side, d, t) => {
    const i0 = index(side, d, t - 1), i1 = index(side, d, t), i2 = index(side, d, t + 1);
    return [(data[i0] + data[i1] + data[i2]) / 3, (data[i0 + 1] + data[i1 + 1] + data[i2 + 1]) / 3, (data[i0 + 2] + data[i1 + 2] + data[i2 + 2]) / 3];
  };


  // 1. Read every line of every side: each pixel's colour, and its distance
  // from that line's own border colour.
  const per = {};
  const learnDists = [], refs = [];
  for (const side of SIDES) {
    const len = side === 'left' || side === 'right' ? H : W;
    const start = Math.round(len * (1 - b.middleShare) / 2);
    const maxD = Math.round((side === 'left' || side === 'right' ? W : H) * b.maxShare);
    const ts = [];
    for (let t = start + 1; t < len - start - 1; t += 3) ts.push(t);
    const depth = maxD + 1;
    const dist = new Float32Array(ts.length * depth);
    const col = new Float32Array(ts.length * depth * 3);
    ts.forEach((t, li) => {
      for (let d = 0; d <= maxD; d++) col.set(colourAt(side, d, t), (li * depth + d) * 3);
      const strip = [[], [], []];
      for (let d = from; d <= to; d++) for (let c = 0; c < 3; c++) strip[c].push(col[(li * depth + d) * 3 + c]);
      const ref = strip.map(median);
      refs.push(ref);
      for (let d = 0; d <= maxD; d++) {
        const i = (li * depth + d) * 3;
        dist[li * depth + d] = colourDistance([col[i], col[i + 1], col[i + 2]], ref);
      }
      for (let d = from; d <= to; d++) learnDists.push(dist[li * depth + d]);
    });
    per[side] = { ts, depth, maxD, dist, col };
  }
  // How much the border varies on its own; "clearly different" is well above that.
  const noise = median(learnDists);
  const threshold = Math.max(b.minDistance, b.noiseFactor * noise);

  const hits = {}, sides = {}, tilt = {};
  for (const side of SIDES) {
    const { ts, depth, maxD, dist } = per[side];
    const n = ts.length;
    // 2. Rough depth: the first depth where nearly all lines look "not border"
    // (for runLength depths in a row). The frame's edge runs the whole length
    // of the side, so at the right depth almost every line has reached it;
    // print in the border only ever covers part of the lines. If no depth
    // gets there (a poor photo), settle for most lines.
    const shares = new Float32Array(depth);
    for (let d = to + 1; d <= maxD; d++) {
      let count = 0;
      for (let li = 0; li < n; li++) if (dist[li * depth + d] >= threshold) count++;
      shares[d] = count / Math.max(1, n);
    }
    let rough = null;
    for (const level of [b.roughShare, 0.5]) {
      for (let d = to + 1; d <= maxD - b.runLength && rough === null; d++) {
        let ok = true;
        for (let k = 0; k < b.runLength && ok; k++) ok = shares[d + k] > level;
        if (ok) rough = d;
      }
      if (rough !== null) break;
    }
    per[side].shares = shares;
    const placed = rough === null ? { found: [] } : placeEdge(side, rough);
    record(side, placed);
  }

  // 3. The exact edge near a rough depth (see the top of the file). Answers
  // { found: each line's edge depth, tilt }.
  function placeEdge(side, rough) {
    const { ts, depth, maxD, col, shares } = per[side];
    const n = ts.length;
    const found = [];
    let tiltPx;
    // The exact edge: the strongest colour change near the rough depth,
    // averaged over all the lines (so it is the frame's edge, which every
    // line crosses). The search reaches back towards the card's edge only
    // as far as the change keeps covering a good share of the lines: print
    // in the border sits beyond a gap of plain border and stays out.
    //   Strongest change, rather than "first change", because some borders
    // fade (older yellow borders go from yellow to almost white towards the
    // inside), and where a fading border "stops" is a matter of opinion
    // that came out different on each side. The frame's own edge is sharp
    // and the same on all four sides.
    let lo = rough;
    while (lo - 1 > to && lo > rough - near && shares[lo - 1] >= b.reachShare) lo--;
    lo = Math.max(lo - 2, to + 1);
    const hi = Math.min(maxD - 2, rough + near);
    const grad = (li, d) => {
      const i = (li * depth + d - 1) * 3, j = (li * depth + d + 1) * 3;
      const dr = col[j] - col[i], dg = col[j + 1] - col[i + 1], db = col[j + 2] - col[i + 2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    const sums = new Float32Array(hi + 2);
    let best = -1;
    for (let d = lo; d <= hi; d++) {
      let sum = 0;
      for (let li = 0; li < n; li++) sum += grad(li, d);
      sums[d] = sum;
      if (sum > best) best = sum;
    }
    // A frame often has a light or dark edge line of its own (a thin
    // highlight along the panel). Its outer edge is where the frame starts,
    // so the outermost change nearly as strong as the strongest one wins.
    let edge = lo;
    for (let d = lo; d <= hi; d++) {
      if (sums[d] >= b.outerEdgeShare * best && sums[d] >= sums[d - 1] && sums[d] >= sums[d + 1]) { edge = d; break; }
    }
    const meanBest = sums[edge] / Math.max(1, n);
    // Each line: its own strongest change within a few pixels of that edge,
    // placed between pixels by fitting a curve through the three values
    // around the peak.
    const reach = b.lineReachPx;
    const peakNear = (li, centre) => {
      let m = -1, g = -1;
      const c = Math.round(centre);
      for (let d = Math.max(2, c - reach); d <= Math.min(maxD - 2, c + reach); d++) {
        const v = grad(li, d);
        if (v > g) { g = v; m = d; }
      }
      if (m < 0 || g < b.lineMinShare * meanBest) return null;
      const g0 = grad(li, m - 1), g2 = grad(li, m + 1);
      const den = g0 - 2 * g + g2;
      const offset = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (g0 - g2) / den)) : 0;
      // The change measured at pixel m is across that pixel, whose middle is
      // m + 0.5 from the card's edge.
      return m + 0.5 + offset;
    };
    // First pass around the side's edge depth; then again around a straight
    // line fitted through the first pass, so a frame printed slightly
    // crooked (common on badly cut cards) is followed along its length.
    const first = [];
    for (let li = 0; li < n; li++) {
      const p = peakNear(li, edge);
      if (p !== null) first.push([ts[li], p]);
    }
    const fit = first.length >= 8 ? fitDepth(first) : null;
    for (let li = 0; li < n; li++) {
      const p = fit ? peakNear(li, fit.a + fit.b * ts[li] - 0.5) : peakNear(li, edge);
      if (p !== null) found.push(p);
    }
    if (fit) tiltPx = fit.b * (ts[n - 1] - ts[0]);
    return { found, tilt: tiltPx };
  }

  // 4. The side's width (median of the lines) and how sure it is.
  function record(side, { found, tilt: tiltPx }, extra = {}) {
    const n = per[side].ts.length;
    if (tiltPx !== undefined) tilt[side] = tiltPx; else delete tilt[side];
    found.sort((x, y) => x - y);
    const width = found.length ? quantile(found, 0.5) : null;
    const spread = found.length >= 4 ? quantile(found, 0.75) - quantile(found, 0.25) : null;
    hits[side] = width;
    sides[side] = {
      found: width !== null,
      share: n ? round(found.length / n, 2) : 0,              // lines that found the edge
      spreadPx: spread === null ? null : round(spread, 1),     // how much they disagree
      confidence: confidenceOf(found.length / Math.max(1, n), spread, pxPerMm),
      // how much deeper the frame is at one end of the measured stretch than
      // at the other, in mm (a frame printed crooked)
      tiltMm: tilt[side] === undefined ? null : round(tilt[side] / pxPerMm, 2),
      ...extra,
    };
  }

  // 5. The back of every card has the same printed frame, so its left + right
  // borders (and top + bottom) always add up to the same width, however
  // off-centre it is. Where the swirl next to the border is nearly the
  // border's own blue, a side's search can run on past the frame into the
  // swirl (seen on real photos: a right border found at 8 mm, when the left
  // was 3.4 mm and the pair should make 6.3 mm). When a pair is far off its
  // total, keep one side and look again for the other where the frame has to
  // be; of the two ways round, the one whose new edge is clearest wins.
  const frame = b.backFrame;
  const pairs = [['left', 'right', frame?.leftRightMm], ['top', 'bottom', frame?.topBottomMm]];
  if (face === 'back' && frame) {
    for (const [a, z, totalMm] of pairs) {
      const total = totalMm * pxPerMm;
      const known = [a, z].filter(sd => hits[sd] !== null);
      if (known.length === 2 && Math.abs(hits[a] + hits[z] - total) <= frame.maxOffMm * pxPerMm) continue;
      let best = null;
      for (const keep of known) {
        const other = keep === a ? z : a;
        const want = total - hits[keep];
        if (want < to + 2 || want > per[other].maxD - near) continue;
        const placed = placeEdge(other, Math.round(want));
        const found = placed.found.filter(p => Math.abs(p - want) <= near + 2);
        if (found.length < 0.3 * per[other].ts.length) continue;
        const sorted = [...found].sort((x, y) => x - y);
        const spread = sorted.length >= 4 ? quantile(sorted, 0.75) - quantile(sorted, 0.25) : null;
        const conf = confidenceOf(found.length / per[other].ts.length, spread, pxPerMm);
        if (!best || conf > best.conf) best = { other, placed: { ...placed, found }, conf };
      }
      if (best) record(best.other, best.placed, { fromBackFrame: true });
    }
  }

  // A side where nothing was found gets the same width as its opposite side
  // (shown as a guess, to be placed by hand); on the back, what the frame
  // leaves for it.
  const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const totalOf = { left: frame?.leftRightMm, right: frame?.leftRightMm, top: frame?.topBottomMm, bottom: frame?.topBottomMm };
  for (const side of SIDES) {
    if (hits[side] !== null) continue;
    const opp = hits[opposite[side]];
    if (face === 'back' && frame && opp !== null && totalOf[side] * pxPerMm - opp > to) hits[side] = totalOf[side] * pxPerMm - opp;
    else hits[side] = opp ?? Math.round(3 * pxPerMm);
  }

  return {
    lines: {
      outerLeft: 0, innerLeft: round(hits.left, 2),
      innerRight: round(W - hits.right, 2), outerRight: W,
      outerTop: 0, innerTop: round(hits.top, 2),
      innerBottom: round(H - hits.bottom, 2), outerBottom: H,
    },
    sides,
    border: [0, 1, 2].map(c => Math.round(median(refs.map(r => r[c])))),
    threshold: round(threshold, 1),
  };
}

// Border widths and ratios from the 8 lines.
export function measure(lines, pxPerMm) {
  const left = lines.innerLeft - lines.outerLeft;
  const right = lines.outerRight - lines.innerRight;
  const top = lines.innerTop - lines.outerTop;
  const bottom = lines.outerBottom - lines.innerBottom;
  const lr = 100 * left / (left + right);
  const tb = 100 * top / (top + bottom);
  const lrBig = Math.max(lr, 100 - lr), tbBig = Math.max(tb, 100 - tb);
  return {
    mm: { left: round(left / pxPerMm, 2), right: round(right / pxPerMm, 2), top: round(top / pxPerMm, 2), bottom: round(bottom / pxPerMm, 2) },
    leftRight: round(lr, 1),             // left side's share
    topBottom: round(tb, 1),             // top side's share
    leftRightText: ratioText(lr),        // "58/42"
    topBottomText: ratioText(tb),
    worst: round(Math.max(lrBig, tbBig), 1),
    worstDirection: lrBig >= tbBig ? 'left/right' : 'top/bottom',
  };
}

export function ratioText(share) {
  const big = Math.round(Math.max(share, 100 - share));
  return `${big}/${100 - big}`;
}

// The best grade a side's centering allows.
function capFor(worst, side, table) {
  for (const row of table.grades) if (worst <= row[side]) return row.grade;
  return table.floor;
}

// The centering cap from the front and/or back measurements. Answers
//   { cap, low, high, front: {...}, back: {...}, limitedBy, reason }
// low..high is the range once close calls are counted (a share within
// closeCall points of a limit could be either side of it).
export function centeringCap(front, back, settings) {
  const table = settings.centering;
  const per = {};
  for (const [side, m] of [['front', front], ['back', back]]) {
    if (!m) continue;
    per[side] = {
      cap: capFor(m.worst, side, table),
      high: capFor(m.worst - table.closeCall, side, table),
      low: capFor(m.worst + table.closeCall, side, table),
      worst: m.worst,
      direction: m.worstDirection,
    };
  }
  const list = Object.values(per);
  if (!list.length) return null;
  const cap = Math.min(...list.map(p => p.cap));
  const high = Math.min(...list.map(p => p.high));
  const low = Math.min(...list.map(p => p.low));
  // Which side limits it, in words.
  const limiting = Object.entries(per).filter(([, p]) => p.cap === cap)
    .map(([side, p]) => `${side} ${ratioText(p.worst)} ${p.direction}`);
  const floorText = cap === table.floor ? `${cap} or lower` : String(cap);
  return {
    cap, low, high, ...per,
    limitedBy: limiting.join(' and the '),           // "front 58/42 left/right"
    reason: `Centering allows up to ${floorText} (limited by the ${limiting.join(' and the ')})`,
  };
}

// Straight line depth = a + b * t through [t, depth] points (least squares, then
// again without the points furthest from it).
function fitDepth(pts) {
  const solve = (p) => {
    let st = 0, sd = 0, stt = 0, std = 0;
    for (const [t, d] of p) { st += t; sd += d; stt += t * t; std += t * d; }
    const k = p.length, den = k * stt - st * st;
    const b = den ? (k * std - st * sd) / den : 0;
    return { a: (sd - b * st) / k, b };
  };
  let line = solve(pts);
  const res = pts.map(([t, d]) => Math.abs(d - line.a - line.b * t));
  const cut = Math.max(1, 2.5 * median(res));
  const keep = pts.filter((_, i) => res[i] <= cut);
  if (keep.length >= 8) line = solve(keep);
  return line;
}

// 0-1: how sure the found line is. Needs most lines to have found an edge, and
// them to agree within about half a millimetre.
function confidenceOf(foundShare, spread, pxPerMm) {
  if (!foundShare || spread === null) return 0;
  const agree = Math.max(0, 1 - spread / (0.5 * pxPerMm));
  return round(Math.min(1, foundShare) * (0.4 + 0.6 * agree), 2);
}

export function colourDistance(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  return s.length ? quantile(s, 0.5) : 0;
}

// q-th quantile of an already sorted array (linear between neighbours).
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function round(v, n) { const f = 10 ** n; return Math.round(v * f) / f; }
