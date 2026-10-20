// utils/renderCardSheets.js — Draws card lists as shareable PNG images
//
// Each "sheet" is a tall PNG, 1080px wide with 3 cards across, sized to read
// well on a phone: card picture, "Name, 4/102", the set name, and small
// colored tags (owned / need, or a price). Long lists are split into several
// sheets with a "Page 1 of 3" header.
//
// Cards are plain objects so this works for any kind of export:
//   { id, name, number, setName, dim, tags: [{ text, tone }] }
// where tone is 'good' (green), 'bad' (red), 'muted' (gray) or 'price'.
// Pictures load through the backend (api.images) so the canvas stays
// exportable — see routes/images.js.

import { api } from '../api.js';

const SHEET_W = 1080;
const PAD = 28;
const GAP = 18;
const COLS = 3;
const CELL_W = Math.floor((SHEET_W - PAD * 2 - GAP * (COLS - 1)) / COLS);
const IMG_H = Math.round(CELL_W * 1.4);
const TEXT_H = 146;
const CELL_H = IMG_H + TEXT_H;
const ROW_GAP = 22;
const HEADER_H = 104;

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

const TONES = {
  good:  { bg: '#dff5e6', fg: '#14703a' },
  bad:   { bg: '#fde2e2', fg: '#b42323' },
  muted: { bg: '#ececf1', fg: '#555566' },
  price: { bg: '#e6edff', fg: '#1c3fa8' },
};

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shrinks the font until the text fits, then falls back to an ellipsis.
function fitText(ctx, text, maxWidth, startPx, minPx, weight) {
  let size = startPx;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && size > minPx) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
  return cut + '…';
}

async function loadImage(cardId) {
  try {
    const blob = await api.images.cardBlob(cardId, 400);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  }
}

function drawCell(ctx, card, image, x, y) {
  // Picture, scaled to fit inside the cell
  if (image) {
    const scale = Math.min(CELL_W / image.width, IMG_H / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.save();
    if (card.dim) ctx.globalAlpha = 0.35;
    ctx.drawImage(image, x + (CELL_W - w) / 2, y + (IMG_H - h) / 2, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = '#ececf1';
    roundedRect(ctx, x, y, CELL_W, IMG_H, 14);
    ctx.fill();
    ctx.fillStyle = '#888899';
    ctx.font = `600 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('No image', x + CELL_W / 2, y + IMG_H / 2);
    ctx.textAlign = 'left';
  }

  // "Charizard, 4/102"
  const heading = card.number ? `${card.name}, ${card.number}` : card.name;
  ctx.fillStyle = '#14141f';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, heading, CELL_W, 34, 22, 700), x, y + IMG_H + 42);

  // Set name
  ctx.fillStyle = '#5a5a6e';
  ctx.fillText(fitText(ctx, card.setName || '', CELL_W, 28, 18, 500), x, y + IMG_H + 78);

  // Tags
  let tagX = x;
  const tagY = y + IMG_H + 94;
  for (const tag of card.tags || []) {
    const tone = TONES[tag.tone] || TONES.muted;
    ctx.font = `700 24px ${FONT}`;
    const w = ctx.measureText(tag.text).width + 24;
    if (tagX + w > x + CELL_W) break;
    ctx.fillStyle = tone.bg;
    roundedRect(ctx, tagX, tagY, w, 40, 20);
    ctx.fill();
    ctx.fillStyle = tone.fg;
    ctx.fillText(tag.text, tagX + 12, tagY + 29);
    tagX += w + 8;
  }
}

async function renderSheet(cards, title, pageNum, pageCount, totalCards) {
  const rows = Math.ceil(cards.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = HEADER_H + rows * CELL_H + (rows - 1) * ROW_GAP + PAD;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header
  ctx.fillStyle = '#14141f';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText(fitText(ctx, title, SHEET_W - PAD * 2 - 220, 44, 26, 800), PAD, 62);
  ctx.fillStyle = '#5a5a6e';
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(pageCount > 1 ? `Page ${pageNum} of ${pageCount}` : `${totalCards} cards`, SHEET_W - PAD, 62);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e1e1ea';
  ctx.fillRect(PAD, 82, SHEET_W - PAD * 2, 2);

  // Load this sheet's pictures (a few at a time), then draw
  const images = new Array(cards.length).fill(null);
  const CONCURRENCY = 6;
  for (let i = 0; i < cards.length; i += CONCURRENCY) {
    const chunk = cards.slice(i, i + CONCURRENCY);
    const loaded = await Promise.all(chunk.map(c => loadImage(c.id)));
    loaded.forEach((img, j) => { images[i + j] = img; });
  }

  cards.forEach((card, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CELL_W + GAP);
    const y = HEADER_H + row * (CELL_H + ROW_GAP);
    drawCell(ctx, card, images[i], x, y);
  });
  images.forEach(img => img?.close?.());

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// Returns an array of PNG Blobs, one per sheet.
export async function renderCardSheets(cards, { title, perImage = 12, onProgress } = {}) {
  const pageCount = Math.max(1, Math.ceil(cards.length / perImage));
  const blobs = [];
  for (let p = 0; p < pageCount; p++) {
    onProgress?.(p + 1, pageCount);
    const slice = cards.slice(p * perImage, (p + 1) * perImage);
    blobs.push(await renderSheet(slice, title || 'Cards', p + 1, pageCount, cards.length));
  }
  return blobs;
}
