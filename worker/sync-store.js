// Atomic save storage. Each authenticated namespace owns one SQLite Durable Object.
// PANDORA_KV remains a read-only source for old backups; it is never deleted here.
export const SYNC_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Token,X-Auth,X-OR-Key,X-Push-Sub,Range,If-Match',
  'Access-Control-Expose-Headers': 'Content-Range,Accept-Ranges,Content-Length,ETag,X-Pandora-Sync-Protocol',
};

const MAX_BODY_BYTES = 20_000_000;
const MAX_VERSIONS = 6;             // Includes the current version.
const MAX_HISTORY_BYTES = 40_000_000;
const CHUNK_CHARS = 128 * 1024;    // Safely below SQLite's row-size limit, including UTF-8.
const EMPTY_REVISION = 'missing';
const encoder = new TextEncoder();

function reply(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    ...SYNC_CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Pandora-Sync-Protocol': '2', ...headers,
  } });
}
function tag(revision) { return '"' + revision + '"'; }
function headTag(head) { return tag(head ? head.revision : EMPTY_REVISION); }
function validKey(key) { return typeof key === 'string' && key.length > 0 && key.length <= 128 && !/[\x00-\x1f]/.test(key); }
// The recovery picker can import only play saves into empty local slots. Never
// expose old connection settings, credentials, token counts, or arbitrary keys there.
function recoverablePlayKey(key) {
  return validKey(key) && /^(?:save:.+|slot[1-3]:.+|vn_slot_.+_[1-3])$/.test(key);
}
function row(cursor) { return [...cursor][0] || null; }

