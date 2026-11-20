// public/grading/cv-worker.js — finds a card in a photo and straightens it
//
// Runs as a Web Worker (a background thread) so the page never freezes while
// it works. It's a plain script in public/ rather than a module in src/
// because OpenCV.js only loads with importScripts(), which module workers
// don't have. OpenCV is loaded on the first message, so pages that never
// grade a card never download it (~10 MB, cached by the browser afterwards).
//
// Messages in (each has an id; the answer comes back with the same id):
//   { type: 'init' }
//   { type: 'detect', image: ImageData }   → { quad, score, strategy } or { quad: null }
//        Finds the card's outline. Give it a downscaled photo (~1000 px).
//   { type: 'refine', image: ImageData, quad } → { quad }
//        Moves each edge onto the card's real edge in a bigger copy (~2000 px).
//   { type: 'warp', image: ImageData, quad, width, height, margin } → { image: ImageData }
//     (margin: pixels of the photo kept round the card, for the edges check)
//        Straightens the card to width x height.
// quad = 4 corners [[x,y] ...] in the given image's pixels: top-left, top-right,
// bottom-right, bottom-left, card upright (short sides at top and bottom).
//
// Nothing here is random, so the same photo always gives the same corners.

/* global cv */
const OPENCV_URL = 'opencv-4.10.0.js';            // next to this file
const CARD_RATIO = 63 / 88;                        // width / height

let ready = null;
function loadOpenCv() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    try {
      importScripts(OPENCV_URL);
    } catch (err) {
      reject(new Error('Could not load OpenCV: ' + err.message));
      return;
    }
    // Depending on the build, cv is the module itself, or something that
    // calls back when it's ready. Its then() hands back an object that is
    // itself "thenable", so it must not be awaited or resolved directly
    // (that loops forever) — take it in a callback instead.
    const done = (mod) => { self.cv = mod; resolve(); };
    if (self.cv && self.cv.Mat) done(self.cv);
    else if (self.cv && typeof self.cv.then === 'function') self.cv.then(done);
    else if (self.cv) self.cv.onRuntimeInitialized = () => done(self.cv);
    else reject(new Error('OpenCV did not start'));
  });
  return ready;
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    await loadOpenCv();
    let result;
    if (type === 'init') result = { ok: true };
    else if (type === 'detect') result = detect(e.data.image, e.data.debug);
    else if (type === 'refine') result = refine(e.data.image, e.data.quad);
    else if (type === 'warp') {
      const image = warp(e.data.image, e.data.quad, e.data.width, e.data.height, e.data.margin || 0);
      self.postMessage({ id, result: { image } }, [image.data.buffer]);
      return;
    } else throw new Error('Unknown message ' + type);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};

// ─── FIND THE OUTLINE ────────────────────────────────────────────────────────
// Several ways of turning the photo into outlines are tried, because no single
// one works everywhere: plain brightness edges fail for a yellow card on white
// paper (similar brightness), colour-strength edges fail for a silver card on
// grey, and a busy background (wood grain) breaks edges into pieces. Every
// 4-cornered outline found is scored and the best one wins.

