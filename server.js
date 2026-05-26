const express = require('express');
const { randomUUID } = require('node:crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'data', 'backups');
const ARCHIVE_BACKUP_DIR = path.join(BACKUP_DIR, 'archives');
const LATEST_BACKUP_PATH = path.join(BACKUP_DIR, 'time-river-latest.json');

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Please configure your Neon PostgreSQL connection string.');
}

ensureDir(BACKUP_DIR);
ensureDir(ARCHIVE_BACKUP_DIR);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDir(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeScheduleData(payload) {
  if (!payload || typeof payload !== 'object') {
    return { d1name: '', d2name: '', d1date: '', d2date: '', slots: {}, merges: { d1: {}, d2: {} } };
  }

  const slots = payload.slots && typeof payload.slots === 'object' ? payload.slots : {};
  const merges = payload.merges && typeof payload.merges === 'object' ? payload.merges : {};
  return {
    d1name: normalizeText(payload.d1name),
    d2name: normalizeText(payload.d2name),
    d1date: normalizeText(payload.d1date),
    d2date: normalizeText(payload.d2date),
    slots,
    merges: {
      d1: merges.d1 && typeof merges.d1 === 'object' ? merges.d1 : {},
      d2: merges.d2 && typeof merges.d2 === 'object' ? merges.d2 : {},
    },
  };
}

function archiveMetadata(data) {
  let entryCount = 0;

  Object.values(data.slots || {}).forEach((slot) => {
    if (slot && typeof slot === 'object') {
      if (normalizeText(slot.d1).trim()) entryCount += 1;
      if (normalizeText(slot.d2).trim()) entryCount += 1;
    }
  });

  return {
    d1Name: data.d1name.trim() || '第一天',
    d2Name: data.d2name.trim() || '第二天',
    entryCount,
  };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeFilePart(value) {
  return normalizeText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'archive';
}

async function queryOne(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

async function queryAll(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      data JSONB NOT NULL,
      d1_name TEXT NOT NULL,
      d2_name TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_archives_created_at
    ON archives(created_at DESC);
  `);

  await pool.query(`
    INSERT INTO schedules (id, data, updated_at)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (id) DO NOTHING;
  `, ['main', JSON.stringify({}), Date.now()]);
}

async function getCurrentScheduleRecord() {
  const row = await queryOne('SELECT data, updated_at FROM schedules WHERE id = $1', ['main']);
  if (!row) {
    return { data: {}, updated_at: null };
  }

  return {
    data: typeof row.data === 'object' && row.data ? row.data : safeJsonParse(row.data, {}),
    updated_at: Number(row.updated_at) || null,
  };
}

async function getArchiveRecords() {
  const rows = await queryAll(`
    SELECT id, title, data, d1_name, d2_name, entry_count, created_at
    FROM archives
    ORDER BY created_at DESC
  `);

  return rows.map((archive) => ({
    ...archive,
    data: typeof archive.data === 'object' && archive.data ? archive.data : safeJsonParse(archive.data, {}),
    entry_count: Number(archive.entry_count),
    created_at: Number(archive.created_at),
  }));
}

async function exportSnapshot() {
  return {
    generated_at: Date.now(),
    persistence: {
      driver: 'postgres',
      database_url_configured: Boolean(DATABASE_URL),
      backup_dir: BACKUP_DIR,
    },
    schedule: await getCurrentScheduleRecord(),
    archives: await getArchiveRecords(),
  };
}

function writeJsonAtomically(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

async function writeLatestBackup() {
  writeJsonAtomically(LATEST_BACKUP_PATH, await exportSnapshot());
}

function writeArchiveBackup(archiveRecord) {
  const createdAt = new Date(archiveRecord.created_at).toISOString().replace(/[:.]/g, '-');
  const fileName = `${createdAt}-${sanitizeFilePart(archiveRecord.title)}.json`;
  writeJsonAtomically(path.join(ARCHIVE_BACKUP_DIR, fileName), archiveRecord);
}

function logPersistenceMode() {
  console.log('[storage] Driver: postgres');
  console.log(`[storage] Backup snapshot: ${LATEST_BACKUP_PATH}`);
  console.log(`[storage] DATABASE_URL configured: ${DATABASE_URL ? 'yes' : 'no'}`);
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get('/api/schedule', asyncHandler(async (_req, res) => {
  res.json(await getCurrentScheduleRecord());
}));

app.post('/api/schedule', asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const normalized = normalizeScheduleData(req.body);
  const now = Date.now();
  await pool.query(`
    INSERT INTO schedules (id, data, updated_at)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (id) DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = EXCLUDED.updated_at
  `, ['main', JSON.stringify(normalized), now]);
  await writeLatestBackup();
  res.json({ ok: true, updated_at: now });
}));

app.get('/api/archives', asyncHandler(async (_req, res) => {
  const rows = await queryAll(`
    SELECT id, title, d1_name, d2_name, entry_count, created_at
    FROM archives
    ORDER BY created_at DESC
  `);

  res.json({
    archives: rows.map((archive) => ({
      ...archive,
      entry_count: Number(archive.entry_count),
      created_at: Number(archive.created_at),
    })),
  });
}));

app.get('/api/archives/:id', asyncHandler(async (req, res) => {
  const archive = await queryOne(`
    SELECT id, title, data, d1_name, d2_name, entry_count, created_at
    FROM archives
    WHERE id = $1
  `, [req.params.id]);

  if (!archive) {
    res.status(404).json({ error: 'Archive not found' });
    return;
  }

  res.json({
    archive: {
      ...archive,
      data: typeof archive.data === 'object' && archive.data ? archive.data : safeJsonParse(archive.data, {}),
      entry_count: Number(archive.entry_count),
      created_at: Number(archive.created_at),
    },
  });
}));

app.post('/api/archives', asyncHandler(async (req, res) => {
  const title = normalizeText(req.body && req.body.title).trim();
  if (!title) {
    res.status(400).json({ error: 'Archive title is required' });
    return;
  }

  if (title.length > 60) {
    res.status(400).json({ error: 'Archive title is too long' });
    return;
  }

  const data = normalizeScheduleData(req.body && req.body.data);
  const createdAt = Date.now();
  const id = randomUUID();
  const meta = archiveMetadata(data);

  await pool.query(`
    INSERT INTO archives (id, title, data, d1_name, d2_name, entry_count, created_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
  `, [
    id,
    title,
    JSON.stringify(data),
    meta.d1Name,
    meta.d2Name,
    meta.entryCount,
    createdAt,
  ]);

  const archiveRecord = {
    id,
    title,
    data,
    d1_name: meta.d1Name,
    d2_name: meta.d2Name,
    entry_count: meta.entryCount,
    created_at: createdAt,
  };

  writeArchiveBackup(archiveRecord);
  await writeLatestBackup();

  res.status(201).json({
    ok: true,
    archive: {
      id,
      title,
      d1_name: meta.d1Name,
      d2_name: meta.d2Name,
      entry_count: meta.entryCount,
      created_at: createdAt,
    },
  });
}));

app.get('/api/export', asyncHandler(async (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="time-river-export.json"');
  res.send(JSON.stringify(await exportSnapshot(), null, 2));
}));

app.get('/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({
    status: 'ok',
    driver: 'postgres',
    backup_path: LATEST_BACKUP_PATH,
  });
}));

app.use((error, _req, res, _next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  await initializeDatabase();
  await writeLatestBackup();
  app.listen(PORT, () => {
    console.log(`Time River running on http://localhost:${PORT}`);
    logPersistenceMode();
  });
}

async function closeDatabaseAndExit() {
  try {
    await pool.end();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => {
  closeDatabaseAndExit();
});

process.on('SIGINT', () => {
  closeDatabaseAndExit();
});

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
