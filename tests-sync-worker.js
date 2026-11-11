'use strict';
// Executes the actual Worker + Durable Object code with real SQLite transactions.
// No network, account, API key, Cloudflare resource, or user backup is used.
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { webcrypto, createHmac } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const deferred = () => {
  let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve };
};
const tests = [];
const test = (name, run) => tests.push({ name, run });
let PandoraSyncStore, routeAtomicSync, worker;

function harness(initial = {}) {
  const legacy = new Map(Object.entries(initial)), objects = new Map(), kvWrites = [];
  let getHook = null, listHook = null, sqlHook = null;
  const kv = {
    async get(key) {
      if (getHook) { const handled = await getHook(key); if (handled !== undefined) return handled; }
      return legacy.get(key) ?? null;
    },
    async list(options) {
      if (listHook) { const handled = await listHook(options); if (handled !== undefined) return handled; }
      const keys = [...legacy.keys()].filter(k => k.startsWith(options.prefix)).sort();
      const start = Number(options.cursor || 0), count = options.limit || 1000;
      return { keys: keys.slice(start, start + count).map(name => ({ name })),
        list_complete: start + count >= keys.length, cursor: String(start + count) };
    },
    async put(...args) { kvWrites.push(['put', ...args]); throw new Error('test forbids legacy writes'); },
    async delete(...args) { kvWrites.push(['delete', ...args]); throw new Error('test forbids legacy deletion'); },
  };
  const env = { PANDORA_KV: kv, AUTH_SECRET: 'test-only-worker-secret' };
  const createObject = id => {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(statement, ...bindings) {
      if (sqlHook) sqlHook(statement, bindings);
      const prepared = db.prepare(statement);
      if (prepared.columns().length) return prepared.all(...bindings);
      prepared.run(...bindings); return [];
    } };
    const ctx = { storage: { sql, transactionSync(callback) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    } } };
    const object = new PandoraSyncStore(ctx, env);
    return { object, db, fetch: request => object.fetch(request) };
  };
  env.PANDORA_SYNC_STORE = {
    idFromName: name => name,
    get(id) { if (!objects.has(id)) objects.set(id, createObject(id)); return objects.get(id); }
  };
  const request = (method, key, body, etag, extra = {}) => {
    const url = 'https://fixture.invalid/sync?key=' + encodeURIComponent(key) + (extra.version ? '&version=' + encodeURIComponent(extra.version) : '');
    const headers = { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}), ...(extra.headers || {}) };
    const init = { method, headers };
    if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); if (body instanceof ReadableStream) { init.body = body; init.duplex = 'half'; } }
    return new Request(url, init);
  };
  const send = (method, key = 'save:library', body, etag, extra) => routeAtomicSync(request(method, key, body, etag, extra), env, 'fixture-user');
  const endpoint = pathname => routeAtomicSync(new Request('https://fixture.invalid' + pathname), env, 'fixture-user');
  return { env, legacy, objects, kvWrites, request, send, endpoint,
    setGetHook: fn => { getHook = fn; }, setListHook: fn => { listHook = fn; }, setSqlHook: fn => { sqlHook = fn; },
    close() { for (const { db } of objects.values()) db.close(); }
  };
}
async function etagOf(h, key = 'save:library') { return (await h.send('GET', key)).headers.get('ETag'); }
async function put(h, value, key = 'save:library') { return h.send('PUT', key, value, await etagOf(h, key)); }

test('capabilities accurately distinguishes deployed atomic storage from read-only legacy mode', async () => {
  const h = harness();
  assert.deepEqual(await (await h.endpoint('/sync/capabilities')).json(), {
    protocol: 2, atomic: true, history: true, maxVersions: 6, maxHistoryBytes: 40_000_000, maxBodyBytes: 20_000_000
  });
  delete h.env.PANDORA_SYNC_STORE;
  const cap = await (await h.endpoint('/sync/capabilities')).json();
  assert.equal(cap.atomic, false); assert.equal(cap.history, false);
  h.close();
});

