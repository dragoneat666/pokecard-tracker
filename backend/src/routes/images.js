// routes/images.js
// Card picture relay:
//   GET /api/images/card/:id?size=400   — card image, served from our own origin
//
// WHY: the card image CDN doesn't send CORS headers, so a browser can't draw
// its images onto a canvas and export the result (the canvas becomes
// "tainted"). The export builder needs exactly that, so it loads pictures
// through here instead. The URL is always looked up from the card's saved
// image_url — never taken from the request — so this can't be pointed at
// arbitrary hosts.

import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/card/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT image_url FROM cards WHERE id = $1', [req.params.id]);
    const saved = rows[0]?.image_url;
    if (!saved || !/^https?:\/\//.test(saved)) {
      return res.status(404).json({ error: 'No image for this card' });
    }

    // Saved URLs are the small _200w thumbnail; the CDN also serves _400w.
    const size = req.query.size === '200' ? '200w' : '400w';
    const wanted = saved.replace(/_\d+w(\.\w+)$/, `_${size}$1`);

    let upstream = await fetch(wanted);
    if (!upstream.ok && wanted !== saved) upstream = await fetch(saved);
    if (!upstream.ok) return res.status(502).json({ error: 'Image fetch failed' });

    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    next(err);
  }
});

export default router;
