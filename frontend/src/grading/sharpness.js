// grading/sharpness.js — Is the card in focus?
//
// Used by the live camera so the photo is only taken when the card is sharp.
// The card is cut out of the camera frame at up to 20 pixels per mm (the
// detail the straightened card keeps) and blurred once more on purpose: a
// sharp picture changes a lot when blurred, an already blurry one hardly at
// all. How much of the picture's pixel-to-pixel change survives the extra blur
// is the measure ("blur the blur", Crété-Roffet et al. 2007), so a busy holo
// and a plain energy card are judged the same way.

const MAX_PX_PER_MM = 20;

// The card's bounding box cut out of `source` (a <video>, canvas or bitmap)
// as grey levels, at up to MAX_PX_PER_MM. quad: corners in source pixels.
export function cardGrey(source, srcW, srcH, quad) {
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(srcW, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(srcH, Math.ceil(Math.max(...ys)));
  const sw = x1 - x0, sh = y1 - y0;
  if (sw < 40 || sh < 40) return null;
  // the card's long side is 88 mm; never blow the picture up
  const longSide = Math.max(sw, sh);
  const s = Math.min(1, (88 * MAX_PX_PER_MM) / longSide);
  const w = Math.round(sw * s), h = Math.round(sh * s);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, x0, y0, sw, sh, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const grey = new Float32Array(w * h);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4) grey[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { grey, w, h };
}

// One direction (dx, dy = 1, 0 across or 0, 1 down) over the middle 80% of
// the picture (its corners are background), every other row: the total
// pixel-to-pixel change, and how much of it is still there when the picture is
// blurred along that direction with a 9-pixel average.
function changeKept(g, w, h, dx, dy) {
  const R = 4;
  const step = dy * w + dx;
  const xa = Math.round(w * 0.1) + R + 1, xb = Math.round(w * 0.9) - R - 1;
  const ya = Math.round(h * 0.1) + R + 1, yb = Math.round(h * 0.9) - R - 1;
  let total = 0, kept = 0;
  for (let y = ya; y < yb; y += 2) {
    for (let x = xa; x < xb; x++) {
      const i = y * w + x;
      const d = Math.abs(g[i] - g[i - step]);
      // the 9-pixel averages at i and the pixel before differ by
      // (g[i + 4·step] - g[i - 5·step]) / 9
      const db = Math.abs(g[i + R * step] - g[i - (R + 1) * step]) / (2 * R + 1);
      total += d;
      kept += Math.min(d, db);
    }
  }
  return { total, kept };
}

// A straightened card (ImageData, 20 px per mm) as grey levels, without the
// `margin` pixels of background round it, for sharpnessOf: the photo as
// taken, which can be blurrier than the camera preview that passed (the full
// photo is focused and taken separately; seen on real checks: preview 0.52-
// 0.57, the photo 0.39-0.44).
export function imageGrey(image, margin = 0) {
  const { width: IW, data } = image;
  const w = IW - 2 * margin, h = image.height - 2 * margin;
  const grey = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = ((y + margin) * IW + x + margin) * 4;
      grey[y * w + x] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
  }
  return { grey, w, h };
}

// { score }: 1 = sharp, 0 = completely blurred (the share of the fine change
// that the extra blur takes away, in the worse of the two directions). On the
// sample photos: 0.62-0.81 as they are, 0.50-0.68 with a 0.05 mm blur added,
// 0.35-0.51 with 0.1 mm (2 pixels at 20 px/mm), 0.29-0.41 with 0.15 mm.
export function sharpnessOf({ grey, w, h }) {
  let score = 1;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const { total, kept } = changeKept(grey, w, h, dx, dy);
    if (total > 0) score = Math.min(score, 1 - kept / total);
  }
  return { score };
}