test('missing binding allows legacy reads but never blind PUT or DELETE', async () => {
  const h = harness({ 'fixture-user:save:library': '{"turnCount":9}' });
  delete h.env.PANDORA_SYNC_STORE;
  const read = await h.send('GET'); assert.equal(read.status, 200);
  assert.equal(read.headers.get('X-Pandora-Sync-Protocol'), '1'); assert.equal(read.headers.get('ETag'), null);
  assert.deepEqual(await read.json(), { turnCount: 9 });
  assert.equal((await h.send('PUT', 'save:library', { turnCount: 10 }, '"missing"')).status, 503);
  assert.equal((await h.send('DELETE', 'save:library', undefined, '"missing"')).status, 503);
  assert.equal((await h.endpoint('/sync/versions?key=save%3Alibrary')).status, 503);
  assert.equal((await h.endpoint('/sync/list?history=1')).status, 503);
  assert.deepEqual(h.kvWrites, []); h.close();
});

test('legacy JSON migrates byte-for-byte once; original KV stays untouched', async () => {
  const raw = '{ "turnCount": 9, "location": "서고", "note": "약속 유지" }';
  const h = harness({ 'fixture-user:save:library': raw });
  const a = await h.send('GET'), tag = a.headers.get('ETag');
  assert.equal(await a.text(), raw); assert.match(tag, /^"[a-f0-9-]{36}"$/);
  assert.equal((await h.send('GET')).headers.get('ETag'), tag);
  assert.equal(h.legacy.get('fixture-user:save:library'), raw); assert.deepEqual(h.kvWrites, []); h.close();
});

test('two concurrent creates from missing revision have exactly one winner', async () => {
  const h = harness(), before = await etagOf(h);
  assert.equal(before, '"missing"');
  const results = await Promise.all([h.send('PUT', 'save:library', { turnCount: 1 }, before), h.send('PUT', 'save:library', { turnCount: 2 }, before)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 412]);
  const winner = results.findIndex(r => r.status === 200);
  assert.equal((await (await h.send('GET')).json()).turnCount, winner + 1); h.close();
});

test('two devices updating the same revision cannot silently overwrite one another', async () => {
  const h = harness({ 'fixture-user:save:library': '{"turnCount":7}' }), before = await etagOf(h);
  const results = await Promise.all([h.send('PUT', 'save:library', { turnCount: 8 }, before), h.send('PUT', 'save:library', { turnCount: 9 }, before)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 412]);
  const versions = (await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json()).versions;
  assert.equal(versions.length, 2); assert.equal(versions.filter(v => v.current).length, 1); h.close();
});

test('a write while another request is still receiving its body is caught at commit', async () => {
  const h = harness(); await put(h, { turnCount: 1 }); const before = await etagOf(h);
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  const slow = h.send('PUT', 'save:library', body, before);
  const fast = await h.send('PUT', 'save:library', { turnCount: 3 }, before);
  assert.equal(fast.status, 200);
  controller.enqueue(new TextEncoder().encode('{"turnCount":2}')); controller.close();
  assert.equal((await slow).status, 412);
  assert.equal((await (await h.send('GET')).json()).turnCount, 3); h.close();
});

test('a delayed legacy migration cannot overwrite a newer authoritative save', async () => {
  const h = harness({ 'fixture-user:save:library': '{"turnCount":1}' }), gate = deferred();
  let reads = 0;
  h.setGetHook(async key => { if (key.endsWith(':save:library') && ++reads === 1) { await gate.promise; return '{"turnCount":1}'; } });
  const delayed = h.send('GET');
  const first = await h.send('GET');
  assert.equal((await h.send('PUT', 'save:library', { turnCount: 4 }, first.headers.get('ETag'))).status, 200);
  gate.resolve(); assert.equal((await (await delayed).json()).turnCount, 4); h.close();
});

test('unconditional writes, wildcard and weak validators are refused', async () => {
  const h = harness();
  for (const value of [undefined, '*', 'W/"missing"', '"missing", "other"', 'not-a-tag'])
    assert.equal((await h.send('PUT', 'save:library', { turnCount: 1 }, value)).status, 428);
  assert.equal((await h.send('GET')).status, 404); h.close();
});

test('a stale revision remains rejected even if the content is identical (no blind retry)', async () => {
  const h = harness(); const old = await etagOf(h); await h.send('PUT', 'save:library', { a: 1 }, old);
  assert.equal((await h.send('PUT', 'save:library', { a: 1 }, old)).status, 412); h.close();
});

