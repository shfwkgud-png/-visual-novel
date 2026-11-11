'use strict';
// Cloud-save safety regressions. Every credential, storage record, timer and
// HTTP response is a local fixture; fetch never reaches a network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const cloudStart = source.indexOf('// ===== CLOUD BACKUP / DEVICE SYNC');
const cloudEnd = source.indexOf('// ===== IMAGE UPLOADS', cloudStart);
assert(cloudStart >= 0 && cloudEnd > cloudStart, 'cloud implementation block missing');
const cloudSource = source.slice(cloudStart, cloudEnd);

function grab(name) {
  const start = source.search(new RegExp('\\n(?:async )?function ' + name + '\\('));
  assert(start >= 0, 'missing function: ' + name);
  // Compile candidates so both one-line helpers and nested template literals
  // are supported without copying a second implementation into this test.
  for (let end = source.indexOf('}', start); end >= 0; end = source.indexOf('}', end + 1)) {
    const candidate = source.slice(start, end + 1);
    try { new vm.Script(candidate); return candidate; } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error('unterminated function: ' + name);
}

const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const until = async (condition, description) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await Promise.resolve();
  }
  assert.fail('mock async operation did not reach ' + description);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const saveFixture = (turn = 4) => ({ dataVersion: 5, turnCount: turn, savedAt: 1730000000000,
  gameHistory: [{ role: 'assistant', content: '성인 사서가 도서관 문을 열었다.' }],
  gameState: { gold: 20, location: '도서관', time: '1일차 오후' }, dialogueLog: [] });

