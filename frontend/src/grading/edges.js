// grading/edges.js — Edges and corners: whitening (worn edges showing the
// white card stock underneath)
//
// Works on a straightened card with a margin of the photo kept round it
// (vision.straighten with { margin }), so the background shows outside every
// edge. The card's outline is read as 8 "tracks" going clockwise: top edge,
// top-right corner, right edge, bottom-right corner, bottom edge, bottom-left
// corner, left edge, top-left corner. Along each track, every pixel step is a
// short line straight in from the background across the edge (on corners,
// in towards the middle of the corner's rounding):
//
//   1. Where the card starts: the first point clearly different from the
//      background outside it.
//   2. The border's colour there, from a little way in (1.0-1.6 mm, past any
//      wear), smoothed along the track so a worn patch doesn't change it.
//   3. How deep the whitening goes: the number of pixels from the card's edge
//      inwards that are clearly lighter than the border and nearer to white.
//      A pixel is 0.05 mm (20 px per mm).
//
// Light glinting off the card's cut edge looks just like whitening in one
// photo: a thin bright line along the edges that face a lamp. Glints follow
// the light, whitening stays with the card, so a second photo with the card
// turned a quarter turn (lying sideways) settles it: at each point the
// smaller of the two depths is kept (combine). With one photo only, an edge
// lit along much of its length is marked "may be glints" and not counted.
//
// Spots: stretches of track whitened at least minDepthPx deep. The limit
// they set on the grade is a rough guide (the table in config.js), not a
// grader's rule: graders judge wear by eye.

export const EDGES_VERSION = 1;

export const TRACKS = ['top', 'tr', 'right', 'br', 'bottom', 'bl', 'left', 'tl'];
export const CORNER_TRACKS = ['tr', 'br', 'bl', 'tl'];
export const TRACK_NAMES = {
  top: 'top edge', right: 'right edge', bottom: 'bottom edge', left: 'left edge',
  tl: 'top-left corner', tr: 'top-right corner', br: 'bottom-right corner', bl: 'bottom-left corner',
};
// the corners either side of each edge, and the edges either side of each corner
const NEXT_TO = {
  top: ['tl', 'tr'], right: ['tr', 'br'], bottom: ['br', 'bl'], left: ['bl', 'tl'],
  tl: ['left', 'top'], tr: ['top', 'right'], br: ['right', 'bottom'], bl: ['bottom', 'left'],
};

// The tracks' shape for a card W x H (card pixels) with corners rounded to
// radius R. point(i) answers a point on track `key` at step i, on the card's
// outline, with the inward direction: { x, y, nx, ny } in card pixels (the
// card's top-left corner at 0, 0).
export function trackGeometry(W, H, R) {
  const n = {};
  const arc = Math.max(4, Math.round(R * Math.PI / 2));
  n.top = n.bottom = Math.max(0, Math.round(W - 2 * R));
  n.left = n.right = Math.max(0, Math.round(H - 2 * R));
  for (const c of CORNER_TRACKS) n[c] = arc;
  const corner = (cx, cy, from) => (i) => {
    const a = from + (i + 0.5) * (Math.PI / 2) / arc;
    const ux = Math.cos(a), uy = Math.sin(a);
    return { x: cx + R * ux, y: cy + R * uy, nx: -ux, ny: -uy };
  };
  const point = {
    top: (i) => ({ x: R + i + 0.5, y: 0, nx: 0, ny: 1 }),
    tr: corner(W - R, R, -Math.PI / 2),
    right: (i) => ({ x: W, y: R + i + 0.5, nx: -1, ny: 0 }),
    br: corner(W - R, H - R, 0),
    bottom: (i) => ({ x: W - R - i - 0.5, y: H, nx: 0, ny: -1 }),
    bl: corner(R, H - R, Math.PI / 2),
    left: (i) => ({ x: 0, y: H - R - i - 0.5, nx: 1, ny: 0 }),
    tl: corner(R, R, Math.PI),
  };
  return { n, point: (key, i) => point[key](i) };
}

