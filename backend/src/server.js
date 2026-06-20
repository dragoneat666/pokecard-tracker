// server.js — Entry point for the backend

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import setsRouter    from './routes/sets.js';
import cardsRouter   from './routes/cards.js';
import pricesRouter  from './routes/prices.js';
import importRouter  from './routes/import.js';
import backupRouter, { startBackupSchedule } from './routes/backup.js';
import adminRouter from './routes/admin.js';

import { startPriceSync } from './jobs/priceSync.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// Allow all origins — this is a private homelab app, not exposed to the internet.
// This means you can open it from your phone, PC, or any device on your network.
app.use(cors());
app.use(express.json());

// Request logger — visible in Dozzle
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method}  ${req.url}`);
  next();
});

// Serve downloaded set logos as static files
app.use('/logos', express.static('/app/logos'));

app.use('/api/sets',   setsRouter);
app.use('/api/cards',  cardsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/import', importRouter);
app.use('/api/backup', backupRouter);
app.use('/api/admin', adminRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  startPriceSync();
  startBackupSchedule();
});