function harness(options = {}) {
  const storage = new Map(Object.entries(options.storage || {
    vn_auth: 'fixture-auth-a', vn_auth_user: 'Fixture Player', vn_auth_admin: '0'
  }));
  const bulk = new Map(Object.entries(options.bulk || {}));
  const remote = new Map(Object.entries(options.remote || {}));
  const fetches = [], timers = new Map(), clearedTimers = [], statuses = [], confirms = [];
  const events = [], elements = new Map(), listeners = new Map();
  let timerId = 0, fetchOverride = null;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { id, value: '', checked: false, disabled: false,
      style: {}, textContent: '', innerHTML: '', options: [],
      classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, click() {} });
    return elements.get(id);
  };
  const response = (status, value) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => typeof value === 'string' ? JSON.parse(value) : clone(value),
    text: async () => typeof value === 'string' ? value : JSON.stringify(value)
  });
  const sb = {
    console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams, AbortController,
    JSON, Math, Date, Object, Array, Set, Map, Number, String, Promise, RegExp,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => { events.push(['set', key]); storage.set(key, String(value)); },
      removeItem: key => { events.push(['remove', key]); storage.delete(key); },
      key: index => [...storage.keys()][index] || null,
      get length() { return storage.size; }
    },
    document: { getElementById: element, createElement: tag => ({ tag, style: {}, click() {} }),
      head: { appendChild() {} } },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { clearedTimers.push(id); timers.delete(id); },
    addEventListener: (name, fn) => { listeners.set(name, fn); },
    requestAnimationFrame: fn => fn(),
    confirm: text => { confirms.push(text); return sb.confirmResult; }, confirmResult: true,
    alert: text => statuses.push(text), showStatToast: text => statuses.push(text),
    bulkGet: key => bulk.get(key) || null,
    bulkSetSilent: (key, value) => { bulk.set(key, String(value)); return true; },
    bulkDel: key => bulk.delete(key), bulkKeys: re => [...bulk.keys()].filter(key => re.test(key)),
    lsSet: (key, value) => { storage.set(key, String(value)); return true; }, lsFull() {},
    STORY: { id: 'nakin', title: 'Fixture Library' },
    BUILTIN_STORIES: { nakin: { id: 'nakin' } },
    allStories: () => ({ ...sb.BUILTIN_STORIES, ...sb.getLocalStories() }),
    renderHome() {}, renderSlots() {}, timeAgo: () => '방금',
    applyAiPreferences() {}, setProvider() {},
    API_KEY: 'fixture-gemini', OPENROUTER_KEY: 'fixture-openrouter',
    OR_MODEL_BY_STORY: {}, OPENROUTER_MODEL: 'fixture/model',
    NIM_URL: 'https://fixture.invalid', NIM_MODEL: 'fixture/model', NIM_MODEL_OLD_DEFAULTS: [],
    FREE_TEST_MODE: true, PROVIDER: 'openrouter',
    currentSavePayload: () => saveFixture(),
    Ambient: { setMood() {} }, SFX: { play() {} },
    autoSave: () => sb.scheduleAutoBackup(),
    fetch: async (url, init = {}) => {
      const call = { url: String(url), method: (init.method || 'GET').toUpperCase(),
        headers: { ...(init.headers || {}) }, body: init.body };
      fetches.push(call);
      if (fetchOverride) {
        const result = await fetchOverride(call, fetches.length - 1);
        if (result !== undefined) return result;
      }
      const parsed = new URL(call.url);
      if (parsed.pathname === '/sync/list') return response(200, { keys: [...remote.keys()] });
      if (parsed.pathname === '/sync') {
        const key = parsed.searchParams.get('key');
        if (call.method === 'GET') return remote.has(key)
          ? response(200, remote.get(key)) : response(404, { error: 'not found' });
        if (call.method === 'PUT') { remote.set(key, call.body); return response(200, { ok: true }); }
      }
      if (parsed.pathname === '/img' && call.method === 'PUT')
        return response(200, { url: 'https://fixture.invalid/image.png' });
      throw new Error('unexpected mocked endpoint: ' + parsed.pathname);
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(cloudSource + '\n' + [
    'getLocalStories', 'getUploads', 'saveKeyFor', 'esc', 'uploadBlob',
    'slotKey', 'saveToSlot', 'endingsFor', 'showEndingCard'
  ].map(grab).join('\n'), sb);
  const syncStatusOriginal = sb.syncStatus;
  sb.syncStatus = text => { statuses.push(text); syncStatusOriginal(text); };
  return {
    sb, storage, bulk, remote, fetches, timers, clearedTimers, statuses, confirms, events, elements, listeners,
    response, setFetch: fn => { fetchOverride = fn; },
    puts: () => fetches.filter(call => call.method === 'PUT'),
    key: call => new URL(call.url).searchParams.get('key'),
    fire: async id => {
      const timer = timers.get(id); assert(timer, 'mock timer missing');
      timers.delete(id); await timer.fn(); await tick();
    }
  };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
async function enable(h) {
  await h.sb.enableCloudBackup(); await tick();
  assert.equal(h.sb.cloudWritesEnabled(), true, 'matching fixture baseline should permit writes');
  h.fetches.length = 0;
}
function scheduled(h) {
  h.sb.scheduleAutoBackup();
  assert.equal(h.timers.size, 1, 'there must be exactly one debounced backup timer');
  return [...h.timers.values()][0].fn;
}
function attachIndexedDb(h) {
  const transactions = [], physical = new Map();
  h.sb._bulk = h.bulk;
  h.sb._bulkDB = {
    transaction: (name, mode) => {
      assert.equal(name, 'kv'); assert.equal(mode, 'readwrite');
      const pending = new Map(), reads = [];
      const tx = { objectStore: () => ({
        get: key => { const req = { key, result: undefined }; reads.push(req); return req; },
        put: (raw, key) => { pending.set(key, raw); return {}; }
      }) };
      transactions.push({ tx, reads, pending,
        read: () => { for (const req of reads) { req.result = physical.get(req.key); req.onsuccess(); } },
        complete: () => { for (const [key, raw] of pending) physical.set(key, raw); tx.oncomplete(); },
        abort: () => tx.onabort()
      });
      return tx;
    }
  };
  return { transactions, physical };
}

test('an authenticated fresh page has no cloud-write permission', async () => {
  const h = harness();
  assert.equal(h.sb.hasSyncAuth(), true);
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(await h.sb.syncPut('save:nakin', saveFixture()), false);
  h.sb.scheduleAutoBackup();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.timers.size, 0);
});

test('legacy authentication does not implicitly authorize cloud writes', async () => {
  const h = harness({ storage: { vn_sync_token: 'fixture-legacy-auth' } });
  assert.equal(h.sb.hasSyncAuth(), true);
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(await h.sb.syncPut('stories', {}), false);
  h.sb.scheduleAutoBackup();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.timers.size, 0);
});

test('login stores the account without legacy migration or automatic backup', async () => {
  const h = harness({ storage: { vn_sync_token: 'fixture-legacy-auth' } });
  h.sb.afterLogin({ token: 'fixture-auth-b', user: 'fixture-b', display: 'Fixture B', admin: false });
  await tick();
  assert(h.storage.get('vn_auth') === 'fixture-auth-b', 'new fixture account was not installed');
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.fetches.length, 0, 'login must not read or write legacy/cloud saves');
  assert.equal(h.timers.size, 0, 'login must not start an upload timer');
});