// Reads every track of one photo. image: ImageData of the straightened card
// with `margin` pixels of photo all round. Answers
//   { W, H, ppm, R, tracks: { key: { depth: Float32Array (px, NaN where it
//     couldn't be read), edge: Float32Array (where the card starts, px from
//     the expected edge, + is inwards) } }, lit: { key: share }, unread }
export function scanEdges(image, margin, settings) {
  const s = settings.edges;
  const W = image.width - 2 * margin, H = image.height - 2 * margin;
  const ppm = W / 63;
  const R = s.cornerRadiusMm * ppm;
  const geo = trackGeometry(W, H, R);
  const out = Math.min(margin - 2, Math.round(s.outsideMm * ppm));   // samples outside the edge
  const inside = Math.round(s.insideMm * ppm);
  const len = out + inside;
  const refFrom = Math.round(s.refFromMm * ppm), refTo = Math.round(s.refToMm * ppm);
  const maxDepth = Math.round(s.maxDepthMm * ppm);
  const bgN = Math.max(3, Math.round(out / 2));
  const { data, width: IW, height: IH } = image;

  // Colour at card coordinates (x, y), bilinear. Card x = 0 is the card's
  // left edge, which is the outer edge of image pixel `margin`, i.e. image
  // pixel-centre coordinate margin - 0.5.
  const at = (x, y, rgb) => {
    const fx = Math.min(IW - 1.001, Math.max(0, x + margin - 0.5));
    const fy = Math.min(IH - 1.001, Math.max(0, y + margin - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const i00 = (y0 * IW + x0) * 4, i10 = i00 + 4, i01 = i00 + IW * 4, i11 = i01 + 4;
    for (let c = 0; c < 3; c++) {
      rgb[c] = (data[i00 + c] * (1 - ax) + data[i10 + c] * ax) * (1 - ay) + (data[i01 + c] * (1 - ax) + data[i11 + c] * ax) * ay;
    }
  };

  const tracks = {}, lit = {};
  let unread = 0, total = 0;
  const rgb = [0, 0, 0];
  for (const key of TRACKS) {
    const n = geo.n[key];
    const prof = new Float32Array(n * len * 3);
    const e0s = new Int32Array(n).fill(-1);
    const bgs = new Float32Array(n * 3), refs = new Float32Array(n * 3);
    // 1. The profiles, where each starts, and the raw border colour.
    for (let i = 0; i < n; i++) {
      const p = geo.point(key, i);
      for (let k = 0; k < len; k++) {
        const d = k - out + 0.5;
        at(p.x + p.nx * d, p.y + p.ny * d, rgb);
        prof.set(rgb, (i * len + k) * 3);
      }
      const bg = channelMedian(prof, i * len, 0, bgN);
      bgs.set(bg, i * 3);
      const far = (k) => colourDistanceAt(prof, (i * len + k) * 3, bg) > s.minStep;
      for (let k = bgN; k < out * 2 && k + 2 + refTo < len; k++) {
        if (far(k) && far(k + 1) && far(k + 2)) { e0s[i] = k; break; }
      }
      if (e0s[i] >= 0) refs.set(channelMedian(prof, i * len, e0s[i] + refFrom, e0s[i] + refTo), i * 3);
    }
    // 2. The border colour smoothed along the track (a running median), so a
    // worn stretch, whose own "border" reading may be pale, takes its
    // neighbours' colour.
    const smooth = runningMedian(refs, e0s, n, Math.round(s.refSmoothMm * ppm));
    // Print inside the border (the copyright line along the bottom of newer
    // cards, which can cover most of that edge) can sit where the colour is
    // read and make the border look darker than it is, and the plain border
    // before it "whiter". So the border's plain colour for the whole edge is
    // taken too, as a bright reading (brighter than usualShare of them), and
    // where the local reading is darker, that is used instead. (Wear makes a
    // reading lighter, never darker, so this doesn't hide it.)
    const usual = brightReading(refs, e0s, n, s.usualShare);
    if (usual) {
      const uSum = usual[0] + usual[1] + usual[2];
      for (let i = 0; i < n; i++) {
        const a = smooth[i];
        if (a && uSum > a[0] + a[1] + a[2]) smooth[i] = usual;
      }
    }
    // 3. Where exactly the card starts, and how deep the whitening goes.
    const depth = new Float32Array(n).fill(NaN), edge = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      total++;
      if (e0s[i] < 0 || !smooth[i]) { unread++; continue; }
      const ref = smooth[i], bg = [bgs[i * 3], bgs[i * 3 + 1], bgs[i * 3 + 2]];
      // whitening (near white) only stands out from a dark background
      if ((bg[0] + bg[1] + bg[2]) / 3 > s.maxBackground) { unread++; continue; }
      const half = 0.5 * colourDistance(ref, bg);
      let e = e0s[i];
      for (let k = Math.max(1, e0s[i] - 4); k <= e0s[i] + 6; k++) {
        if (colourDistanceAt(prof, (i * len + k) * 3, bg) >= half) { e = k; break; }
      }
      edge[i] = e - out;
      const wx = 255 - ref[0], wy = 255 - ref[1], wz = 255 - ref[2];
      const den = wx * wx + wy * wy + wz * wz;
      let count = 0, last = -1, sumL = 0;
      for (let k = e; k < e + maxDepth && k < len; k++) {
        const j = (i * len + k) * 3;
        const dr = prof[j] - ref[0], dg = prof[j + 1] - ref[1], db = prof[j + 2] - ref[2];
        const towardWhite = den > 0 ? (dr * wx + dg * wy + db * wz) / den : 0;
        if (towardWhite > s.minWhite && (dr + dg + db) / 3 > s.minLighter) {
          count++; last = k; sumL += (prof[j] + prof[j + 1] + prof[j + 2]) / 3;
        }
      }
      // Wear ends in a step back to the border's colour; a border that only
      // gets gradually lighter towards the edge (the sheen on silver
      // borders) doesn't count.
      if (count) {
        let afterL = 0, m = 0;
        for (let k = last + 2; k <= last + 5 && k < len; k++, m++) {
          const j = (i * len + k) * 3;
          afterL += (prof[j] + prof[j + 1] + prof[j + 2]) / 3;
        }
        if (m && sumL / count - afterL / m < s.minStepIn) count = 0;
      }
      depth[i] = count;
    }
    tracks[key] = { depth, edge };
  }
  // Edges lit along much of their length (glints, if there is no second
  // photo to tell).
  for (const key of ['top', 'right', 'bottom', 'left']) lit[key] = round(shareAtLeast(tracks[key].depth, 1), 2);
  return { W, H, ppm, R, tracks, lit, unread: total ? round(unread / total, 3) : 1 };
}

// The second photo (card turned a quarter turn, then straightened, so it may
// have come out upside down compared with the first): 1 if it lines up with
// the first as it is, -1 if it needs half a turn. Compares small grey copies
// of the card's middle.
export function sameWayUp(imageA, imageB, margin) {
  const a = thumb(imageA, margin), b = thumb(imageB, margin);
  let same = 0, turned = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    same += Math.abs(a[i] - b[i]);
    turned += Math.abs(a[i] - b[n - 1 - i]);
  }
  return same <= turned ? 1 : -1;
}