function detect(imageData, debug = false) {
  const src = cv.matFromImageData(imageData);
  const W = src.cols, H = src.rows;
  const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const gray = new cv.Mat(); cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
  const hsv = new cv.Mat(); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const chans = new cv.MatVector(); cv.split(hsv, chans);
  const sat = chans.get(1);

  const maps = [
    ['brightness edges', edgesOf(gray)],
    // Faint edges too: a silver card on white paper differs from it by only
    // a little brightness and no colour.
    ['faint brightness edges', edgesOf(gray, 12, 36)],
    ['colour edges', edgesOf(sat)],
    ['brightness blob', blobOf(gray)],
    ['colour blob', blobOf(sat)],
  ];
  // The edge strength along a candidate's outline is checked on this map.
  const support = maxEdges(gray, sat);

  let best = null;
  const candidates = [];
  for (const [strategy, map] of maps) {
    for (const { quad: rough, points } of quadsIn(map, W, H)) {
      // The outline's corners land somewhere on the card's rounded corners,
      // which pulls its sides a few pixels inside the card's real edges. Fit
      // a straight line to each side's own outline points instead.
      const quad = fitQuad(rough, points);
      const { score, reason } = scoreQuad(quad, W, H, support);
      if (debug) candidates.push({ strategy, quad: quad.map(p => p.map(v => round(v, 1))), score: round(score, 3), reason });
      if (score > 0 && (!best || score > best.score)) best = { quad, score, strategy };
    }
    map.delete();
  }
  // The card's printed frame (round the art, or a coloured panel) is card-
  // shaped too, and its edge is often sharper than the card's own edge
  // (yellow on a grey table hardly differs in brightness). So look just
  // outside the chosen outline: a second straight edge on all four sides
  // means the chosen one was the frame, and the card's edge is out there.
  let cutOff = false;
  if (best) {
    const out = outerEdge(best.quad, imageData, W, H);
    if (out.quad) {
      const { score } = scoreQuad(out.quad, W, H, support);
      if (score > 0) best = { quad: out.quad, score, strategy: best.strategy + ', moved out to the card edge' };
    } else if (out.cutOff) {
      cutOff = true;
      best = null;
    }
  }
  [src, rgb, gray, hsv, chans, sat, support].forEach(m => m.delete());
  const extra = debug ? { candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 12) } : {};
  if (!best) return { quad: null, cutOff, ...extra };
  return { quad: upright(best.quad), score: round(best.score, 3), strategy: best.strategy, ...extra };
}

// For each side of the outline, a straight edge parallel to it a little way
// outside it (up to 12% of the card's width: wider than any card's border),
// with plain colour in between. Works on the average colour along lines
// parallel to the side, one per pixel of distance: averaging hundreds of
// pixels cancels out the photo's noise (a dark mat is noisy), so what is left
// is how the colour changes going outwards: the frame, the plain border, then
// a clear change where the card ends. Answers
//   { quad }     a bigger outline, when all four sides have such an edge
//   { cutOff }   some sides have one and the others run off the photo: the
//                outline is the card's frame and the card itself goes past
//                the edge of the picture
//   {}           nothing outside: the outline is the card's own edge
function outerEdge(quad, image, W, H) {
  const px = image.data;
  const o = orderClockwise(quad);
  const cx = o.reduce((s, p) => s + p[0], 0) / 4, cy = o.reduce((s, p) => s + p[1], 0) / 4;
  const short = Math.min(dist(o[0], o[1]), dist(o[1], o[2]));
  const from = Math.max(4, Math.round(0.012 * short)), to = Math.round(0.12 * short);
  const MIN_STEP = 30;          // colour change (of averages) that counts as an edge
  const sides = [];
  for (let i = 0; i < 4; i++) {
    const p = o[i], q = o[(i + 1) % 4], len = dist(p, q);
    let nx = -(q[1] - p[1]) / len, ny = (q[0] - p[0]) / len;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }     // point outwards
    const steps = Math.max(30, Math.round(len / 2));
    // average colour at each distance outwards
    const prof = [];
    let offPhoto = false;
    for (let off = 0; off <= to + 2; off++) {
      let r = 0, g = 0, b = 0, n = 0, outside = false;
      for (let k = Math.round(steps * 0.15); k <= Math.round(steps * 0.85); k++) {
        const t = k / steps;
        const x = Math.round(p[0] + (q[0] - p[0]) * t + nx * off), y = Math.round(p[1] + (q[1] - p[1]) * t + ny * off);
        if (x < 1 || y < 1 || x > W - 2 || y > H - 2) { outside = true; break; }
        const j = (y * W + x) * 4;
        r += px[j]; g += px[j + 1]; b += px[j + 2]; n++;
      }
      if (outside) { offPhoto = true; break; }
      prof.push([r / n, g / n, b / n]);
    }
    const cd = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    const step = (off) => (off >= 2 && off + 2 < prof.length) ? cd(prof[off + 2], prof[off - 2]) : 0;
    // The strongest change in range that is a peak, with a calm stretch (the
    // plain border) between it and the outline.
    let best = null;
    for (let off = from; off + 2 < prof.length; off++) {
      const v = step(off);
      if (v < MIN_STEP || v < step(off - 1) || v < step(off + 1)) continue;
      let calm = Infinity;
      for (let k = 3; k < off - 1; k++) calm = Math.min(calm, step(k));
      if (calm > 0.3 * v) continue;
      if (!best || v > best.v) best = { off, v };
    }
    let off = null;
    if (best) {
      // between pixels, from the curve through the peak and its neighbours
      const a = step(best.off - 1), b = best.v, c = step(best.off + 1);
      const den = a - 2 * b + c;
      off = best.off + (den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0);
    }
    sides.push({ off, offPhoto: off === null && offPhoto, n: [nx, ny] });
  }
  const withEdge = sides.filter(s => s.off !== null).length;
  if (withEdge === 4) {
    const lines = sides.map((s, i) => {
      const p = o[i], q = o[(i + 1) % 4];
      return lineThrough([p[0] + s.n[0] * s.off, p[1] + s.n[1] * s.off], [q[0] + s.n[0] * s.off, q[1] + s.n[1] * s.off]);
    });
    const out = [];
    for (let i = 0; i < 4; i++) {
      const c = intersect(lines[(i + 3) % 4], lines[i]);
      if (!c) return {};
      out.push(c);
    }
    return { quad: out, offsets: sides.map(s => round(s.off, 1)) };
  }
  if (withEdge >= 2 && sides.every(s => s.off !== null || s.offPhoto)) return { cutOff: true };
  return {};
}