test('manual backup while paused reports no success and changes no cloud or backup timestamp', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } });
  await h.sb.backupAll(true);
  assert.equal(h.fetches.length, 0);
  assert.equal(h.storage.has('vn_last_backup'), false);
  assert(!h.statuses.some(text => /백업 완료/.test(text)), 'blocked backup must not report completion');
});

test('automatic storage cleanup cannot delete local saves while cloud writes are paused', async () => {
  const existing = JSON.stringify(saveFixture());
  const h = harness({ bulk: { vn_save_other: existing, vn_slot_other_1: existing } });
  const result = await h.sb.offloadSaves('nakin');
  assert.equal(result.moved, 0);
  assert.equal(h.bulk.get('vn_save_other'), existing);
  assert.equal(h.bulk.get('vn_slot_other_1'), existing);
  assert.equal(h.fetches.length, 0);
});

test('a paused slot save remains local without touching an existing cloud slot', async () => {
  const remoteSlot = saveFixture(99);
  const h = harness({ remote: { 'slot1:nakin': remoteSlot } });
  h.sb.saveToSlot(1); await tick();
  assert.equal(JSON.parse(h.bulk.get('vn_slot_nakin_1')).turnCount, 4);
  assert.equal(h.remote.get('slot1:nakin').turnCount, 99);
  assert.equal(h.fetches.length, 0);
});

test('an ending achievement remains local while cloud writes are paused', async () => {
  const h = harness();
  h.sb.showEndingCard('성인 사서의 서가 정리 완료'); await tick();
  assert.deepEqual(JSON.parse(h.storage.get('vn_endings_nakin')), ['성인 사서의 서가 정리 완료']);
  assert.equal(h.fetches.length, 0);
  assert.equal(h.timers.size, 0);
});

test('image uploads fail locally while cloud writes are paused', async () => {
  const h = harness();
  await assert.rejects(() => h.sb.uploadBlob('fixture.png', 'fixture-image', 'image/png'));
  assert.equal(h.fetches.length, 0);
});

test('legacy migration cannot bypass a paused cloud-write gate', async () => {
  const h = harness({ storage: { vn_auth: 'fixture-auth-a', vn_auth_user: 'Fixture Player',
    vn_sync_token: 'fixture-legacy-auth' }, remote: { stories: { fixture: { title: 'Fixture' } } } });
  await h.sb.migrateLegacy(false); await tick();
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('cloud inspection is read-only and does not expose fixture settings or credentials', async () => {
  const secretMarker = 'FIXTURE_PRIVATE_CONFIG_CONTENT_DO_NOT_DISPLAY';
  const h = harness({ remote: { stories: { test: { id: 'test', title: 'Fixture story' } },
    uploads: { faces: {}, bgs: {} }, 'save:nakin': saveFixture(),
    cfg: { orKey: secretMarker }, 'vn_slot_nakin_1': saveFixture(3) } });
  await h.sb.inspectCloudBackup(); await tick();
  assert(h.fetches.length > 0, 'inspection must inspect the mocked cloud');
  assert(h.fetches.every(call => call.method === 'GET'), 'inspection must issue GET requests only');
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
  const visible = h.statuses.join('\n') + [...h.elements.values()].map(el => el.textContent + el.innerHTML).join('\n');
  assert(!visible.includes(secretMarker), 'inspection exposed configuration contents');
  assert(!visible.includes('fixture-auth-a'), 'inspection exposed an authentication value');
});

test('cloud restoration only reads remote data and leaves cloud writes paused', async () => {
  const restored = saveFixture(7);
  const h = harness({ remote: { stories: {}, uploads: { faces: {}, bgs: {} }, 'save:nakin': restored } });
  await h.sb.restoreAll(); await tick();
  assert.equal(JSON.parse(h.bulk.get('nakin_save')).turnCount, 7);
  assert(h.fetches.every(call => call.method === 'GET'));
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
  h.sb.scheduleAutoBackup();
  assert.equal(h.timers.size, 0, 'restoration must not implicitly re-enable uploads');
});

test('a failed restore never enables writes or queues a follow-up backup', async () => {
  const h = harness();
  h.setFetch(() => { throw new Error('fixture connection failure'); });
  await h.sb.restoreAll(); await tick();
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
});

test('explicit enable checks the cloud using only GET requests before granting permission', async () => {
  const h = harness();
  await h.sb.enableCloudBackup(); await tick();
  assert.equal(h.sb.cloudWritesEnabled(), true);
  assert(h.fetches.length > 0);
  assert(h.fetches.every(call => call.method === 'GET'), 'preflight must not alter cloud data');
});

test('a new page never inherits another page cloud-write permission', async () => {
  const first = harness(); await enable(first);
  const second = harness({ storage: Object.fromEntries(first.storage) });
  assert.equal(second.sb.hasSyncAuth(), true);
  assert.equal(second.sb.cloudWritesEnabled(), false);
  assert.equal(await second.sb.syncPut('save:nakin', saveFixture()), false);
  assert.equal(second.fetches.length, 0);
});

test('a nonempty remote save missing locally blocks enable without any cloud write', async () => {
  const h = harness({ remote: { 'save:nakin': saveFixture(40) } });
  await h.sb.enableCloudBackup(); await tick();
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.remote.get('save:nakin').turnCount, 40);
  assert.equal(h.timers.size, 0);
});

test('different local and remote story catalogs cannot enable uploads', async () => {
  const h = harness({ storage: { vn_auth: 'fixture-auth-a', vn_auth_user: 'Fixture Player',
    vn_local_stories: JSON.stringify({ test: { id: 'test', title: 'Local draft' } }) },
    remote: { stories: { test: { id: 'test', title: 'Existing cloud draft' } } } });
  await h.sb.enableCloudBackup(); await tick();
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.remote.get('stories').test.title, 'Existing cloud draft');
});