// ImageData turned half a turn.
export function turnImage(image) {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const px = width * height;
  for (let i = 0; i < px; i++) {
    const j = (px - 1 - i) * 4, k = i * 4;
    out[k] = data[j]; out[k + 1] = data[j + 1]; out[k + 2] = data[j + 2]; out[k + 3] = data[j + 3];
  }
  return new ImageData(out, width, height);
}

// Two scans of the same side (the second already lined up): at each point
// the smaller depth, after letting each spread alignPx either way (the two
// outlines can differ by a pixel or two).
export function combineScans(a, b, settings) {
  const k = settings.edges.alignPx;
  const tracks = {};
  for (const key of TRACKS) {
    const da = spread(a.tracks[key].depth, k), db = spread(b.tracks[key].depth, k);
    const n = da.length;
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = da[i], y = db[i];
      depth[i] = Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y);
    }
    tracks[key] = { depth, edge: a.tracks[key].edge };
  }
  // Glints are gone now, so nothing is in doubt: whitening left along an
  // edge was there in both photos, with the light on different edges.
  const lit = {};
  for (const key of Object.keys(a.lit)) lit[key] = 0;
  return { ...a, tracks, lit, combined: true };
}

// The whitened stretches. Answers [{ id, track, from, to (steps), lengthMm,
// depthMm, doubt }]; doubt: on an edge (or next to one) that may only be
// glinting (not counted).
export function findSpots(scan, settings) {
  const s = settings.edges;
  const ppm = scan.ppm;
  const mergePx = Math.round(s.mergeMm * ppm), minRun = Math.round(s.minRunMm * ppm);
  const doubtful = new Set();
  for (const [key, share] of Object.entries(scan.lit)) {
    if (share >= s.litShare) { doubtful.add(key); NEXT_TO[key].forEach(c => doubtful.add(c)); }
  }
  const spots = [];
  for (const key of TRACKS) {
    const depth = scan.tracks[key].depth;
    const runs = [];
    for (let i = 0; i < depth.length; i++) {
      if (!(depth[i] >= s.minDepthPx)) continue;
      const last = runs[runs.length - 1];
      if (last && i - last.to <= mergePx) last.to = i;
      else runs.push({ from: i, to: i });
    }
    for (const r of runs) {
      if (r.to - r.from + 1 < minRun) continue;
      let deepest = 0;
      for (let i = r.from; i <= r.to; i++) if (depth[i] > deepest) deepest = depth[i];
      spots.push({
        id: `${key}-${r.from}`, track: key, from: r.from, to: r.to,
        lengthMm: round((r.to - r.from + 1) / ppm, 2), depthMm: round(deepest / ppm, 2),
        doubt: doubtful.has(key),
      });
    }
  }
  return spots;
}

