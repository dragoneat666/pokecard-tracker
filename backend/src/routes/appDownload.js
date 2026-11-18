// routes/appDownload.js — The Android app: download page and version check
//
//   GET /download                       a page to open on the phone's browser
//                                       (http://<server>:14000/download, the
//                                       website passes it on, or :14001) with
//                                       an install button
//   GET /download/pokecard-tracker.apk  the app itself
//   GET /api/app/latest                 { versionCode, versionName } of the
//                                       app on the server, so the installed
//                                       app can say "update available"
//
// The app is built and signed on the server (build-app.ps1 in the stack
// folder), which leaves pokecard-tracker.apk and version.json in the folder
// mounted at APK_DIR. Without that folder the page just says there's no app yet.

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const APK_DIR = process.env.APK_DIR || '/app/apk';
const APK_NAME = 'pokecard-tracker.apk';

function apkInfo() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(APK_DIR, 'version.json'), 'utf8'));
    if (!fs.existsSync(path.join(APK_DIR, APK_NAME))) return null;
    return { versionCode: Number(info.versionCode) || 0, versionName: String(info.versionName || '') };
  } catch {
    return null;
  }
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const router = Router();

router.get('/download', (req, res) => {
  const info = apkInfo();
  // The backend's address on the address this page was opened with (the
  // page can also come through the website on port 14000).
  const server = escapeHtml(`http://${req.hostname}:14001`);
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PokeCard Tracker app</title>
<style>
  body { font-family: system-ui, sans-serif; background: #12131a; color: #e8e8f0; margin: 0; padding: 24px; line-height: 1.5; }
  main { max-width: 480px; margin: 0 auto; }
  h1 { font-size: 1.4rem; }
  .btn { display: inline-block; background: #5b6aff; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 700; }
  li { margin-bottom: 6px; }
  .muted { color: #9a9ab0; }
</style></head>
<body><main>
<h1>⚡ PokeCard Tracker for Android</h1>
${info ? `<p>Version ${escapeHtml(info.versionName)}</p>
<p><a class="btn" href="download/${APK_NAME}">Download the app</a></p>
<ol>
  <li>Tap the button, then open the downloaded file.</li>
  <li>If Android asks, allow installing apps from this browser.</li>
  <li>The first time the app opens, type in the server's address: <b>${server}</b></li>
</ol>
<p class="muted">The app needs NetBird connected, like the website.</p>`
    : '<p>No app has been built yet.</p>'}
</main></body></html>`);
});

router.get(`/download/${APK_NAME}`, (_req, res) => {
  const file = path.join(APK_DIR, APK_NAME);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No app has been built yet' });
  res.type('application/vnd.android.package-archive').download(file, APK_NAME);
});

router.get('/api/app/latest', (_req, res) => res.json(apkInfo() || {}));

export default router;