test('saving unchanged content with the current validator does not churn versions', async () => {
  const h = harness(); await put(h, { a: 1 }); const before = await etagOf(h);
  const unchanged = await h.send('PUT', 'save:library', { a: 1 }, before);
  assert.equal((await unchanged.json()).unchanged, true); assert.equal(unchanged.headers.get('ETag'), before);
  assert.equal((await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json()).versions.length, 1); h.close();
});

test('history retains six revisions and never changes the active save when read', async () => {
  const h = harness(); const tags = [];
  for (let i = 1; i <= 9; i++) tags.push((await put(h, { turnCount: i })).headers.get('ETag'));
  const history = await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json();
  assert.equal(history.versions.length, 6); assert.equal(history.versions[0].current, true);
  assert.equal((await h.send('GET', 'save:library', undefined, undefined, { version: tags[0].slice(1, -1) })).status, 404);
  const old = await h.send('GET', 'save:library', undefined, undefined, { version: tags[4].slice(1, -1) });
  assert.equal((await old.json()).turnCount, 5); assert.equal((await (await h.send('GET')).json()).turnCount, 9);
  assert.equal((await h.send('PUT', 'save:library', { turnCount: 5 }, tags[8], { version: tags[4].slice(1, -1) })).status, 405); h.close();
});

test('delete creates a recoverable tombstone; stale pre-delete writes cannot resurrect it', async () => {
  const h = harness({ 'fixture-user:save:library': '{"turnCount":7}' }); const original = await etagOf(h);
  const deletion = await h.send('DELETE', 'save:library', undefined, original); assert.equal(deletion.status, 200);
  const missing = await h.send('GET'); assert.equal(missing.status, 404); assert.notEqual(missing.headers.get('ETag'), '"missing"');
  assert.equal((await h.send('PUT', 'save:library', { turnCount: 8 }, original)).status, 412);
  const restoreSource = await h.send('GET', 'save:library', undefined, undefined, { version: original.slice(1, -1) });
  assert.equal((await restoreSource.json()).turnCount, 7);
  assert.deepEqual((await (await h.endpoint('/sync/list')).json()).keys, []);
  assert.equal(h.legacy.get('fixture-user:save:library'), '{"turnCount":7}'); h.close();
});

test('a new save after deletion must use the tombstone revision', async () => {
  const h = harness(); await put(h, { a: 1 }); await h.send('DELETE', 'save:library', undefined, await etagOf(h));
  assert.equal((await h.send('PUT', 'save:library', { a: 2 }, '"missing"')).status, 412);
  const missing = await etagOf(h); assert.equal((await h.send('PUT', 'save:library', { a: 2 }, missing)).status, 200); h.close();
});

test('history key list includes deleted saves with retained content without changing normal list', async () => {
  const h = harness(); await put(h, { turnCount: 7 }); const original = await etagOf(h);
  assert.equal((await h.send('DELETE', 'save:library', undefined, original)).status, 200);
  assert.deepEqual((await (await h.endpoint('/sync/list')).json()).keys, []);
  assert.deepEqual(await (await h.endpoint('/sync/list?history=1')).json(), {
    keys: ['save:library'], list_complete: true, history: true
  });
  assert.equal((await h.send('GET')).status, 404);
  assert.equal((await (await h.send('GET', 'save:library', undefined, undefined, { version: original.slice(1, -1) })).json()).turnCount, 7);
  h.close();
});

test('history key list omits empty tombstones that have no recoverable saved content', async () => {
  const h = harness();
  assert.equal((await h.send('DELETE', 'save:never-saved', undefined, '"missing"')).status, 200);
  assert.deepEqual((await (await h.endpoint('/sync/list?history=1')).json()).keys, []); h.close();
});

test('history key list allowlists play-save keys without reading credential-like legacy bodies', async () => {
  const initial = {};
  const expected = ['save:old', 'slot1:old', 'slot2:old', 'slot3:old', 'vn_slot_story_1'];
  for (const key of [...expected, 'cfg', 'stories', 'uploads', 'tokens:fixture-user', 'endings:old', 'auth:token', 'arbitrary', 'slot4:old', 'save:', 'vn_slot_story_4'])
    initial['fixture-user:' + key] = '{"fixture":"not read by listing"}';
  const h = harness(initial); let reads = 0;
  h.setGetHook(() => { reads++; throw new Error('listing must not fetch record bodies'); });
  assert.deepEqual((await (await h.endpoint('/sync/list?history=1')).json()).keys, expected.sort());
  assert.equal(reads, 0);
  assert.equal((await (await h.endpoint('/sync/list')).json()).keys.length, Object.keys(initial).length);
  h.close();
});