// One side's numbers from its spots, leaving out spots in doubt and those
// marked "not whitening". Answers { lengthMm, depthMm, corners, edges,
// counted, doubtTracks }.
export function measureEdges(spots, ignored = [], doubtTracks = []) {
  const skip = new Set(ignored);
  const counted = spots.filter(sp => !sp.doubt && !skip.has(sp.id));
  const lengthMm = round(counted.reduce((t, sp) => t + sp.lengthMm, 0), 2);
  const depthMm = round(counted.reduce((m, sp) => Math.max(m, sp.depthMm), 0), 2);
  const where = new Set(counted.map(sp => sp.track));
  return {
    lengthMm, depthMm,
    corners: CORNER_TRACKS.filter(c => where.has(c)).length,
    edges: ['top', 'right', 'bottom', 'left'].filter(c => where.has(c)).length,
    counted: counted.length,
    doubtTracks,
  };
}

// The tracks in doubt for a scan (edges lit along much of their length, and
// the corners next to them), as a list for the page.
export function doubtTracksOf(scan, settings) {
  const out = new Set();
  for (const [key, share] of Object.entries(scan.lit)) {
    if (share >= settings.edges.litShare) { out.add(key); NEXT_TO[key].forEach(c => out.add(c)); }
  }
  return TRACKS.filter(t => out.has(t));
}

// The best grade the whitening allows, from the front and/or back numbers.
// Answers { cap, low, high, limitedBy, reason, unchecked } or null.
export function edgesCap(front, back, settings) {
  const t = settings.edges;
  const capOf = (m, face, lenK, depthAdd) => {
    for (const row of t.grades) {
      const lim = row[face];
      if (m.lengthMm * lenK <= lim.lengthMm && m.depthMm + depthAdd <= lim.depthMm) return row.grade;
    }
    return t.floor;
  };
  const per = {};
  for (const [face, m] of [['front', front], ['back', back]]) {
    if (!m) continue;
    per[face] = {
      cap: capOf(m, face, 1, 0),
      high: capOf(m, face, 1 - t.closeShare, -t.closeDepthMm),
      low: capOf({ lengthMm: m.lengthMm + t.closeMinMm, depthMm: m.depthMm }, face, 1 + t.closeShare, t.closeDepthMm),
      lengthMm: m.lengthMm, depthMm: m.depthMm,
    };
  }
  const list = Object.entries(per);
  if (!list.length) return null;
  const cap = Math.min(...list.map(([, p]) => p.cap));
  const high = Math.min(...list.map(([, p]) => p.high));
  const low = Math.min(...list.map(([, p]) => p.low));
  const limiting = list.filter(([, p]) => p.cap === cap)
    .map(([face, p]) => (p.lengthMm ? `${face}: ${p.lengthMm} mm of whitening, up to ${p.depthMm} mm deep` : `${face}: no whitening found`));
  const unchecked = [front, back].filter(Boolean).reduce((n, m) => n + (m.doubtTracks?.length || 0), 0);
  return { cap, low, high, ...per, limitedBy: limiting.join('; '), unchecked };
}

