const express = require('express');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'planner.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DB_DIR, 'backups');
const ARCHIVE_BACKUP_DIR = path.join(BACKUP_DIR, 'archives');
const LATEST_BACKUP_PATH = path.join(BACKUP_DIR, 'time-river-latest.json');
const PERSISTENT_DISK_ROOT = '/data';

ensureDir(DB_DIR);
ensureDir(BACKUP_DIR);
ensureDir(ARCHIVE_BACKUP_DIR);

const db = new DatabaseSync(DB_PATH, { timeout: 5000 });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS archives (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    d1_name TEXT NOT NULL,
    d2_name TEXT NOT NULL,
    entry_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_archives_created_at
  ON archives(created_at DESC);
`);

const scheduleRow = db.prepare('SELECT id FROM schedules WHERE id = ?').get('main');
if (!scheduleRow) {
  db.prepare('INSERT INTO schedules (id, data, updated_at) VALUES (?, ?, ?)')
    .run('main', JSON.stringify({}), Date.now());
}

const stmtGetSchedule = db.prepare('SELECT data, updated_at FROM schedules WHERE id = ?');
const stmtUpsertSchedule = db.prepare(`
  INSERT INTO schedules (id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

const stmtInsertArchive = db.prepare(`
  INSERT INTO archives (id, title, data, d1_name, d2_name, entry_count, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtListArchives = db.prepare(`
  SELECT id, title, d1_name, d2_name, entry_count, created_at
  FROM archives
  ORDER BY created_at DESC
`);

const stmtListArchivesWithData = db.prepare(`
  SELECT id, title, data, d1_name, d2_name, entry_count, created_at
  FROM archives
  ORDER BY created_at DESC
`);

const stmtGetArchive = db.prepare(`
  SELECT id, title, data, d1_name, d2_name, entry_count, created_at
  FROM archives
  WHERE id = ?
`);

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
    return { d1name: '', d2name: '', d1date: '', d2date: '', slots: {} };
  }

  const slots = payload.slots && typeof payload.slots === 'object' ? payload.slots : {};
  return {
    d1name: normalizeText(payload.d1name),
    d2name: normalizeText(payload.d2name),
    d1date: normalizeText(payload.d1date),
    d2date: normalizeText(payload.d2date),
    slots,
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

function getCurrentScheduleRecord() {
  const row = stmtGetSchedule.get('main');
  if (!row) {
    return { data: {}, updated_at: null };
  }

  return {
    data: safeJsonParse(row.data, {}),
    updated_at: row.updated_at,
  };
}

function getArchiveRecords() {
  return stmtListArchivesWithData.all().map((archive) => ({
    ...archive,
    data: safeJsonParse(archive.data, {}),
  }));
}

function exportSnapshot() {
  return {
    generated_at: Date.now(),
    persistence: {
      db_dir: DB_DIR,
      db_path: DB_PATH,
      backup_dir: BACKUP_DIR,
      using_render_disk: DB_DIR === PERSISTENT_DISK_ROOT || DB_DIR.startsWith(`${PERSISTENT_DISK_ROOT}/`),
    },
    schedule: getCurrentScheduleRecord(),
    archives: getArchiveRecords(),
  };
}

function writeJsonAtomically(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function writeLatestBackup() {
  writeJsonAtomically(LATEST_BACKUP_PATH, exportSnapshot());
}

function writeArchiveBackup(archiveRecord) {
  const createdAt = new Date(archiveRecord.created_at).toISOString().replace(/[:.]/g, '-');
  const fileName = `${createdAt}-${sanitizeFilePart(archiveRecord.title)}.json`;
  writeJsonAtomically(path.join(ARCHIVE_BACKUP_DIR, fileName), archiveRecord);
}

function logPersistenceMode() {
  const usesRenderDisk = DB_DIR === PERSISTENT_DISK_ROOT || DB_DIR.startsWith(`${PERSISTENT_DISK_ROOT}/`);

  if (process.env.NODE_ENV === 'production' && !usesRenderDisk) {
    console.warn(`[storage] Production is not using Render persistent disk. Current DB_DIR=${DB_DIR}`);
  }

  console.log(`[storage] DB: ${DB_PATH}`);
  console.log(`[storage] Backup snapshot: ${LATEST_BACKUP_PATH}`);
  console.log(`[storage] Persistent disk mode: ${usesRenderDisk ? 'enabled' : 'disabled'}`);
}

app.get('/api/schedule', (_req, res) => {
  res.json(getCurrentScheduleRecord());
});

app.post('/api/schedule', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const normalized = normalizeScheduleData(req.body);
  const now = Date.now();
  stmtUpsertSchedule.run('main', JSON.stringify(normalized), now);
  writeLatestBackup();
  res.json({ ok: true, updated_at: now });
});

app.get('/api/archives', (_req, res) => {
  res.json({ archives: stmtListArchives.all() });
});

app.get('/api/archives/:id', (req, res) => {
  const archive = stmtGetArchive.get(req.params.id);
  if (!archive) {
    res.status(404).json({ error: 'Archive not found' });
    return;
  }

  res.json({
    archive: {
      ...archive,
      data: safeJsonParse(archive.data, {}),
    },
  });
});

app.post('/api/archives', (req, res) => {
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

  stmtInsertArchive.run(
    id,
    title,
    JSON.stringify(data),
    meta.d1Name,
    meta.d2Name,
    meta.entryCount,
    createdAt,
  );

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
  writeLatestBackup();

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
});

app.get('/api/export', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=\"time-river-export.json\"');
  res.send(JSON.stringify(exportSnapshot(), null, 2));
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    db_path: DB_PATH,
    backup_path: LATEST_BACKUP_PATH,
  });
});

writeLatestBackup();

app.listen(PORT, () => {
  console.log(`Time River running on http://localhost:${PORT}`);
  logPersistenceMode();
});

function closeDatabaseAndExit() {
  db.close();
  process.exit(0);
}

process.on('SIGTERM', closeDatabaseAndExit);
process.on('SIGINT', closeDatabaseAndExit);