// Straight lines through each side's outline points (leaving out the ends of
// each side, where the rounded corners are), crossed to give the corners.
function fitQuad(rough, points) {
  const o = orderClockwise(rough);
  const sides = [[], [], [], []];
  const segs = o.map((p, i) => {
    const q = o[(i + 1) % 4], len = dist(p, q);
    return { p, ux: (q[0] - p[0]) / len, uy: (q[1] - p[1]) / len, len };
  });
  const tol = 0.04 * Math.min(segs[0].len, segs[1].len);
  for (let k = 0; k < points.length; k += 2) {
    const x = points[k], y = points[k + 1];
    let bestI = -1, bestD = tol;
    for (let i = 0; i < 4; i++) {
      const s = segs[i], dx = x - s.p[0], dy = y - s.p[1];
      const t = (dx * s.ux + dy * s.uy) / s.len;
      if (t < 0.15 || t > 0.85) continue;
      const d = Math.abs(dx * s.uy - dy * s.ux);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI >= 0) sides[bestI].push([x, y]);
  }
  const lines = sides.map((pts, i) => fitLine(pts) || lineThrough(o[i], o[(i + 1) % 4]));
  const out = [];
  for (let i = 0; i < 4; i++) {
    const c = intersect(lines[(i + 3) % 4], lines[i]);
    if (!c || dist(c, o[i]) > tol * 4) return o;     // lines gone wild: keep the rough outline
    out.push(c);
  }
  return out;
}

function medianOf(mat) {
  const hist = new Uint32Array(256);
  const d = mat.data;
  for (let i = 0; i < d.length; i++) hist[d[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= d.length / 2) return v; }
  return 128;
}

function edgesOf(single, low = null, high = null) {
  const blur = new cv.Mat(); cv.GaussianBlur(single, blur, new cv.Size(5, 5), 0);
  const m = medianOf(blur);                         // thresholds follow the photo's own brightness
  const edges = new cv.Mat();
  cv.Canny(blur, edges, low ?? Math.max(10, 0.33 * m), high ?? Math.max(30, 0.665 * m));
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, edges, k);
  blur.delete(); k.delete();
  return edges;
}

function blobOf(single) {
  const blur = new cv.Mat(); cv.GaussianBlur(single, blur, new cv.Size(7, 7), 0);
  const bin = new cv.Mat();
  cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  // The card might be the dark or the light part — keep whichever is smaller
  // than half the picture (the background is usually the bigger part).
  if (cv.countNonZero(bin) > bin.rows * bin.cols / 2) cv.bitwise_not(bin, bin);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k);
  blur.delete(); k.delete();
  return bin;
}

function maxEdges(gray, sat) {
  const a = new cv.Mat(), b = new cv.Mat();
  cv.Canny(gray, a, 30, 90); cv.Canny(sat, b, 30, 90);
  cv.bitwise_or(a, b, a);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  cv.dilate(a, a, k);
  b.delete(); k.delete();
  return a;
}