// Share of the card (inside the margin) blown out to white by glare, where
// whitening (or anything else) can't be seen.
export function glareShare(image, margin, level = 250) {
  const { width, height, data } = image;
  let hit = 0, n = 0;
  for (let y = margin; y < height - margin; y += 2) {
    for (let x = margin; x < width - margin; x += 2) {
      const i = (y * width + x) * 4;
      n++;
      if (data[i] >= level && data[i + 1] >= level && data[i + 2] >= level) hit++;
    }
  }
  return n ? hit / n : 0;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function thumb(image, margin) {
  // 21 x 30 grey squares over the card's middle 80%
  const { width, height, data } = image;
  const W = width - 2 * margin, H = height - 2 * margin;
  const out = new Float32Array(21 * 30);
  for (let gy = 0; gy < 30; gy++) {
    for (let gx = 0; gx < 21; gx++) {
      const x0 = Math.floor(margin + W * (0.1 + 0.8 * gx / 21)), y0 = Math.floor(margin + H * (0.1 + 0.8 * gy / 30));
      const x1 = Math.floor(margin + W * (0.1 + 0.8 * (gx + 1) / 21)), y1 = Math.floor(margin + H * (0.1 + 0.8 * (gy + 1) / 30));
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * width + x) * 4;
        sum += data[i] + data[i + 1] + data[i + 2]; cnt++;
      }
      out[gy * 21 + gx] = cnt ? sum / cnt : 0;
    }
  }
  return out;
}

function channelMedian(prof, base, from, to) {
  const out = [0, 0, 0];
  const n = to - from;
  if (n <= 0) return out;
  const tmp = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < n; k++) tmp[k] = prof[(base + from + k) * 3 + c];
    tmp.sort();
    out[c] = n % 2 ? tmp[(n - 1) / 2] : (tmp[n / 2 - 1] + tmp[n / 2]) / 2;
  }
  return out;
}

function runningMedian(refs, ok, n, half) {
  const out = new Array(n).fill(null);
  const tmp = [[], [], []];
  for (let i = 0; i < n; i++) {
    tmp[0].length = tmp[1].length = tmp[2].length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (ok[j] < 0) continue;
      for (let c = 0; c < 3; c++) tmp[c].push(refs[j * 3 + c]);
    }
    if (tmp[0].length < 3) continue;
    out[i] = tmp.map(a => { a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; });
  }
  return out;
}

// The reading brighter than `share` of the others (as a colour), or null.
function brightReading(refs, ok, n, share) {
  const list = [];
  for (let i = 0; i < n; i++) if (ok[i] >= 0) list.push(i);
  if (list.length < 3) return null;
  const sum = (i) => refs[i * 3] + refs[i * 3 + 1] + refs[i * 3 + 2];
  list.sort((x, y) => sum(x) - sum(y));
  const i = list[Math.min(list.length - 1, Math.floor(share * list.length))];
  return [refs[i * 3], refs[i * 3 + 1], refs[i * 3 + 2]];
}

function spread(depth, k) {
  const n = depth.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = NaN;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      const v = depth[j];
      if (!Number.isNaN(v) && !(m >= v)) m = v;
    }
    out[i] = m;
  }
  return out;
}

function shareAtLeast(depth, v) {
  let n = 0, hit = 0;
  for (const d of depth) { if (Number.isNaN(d)) continue; n++; if (d >= v) hit++; }
  return n ? hit / n : 0;
}

function colourDistance(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
function colourDistanceAt(prof, j, b) {
  const dr = prof[j] - b[0], dg = prof[j + 1] - b[1], db = prof[j + 2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function round(v, n) { const f = 10 ** n; return Math.round(v * f) / f; }