async function legacyKeys(env, ns) {
  const keys = new Set();
  let cursor;
  const seen = new Set();
  // A repeated/missing continuation cursor is an error, never a complete list.
  for (let page = 0; page < 100; page++) {
    const result = await env.PANDORA_KV.list({ prefix: ns + ':', limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const key of result.keys || []) keys.add(key.name.slice(ns.length + 1));
    if (result.list_complete !== false) return [...keys];
    if (!result.cursor || seen.has(result.cursor)) throw new Error('incomplete legacy list');
    cursor = result.cursor; seen.add(cursor);
  }
  throw new Error('legacy list exceeds safe page limit');
}

// Called only after the outer Worker authenticates and derives the namespace.
// No account token or passphrase is forwarded to the Durable Object.
export async function routeAtomicSync(req, env, ns) {
  const url = new URL(req.url);
  const capable = !!env.PANDORA_SYNC_STORE;
  if (url.pathname === '/sync/capabilities' && req.method === 'GET') {
    return reply({ protocol: 2, atomic: capable, history: capable,
      maxVersions: MAX_VERSIONS, maxHistoryBytes: MAX_HISTORY_BYTES, maxBodyBytes: MAX_BODY_BYTES });
  }
  if (!['/sync', '/sync/list', '/sync/versions'].includes(url.pathname)) return reply({ error: 'not found' }, 404);
  if (!capable) {
    // Safe rollout: old backups remain readable, but no check-then-KV-write path remains.
    if (req.method !== 'GET') return reply({ error: 'atomic sync storage is not deployed', code: 'sync_unavailable' }, 503);
    if (url.pathname === '/sync/versions' || url.searchParams.has('version')
        || (url.pathname === '/sync/list' && url.searchParams.get('history') === '1'))
      return reply({ error: 'version history is not deployed', code: 'sync_unavailable' }, 503);
    if (url.pathname === '/sync/list') {
      try { return reply({ keys: await legacyKeys(env, ns), list_complete: true }, 200, { 'X-Pandora-Sync-Protocol': '1' }); }
      catch { return reply({ error: 'backup list is incomplete' }, 503); }
    }
    const key = url.searchParams.get('key');
    if (!validKey(key)) return reply({ error: 'key required' }, 400);
    const value = await env.PANDORA_KV.get(ns + ':' + key);
    if (value === null) return reply({ error: 'not found' }, 404, { 'X-Pandora-Sync-Protocol': '1' });
    return new Response(value, { headers: { ...SYNC_CORS, 'Content-Type': 'application/json',
      'Cache-Control': 'no-store', 'X-Pandora-Sync-Protocol': '1' } });
  }
  const id = env.PANDORA_SYNC_STORE.idFromName('sync-v2:' + ns);
  const stub = env.PANDORA_SYNC_STORE.get(id);
  const headers = new Headers({ 'X-Pandora-Sync-Namespace': ns });
  for (const name of ['Content-Type', 'Content-Length', 'If-Match']) {
    const value = req.headers.get(name); if (value !== null) headers.set(name, value);
  }
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
  // Cloudflare accepts streaming Request bodies. duplex is needed by Node's test runtime.
  if (init.body) init.duplex = 'half';
  try { return await stub.fetch(new Request(req.url, init)); }
  catch { return reply({ error: 'backup storage is temporarily unavailable', code: 'sync_storage_error' }, 503); }
}

export class PandoraSyncStore {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.sql = ctx.storage.sql;
    // Synchronous setup completes before the first request can access these tables.
    this.sql.exec('CREATE TABLE IF NOT EXISTS heads (key TEXT PRIMARY KEY, revision TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL, bytes INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS versions (key TEXT NOT NULL, revision TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY (key, revision))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS versions_recent ON versions (key, updated DESC, revision DESC)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (key TEXT NOT NULL, revision TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (key, revision, part))');
  }

  head(key) { return row(this.sql.exec('SELECT * FROM heads WHERE key = ?', key)); }

  storeVersion(key, revision, body, updated, deleted, bytes) {
    this.sql.exec('INSERT INTO versions (key, revision, updated, deleted, bytes) VALUES (?, ?, ?, ?, ?)', key, revision, updated, deleted, bytes);
    if (!deleted) {
      for (let start = 0, part = 0; start < body.length; part++) {
        let end = Math.min(body.length, start + CHUNK_CHARS);
        // SQLite encodes each chunk separately. Do not cut an emoji's surrogate pair.
        const last = body.charCodeAt(end - 1);
        if (end < body.length && last >= 0xd800 && last <= 0xdbff) end--;
        this.sql.exec('INSERT INTO chunks (key, revision, part, body) VALUES (?, ?, ?, ?)', key, revision, part, body.slice(start, end));
        start = end;
      }
    }
    this.sql.exec('INSERT INTO heads (key, revision, updated, deleted, bytes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, updated = excluded.updated, deleted = excluded.deleted, bytes = excluded.bytes',
      key, revision, updated, deleted, bytes);
  }

  body(key, revision) {
    return [...this.sql.exec('SELECT body FROM chunks WHERE key = ? AND revision = ? ORDER BY part', key, revision)].map(part => part.body).join('');
  }

  async importLegacy(key, ns) {
    const existing = this.head(key);
    if (existing) return existing;
    // The network read occurs before the synchronous commit. A concurrent import/create
    // is rechecked inside the transaction and never overwritten by this stale result.
    const old = await this.env.PANDORA_KV.get(ns + ':' + key);
    if (old === null) return this.head(key);
    const revision = crypto.randomUUID(), bytes = encoder.encode(old).byteLength;
    return this.ctx.storage.transactionSync(() => {
      const current = this.head(key);
      if (current) return current;
      this.storeVersion(key, revision, old, Date.now(), 0, bytes);
      return this.head(key);
    });
  }

  prune(key) {
    let count = 0, bytes = 0;
    const versions = [...this.sql.exec('SELECT revision, bytes FROM versions WHERE key = ? ORDER BY updated DESC, revision DESC', key)];
    for (const version of versions) {
      count++; bytes += version.bytes;
      if (count <= MAX_VERSIONS && (count === 1 || bytes <= MAX_HISTORY_BYTES)) continue;
      this.sql.exec('DELETE FROM chunks WHERE key = ? AND revision = ?', key, version.revision);
      this.sql.exec('DELETE FROM versions WHERE key = ? AND revision = ?', key, version.revision);
    }
  }

  async fetch(req) {
    try { return await this.handle(req); }
    catch {
      // No request bodies, auth material, raw SQL errors or user data in error responses.
      return reply({ error: 'backup storage is temporarily unavailable', code: 'sync_storage_error' }, 503);
    }
  }

  async handle(req) {
    const url = new URL(req.url);
    const ns = req.headers.get('X-Pandora-Sync-Namespace');
    if (!ns) return reply({ error: 'namespace required' }, 401);
    if (url.pathname === '/sync/list') {
      if (req.method !== 'GET') return reply({ error: 'method' }, 405);
      const history = url.searchParams.get('history') === '1';
      const legacy = await legacyKeys(this.env, ns);
      const keys = new Set(history ? legacy.filter(recoverablePlayKey) : legacy);
      // Query only metadata. A history list neither loads bodies nor imports KV
      // records, and cannot revive a version already removed by retention.
      const retained = history ? new Set([...this.sql.exec('SELECT DISTINCT key FROM versions WHERE deleted = 0')]
        .map(v => v.key).filter(recoverablePlayKey)) : null;
      for (const current of this.sql.exec('SELECT key, deleted FROM heads')) {
        if (history) {
          if (retained.has(current.key)) keys.add(current.key); else keys.delete(current.key);
        } else if (current.deleted) keys.delete(current.key); else keys.add(current.key);
      }
      return reply({ keys: [...keys].sort(), list_complete: true, ...(history ? { history: true } : {}) });
    }
    if (!['/sync', '/sync/versions'].includes(url.pathname)) return reply({ error: 'not found' }, 404);
    const key = url.searchParams.get('key');
    if (!validKey(key)) return reply({ error: 'key required' }, 400);
    if (url.pathname === '/sync/versions' && req.method !== 'GET') return reply({ error: 'method' }, 405);
    if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return reply({ error: 'method' }, 405);
    if (req.method !== 'GET' && url.searchParams.has('version')) return reply({ error: 'historical versions are read only' }, 405);
    const initial = await this.importLegacy(key, ns);
    if (url.pathname === '/sync/versions') {
      const versions = [...this.sql.exec('SELECT revision, updated, deleted, bytes FROM versions WHERE key = ? ORDER BY updated DESC, revision DESC', key)]
        .map(v => ({ revision: v.revision, savedAt: v.updated, deleted: !!v.deleted, bytes: v.bytes, current: !!initial && initial.revision === v.revision }));
      return reply({ key, versions, maxVersions: MAX_VERSIONS }, 200, { ETag: headTag(initial) });
    }
    if (req.method === 'GET') {
      const version = url.searchParams.get('version');
      const current = version ? row(this.sql.exec('SELECT * FROM versions WHERE key = ? AND revision = ?', key, version)) : this.head(key);
      const headers = { ETag: headTag(current) };
      if (!current || current.deleted) return reply({ error: 'not found', deleted: !!current?.deleted }, 404, headers);
      return new Response(this.body(key, current.revision), { headers: { ...SYNC_CORS,
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Pandora-Sync-Protocol': '2', ...headers } });
    }
    const expected = req.headers.get('If-Match');
    if (!expected) return reply({ error: 'read the current revision before writing', code: 'revision_required' }, 428);
    // A specific version is mandatory. A wildcard would reintroduce blind overwrites.
    if (!/^"(?:missing|[a-f0-9-]{36})"$/.test(expected)) return reply({ error: 'a single exact revision is required', code: 'revision_required' }, 428);
    let body = '', bytes = 0;
    if (req.method === 'PUT') {
      const advertised = Number(req.headers.get('Content-Length'));
      if (Number.isFinite(advertised) && advertised > MAX_BODY_BYTES) return reply({ error: 'too large' }, 413);
      // Bound the stream while receiving it. Unknown Content-Length must not permit
      // an arbitrarily large body to exhaust Worker memory before the size check.
      const reader = req.body?.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true }), parts = [];
      try {
        if (reader) for (;;) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return reply({ error: 'too large' }, 413); }
          parts.push(decoder.decode(next.value, { stream: true }));
        }
        parts.push(decoder.decode()); body = parts.join('');
      } catch {
        try { await reader?.cancel(); } catch {}
        return reply({ error: 'invalid request body' }, 400);
      }
      try { JSON.parse(body); } catch { return reply({ error: 'bad json' }, 400); }
    }
    const revision = crypto.randomUUID();
    const deleted = req.method === 'DELETE' ? 1 : 0;
    // No await inside this transaction: revision check, body, head, and retained history
    // succeed together. Another device's request can never slip between check and write.
    return this.ctx.storage.transactionSync(() => {
      const current = this.head(key);
      if (expected !== headTag(current)) return reply({ error: 'backup changed on another device', code: 'revision_conflict' }, 412, { ETag: headTag(current) });
      if (current && current.deleted === deleted && (deleted || this.body(key, current.revision) === body))
        return reply({ ok: true, revision: current.revision, bytes: current.bytes, unchanged: true }, 200, { ETag: headTag(current) });
      const updated = Math.max(Date.now(), (current?.updated || 0) + 1);
      this.storeVersion(key, revision, body, updated, deleted, bytes);
      this.prune(key);
      return reply({ ok: true, revision, bytes }, 200, { ETag: tag(revision) });
    });
  }
}
