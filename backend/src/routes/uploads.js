// routes/uploads.js
// Pictures sent as a file, for the picture fields that are part of a form you
// save afterwards (set logo and symbol, checklist logo):
//   POST /api/uploads/picture   — store one picture, answer with its URL
//
// The URL goes into the form's URL box like a pasted link; saving the form
// keeps it as it is, because it's already a picture stored on our server. Files
// are named by their content, so uploading the same picture twice stores it
// once. A picture uploaded but never saved stays in /logos/uploads/.

import { Router } from 'express';
import { saveUploadedImage } from '../utils/imageDownload.js';
import { acceptPicture } from '../utils/pictureUpload.js';

const router = Router();

// ─── POST /api/uploads/picture ───────────────────────────────────────────────
// Multipart form: picture (the file). Answers { url }.
router.post('/picture', acceptPicture, (req, res) => {
  try {
    res.status(201).json({ url: saveUploadedImage(req.file.buffer, 'uploads', 'upload') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