// Every outline in the map that simplifies to 4 corners.
function quadsIn(map, W, H) {
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  cv.findContours(map, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
  const out = [];
  const minArea = 0.08 * W * H;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    if (cv.contourArea(c) < minArea * 0.5) { c.delete(); continue; }
    const hull = new cv.Mat(); cv.convexHull(c, hull);
    const peri = cv.arcLength(hull, true);
    for (const eps of [0.02, 0.035, 0.05]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(hull, approx, eps * peri, true);
      if (approx.rows === 4) {
        const q = [];
        for (let j = 0; j < 4; j++) q.push([approx.data32S[j * 2], approx.data32S[j * 2 + 1]]);
        if (polyArea(q) >= minArea) out.push({ quad: q, points: Int32Array.from(c.data32S) });
        approx.delete();
        break;
      }
      approx.delete();
    }
    hull.delete(); c.delete();
  }
  contours.delete(); hierarchy.delete();
  return out;
}

// Higher is better; 0 = not a card. Looks for: the right shape (63:88, allowing
// for some tilt), not touching the photo's edge, edges that really are edges
// in the photo, and size (the card, not the art box inside it).
function scoreQuad(q, W, H, support) {
  const o = orderClockwise(q);
  const s = [dist(o[0], o[1]), dist(o[1], o[2]), dist(o[2], o[3]), dist(o[3], o[0])];
  const shortSide = (Math.min(s[0], s[2]) + Math.min(s[1], s[3])) / 2;
  const a = (s[0] + s[2]) / 2, b = (s[1] + s[3]) / 2;
  const ratio = Math.min(a, b) / Math.max(a, b);
  if (Math.abs(ratio - CARD_RATIO) > 0.12) return { score: 0, reason: 'shape' };
  // opposite sides should be similar (a phone held roughly straight)
  if (Math.min(s[0], s[2]) / Math.max(s[0], s[2]) < 0.8) return { score: 0, reason: 'uneven sides' };
  if (Math.min(s[1], s[3]) / Math.max(s[1], s[3]) < 0.8) return { score: 0, reason: 'uneven sides' };
  const margin = 3;
  if (o.some(([x, y]) => x < margin || y < margin || x > W - 1 - margin || y > H - 1 - margin)) return { score: 0, reason: 'touches photo edge' };
  if (shortSide < 0.15 * Math.min(W, H)) return { score: 0, reason: 'too small' };
  const edgeShare = supportAlong(o, support);
  if (edgeShare < 0.5) return { score: 0, reason: 'weak edges ' + round(edgeShare, 2) };
  const areaShare = polyArea(o) / (W * H);
  const shape = 1 - Math.abs(ratio - CARD_RATIO) / 0.12;
  return { score: edgeShare * edgeShare * (0.5 + 0.5 * shape) * Math.sqrt(areaShare), reason: 'ok' };
}

// Share of points along the sides that sit on (or within 2 px of) a real edge
// in the photo.
function supportAlong(o, support) {
  let hit = 0, n = 0;
  const W = support.cols, H = support.rows, d = support.data;
  for (let i = 0; i < 4; i++) {
    const p = o[i], q = o[(i + 1) % 4];
    const len = dist(p, q), steps = Math.max(20, Math.round(len / 3));
    const nx = (q[1] - p[1]) / len, ny = -(q[0] - p[0]) / len;
    // Skip the rounded corners: only the middle 80% of each side.
    for (let k = Math.round(steps * 0.1); k <= Math.round(steps * 0.9); k++) {
      const t = k / steps;
      const bx = p[0] + (q[0] - p[0]) * t, by = p[1] + (q[1] - p[1]) * t;
      n++;
      for (const dd of [0, -1, 1, -2, 2]) {
        const x = Math.round(bx + nx * dd), y = Math.round(by + ny * dd);
        if (x >= 0 && y >= 0 && x < W && y < H && d[y * W + x]) { hit++; break; }
      }
    }
  }
  return n ? hit / n : 0;
}

// ─── REFINE THE EDGES ─────────────────────────────────────────────────────────
// The outline from detect() is good to a few pixels, and its corners sit inside
// the card's rounded corners. For measuring centering it has to be better than
// that, so each side is searched again in a bigger copy: at many points along
// the side, look across it for the sharpest colour change near the first guess,
// fit a straight line through those points (ignoring stray ones), and use where
// the four lines cross as the corners. That's where a square-cornered card's
// corner would be — the same frame a grader's centering tool uses.