test('history key list includes only the authenticated namespace, including deleted records', async () => {
  const h = harness({ 'fixture-user:save:own-legacy': '{}', 'other-user:save:other-legacy': '{}' });
  await put(h, { turnCount: 4 }, 'save:own-deleted');
  await h.send('DELETE', 'save:own-deleted', undefined, await etagOf(h, 'save:own-deleted'));
  const otherRequest = new Request('https://fixture.invalid/sync/list?history=1');
  const theirs = await routeAtomicSync(otherRequest, h.env, 'other-user');
  assert.deepEqual((await theirs.json()).keys, ['save:other-legacy']);
  assert.deepEqual((await (await h.endpoint('/sync/list?history=1')).json()).keys, ['save:own-deleted', 'save:own-legacy']);
  h.close();
});

test('history key listing does not restore pruned versions or change the current revision', async () => {
  const h = harness({ 'fixture-user:save:library': '{"turnCount":0}' }); const imported = await etagOf(h);
  for (let i = 1; i <= 8; i++) await put(h, { turnCount: i });
  const current = await etagOf(h);
  for (let i = 0; i < 3; i++) assert.deepEqual((await (await h.endpoint('/sync/list?history=1')).json()).keys, ['save:library']);
  assert.equal(await etagOf(h), current);
  assert.equal((await h.send('GET', 'save:library', undefined, undefined, { version: imported.slice(1, -1) })).status, 404);
  assert.equal((await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json()).versions.length, 6);
  assert.equal(h.legacy.get('fixture-user:save:library'), '{"turnCount":0}'); h.close();
});

test('history key list is read only', async () => {
  const h = harness();
  const req = new Request('https://fixture.invalid/sync/list?history=1', { method: 'POST', body: '{}' });
  assert.equal((await routeAtomicSync(req, h.env, 'fixture-user')).status, 405);
  assert.deepEqual(h.kvWrites, []); h.close();
});

test('write failure rolls back new chunks, revision and history together', async () => {
  const h = harness(); await put(h, { a: 1 }); const before = await etagOf(h);
  h.setSqlHook((sql, args) => { if (sql.startsWith('INSERT INTO chunks') && args[2] === 1) throw new Error('simulated disk full'); });
  const failed = await h.send('PUT', 'save:library', { text: '가'.repeat(160_000) }, before);
  assert.equal(failed.status, 503); assert.equal((await failed.json()).code, 'sync_storage_error');
  assert.equal(await etagOf(h), before); assert.deepEqual(await (await h.send('GET')).json(), { a: 1 });
  assert.equal((await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json()).versions.length, 1); h.close();
});

test('chunked non-ASCII saves survive exact round-trip and prior version reads', async () => {
  const h = harness(); const raw = JSON.stringify({ text: '가나다🙂\n'.repeat(60_000), turnCount: 17 });
  const saved = await h.send('PUT', 'save:library', raw, await etagOf(h)); assert.equal(saved.status, 200);
  assert.equal((await saved.json()).bytes, new TextEncoder().encode(raw).byteLength);
  const revision = saved.headers.get('ETag').slice(1, -1); assert.equal(await (await h.send('GET')).text(), raw);
  await put(h, { turnCount: 18 }); assert.equal(await (await h.send('GET', 'save:library', undefined, undefined, { version: revision })).text(), raw); h.close();
});

test('history metadata never contains body or credentials', async () => {
  const h = harness(); await put(h, { story: 'PRIVATE_FIXTURE_BODY', secret: 'FIXTURE_NOT_A_REAL_KEY' });
  const json = await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json();
  assert.equal(JSON.stringify(json).includes('PRIVATE_FIXTURE_BODY'), false);
  assert.equal(JSON.stringify(json).includes('FIXTURE_NOT_A_REAL_KEY'), false);
  assert.deepEqual(Object.keys(json.versions[0]).sort(), ['bytes', 'current', 'deleted', 'revision', 'savedAt']); h.close();
});