test('a failed cloud read cannot be mistaken for an empty account during enable', async () => {
  const h = harness({ remote: { 'save:nakin': saveFixture() } });
  h.setFetch(call => new URL(call.url).pathname === '/sync'
    ? h.response(500, { error: 'fixture service failure' }) : undefined);
  await h.sb.enableCloudBackup(); await tick();
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.timers.size, 0);
});

test('a verified matching save can advance after a preflight read', async () => {
  const original = saveFixture(4), next = saveFixture(5);
  const h = harness({ bulk: { nakin_save: JSON.stringify(original) }, remote: { 'save:nakin': original } });
  await enable(h);
  h.bulk.set('nakin_save', JSON.stringify(next));
  assert.equal(await h.sb.syncPut('save:nakin', next), true);
  assert.deepEqual(h.fetches.map(call => call.method), ['GET', 'PUT']);
  assert.equal(JSON.parse(h.puts()[0].body).turnCount, 5);
  assert.equal(h.sb.cloudWritesEnabled(), true);
});

test('a new save key is written only after its GET confirms absence', async () => {
  const h = harness(); await enable(h);
  assert.equal(await h.sb.syncPut('save:nakin', saveFixture()), true);
  assert.deepEqual(h.fetches.map(call => call.method), ['GET', 'PUT']);
  assert(h.fetches.every(call => h.key(call) === 'save:nakin'));
});

test('a server error for a new key is never treated as a safe 404', async () => {
  const h = harness(); await enable(h);
  h.setFetch(() => h.response(503, { error: 'fixture unavailable' }));
  assert.equal(await h.sb.syncPut('save:nakin', saveFixture()), false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('an intervening cloud change blocks overwrite and revokes write permission', async () => {
  const original = saveFixture(4), newerCloud = saveFixture(80);
  const h = harness({ bulk: { nakin_save: JSON.stringify(original) }, remote: { 'save:nakin': original } });
  await enable(h);
  h.remote.set('save:nakin', newerCloud);
  assert.equal(await h.sb.syncPut('save:nakin', saveFixture(5)), false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.remote.get('save:nakin').turnCount, 80);
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
});

test('pause invalidates an already captured timer even after the same account enables again', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } }); await enable(h);
  const stale = scheduled(h);
  h.sb.pauseCloudWrites();
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
  await enable(h);
  await stale(); await tick();
  assert.equal(h.fetches.length, 0, 'stale timer must be rejected before even a cloud GET');
});

