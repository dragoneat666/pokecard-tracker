// grading/vision.js — Photo in, straightened card out
//
// The page side of public/grading/cv-worker.js (which does the OpenCV work in
// a background thread). Steps:
//   1. loadPhoto()      a File / Blob / URL -> an ImageBitmap (phone photos are
//                       turned the right way up by the browser on decode)
//   2. findCard()       find the card's 4 corners, first roughly in a small
//                       copy (fast), then exactly in a bigger copy
//   3. straighten()     warp the card flat to CARD_W x CARD_H
//
// Sizes are fixed so the same photo always gives the same result: the work
// copies are always 1000 / 2000 / up to 4096 px on the long side, however big
// the photo is.

import { GRADING_DEFAULTS } from './config.js';

const DETECT_SIDE = 1000;   // rough outline search
const REFINE_SIDE = 2000;   // exact edges
const WARP_SIDE = 4096;     // the photo copy the card is cut out of

export const CARD_W = GRADING_DEFAULTS.image.width;    // 63 mm
export const CARD_H = GRADING_DEFAULTS.image.height;   // 88 mm

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker('/grading/cv-worker.js');
  worker.onmessage = (e) => {
    const { id, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The image worker stopped'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(type, payload = {}, transfer = []) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...payload }, transfer);
  });
}

// Starts loading OpenCV (~10 MB the first time) so it's ready when needed.
export function warmUp() {
  return call('init');
}

export async function loadPhoto(source) {
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not load ${source} (${res.status})`);
    source = await res.blob();
  }
  const bitmap = await createImageBitmap(source);
  // Nothing uses more than WARP_SIDE pixels, and a 50-megapixel photo held in
  // full would take ~200 MB of the phone's memory: keep a smaller copy.
  const long = Math.max(bitmap.width, bitmap.height);
  if (long <= WARP_SIDE) return bitmap;
  const s = WARP_SIDE / long;
  const smaller = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * s), resizeHeight: Math.round(bitmap.height * s), resizeQuality: 'high',
  });
  bitmap.close();
  return smaller;
}

// The photo (or part of it) scaled so its long side is at most maxSide.
export function pixelsOf(bitmap, maxSide, crop = null) {
  const sw = crop ? crop.w : bitmap.width, sh = crop ? crop.h : bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  else ctx.drawImage(bitmap, 0, 0, w, h);
  // The real scale on each axis (w and h were rounded to whole pixels).
  return { data: ctx.getImageData(0, 0, w, h), sx: w / sw, sy: h / sh };
}

// Corners from one copy of the photo to another of a different size. Pixel
// (0, 0) is the middle of the first pixel, so the first pixel's outer edge is
// at -0.5; scaling is about that edge, not about the first pixel's middle.
// (Half a pixel sounds like nothing, but every step of shrinking and growing
// added one, and on the card it showed up as a border a pixel too wide on one
// side and too narrow on the other.)
const toCopy = (quad, c) => quad.map(([x, y]) => [(x + 0.5) * c.sx - 0.5, (y + 0.5) * c.sy - 0.5]);
const fromCopy = (quad, c) => quad.map(([x, y]) => [(x + 0.5) / c.sx - 0.5, (y + 0.5) / c.sy - 0.5]);

// Finds the card. Answers { quad, score, strategy } with corners in the
// photo's own pixels, or { quad: null } when no card-shaped outline was found
// (the page then asks for the corners to be placed by hand). cutOff: the
// card runs off the edge of the photo (only its frame was found).
export async function findCard(bitmap, { debug = false } = {}) {
  const small = pixelsOf(bitmap, DETECT_SIDE);
  const found = await call('detect', { image: small.data, debug }, [small.data.data.buffer]);
  // debug: every outline looked at, with its score (or why it was turned down)
  const candidates = found.candidates?.map(c => ({ ...c, quad: fromCopy(c.quad, small) }));
  if (!found.quad) return { quad: null, cutOff: !!found.cutOff, candidates };
  const rough = fromCopy(found.quad, small);
  const { quad, bendMm } = await refineEdges(bitmap, rough);
  return { quad, rough, bendMm, score: found.score, strategy: found.strategy, candidates };
}

// Moves rough corners (photo pixels) onto the card's exact edges.
export async function refineCorners(bitmap, quad) {
  return (await refineEdges(bitmap, quad)).quad;
}

// The same, plus how far each side bows away from straight, in mm (top,
// right, bottom, left as the corners go; null where a side's edge was too
// broken up to tell). A bent card throws the centering off.
export async function refineEdges(bitmap, quad) {
  const big = pixelsOf(bitmap, REFINE_SIDE);
  const { quad: refined, bendMm } = await call('refine', { image: big.data, quad: toCopy(quad, big) }, [big.data.data.buffer]);
  return { quad: fromCopy(refined, big), bendMm };
}

// The biggest bend of any side, or null when none could be measured.
export const worstBend = (bendMm) => {
  const known = (bendMm || []).filter(v => v !== null && v !== undefined);
  return known.length ? Math.max(...known) : null;
};

// How much detail the photo has of the card: pixels per mm along the card's
// long sides. The straightened card uses GRADING_DEFAULTS.image.pxPerMm (20);
// a photo with less is blown up to fit, which looks soft.
export function detailOf(quad) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sides = [d(quad[0], quad[1]), d(quad[1], quad[2]), d(quad[2], quad[3]), d(quad[3], quad[0])];
  const long = (sides[0] + sides[2] > sides[1] + sides[3]) ? (sides[0] + sides[2]) / 2 : (sides[1] + sides[3]) / 2;
  return long / 88;
}

// The card cut out and flattened to CARD_W x CARD_H, as ImageData. margin:
// pixels of the photo kept all round the card (the edges check needs to see
// where the card stops), making the picture 2 x margin bigger each way.
export async function straighten(bitmap, quad, { margin = 0 } = {}) {
  const src = pixelsOf(bitmap, WARP_SIDE);
  const { image } = await call('warp', {
    image: src.data, quad: toCopy(quad, src), width: CARD_W, height: CARD_H, margin,
  }, [src.data.data.buffer]);
  return image;
}

// Half a turn, for a card photographed upside down: the same corners, starting
// from the opposite one.
export function turnQuad(quad) {
  return [quad[2], quad[3], quad[0], quad[1]];
}

// A quick outline check on a small frame (live camera view). Corners come back
// in the frame's pixels.
export async function detectInFrame(imageData) {
  return call('detect', { image: imageData }, [imageData.data.buffer]);
}

// ImageData -> JPEG Blob (for saving, and for showing as an <img>).
export async function toJpeg(imageData, quality = 0.9, maxSide = null) {
  let w = imageData.width, h = imageData.height;
  const full = new OffscreenCanvas(w, h);
  full.getContext('2d').putImageData(imageData, 0, 0);
  if (!maxSide || Math.max(w, h) <= maxSide) return full.convertToBlob({ type: 'image/jpeg', quality });
  const s = maxSide / Math.max(w, h);
  w = Math.round(w * s); h = Math.round(h * s);
  const small = new OffscreenCanvas(w, h);
  const ctx = small.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, w, h);
  return small.convertToBlob({ type: 'image/jpeg', quality });
}

// A picture that is already just the card, straight (a scan): stretched to
// CARD_W x CARD_H, nothing else done.
export function cardFromScan(bitmap) {
  const canvas = new OffscreenCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, CARD_W, CARD_H);
  return ctx.getImageData(0, 0, CARD_W, CARD_H);
}