test('an emoji exactly across a chunk boundary is not replaced during SQLite encoding', async () => {
  const h = harness();
  // JSON's opening quote consumes one UTF-16 code unit; emoji starts at 131071.
  const raw = JSON.stringify('x'.repeat(131070) + '🙂끝');
  assert.equal((await h.send('PUT', 'save:library', raw, await etagOf(h))).status, 200);
  assert.equal(await (await h.send('GET')).text(), raw); h.close();
});

test('namespace isolation holds for current reads, history, and writes', async () => {
  const h = harness(); await put(h, { player: 'A' });
  const req = h.request('GET', 'save:library'); const other = await routeAtomicSync(req, h.env, 'other-user');
  assert.equal(other.status, 404);
  const otherWrite = await routeAtomicSync(h.request('PUT', 'save:library', { player: 'B' }, other.headers.get('ETag')), h.env, 'other-user');
  assert.equal(otherWrite.status, 200); assert.equal((await (await h.send('GET')).json()).player, 'A'); h.close();
});

test('complete legacy listing follows all cursors and includes new authoritative keys', async () => {
  const initial = {}; for (let i = 0; i < 1002; i++) initial['fixture-user:save:' + i] = '{}';
  const h = harness(initial); await put(h, { a: 1 }, 'save:new');
  const list = await (await h.endpoint('/sync/list')).json(); assert.equal(list.keys.length, 1003); assert.equal(list.list_complete, true); h.close();
});

test('a looping KV cursor is an error rather than a misleading complete backup list', async () => {
  const h = harness(); h.setListHook(() => ({ keys: [], list_complete: false, cursor: 'same' }));
  assert.equal((await h.endpoint('/sync/list')).status, 503); h.close();
});

test('invalid JSON, keys, methods and oversized content never alter an existing save', async () => {
  const h = harness(); await put(h, { a: 1 }); const before = await etagOf(h);
  assert.equal((await h.send('PUT', 'save:library', '{bad', before)).status, 400);
  assert.equal((await h.send('PUT', 'save:library', '{}', before, { headers: { 'Content-Length': '20000001' } })).status, 413);
  assert.equal((await h.send('GET', 'x'.repeat(129))).status, 400);
  assert.equal((await h.send('GET', 'bad\nkey')).status, 400);
  assert.equal((await h.send('POST', 'save:library', '{}', before)).status, 405);
  assert.equal(await etagOf(h), before); h.close();
});

test('UTF-8 byte limit applies even when character count is below the old limit', async () => {
  const h = harness(); const body = JSON.stringify('가'.repeat(6_666_667));
  assert(body.length < 20_000_000);
  assert.equal((await h.send('PUT', 'save:library', body, '"missing"')).status, 413);
  assert.equal((await h.send('GET')).status, 404); h.close();
});

test('oversized streaming input is cancelled before it is fully consumed', async () => {
  const h = harness(); let pulls = 0, cancelled = false;
  const body = new ReadableStream({ pull(controller) {
    pulls++; controller.enqueue(new Uint8Array(10_000_001));
    if (pulls > 5) controller.close();
  }, cancel() { cancelled = true; } });
  const result = await h.send('PUT', 'save:library', body, '"missing"');
  assert.equal(result.status, 413); assert.equal(cancelled, true); assert(pulls < 5);
  assert.equal((await h.send('GET')).status, 404); h.close();
});

test('malformed UTF-8 fails without changing the saved revision', async () => {
  const h = harness(); await put(h, { a: 1 }); const before = await etagOf(h);
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xff, 0xfe])); c.close(); } });
  assert.equal((await h.send('PUT', 'save:library', body, before)).status, 400);
  assert.equal(await etagOf(h), before); h.close();
});

test('byte retention limit removes oldest large history without touching current or legacy', async () => {
  const h = harness({ 'fixture-user:save:library': '{"turnCount":1}' });
  const large = 'x'.repeat(13_400_000);
  for (let i = 2; i <= 4; i++) assert.equal((await put(h, { text: large, turnCount: i })).status, 200);
  const history = await (await h.endpoint('/sync/versions?key=save%3Alibrary')).json();
  assert(history.versions.reduce((sum, v) => sum + v.bytes, 0) <= 40_000_000);
  assert.equal(history.versions.length, 2); assert.equal((await (await h.send('GET')).json()).turnCount, 4);
  assert.equal(h.legacy.get('fixture-user:save:library'), '{"turnCount":1}'); h.close();
});

