// routes/backup.js
//
// Handles database backup and restore operations:
//   POST /api/backup/run        — trigger a backup now
//   GET  /api/backup/list       — list available backups
//   GET  /api/backup/download/:filename — download a backup file
//   POST /api/backup/restore    — restore from a SQL dump

import { Router } from 'express';
import { exec }   from 'child_process';
import { promisify } from 'util';
import fs   from 'fs';
import path from 'path';
import multer from 'multer';

const router   = Router();
const execAsync = promisify(exec);
const BACKUP_DIR = '/app/backups';

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Multer for restore file upload — store in temp location
const upload = multer({ dest: '/tmp/pokecard-restore/' });

// ── Helper: format file size ──────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Helper: run a backup ──────────────────────────────────────────────────────
async function runBackup() {
  const date    = new Date().toISOString().split('T')[0];
  const sqlFile = path.join(BACKUP_DIR, `backup_${date}.sql`);
  const csvFile = path.join(BACKUP_DIR, `collection_${date}.csv`);

  const { DB_USER, DB_NAME, DB_PASSWORD, DB_HOST } = process.env;

  // SQL dump
  await execAsync(
    `PGPASSWORD="${DB_PASSWORD}" pg_dump -h ${DB_HOST} -U ${DB_USER} ${DB_NAME} > ${sqlFile}`
  );

  // Collection CSV
  const csvQuery = `COPY (
    SELECT
      s.name AS set_name,
      c.card_number,
      c.name AS card_name,
      c.owned AS regular_owned,
      COALESCE(rh.owned, 0) AS reverse_holo_owned
    FROM cards c
    JOIN sets s ON s.id = c.set_id
    LEFT JOIN reverse_holos rh ON rh.card_id = c.id
    ORDER BY s.release_date DESC NULLS LAST,
      (REGEXP_REPLACE(c.card_number, '[^0-9]', '', 'g'))::INTEGER ASC NULLS LAST
  ) TO STDOUT WITH CSV HEADER`;

  await execAsync(
    `PGPASSWORD="${DB_PASSWORD}" psql -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -c "${csvQuery}" > ${csvFile}`
  );

  // Cleanup files older than 30 days
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(BACKUP_DIR);
  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      console.log(`🗑️  Deleted old backup: ${file}`);
    }
  }

  console.log(`✅ Backup complete: ${sqlFile}`);
  return { sqlFile: path.basename(sqlFile), csvFile: path.basename(csvFile), date };
}

// ── POST /api/backup/run ──────────────────────────────────────────────────────
router.post('/run', async (_req, res, next) => {
  try {
    console.log('🔄 Manual backup triggered');
    const result = await runBackup();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/backup/list ──────────────────────────────────────────────────────
router.get('/list', (_req, res, next) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json({ backups: [] });
    }

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql') || f.endsWith('.csv'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          size:     formatSize(stat.size),
          date:     stat.mtime.toISOString(),
          type:     f.endsWith('.sql') ? 'sql' : 'csv',
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ backups: files });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/backup/download/:filename ───────────────────────────────────────
router.get('/download/:filename', (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename); // sanitize
    const filePath = path.join(BACKUP_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, filename);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/backup/restore ──────────────────────────────────────────────────
router.post('/restore', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.file.originalname.endsWith('.sql')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Only .sql files are supported for restore' });
    }

    console.log('⚠️  Database restore triggered');
    const { DB_USER, DB_NAME, DB_PASSWORD, DB_HOST } = process.env;

    // Drop and recreate the database, then restore
    await execAsync(
      `PGPASSWORD="${DB_PASSWORD}" psql -h ${DB_HOST} -U ${DB_USER} -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME}; CREATE DATABASE ${DB_NAME};"`
    );

    await execAsync(
      `PGPASSWORD="${DB_PASSWORD}" psql -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} < ${req.file.path}`
    );

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    console.log('✅ Database restore complete');
    res.json({ success: true, message: 'Database restored successfully' });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(err);
  }
});

// ── Scheduled nightly backup at 2AM ──────────────────────────────────────────
export function startBackupSchedule() {
  import('node-cron').then(({ default: cron }) => {
    cron.schedule('0 2 * * *', async () => {
      console.log('🕑 Scheduled nightly backup starting...');
      try {
        await runBackup();
      } catch (err) {
        console.error('Nightly backup failed:', err.message);
      }
    });
    console.log('⏰ Nightly backup scheduled for 2:00 AM daily');
  });
}

export default router;