function refine(imageData, quad) {
  const W = imageData.width, H = imageData.height, px = imageData.data;
  const o = quad.map(p => [p[0], p[1]]);
  const lines = [], bows = [];
  // How far either side of the first guess to look. Kept short on purpose: a
  // narrow border puts the art's edge (often a sharper change than the card's
  // own edge) only a little way inside, and that must not be picked instead.
  const reach = Math.max(6, Math.round(0.006 * Math.max(W, H)));
  for (let i = 0; i < 4; i++) {
    const p = o[i], q = o[(i + 1) % 4];
    const len = dist(p, q);
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    // Normal pointing out of the card (corners go clockwise on screen).
    const nx = uy, ny = -ux;
    const pts = [];
    const steps = Math.round(len / 4);
    for (let k = Math.round(steps * 0.12); k <= Math.round(steps * 0.88); k++) {
      const t = k / steps;
      const bx = p[0] + (q[0] - p[0]) * t, by = p[1] + (q[1] - p[1]) * t;
      let bestG = 0, bestD = null;
      let prev = sample(px, W, H, bx - nx * (reach + 1), by - ny * (reach + 1));
      for (let dd = -reach; dd <= reach; dd++) {
        const cur = sample(px, W, H, bx + nx * dd, by + ny * dd);
        if (!cur || !prev) { prev = cur; continue; }
        const g = Math.max(Math.abs(cur[0] - prev[0]), Math.abs(cur[1] - prev[1]), Math.abs(cur[2] - prev[2]));
        if (g > bestG) { bestG = g; bestD = dd - 0.5; }
        prev = cur;
      }
      if (bestD !== null && bestG >= 12) pts.push([bx + nx * bestD, by + ny * bestD]);
    }
    const line = fitLine(pts);
    lines.push(line || lineThrough(p, q));
    bows.push({ sag: line ? bowOf(pts, p, ux, uy, len) : null, len });
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    const c = intersect(lines[(i + 3) % 4], lines[i]);
    out.push(c || o[i]);
  }
  // How far each side bows away from straight, in mm (a long side is 88 mm,
  // a short one 63).
  const longest = Math.max(...bows.map(b => b.len));
  const bendMm = bows.map(b => b.sag === null ? null
    : round(b.sag / b.len * (b.len > 0.85 * longest ? 88 : 63), 2));
  return { quad: out.map(([x, y]) => [round(x, 2), round(y, 2)]), bendMm };
}

// A bent card's edges curve. Fits a gentle curve (a parabola across the side)
// to the side's edge points and answers how far its middle sits from the
// straight line between its ends, in pixels. Done twice, leaving out points
// far from the first curve (dust, a shadow, the art's edge picked by mistake).
function bowOf(pts, p, ux, uy, len) {
  if (pts.length < 20) return null;
  // position along the side (0..1) and distance off the side's first line
  let data = pts.map(([x, y]) => [((x - p[0]) * ux + (y - p[1]) * uy) / len, (x - p[0]) * uy - (y - p[1]) * ux]);
  let fit = null;
  for (let pass = 0; pass < 3; pass++) {
    fit = parabola(data);
    if (!fit) return null;
    const res = data.map(([t, d]) => Math.abs(d - (fit[0] + fit[1] * t + fit[2] * t * t)));
    const sorted = [...res].sort((a, b) => a - b);
    const cut = Math.max(1.5, 2.5 * sorted[Math.floor(sorted.length / 2)]);
    const keep = data.filter((_, i) => res[i] <= cut);
    if (keep.length < 20 || keep.length === data.length) break;
    data = keep;
  }
  // d = a + b·t + c·t²: the middle (t = 0.5) is c/4 off the chord
  return Math.abs(fit[2]) / 4;
}

// Least-squares d = a + b·t + c·t² through [t, d] points.
function parabola(data) {
  const S = Array(5).fill(0), T = Array(3).fill(0);
  for (const [t, d] of data) {
    let tp = 1;
    for (let k = 0; k < 5; k++) { S[k] += tp; if (k < 3) T[k] += tp * d; tp *= t; }
  }
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map(k => det(M.map((row, r) => row.map((v, c) => (c === k ? T[r] : v)))) / D);
}

