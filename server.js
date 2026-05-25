const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据库路径：本地开发用 ./data，Render 上挂载到 /data
const DB_DIR  = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'planner.db');

// 确保目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ─── 初始化数据库 ──────────────────────────────────────
const db = new DatabaseSync(DB_PATH, { timeout: 5000 });

db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id          TEXT    PRIMARY KEY,
    data        TEXT    NOT NULL,
    updated_at  INTEGER NOT NULL
  )
`);

// 预置一条空记录，避免首次加载返回 null
const existing = db.prepare('SELECT id FROM schedules WHERE id = ?').get('main');
if (!existing) {
  db.prepare('INSERT INTO schedules (id, data, updated_at) VALUES (?, ?, ?)')
    .run('main', JSON.stringify({}), Date.now());
}

// ─── 预编译语句 ────────────────────────────────────────
const stmtGet  = db.prepare('SELECT data, updated_at FROM schedules WHERE id = ?');
const stmtUpsert = db.prepare(`
  INSERT INTO schedules (id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    data       = excluded.data,
    updated_at = excluded.updated_at
`);

// ─── 中间件 ────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ───────────────────────────────────────────────

// 获取日程数据
app.get('/api/schedule', (req, res) => {
  const row = stmtGet.get('main');
  if (!row) return res.json({ data: null, updated_at: null });
  res.json({
    data: JSON.parse(row.data),
    updated_at: row.updated_at,
  });
});

// 保存日程数据（整体替换）
app.post('/api/schedule', (req, res) => {
  const payload = req.body;
  if (typeof payload !== 'object' || payload === null) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const now = Date.now();
  stmtUpsert.run('main', JSON.stringify(payload), now);
  res.json({ ok: true, updated_at: now });
});

// 健康检查（Render 会探测）
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── 启动 ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Daily Planner running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});
