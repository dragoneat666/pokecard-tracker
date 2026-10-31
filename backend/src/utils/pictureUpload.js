// utils/pictureUpload.js — Receive one picture file from a multipart form
//
// Used by every route that takes a picture as a file (a scan) instead of a
// link. The file is kept in memory (it's checked and written to the logos
// folder right away by saveUploadedImage); one over the limit is refused
// before it's all read.

import multer from 'multer';
import { MAX_UPLOAD_BYTES } from './imageDownload.js';

const single = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
}).single('picture');

// Express middleware: the form field "picture" ends up in req.file, the other
// fields in req.body. A failed upload is answered with a 400 here.
export function acceptPicture(req, res, next) {
  single(req, res, err => {
    if (!err) {
      if (!req.file) return res.status(400).json({ error: 'No picture was sent' });
      return next();
    }
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(400).json({ error: tooBig ? 'That picture is bigger than 10 MB' : `Upload failed: ${err.message}` });
  });
}
