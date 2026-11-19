// routes/gradingTests.js — Test photos sent from the Grading page
//
//   POST /api/grading/test-photos   multipart: "photo" (the photo exactly as
//                                   the phone took it) + "meta" (JSON text:
//                                   camera, outline found, corners used,
//                                   measurements, app version)
//
// For tuning the photo steps on real phone photos while the grading tool is
// being built: each one is kept as a pair of files, <time>-<side>.jpg and
// .json, in the logos volume under grading-tests/. Nothing reads them back;
// they're looked at by hand. Saved copies of cards (with their own storage)
// come later and are separate from this.

import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.GRADING_TESTS_DIR || '/app/logos/grading-tests';
const MAX_PHOTO = 40 * 1024 * 1024;          // a 50-megapixel phone photo is ~15-25 MB
const MAX_FOLDER = 3 * 1024 * 1024 * 1024;   // stop taking more past 3 GB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_PHOTO, fieldSize: 256 * 1024 },
}).single('photo');

// The picture's real type from its first bytes (not the name it came with).
function typeOf(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function folderBytes() {
  try {
    return fs.readdirSync(DIR).reduce((sum, f) => sum + fs.statSync(path.join(DIR, f)).size, 0);
  } catch {
    return 0;
  }
}

const router = Router();

router.post('/test-photos', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is bigger than 40 MB' : `Upload failed: ${err.message}` });
    }
    if (!req.file) return res.status(400).json({ error: 'No photo was sent' });
    const ext = typeOf(req.file.buffer);
    if (!ext) return res.status(400).json({ error: 'That isn\'t a JPEG, PNG or WebP picture' });
    let meta = {};
    try { meta = JSON.parse(req.body.meta || '{}'); } catch { return res.status(400).json({ error: 'The details sent with the photo aren\'t valid JSON' }); }

    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (folderBytes() + req.file.size > MAX_FOLDER) {
        return res.status(507).json({ error: 'The test photo folder is full (3 GB). Ask for the old ones to be cleared out.' });
      }
      const side = meta.side === 'back' ? 'back' : 'front';
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const name = `${stamp}-${side}-${crypto.randomBytes(3).toString('hex')}`;
      fs.writeFileSync(path.join(DIR, `${name}.${ext}`), req.file.buffer);
      fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify({
        receivedAt: new Date().toISOString(), photoBytes: req.file.size, ...meta,
      }, null, 2));
      res.json({ ok: true, name });
    } catch (e) {
      res.status(500).json({ error: `Couldn't save the photo: ${e.message}` });
    }
  });
});

export default router;
