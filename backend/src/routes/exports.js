// routes/exports.js
// Temporary storage for exported card images, so images made on your PC can be
// opened on your phone and saved there:
//   POST   /api/exports          — upload images (field "images", optional "title")
//   GET    /api/exports          — list current exports
//   GET    /api/exports/:id/:n   — one image (n starts at 1)
//   DELETE /api/exports/:id      — delete an export now
//
// Files live in /tmp inside the backend container, not in the database. They
// are deleted after 24 hours, and a container restart clears them too — both
// are fine for something you only need until it's saved to your phone.

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const router = Router();
const ROOT = '/tmp/pokecard-exports';
const TTL_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f]{16}$/;
const N_RE = /^\d{1,3}$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 60, fileSize: 25 * 1024 * 1024 },
});

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, id, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

function purgeExpired() {
  if (!fs.existsSync(ROOT)) return;
  for (const id of fs.readdirSync(ROOT)) {
    if (!ID_RE.test(id)) continue;
    const meta = readMeta(id);
    const created = meta ? new Date(meta.created_at).getTime() : 0;
    if (!meta || Date.now() - created > TTL_MS) {
      fs.rmSync(path.join(ROOT, id), { recursive: true, force: true });
    }
  }
}

setInterval(purgeExpired, 60 * 60 * 1000).unref();

// ─── POST /api/exports ────────────────────────────────────────────────────────
router.post('/', upload.array('images'), (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No images uploaded' });

    purgeExpired();
    const id = crypto.randomBytes(8).toString('hex');
    const dir = path.join(ROOT, id);
    fs.mkdirSync(dir, { recursive: true });

    files.forEach((file, i) => {
      fs.writeFileSync(path.join(dir, `${i + 1}.png`), file.buffer);
    });
    const meta = {
      title: (req.body.title || 'Export').slice(0, 120),
      created_at: new Date().toISOString(),
      count: files.length,
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));

    res.status(201).json({ id, ...meta });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/exports ─────────────────────────────────────────────────────────
router.get('/', (_req, res, next) => {
  try {
    purgeExpired();
    const exportsList = [];
    if (fs.existsSync(ROOT)) {
      for (const id of fs.readdirSync(ROOT)) {
        if (!ID_RE.test(id)) continue;
        const meta = readMeta(id);
        if (!meta) continue;
        exportsList.push({
          id,
          ...meta,
          expires_at: new Date(new Date(meta.created_at).getTime() + TTL_MS).toISOString(),
        });
      }
    }
    exportsList.sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json(exportsList);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/exports/:id/:n ──────────────────────────────────────────────────
router.get('/:id/:n', (req, res) => {
  const { id, n } = req.params;
  if (!ID_RE.test(id) || !N_RE.test(n)) return res.status(404).json({ error: 'Not found' });
  const file = path.join(ROOT, id, `${parseInt(n, 10)}.png`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'private, max-age=3600');
  res.type('png').sendFile(file);
});

// ─── DELETE /api/exports/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(path.join(ROOT, id), { recursive: true, force: true });
  res.status(204).send();
});

export default router;