test('login switches invalidate pending uploads before installing a new account', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } }); await enable(h);
  const stale = scheduled(h);
  const originalSet = h.sb.localStorage.setItem;
  h.sb.localStorage.setItem = (key, value) => {
    if (key === 'vn_auth') {
      assert.equal(h.sb.cloudWritesEnabled(), false, 'permission must be cleared before account change');
      assert.equal(h.timers.size, 0, 'timer must be cancelled before account change');
    }
    originalSet(key, value);
  };
  h.sb.afterLogin({ token: 'fixture-auth-b', user: 'fixture-b' });
  await stale(); await tick();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('logout cancels queued writes and does not activate a legacy fallback credential', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } }); await enable(h);
  h.storage.set('vn_sync_token', 'fixture-legacy-auth');
  const stale = scheduled(h);
  h.sb.doLogout(); await stale(); await tick();
  assert.equal(h.storage.has('vn_auth'), false);
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.fetches.length, 0);
});

test('an account changed by another tab cannot inherit queued upload permission', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } }); await enable(h);
  const stale = scheduled(h);
  h.storage.set('vn_auth', 'fixture-auth-b');
  assert.equal(h.sb.cloudWritesEnabled(), false);
  await stale(); await tick();
  assert.equal(h.fetches.length, 0);
});

test('a story switch rejects a timer captured for another story', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()),
    vn_save_other: JSON.stringify(saveFixture(9)) } }); await enable(h);
  const stale = scheduled(h);
  h.sb.STORY = { id: 'other' };
  await stale(); await tick();
  assert.equal(h.fetches.length, 0);
});

test('automatic backup never manufactures an empty save for an unplayed story', async () => {
  const h = harness(); await enable(h);
  scheduled(h);
  await h.fire([...h.timers.keys()][0]);
  assert(!h.puts().some(call => h.key(call) === 'save:nakin'), 'missing save must not become a cloud PUT');
  assert(!h.puts().some(call => /^save:/.test(h.key(call) || '') && call.body === '{}'));
});

test('a failed preflight during offload preserves the local copy', async () => {
  const existing = JSON.stringify(saveFixture());
  const h = harness({ bulk: { vn_save_other: existing } }); await enable(h);
  h.setFetch(() => h.response(503, { error: 'fixture unavailable' }));
  const result = await h.sb.offloadSaves('nakin');
  assert.equal(result.moved, 0);
  assert.equal(h.bulk.get('vn_save_other'), existing);
  assert.equal(h.puts().length, 0);
});