test('outer Worker refuses unauthenticated capabilities and data access', async () => {
  const h = harness();
  for (const endpoint of ['/sync/capabilities', '/sync/list', '/sync/list?history=1', '/sync?key=save%3Alibrary', '/sync/versions?key=save%3Alibrary']) {
    const result = await worker.fetch(new Request('https://fixture.invalid' + endpoint), h.env, {});
    assert.equal(result.status, 401);
  }
  assert.equal(h.objects.size, 0); h.close();
});

test('outer Worker derives namespace itself and strips untrusted namespace headers', async () => {
  const h = harness();
  const headers = { 'X-Sync-Token': 'fixture-passphrase', 'X-Pandora-Sync-Namespace': 'victim' };
  const current = await worker.fetch(new Request('https://fixture.invalid/sync?key=save%3Alibrary', { headers }), h.env, {});
  const save = await worker.fetch(new Request('https://fixture.invalid/sync?key=save%3Alibrary', {
    method: 'PUT', headers: { ...headers, 'If-Match': current.headers.get('ETag') }, body: '{"ok":true}'
  }), h.env, {});
  assert.equal(save.status, 200);
  assert.equal([...h.objects.keys()].some(key => key.includes('victim')), false);
  assert.equal(h.objects.size, 1); h.close();
});

test('CORS permits validators and exposes revisions on success and conflict', async () => {
  const h = harness();
  const preflight = await worker.fetch(new Request('https://fixture.invalid/sync', { method: 'OPTIONS' }), h.env, {});
  assert(preflight.headers.get('Access-Control-Allow-Headers').includes('If-Match'));
  assert(preflight.headers.get('Access-Control-Expose-Headers').includes('ETag'));
  await put(h, { a: 1 }); const conflict = await h.send('PUT', 'save:library', { a: 2 }, '"missing"');
  assert.equal(conflict.status, 412); assert(conflict.headers.get('ETag'));
  assert.equal(conflict.headers.get('Cache-Control'), 'no-store'); h.close();
});

function authFixture(user, secret) {
  const expiry = Date.now() + 60_000;
  return Buffer.from(user).toString('base64') + '.' + expiry + '.' + createHmac('sha256', secret).update(user + '|' + expiry).digest('hex');
}
test('missing authentication secret rejects forged dev tokens and all account-creation/login paths', async () => {
  const h = harness(); delete h.env.AUTH_SECRET;
  const token = authFixture('fixture-player', 'dev');
  const me = await worker.fetch(new Request('https://fixture.invalid/auth/me', { headers: { 'X-Auth': token } }), h.env, {});
  assert.equal(me.status, 401);
  for (const endpoint of ['/auth/register', '/auth/login', '/auth/google']) {
    const response = await worker.fetch(new Request('https://fixture.invalid' + endpoint, { method: 'POST', body: '{}' }), h.env, {});
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'auth_unavailable');
  }
  assert.deepEqual(h.kvWrites, []); h.close();
});
test('empty signing secret is rejected but a configured secret preserves valid account tokens', async () => {
  const h = harness(); const token = authFixture('fixture-player', h.env.AUTH_SECRET);
  const req = () => new Request('https://fixture.invalid/auth/me', { headers: { 'X-Auth': token } });
  assert.equal((await worker.fetch(req(), h.env, {})).status, 200);
  h.env.AUTH_SECRET = '   ';
  assert.equal((await worker.fetch(req(), h.env, {})).status, 401); h.close();
});

(async () => {
  ({ PandoraSyncStore, routeAtomicSync } = await import(pathToFileURL(path.join(__dirname, 'worker/sync-store.js')).href));
  ({ default: worker } = await import(pathToFileURL(path.join(__dirname, 'worker/sync.js')).href));
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + (error.stack || error)); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} atomic backup tests passed (SQLite; no network).`);
  process.exitCode = failed ? 1 : 0;
})();
