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
// smallest depth over the photos is kept (combine). A light that isn't the
// same all round can still catch one edge in both photos, so when whitening
// is left after two, the Grading page asks for a third (turned the other
// way) and then a fourth (upside down): whitening has to be in every photo
// to count, except that with 4 photos, 3 are enough (one photo out of focus,
// or with the light just wrong for a tiny fleck, shouldn't wipe out real
// wear; a glint in 3 of 4 turns is very unlikely). With one photo only, an
// edge lit along much of its length is marked "may be glints" and not
// counted. Spots seen in at least 2 photos but not enough to count are
// listed as "maybe" (maybeSpots): a tiny fleck can catch the light like a
// glint does, so the user decides.
//
// Spots: stretches of track whitened at least minDepthPx deep. The limit
// they set on the grade is a rough guide (the table in config.js), not a
// grader's rule: graders judge wear by eye.

export const EDGES_VERSION = 4;

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
//     the expected edge, + is inwards) } }, lit: { key: share }, unread,
//     guessed (share of the outline where the card's edge didn't stand out
//     from the background and the straightened outline was used instead) }
// back: the card's back, where tiny flecks are looked for too (backFlecks).
export function scanEdges(image, margin, settings, { back = false } = {}) {
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
  let unread = 0, total = 0, guessed = 0;
  const rgb = [0, 0, 0];
  for (const key of TRACKS) {
    const n = geo.n[key];
    const prof = new Float32Array(n * len * 3);
    const e0s = new Int32Array(n).fill(-1);
    const guess = new Uint8Array(n);
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
      // A border about the colour of the background (a black border on a
      // dark mat) doesn't stand out, and neither does a fleck of whitening
      // only a pixel or two deep before the black starts again. The
      // straightened outline is right to a pixel or two along the edges, so
      // the card is taken to start there.
      if (e0s[i] < 0) { e0s[i] = out; guess[i] = 1; }
      refs.set(channelMedian(prof, i * len, e0s[i] + refFrom, e0s[i] + refTo), i * 3);
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
    // backs: the brightest darkest channel right at the edge (backFlecks)
    const peak = new Float32Array(n).fill(NaN);
    const fOut = Math.round(s.backFlecks.outMm * ppm), fIn = Math.round(s.backFlecks.inMm * ppm);
    for (let i = 0; i < n; i++) {
      total++;
      if (e0s[i] < 0 || !smooth[i]) { unread++; continue; }
      const ref = smooth[i], bg = [bgs[i * 3], bgs[i * 3 + 1], bgs[i * 3 + 2]];
      // whitening (near white) only stands out from a background that isn't
      // whitish itself: judged by its darkest channel, so bright pink paper
      // (lit up on the lamp's side) is still read, a white or grey one isn't
      if (Math.min(bg[0], bg[1], bg[2]) > s.maxBackground) { unread++; continue; }
      const half = 0.5 * colourDistance(ref, bg);
      let e = e0s[i];
      if (guess[i]) {
        // from just outside the outline, in case it is a pixel off (the
        // background is dark, so it never reads as whitening itself)
        e = Math.max(1, out - 2);
        guessed++;
      } else {
        for (let k = Math.max(1, e0s[i] - 4); k <= e0s[i] + 6; k++) {
          if (colourDistanceAt(prof, (i * len + k) * 3, bg) >= half) { e = k; break; }
        }
      }
      edge[i] = e - out;
      const wx = 255 - ref[0], wy = 255 - ref[1], wz = 255 - ref[2];
      const den = wx * wx + wy * wy + wz * wz;
      // On a dark border a fleck of white only a few pixels across is
      // blurred to grey by the photo, so less of the way to white counts.
      const minWhite = (ref[0] + ref[1] + ref[2]) / 3 < s.darkBorder ? s.minWhiteDark : s.minWhite;
      let count = 0, last = -1, sumL = 0;
      for (let k = e; k < e + maxDepth && k < len; k++) {
        const j = (i * len + k) * 3;
        const dr = prof[j] - ref[0], dg = prof[j + 1] - ref[1], db = prof[j + 2] - ref[2];
        const towardWhite = den > 0 ? (dr * wx + dg * wy + db * wz) / den : 0;
        if (towardWhite > minWhite && (dr + dg + db) / 3 > s.minLighter) {
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
      if (back) {
        let pk = 0;
        for (let k = Math.max(0, e - fOut); k <= Math.min(len - 1, e + fIn); k++) {
          const j = (i * len + k) * 3;
          pk = Math.max(pk, Math.min(prof[j], prof[j + 1], prof[j + 2]));
        }
        peak[i] = pk;
      }
    }
    // guess: where the straightened outline was used (the card's edge
    // didn't stand out), so `edge` there says nothing about the outline
    tracks[key] = { depth, edge, guess, peak };
  }
  // Edges lit along much of their length (glints, if there is no second
  // photo to tell). Judged before the flecks below are added.
  for (const key of ['top', 'right', 'bottom', 'left']) lit[key] = round(shareAtLeast(tracks[key].depth, 1), 2);
  // Backs: a fleck is a step whose edge reading stands out from the steps
  // around it (a steady pale line, like the light catching the edge, has
  // the same reading all along and doesn't).
  if (back) {
    const { minLift, windowMm } = s.backFlecks;
    const half = Math.round(windowMm * ppm), near = [];
    for (const key of TRACKS) {
      const { peak, depth } = tracks[key], n = peak.length;
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(peak[i]) || Number.isNaN(depth[i]) || depth[i] >= s.minDepthPx) continue;
        near.length = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (!Number.isNaN(peak[j])) near.push(peak[j]);
        near.sort((a, b) => a - b);
        if (peak[i] - near[near.length >> 1] >= minLift) depth[i] = s.minDepthPx;
      }
    }
  }
  for (const key of TRACKS) delete tracks[key].peak;
  return { W, H, ppm, R, back, tracks, lit, unread: total ? round(unread / total, 3) : 1, guessed: total ? round(guessed / total, 3) : 0 };
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

// How well a turned photo (already the same way up) matches the first: the
// correlation of small grey copies of the card's middle, -1..1. Photos of
// the same card came out 0.5-0.95 (holo fronts lowest, the light moves on
// the foil); an out-of-focus photo whose outline was found wrong 0.37.
export function matchScore(imageA, imageB, margin) {
  const a = thumb(imageA, margin), b = thumb(imageB, margin);
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    ab += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? round(ab / Math.sqrt(aa * bb), 3) : 0;
}

// How well two straightened pictures of the same side line up, judged by the
// printed lines near the card's border only (-1..1). The card's middle (what
// matchScore compares) changes with the light on holo foil, so a turned holo
// front can fail matchScore though it lines up; the border has no foil, and
// an outline found a few mm off (the inner frame, say) moves its lines away.
// On the sent-for-testing photos: lined-up backs 0.6-0.9, fronts mostly
// 0.3-0.9 (blurry full-art fronts lower), outlines 3 mm in or 1.5 mm off
// at most 0.27. Each picture's lines are compared at up to 0.2 mm apart.
const CARD_W_MM = 63, CARD_H_MM = 88;
export function borderMatch(imageA, imageB, margin, { outerMm = 6, cellMm = 1, search = 1 } = {}) {
  const a = lineMap(imageA, margin), b = lineMap(imageB, margin);
  const va = borderCells(a, outerMm, cellMm, 0, 0);
  let best = -1;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      best = Math.max(best, pearsonOf(va, borderCells(b, outerMm, cellMm, dx, dy)));
    }
  }
  return round(best, 3);
}

