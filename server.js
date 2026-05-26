const express = require('express');
const { randomUUID } = require('node:crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_DATABASE_URL = 'postgresql://neondb_owner:npg_uVg3BOxW1ADy@ep-shy-leaf-aqzssdvw-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const DATA_DIR = path.join(__dirname, 'data');
const LOCAL_DATA_PATH = process.env.LOCAL_DATA_PATH || path.join(DATA_DIR, 'local-store.json');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const ARCHIVE_BACKUP_DIR = path.join(BACKUP_DIR, 'archives');
const LATEST_BACKUP_PATH = path.join(BACKUP_DIR, 'time-river-latest.json');

ensureDir(DATA_DIR);
ensureDir(path.dirname(LOCAL_DATA_PATH));
ensureDir(BACKUP_DIR);
ensureDir(ARCHIVE_BACKUP_DIR);

const storageDriver = DATABASE_URL ? 'postgres' : 'file';
let storageReady = false;
let storageInitPromise = null;
let storageInitError = null;
const pool = DATABASE_URL
  ? new Pool(buildDatabaseConfig(DATABASE_URL))
  : null;

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

function buildDatabaseConfig(rawDatabaseUrl) {
  const url = new URL(rawDatabaseUrl);
  const sslMode = url.searchParams.get('sslmode');
  const channelBinding = url.searchParams.get('channel_binding');

  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');

  return {
    connectionString: url.toString(),
    ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined,
    enableChannelBinding: channelBinding === 'require',
  };
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

function defaultLocalStore() {
  return {
    schedule: {
      data: {},
      updated_at: null,
    },
    archives: [],
  };
}

function readLocalStore() {
  if (!fs.existsSync(LOCAL_DATA_PATH)) {
    return defaultLocalStore();
  }

  const raw = fs.readFileSync(LOCAL_DATA_PATH, 'utf8');
  const parsed = safeJsonParse(raw, defaultLocalStore());
  return {
    schedule: {
      data: parsed.schedule && typeof parsed.schedule === 'object' ? parsed.schedule.data || {} : {},
      updated_at: parsed.schedule && typeof parsed.schedule === 'object' ? Number(parsed.schedule.updated_at) || null : null,
    },
    archives: Array.isArray(parsed.archives) ? parsed.archives : [],
  };
}

function writeLocalStore(store) {
  writeJsonAtomically(LOCAL_DATA_PATH, store);
}

async function queryOne(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

async function queryAll(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function initializeStorage() {
  if (storageDriver === 'postgres') {
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
    return;
  }

  if (!fs.existsSync(LOCAL_DATA_PATH)) {
    writeLocalStore(defaultLocalStore());
  }
}

function kickOffStorageInitialization() {
  if (storageReady) {
    return Promise.resolve();
  }

  if (!storageInitPromise) {
    storageInitPromise = (async () => {
      await initializeStorage();
      await writeLatestBackup();
      storageReady = true;
      storageInitError = null;
    })().catch((error) => {
      storageReady = false;
      storageInitError = error;
      storageInitPromise = null;
      throw error;
    });
  }

  return storageInitPromise;
}

async function ensureStorageReady() {
  if (storageReady) return;
  await kickOffStorageInitialization();
}

async function getCurrentScheduleRecord() {
  if (storageDriver === 'postgres') {
    const row = await queryOne('SELECT data, updated_at FROM schedules WHERE id = $1', ['main']);
    if (!row) {
      return { data: {}, updated_at: null };
    }

    return {
      data: typeof row.data === 'object' && row.data ? row.data : safeJsonParse(row.data, {}),
      updated_at: Number(row.updated_at) || null,
    };
  }

  const store = readLocalStore();
  return {
    data: store.schedule.data || {},
    updated_at: store.schedule.updated_at,
  };
}

async function saveScheduleRecord(data, updatedAt) {
  if (storageDriver === 'postgres') {
    await pool.query(`
      INSERT INTO schedules (id, data, updated_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at
    `, ['main', JSON.stringify(data), updatedAt]);
    return;
  }

  const store = readLocalStore();
  store.schedule = {
    data,
    updated_at: updatedAt,
  };
  writeLocalStore(store);
}

async function getArchiveRecords() {
  if (storageDriver === 'postgres') {
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

  const store = readLocalStore();
  return [...store.archives].sort((left, right) => Number(right.created_at) - Number(left.created_at));
}

async function getArchiveRecordById(id) {
  if (storageDriver === 'postgres') {
    const archive = await queryOne(`
      SELECT id, title, data, d1_name, d2_name, entry_count, created_at
      FROM archives
      WHERE id = $1
    `, [id]);

    if (!archive) return null;

    return {
      ...archive,
      data: typeof archive.data === 'object' && archive.data ? archive.data : safeJsonParse(archive.data, {}),
      entry_count: Number(archive.entry_count),
      created_at: Number(archive.created_at),
    };
  }

  const store = readLocalStore();
  return store.archives.find((archive) => archive.id === id) || null;
}

async function insertArchiveRecord(archiveRecord) {
  if (storageDriver === 'postgres') {
    await pool.query(`
      INSERT INTO archives (id, title, data, d1_name, d2_name, entry_count, created_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
    `, [
      archiveRecord.id,
      archiveRecord.title,
      JSON.stringify(archiveRecord.data),
      archiveRecord.d1_name,
      archiveRecord.d2_name,
      archiveRecord.entry_count,
      archiveRecord.created_at,
    ]);
    return;
  }

  const store = readLocalStore();
  store.archives.unshift(archiveRecord);
  writeLocalStore(store);
}

async function checkStorageHealth() {
  if (storageDriver === 'postgres') {
    await pool.query('SELECT 1');
    return;
  }

  readLocalStore();
}

async function exportSnapshot() {
  return {
    generated_at: Date.now(),
    persistence: {
      driver: storageDriver,
      database_url_configured: Boolean(DATABASE_URL),
      local_data_path: storageDriver === 'file' ? LOCAL_DATA_PATH : null,
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
  console.log(`[storage] Driver: ${storageDriver}`);
  console.log(`[storage] Backup snapshot: ${LATEST_BACKUP_PATH}`);
  console.log(`[storage] DATABASE_URL configured: ${DATABASE_URL ? 'yes' : 'no'}`);
  if (storageDriver === 'file') {
    console.warn(`[storage] Falling back to local file storage at ${LOCAL_DATA_PATH}`);
  }
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get('/api/schedule', asyncHandler(async (_req, res) => {
  await ensureStorageReady();
  res.json(await getCurrentScheduleRecord());
}));

app.post('/api/schedule', asyncHandler(async (req, res) => {
  await ensureStorageReady();
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const normalized = normalizeScheduleData(req.body);
  const now = Date.now();
  await saveScheduleRecord(normalized, now);
  await writeLatestBackup();
  res.json({ ok: true, updated_at: now });
}));

app.get('/api/archives', asyncHandler(async (_req, res) => {
  await ensureStorageReady();
  const archives = await getArchiveRecords();
  res.json({
    archives: archives.map((archive) => ({
      id: archive.id,
      title: archive.title,
      d1_name: archive.d1_name,
      d2_name: archive.d2_name,
      entry_count: Number(archive.entry_count),
      created_at: Number(archive.created_at),
    })),
  });
}));

app.get('/api/archives/:id', asyncHandler(async (req, res) => {
  await ensureStorageReady();
  const archive = await getArchiveRecordById(req.params.id);

  if (!archive) {
    res.status(404).json({ error: 'Archive not found' });
    return;
  }

  res.json({
    archive: {
      ...archive,
      entry_count: Number(archive.entry_count),
      created_at: Number(archive.created_at),
    },
  });
}));

app.post('/api/archives', asyncHandler(async (req, res) => {
  await ensureStorageReady();
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

  const archiveRecord = {
    id,
    title,
    data,
    d1_name: meta.d1Name,
    d2_name: meta.d2Name,
    entry_count: meta.entryCount,
    created_at: createdAt,
  };

  await insertArchiveRecord(archiveRecord);
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
  await ensureStorageReady();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="time-river-export.json"');
  res.send(JSON.stringify(await exportSnapshot(), null, 2));
}));

app.get('/health', asyncHandler(async (_req, res) => {
  if (storageReady) {
    await checkStorageHealth();
  }

  res.json({
    status: storageReady ? 'ok' : (storageInitError ? 'degraded' : 'starting'),
    driver: storageDriver,
    database_url_configured: Boolean(DATABASE_URL),
    storage_ready: storageReady,
    storage_error: storageInitError ? storageInitError.message : null,
    backup_path: LATEST_BACKUP_PATH,
  });
}));

app.use((error, _req, res, _next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

function startServer() {
  kickOffStorageInitialization().catch((error) => {
    console.error('Storage init failed after startup:', error);
  });

  app.listen(PORT, () => {
    console.log(`Time River running on http://localhost:${PORT}`);
    logPersistenceMode();
  });
}

async function closeStorageAndExit() {
  try {
    if (pool) {
      await pool.end();
    }
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => {
  closeStorageAndExit();
});

process.on('SIGINT', () => {
  closeStorageAndExit();
});

try {
  startServer();
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}
