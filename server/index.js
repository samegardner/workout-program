import http from 'node:http';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || './weights.db';
const PORT = Number(process.env.PORT) || 3001;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS weights (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const qAll = db.prepare('SELECT key, value FROM weights');
const qUpsert = db.prepare(
  'INSERT INTO weights (key, value, updated_at) VALUES (?, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
);
const qDelete = db.prepare('DELETE FROM weights WHERE key = ?');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, extraHeaders = {}) {
  const headers = { ...CORS_HEADERS, ...extraHeaders };
  if (typeof body === 'object' && body !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limit) { req.destroy(); reject(new Error('payload too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') return send(res, 200, 'ok');

  if (url.pathname === '/weights' && req.method === 'GET') {
    const rows = qAll.all();
    const obj = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return send(res, 200, obj);
  }

  const match = url.pathname.match(/^\/weights\/(.+)$/);
  if (match) {
    const key = decodeURIComponent(match[1]);
    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (typeof parsed.value !== 'string' || parsed.value.length > 64) {
          return send(res, 400, { error: 'value must be string <=64 chars' });
        }
        qUpsert.run(key, parsed.value, Date.now());
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (req.method === 'DELETE') {
      qDelete.run(key);
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`workout-program-api listening on :${PORT} (db: ${DB_PATH})`);
});