test('restore pauses queued uploads before any read and leaves the old callback powerless', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } }); await enable(h);
  const stale = scheduled(h);
  h.setFetch(() => {
    assert.equal(h.sb.cloudWritesEnabled(), false, 'restore must pause before reading');
    assert.equal(h.timers.size, 0, 'restore must cancel the upload timer before reading');
  });
  await h.sb.restoreAll();
  const reads = h.fetches.length;
  await stale(); await tick();
  assert.equal(h.fetches.length, reads);
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('missing-only restore preserves local play, story edits, assets, slots and API preferences', async () => {
  const localConfig = JSON.stringify({ provider: 'openrouter', freeTestMode: true,
    orKey: 'fixture-local-key', customSetting: 'preserve' });
  const localSave = JSON.stringify(saveFixture(9)), localSlot = JSON.stringify(saveFixture(8));
  const h = harness({ storage: { vn_auth: 'fixture-auth-a', vn_auth_user: 'Fixture Player',
    vn_cfg: localConfig,
    vn_local_stories: JSON.stringify({ test: { id: 'test', title: 'Local story edit' } }),
    vn_uploads: JSON.stringify({ faces: { local: { url: 'fixture-local.png' } }, bgs: {} }),
    vn_endings_nakin: JSON.stringify(['Local ending']) },
    bulk: { nakin_save: localSave, vn_slot_nakin_1: localSlot },
    remote: { stories: { test: { id: 'test', title: 'Old cloud edit' },
      extra: { id: 'extra', title: 'Cloud-only story' } },
      uploads: { faces: { local: { url: 'fixture-old.png' }, extra: { url: 'fixture-extra.png' } }, bgs: {} },
      'save:nakin': saveFixture(1), 'save:extra': saveFixture(2),
      vn_slot_nakin_1: saveFixture(1), vn_slot_nakin_2: saveFixture(2),
      'endings:nakin': ['Remote ending'], cfg: { provider: 'gemini', orKey: 'fixture-cloud-key' } } });
  await h.sb.restoreAll(); await tick();
  assert.equal(h.bulk.get('nakin_save'), localSave);
  assert.equal(h.bulk.get('vn_slot_nakin_1'), localSlot);
  assert.equal(JSON.parse(h.bulk.get('vn_save_extra')).turnCount, 2);
  assert.equal(JSON.parse(h.bulk.get('vn_slot_nakin_2')).turnCount, 2);
  const stories = JSON.parse(h.storage.get('vn_local_stories'));
  assert.equal(stories.test.title, 'Local story edit');
  assert.equal(stories.extra.title, 'Cloud-only story');
  const uploads = JSON.parse(h.storage.get('vn_uploads'));
  assert.equal(uploads.faces.local.url, 'fixture-local.png');
  assert.equal(uploads.faces.extra.url, 'fixture-extra.png');
  assert(JSON.parse(h.storage.get('vn_endings_nakin')).includes('Local ending'));
  assert.equal(h.storage.get('vn_cfg'), localConfig);
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('empty or malformed save payloads never produce a PUT even after explicit enable', async () => {
  const h = harness(); await enable(h);
  for (const value of [null, '', '{}', {}, [], { gameState: {} }, { gameHistory: [] }])
    assert.equal(await h.sb.syncPut('save:nakin', value), false);
  assert.equal(h.fetches.length, 0);
});

test('two pending writes for one save are serialized against the updated baseline', async () => {
  const original = saveFixture(4), firstValue = saveFixture(5), secondValue = saveFixture(6);
  const h = harness({ bulk: { nakin_save: JSON.stringify(original) }, remote: { 'save:nakin': original } });
  await enable(h);
  const delayed = deferred(); let firstPut = true;
  h.setFetch(call => {
    if (call.method === 'PUT' && firstPut) { firstPut = false; return delayed.promise; }
  });
  const first = h.sb.syncPut('save:nakin', firstValue);
  const second = h.sb.syncPut('save:nakin', secondValue);
  await tick();
  assert.deepEqual(h.fetches.map(call => call.method), ['GET', 'PUT']);
  h.remote.set('save:nakin', firstValue); delayed.resolve(h.response(200, { ok: true }));
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(h.fetches.map(call => call.method), ['GET', 'PUT', 'GET', 'PUT']);
  assert.equal(JSON.parse(h.remote.get('save:nakin')).turnCount, 6);
});

test('account changes during the preflight read prevent the subsequent PUT', async () => {
  const h = harness(); await enable(h);
  const delayed = deferred(); h.setFetch(() => delayed.promise);
  const pending = h.sb.syncPut('save:nakin', saveFixture()); await tick();
  assert.equal(h.fetches.length, 1);
  h.storage.set('vn_auth', 'fixture-auth-b');
  delayed.resolve(h.response(404, { error: 'not found' }));
  assert.equal(await pending, false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('enabling again waits for an already submitted PUT before reading the new baseline', async () => {
  const original = saveFixture(4), next = saveFixture(5);
  const h = harness({ bulk: { nakin_save: JSON.stringify(original) }, remote: { 'save:nakin': original } });
  await enable(h);
  const delayed = deferred();
  h.setFetch(call => call.method === 'PUT' ? delayed.promise : undefined);
  const pending = h.sb.syncPut('save:nakin', next); await tick();
  assert.equal(h.puts().length, 1);
  h.bulk.set('nakin_save', JSON.stringify(next));
  const enabling = h.sb.enableCloudBackup(); await tick();
  assert(!h.fetches.some(call => new URL(call.url).pathname === '/sync/list'),
    'a new baseline must wait until the old submitted write settles');
  h.remote.set('save:nakin', next); delayed.resolve(h.response(200, { ok: true }));
  assert.equal(await pending, false, 'the old epoch must not reclaim write permission');
  assert.equal(await enabling, true);
  assert.equal(h.sb.cloudWritesEnabled(), true);
});

test('offload keeps a save changed locally while its older copy uploads', async () => {
  const older = JSON.stringify(saveFixture(4)), newer = JSON.stringify(saveFixture(5));
  const h = harness({ bulk: { vn_save_other: older } }); await enable(h);
  const delayed = deferred(); h.setFetch(call => call.method === 'PUT' ? delayed.promise : undefined);
  const pending = h.sb.offloadSaves('nakin'); await tick();
  assert.equal(h.puts().length, 1);
  h.bulk.set('vn_save_other', newer);
  delayed.resolve(h.response(200, { ok: true }));
  const result = await pending;
  assert.equal(result.moved, 0);
  assert.equal(h.bulk.get('vn_save_other'), newer);
});

test('a storage event cancels permission and pending timers even for unchanged credentials', async () => {
  const h = harness(); await enable(h); scheduled(h);
  assert.equal(typeof h.listeners.get('storage'), 'function');
  h.listeners.get('storage')({ key: 'vn_auth' });
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.fetches.length, 0);
});

test('manual backup counts only game data and never reads or writes API configuration', async () => {
  const localConfig = JSON.stringify({ orKey: 'fixture-local-key', freeTestMode: true });
  const h = harness({ storage: { vn_auth: 'fixture-auth-a', vn_auth_user: 'Fixture Player', vn_cfg: localConfig,
    vn_local_stories: JSON.stringify({ test: { id: 'test', title: 'Local fixture' } }) },
    bulk: { nakin_save: JSON.stringify(saveFixture()) }, remote: { cfg: { orKey: 'fixture-remote-key' } } });
  await h.sb.enableCloudBackup();
  assert.equal(h.sb.cloudWritesEnabled(), true);
  await h.sb.backupAll(true);
  assert(!h.fetches.some(call => h.key(call) === 'cfg'));
  assert.equal(h.storage.get('vn_cfg'), localConfig);
  assert.deepEqual(h.puts().map(h.key).sort(), ['save:nakin', 'stories']);
  assert(h.statuses.some(text => /백업 완료 \(2개 항목/.test(text)));
  assert(h.storage.has('vn_last_backup'));
});

test('failed manual backup does not stamp a successful backup time', async () => {
  const h = harness({ bulk: { nakin_save: JSON.stringify(saveFixture()) } }); await enable(h);
  h.setFetch(call => call.method === 'PUT' ? h.response(503, { error: 'fixture unavailable' }) : undefined);
  await h.sb.backupAll(true);
  assert.equal(h.storage.has('vn_last_backup'), false);
  assert(!h.statuses.some(text => /백업 완료/.test(text)));
  assert.equal(h.sb.cloudWritesEnabled(), false);
  assert(h.bulk.has('nakin_save'));
});

test('restore stages all reads before installing any data so a later read failure changes nothing', async () => {
  const h = harness({ remote: { stories: { extra: { id: 'extra', title: 'Remote fixture' } },
    'save:nakin': saveFixture() } });
  h.setFetch(call => h.key(call) === 'save:nakin' ? h.response(503, { error: 'fixture unavailable' }) : undefined);
  await h.sb.restoreAll(); await tick();
  assert.equal(h.storage.has('vn_local_stories'), false);
  assert.equal(h.bulk.size, 0);
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('different cloud values for both slot key formats never choose an arbitrary winner', async () => {
  const h = harness({ remote: { 'slot1:nakin': saveFixture(3), vn_slot_nakin_1: saveFixture(8) } });
  await h.sb.restoreAll(); await tick();
  assert.equal(h.bulk.has('vn_slot_nakin_1'), false);
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

test('an incomplete remote key listing cannot enable uploads or restore partial data', async () => {
  for (const operation of ['enableCloudBackup', 'restoreAll']) {
    const h = harness();
    h.setFetch(() => h.response(200, { keys: ['save:nakin'], list_complete: false }));
    await h.sb[operation](); await tick();
    assert.equal(h.fetches.length, 1);
    assert.equal(h.sb.cloudWritesEnabled(), false);
    assert.equal(h.puts().length, 0);
    assert.equal(h.bulk.size, 0);
  }
});

test('nonempty malformed remote saves block enable while a literal empty object stays harmless', async () => {
  for (const remoteSave of [{ gameState: { gold: 99 } }, { futureFormat: { turns: 99 } },
    { gameState: 'invalid', gameHistory: [] }, []]) {
    const h = harness({ remote: { 'save:nakin': remoteSave } });
    await h.sb.enableCloudBackup(); await tick();
    assert.equal(h.sb.cloudWritesEnabled(), false, 'a nonempty unknown save must be preserved');
    assert.equal(h.puts().length, 0);
    assert.deepEqual(h.remote.get('save:nakin'), remoteSave);
  }
  const empty = harness({ remote: { 'save:nakin': {} } });
  await empty.sb.enableCloudBackup();
  assert.equal(empty.sb.cloudWritesEnabled(), true);
  assert.equal(empty.puts().length, 0);
});

test('different token counters are protected without blocking verified game backups', async () => {
  const localTokens = { nakin: { input: 3, output: 4 } };
  const remoteTokens = { nakin: { input: 300, output: 400 } };
  const h = harness({ storage: { vn_auth: 'fixture-auth-a', vn_auth_user: 'Fixture Player',
    vn_tokens: JSON.stringify(localTokens) }, remote: { 'tokens:Fixture Player': remoteTokens } });
  await enable(h);
  assert.equal(await h.sb.syncPut('tokens:Fixture Player', localTokens), false);
  assert.equal(h.fetches.length, 0);
  assert.deepEqual(h.remote.get('tokens:Fixture Player'), remoteTokens);
  assert.equal(h.sb.cloudWritesEnabled(), true);
  assert.equal(await h.sb.syncPut('save:nakin', saveFixture()), true);
  assert.equal(h.sb.cloudWritesEnabled(), true);
});

test('stale image responses are rejected both before and after reading the response JSON', async () => {
  for (const phase of ['response', 'json']) {
    const h = harness(); await enable(h);
    const delayed = deferred();
    h.setFetch(() => phase === 'response' ? delayed.promise : {
      ok: true, status: 200, json: () => delayed.promise
    });
    const pending = h.sb.uploadBlob('fixture.png', 'fixture-image', 'image/png');
    const rejection = assert.rejects(pending, /계정 또는 백업 상태/);
    await tick();
    h.sb.pauseCloudWrites();
    delayed.resolve(phase === 'response' ? h.response(200, { url: 'https://fixture.invalid/stale.png' })
      : { url: 'https://fixture.invalid/stale.png' });
    await rejection;
    assert.equal(h.puts().length, 1, 'only the already submitted image request may exist');
    assert.equal(h.sb.cloudWritesEnabled(), false);
    assert.equal(h.storage.has('vn_uploads'), false);
  }
});

test('an aborted IndexedDB import never updates the save cache or reports restore success', async () => {
  const h = harness({ remote: { 'save:nakin': saveFixture(7) } });
  const db = attachIndexedDb(h);
  let settled = false;
  const pending = h.sb.restoreAll().then(() => { settled = true; });
  await until(() => db.transactions.length === 1, 'the IndexedDB import');
  assert.equal(db.transactions.length, 1);
  const tx = db.transactions[0]; tx.read(); await tick();
  assert.equal(tx.pending.size, 1, 'a write should be staged in the mock transaction');
  assert.equal(settled, false, 'restore must wait for transaction completion');
  assert.equal(h.bulk.has('nakin_save'), false);
  assert(!h.statuses.some(text => /가져오기 완료/.test(text)));
  tx.abort(); await pending;
  assert.equal(db.physical.has('nakin_save'), false);
  assert.equal(h.bulk.has('nakin_save'), false);
  assert(!h.statuses.some(text => /가져오기 완료/.test(text)));
  assert(h.statuses.some(text => /가져오기 중단/.test(text)));
  assert.equal(h.puts().length, 0);
});

test('a local edit made after staging survives while IndexedDB restoration is awaiting commit', async () => {
  const h = harness({ remote: { 'save:nakin': saveFixture(7),
    stories: { remote: { id: 'remote', title: 'Remote-only fixture' } } } });
  const db = attachIndexedDb(h);
  const pending = h.sb.restoreAll();
  await until(() => db.transactions.length === 1, 'the staged IndexedDB import');
  assert.equal(db.transactions.length, 1);
  const localEdit = JSON.stringify({ local: { id: 'local', title: 'Concurrent local edit' } });
  h.storage.set('vn_local_stories', localEdit);
  const tx = db.transactions[0]; tx.read(); tx.complete();
  await pending;
  assert.equal(h.storage.get('vn_local_stories'), localEdit);
  assert.equal(JSON.parse(h.bulk.get('nakin_save')).turnCount, 7);
  assert.equal(db.physical.get('nakin_save'), h.bulk.get('nakin_save'));
  assert.equal(h.puts().length, 0);
  assert.equal(h.sb.cloudWritesEnabled(), false);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    let watchdog;
    try {
      await Promise.race([Promise.resolve().then(run), new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('test did not settle within 5 seconds')), 5000);
      })]);
      console.log('PASS ' + name);
    }
    catch (error) { failed++; console.error('FAIL ' + name + ' — ' + error.message); }
    finally { clearTimeout(watchdog); }
  }
  console.log(`${tests.length - failed}/${tests.length} cloud sync safety tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