// Average colour of a 3x3 patch (bilinear centre), or null off the image.
function sample(px, W, H, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) return null;
  let r = 0, g = 0, b = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = ((yi + dy) * W + (xi + dx)) * 4;
    r += px[i]; g += px[i + 1]; b += px[i + 2];
  }
  return [r / 9, g / 9, b / 9];
}

// Least-squares line through points, done twice: the second time without the
// points farthest from the first line (a speck of dust, a shadow, a corner).
function fitLine(pts) {
  if (pts.length < 8) return null;
  let line = totalLeastSquares(pts);
  for (let pass = 0; pass < 2; pass++) {
    const d = pts.map(p => Math.abs(line.a * p[0] + line.b * p[1] + line.c));
    const sorted = [...d].sort((x, y) => x - y);
    const cut = Math.max(1.0, sorted[Math.floor(sorted.length * 0.7)] * 2);
    const keep = pts.filter((_, i) => d[i] <= cut);
    if (keep.length < 8) break;
    line = totalLeastSquares(keep);
  }
  return line;
}

// Line a*x + b*y + c = 0 with a²+b²=1 that best fits the points.
function totalLeastSquares(pts) {
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // direction of the line
  const a = -Math.sin(theta), b = Math.cos(theta);
  return { a, b, c: -(a * mx + b * my) };
}

function lineThrough(p, q) {
  const len = dist(p, q);
  const a = -(q[1] - p[1]) / len, b = (q[0] - p[0]) / len;
  return { a, b, c: -(a * p[0] + b * p[1]) };
}

function intersect(l1, l2) {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-9) return null;
  return [(l1.b * l2.c - l2.b * l1.c) / det, (l2.a * l1.c - l1.a * l2.c) / det];
}

// ─── STRAIGHTEN ───────────────────────────────────────────────────────────────

function warp(imageData, quad, outW, outH, margin = 0) {
  let src = cv.matFromImageData(imageData);
  let q = quad;
  // Shrinking a lot in one perspective warp skips pixels (jagged, noisy
  // edges), so a much bigger card is first shrunk smoothly to about the
  // right size.
  const cardH = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const scale = outH / cardH;
  if (scale < 0.8) {
    const small = new cv.Mat();
    cv.resize(src, small, new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)), 0, 0, cv.INTER_AREA);
    // Pixel (0, 0) is the middle of the first pixel (see toCopy in vision.js).
    const sx = small.cols / src.cols, sy = small.rows / src.rows;
    src.delete(); src = small;
    q = q.map(([x, y]) => [(x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5]);
  }
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flat());
  // The card's edges go on the outer edges of the picture's edge pixels
  // (-0.5 and outW - 0.5), so the card fills exactly outW x outH pixels
  // (plus `margin` pixels of the photo all round, if asked for).
  const m = margin, a = m - 0.5, bx = outW + m - 0.5, by = outH + m - 0.5;
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [a, a, bx, a, bx, by, a, by]);
  const M = cv.getPerspectiveTransform(from, to);
  const dst = new cv.Mat();
  cv.warpPerspective(src, dst, M, new cv.Size(outW + 2 * m, outH + 2 * m), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  const out = new ImageData(new Uint8ClampedArray(dst.data), outW + 2 * m, outH + 2 * m);
  [src, from, to, M, dst].forEach(m => m.delete());
  return out;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function dist(p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); }
function round(v, n) { const f = 10 ** n; return Math.round(v * f) / f; }

function polyArea(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// Corners clockwise on screen (y grows downwards), starting top-left.
function orderClockwise(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const sorted = [...q].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // atan2 order runs from the left side round through the top: rotate so the
  // corner nearest the top-left of the photo comes first.
  let start = 0, bestSum = Infinity;
  sorted.forEach((p, i) => { if (p[0] + p[1] < bestSum) { bestSum = p[0] + p[1]; start = i; } });
  return [0, 1, 2, 3].map(i => sorted[(start + i) % 4]);
}

// Clockwise from top-left, with the short sides at top and bottom. A card lying
// sideways in the photo comes out turned a quarter so it stands upright (which
// way up can't be told from the outline; the page has a "turn" button).
function upright(q) {
  const o = orderClockwise(q);
  const top = dist(o[0], o[1]), side = dist(o[1], o[2]);
  return top > side ? [o[3], o[0], o[1], o[2]] : o;
}
