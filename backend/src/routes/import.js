// routes/import.js
//
// Handles Excel import:
//   POST /api/import   — accepts an uploaded .xlsx file, parses it,
//                        creates sets and cards from the data
//
// We'll flesh this out fully in the import step of the build.
// For now it's a placeholder so server.js doesn't crash on startup.

import { Router } from 'express';
const router = Router();

router.post('/', async (_req, res) => {
  res.status(501).json({
    message: 'Import endpoint coming soon — will be built in the import step'
  });
});

export default router;