// A picture at a quarter of its size: how strongly the print changes at each
// point (edges of lines and letters), against the brightness around it so a
// darker side of the card counts the same.
function lineMap(image, margin) {
  const s = 4;
  const { width, height, data } = image;
  const w = Math.floor(width / s), h = Math.floor(height / s);
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = y * s; yy < y * s + s; yy++) {
        for (let xx = x * s; xx < x * s + s; xx++) {
          const i = (yy * width + xx) * 4;
          sum += data[i] + data[i + 1] + data[i + 2];
        }
      }
      g[y * w + x] = sum / (3 * s * s);
    }
  }
  const soft = boxMean(g, w, h, 1), around = boxMean(g, w, h, 8);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (soft[i + 1] - soft[i - 1]) / 2, gy = (soft[i + w] - soft[i - w]) / 2;
      mag[i] = Math.hypot(gx, gy) / (around[i] + 10);
    }
  }
  const ppm = (width - 2 * margin) / CARD_W_MM / s;
  return { w, h, mag, m: margin / s, ppm };
}

// mean over a (2r+1) square around each point (cut off at the sides)
function boxMean(g, w, h, r) {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const t = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      out[y * w + x] = t / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

// the line map's average in each cellMm square within outerMm of an edge,
// read dx, dy pixels off
function borderCells(map, outerMm, cellMm, dx, dy) {
  const { w, h, mag, m, ppm } = map;
  const c = Math.max(1, Math.round(cellMm * ppm));
  const out = [];
  const x1 = m + CARD_W_MM * ppm, y1 = m + CARD_H_MM * ppm;
  for (let y0 = Math.floor(m); y0 + c <= y1; y0 += c) {
    for (let x0 = Math.floor(m); x0 + c <= x1; x0 += c) {
      const xm = (x0 - m) / ppm + cellMm / 2, ym = (y0 - m) / ppm + cellMm / 2;
      if (Math.min(xm, CARD_W_MM - xm, ym, CARD_H_MM - ym) > outerMm) continue;
      let sum = 0, n = 0;
      for (let y = y0 + dy; y < y0 + dy + c; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = x0 + dx; x < x0 + dx + c; x++) {
          if (x < 0 || x >= w) continue;
          sum += mag[y * w + x]; n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

function pearsonOf(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    ab += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
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

// Scans of the same side (all but the first already lined up with it): at
// each point the smallest depth (with 4 or more photos, the depth all but one
// of them reach), after letting each spread alignPx either way (the outlines
// can differ by a pixel or two; backs alignPxBack). combineScans([a, b, c], settings),
// or combineScans(a, b, settings) for two. Answers a scan with combined: true
// and photos: how many went into it.
export function combineScans(a, b, settings) {
  const scans = Array.isArray(a) ? a : [a, b];
  if (Array.isArray(a)) settings = b;
  const first = scans[0];
  const k = first.back ? (settings.edges.alignPxBack ?? settings.edges.alignPx) : settings.edges.alignPx;
  const tracks = {}, some = {}, spreads = {};
  for (const key of TRACKS) {
    const spreadOut = scans.map(sc => spread(sc.tracks[key].depth, k));
    spreads[key] = spreadOut;
    const n = spreadOut[0].length;
    const depth = new Float32Array(n);
    const second = new Float32Array(n).fill(NaN);     // reached by at least 2 photos
    const vals = [];
    for (let i = 0; i < n; i++) {
      vals.length = 0;
      for (const d of spreadOut) if (!Number.isNaN(d[i])) vals.push(d[i]);
      if (!vals.length) { depth[i] = NaN; continue; }
      vals.sort((x, y) => x - y);
      // all of them, or all but one from 4 up: the (need)th largest
      const need = vals.length >= 4 ? vals.length - 1 : vals.length;
      depth[i] = vals[vals.length - need];
      if (vals.length >= 2) second[i] = vals[vals.length - 2];
    }
    tracks[key] = { depth, edge: first.tracks[key].edge };
    some[key] = { depth: second, edge: first.tracks[key].edge };
  }
  // Glints are gone now, so nothing is in doubt: whitening left along an
  // edge was there in every photo, with the light on different edges.
  const lit = {};
  for (const key of Object.keys(first.lit)) lit[key] = 0;
  return {
    ...first, tracks, lit, combined: true, photos: scans.length,
    // with 3 or more photos: what at least 2 of them show, for maybeSpots
    some: scans.length >= 3 ? some : null, spreads,
  };
}

// Spots seen in at least 2 of the photos but not counted (not in all of
// them, or 3 of 4), away from the counted spots: [{ ...spot, maybe: true,
// votes, photos }]. The page lists them, not counted, with "Count it".
export function maybeSpots(scan, counted, settings) {
  if (!scan.some) return [];
  const lit = {};
  for (const key of Object.keys(scan.lit)) lit[key] = 0;
  const slack = Math.round(settings.edges.mergeMm * scan.ppm);
  const minDepth = settings.edges.minDepthPx;
  return findSpots({ ...scan, tracks: scan.some, lit }, settings)
    .filter(sp => !counted.some(c => c.track === sp.track && sp.from <= c.to + slack && sp.to >= c.from - slack))
    .map(sp => {
      let votes = 0;
      for (const d of scan.spreads[sp.track]) {
        let deepest = 0;
        for (let i = sp.from; i <= sp.to; i++) if (d[i] > deepest) deepest = d[i];
        if (deepest >= minDepth) votes++;
      }
      return { ...sp, id: `maybe-${sp.id}`, maybe: true, votes, photos: scan.photos };
    });
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

// Possible nicks: places along a straight edge where the card's outline dips
// in (a sliver of the edge missing), at least nicks.minPx deeper than the
// outline around it (its median over nicks.windowMm either way), along
// minRunMm-maxRunMm. Blur, glints and print near the edge make dips like that
// too, but those don't stay with the card when it's turned, so a dip has to
// show in the same place in at least 2 of the photos (and half of them). A
// nick can fill with light in a photo where the lamp catches it, so the other
// photos only need a faint dip there (weakPx along weakRunMm). A nick nearly
// always shows a fleck of the pale card inside it, so one of the photos must
// read some whitening there too (that also leaves out most dips that are
// only blur). Where a photo couldn't find the card's edge along much of a
// side (a dark border on a dark background: maxGuess), that photo doesn't
// vote on the side; with fewer than 2 photos left, the side isn't checked.
// On the photos so far: 0-1 suggestions on clean sides, the user's real nick
// found, frayed edges on played cards found. The outline is only measured to
// a pixel (0.05 mm), so these are suggestions for the user to check, never
// counted on their own. scans: the first photo's
// scan, then the turned photos' (lined up with it). Answers [{ id, track,
// from, to, lengthMm, depthMm, votes, photos }].
export function findNicks(scans, settings) {
  const s = settings.edges.nicks;
  if (!s || scans.length < 2) return [];
  const ppm = scans[0].ppm;
  const half = Math.round(s.windowMm * ppm);
  const strong = { half, minPx: s.minPx, minRun: Math.round(s.minRunMm * ppm), maxRun: Math.round(s.maxRunMm * ppm) };
  const weak = { half, minPx: s.weakPx, minRun: Math.max(2, Math.round(s.weakRunMm * ppm)), maxRun: strong.maxRun };
  const slack = settings.edges.alignPx;
  // the photos that can vote on each side
  const voters = {};
  for (const key of ['top', 'right', 'bottom', 'left']) {
    voters[key] = new Set(scans.map((sc, p) => (guessShare(sc.tracks[key]) <= s.maxGuess ? p : -1)).filter(p => p >= 0));
  }
  const needOn = (key) => Math.max(2, Math.ceil(voters[key].size / 2));
  // clear dips in any photo, grouped where they overlap on the same edge
  const groups = [];
  scans.forEach((sc, p) => {
    for (const d of dipsOf(sc, strong)) {
      if (!voters[d.track].has(p)) continue;
      const g = groups.find(x => x.track === d.track && d.from <= x.to + slack && d.to >= x.from - slack);
      if (g) {
        g.from = Math.min(g.from, d.from); g.to = Math.max(g.to, d.to);
        g.depth = Math.max(g.depth, d.depth); g.seen.add(p);
      } else {
        groups.push({ ...d, seen: new Set([p]) });
      }
    }
  });
  // ...and the photos with at least a faint dip in the same place
  const faint = scans.map(sc => dipsOf(sc, weak));
  for (const g of groups) {
    faint.forEach((dips, p) => {
      if (voters[g.track].has(p) && dips.some(d => d.track === g.track && d.from <= g.to + slack && d.to >= g.from - slack)) g.seen.add(p);
    });
  }
  const pale = (g) => scans.some((sc, p) => {
    if (!voters[g.track].has(p)) return false;
    const d = sc.tracks[g.track].depth;
    for (let i = Math.max(0, g.from - slack); i <= Math.min(d.length - 1, g.to + slack); i++) if (d[i] >= s.minPale) return true;
    return false;
  });
  return groups
    .filter(g => voters[g.track].size >= 2 && g.seen.size >= needOn(g.track) && pale(g))
    .map(g => ({
      id: `nick-${g.track}-${g.from}`, track: g.track, from: g.from, to: g.to,
      lengthMm: round((g.to - g.from + 1) / ppm, 2), depthMm: round(g.depth / ppm, 2),
      votes: g.seen.size, photos: voters[g.track].size,
    }));
}

// The sides (of top/right/bottom/left) where fewer than 2 photos found the
// card's edge well enough to look for nicks.
export function nicksUnchecked(scans, settings) {
  if (scans.length < 2) return ['top', 'right', 'bottom', 'left'];
  return ['top', 'right', 'bottom', 'left'].filter(key =>
    scans.filter(sc => guessShare(sc.tracks[key]) <= settings.edges.nicks.maxGuess).length < 2);
}

function guessShare(track) {
  const g = track.guess;
  if (!g || !g.length) return 0;
  let n = 0;
  for (let i = 0; i < g.length; i++) n += g[i];
  return n / g.length;
}

function dipsOf(scan, { half, minPx, minRun, maxRun }) {
  const out = [];
  const win = [];
  for (const key of ['top', 'right', 'bottom', 'left']) {
    const { edge: e, guess } = scan.tracks[key], n = e.length;
    const ok = (i) => !Number.isNaN(e[i]) && !guess?.[i];
    const dip = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!ok(i)) continue;
      win.length = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (ok(j)) win.push(e[j]);
      if (win.length < half) continue;
      win.sort((a, b) => a - b);
      dip[i] = e[i] - win[win.length >> 1];
    }
    let from = -1, deepest = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && dip[i] >= minPx) {
        if (from < 0) { from = i; deepest = 0; }
        deepest = Math.max(deepest, dip[i]);
      } else if (from >= 0) {
        const len = i - from;
        if (len >= minRun && len <= maxRun) out.push({ track: key, from, to: i - 1, depth: deepest });
        from = -1;
      }
    }
  }
  return out;
}

// One side's numbers from its spots, leaving out spots in doubt and those
// marked "not whitening", plus the nicks the user confirmed or added. Answers
// { lengthMm, depthMm, corners, edges, counted, doubtTracks, nicks }.
// The user's "Whitening" marks as spots (settings.edges.markSpot in size),
// each on the track it's nearest to: a corner when it's within the corner's
// rounding of both edges, otherwise the closest edge. marks: [{ kind, x, y }]
// in mm from the card's top-left corner.
export function markSpots(marks, settings) {
  const { cornerRadiusMm: r, markSpot } = settings.edges;
  const W = 63, H = 88;
  return (marks || []).filter(m => m.kind === 'whitening').map(m => {
    const v = m.y < r ? 't' : m.y > H - r ? 'b' : '';
    const h = m.x < r ? 'l' : m.x > W - r ? 'r' : '';
    let track = v && h ? v + h : null;
    if (!track) {
      const d = { top: Math.abs(m.y), bottom: Math.abs(H - m.y), left: Math.abs(m.x), right: Math.abs(W - m.x) };
      track = Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
    }
    return { id: m.id, track, lengthMm: markSpot.lengthMm, depthMm: markSpot.depthMm, mark: true };
  });
}

export function measureEdges(spots, ignored = [], doubtTracks = [], nicks = 0) {
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
    nicks,
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

// The best grade the whitening and nicks allow, from the front and/or back
// numbers. Answers { cap, low, high, limitedBy, reason, unchecked } or null.
export function edgesCap(front, back, settings) {
  const t = settings.edges;
  const capOf = (m, face, lenK, depthAdd) => {
    for (const row of t.grades) {
      const lim = row[face];
      if (m.lengthMm * lenK <= lim.lengthMm && m.depthMm + depthAdd <= lim.depthMm) return row.grade;
    }
    return t.floor;
  };
  const nickCap = (n) => (t.nickGrades || []).find(row => n <= row.nicks)?.grade ?? t.floor;
  const per = {};
  for (const [face, m] of [['front', front], ['back', back]]) {
    if (!m) continue;
    const wCap = capOf(m, face, 1, 0), nicks = m.nicks || 0, nCap = nickCap(nicks);
    per[face] = {
      cap: Math.min(wCap, nCap),
      high: Math.min(capOf(m, face, 1 - t.closeShare, -t.closeDepthMm), nCap),
      low: Math.min(capOf({ lengthMm: m.lengthMm + t.closeMinMm, depthMm: m.depthMm }, face, 1 + t.closeShare, t.closeDepthMm), nCap),
      lengthMm: m.lengthMm, depthMm: m.depthMm, wCap, nicks, nCap,
    };
  }
  const list = Object.entries(per);
  if (!list.length) return null;
  const cap = Math.min(...list.map(([, p]) => p.cap));
  const high = Math.min(...list.map(([, p]) => p.high));
  const low = Math.min(...list.map(([, p]) => p.low));
  const limiting = list.filter(([, p]) => p.cap === cap).map(([face, p]) => {
    const why = [];
    if (p.wCap === cap) why.push(p.lengthMm ? `${p.lengthMm} mm of whitening, up to ${p.depthMm} mm deep` : 'no whitening found');
    if (p.nicks && p.nCap === cap) why.push(`${p.nicks} nick${p.nicks > 1 ? 's' : ''}`);
    return `${face}: ${why.join(', ')}`;
  });
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
