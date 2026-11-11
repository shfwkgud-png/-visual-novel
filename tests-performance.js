'use strict';
// Real settings/measurement functions, fake account metadata only. No network.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, 'novel.html'), 'utf8');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function grab(name) {
  const start = source.search(new RegExp('\\n(?:async )?function ' + name + '\\('));
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function harness() {
  const nodes = Object.fromEntries(['freeApiQuotaStatus', 'freeApiQuotaBtn', 'orKeyInput', 'aiPipelineSel', 'aiPerfPanel']
    .map(id => [id, { textContent: '', style: {}, value: '', disabled: false }]));
  nodes.orKeyInput.value = 'fixture-key-never-real'; nodes.aiPipelineSel.value = 'split';
  const storage = new Map(), calls = [], timers = new Map(); let clock = 10000;
  const sb = { JSON, Math, Number, String, Object, Array, Set, Map, Promise, AbortController,
    Date: class extends Date { static now() { return clock; } },
    document: { getElementById: id => nodes[id] || null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    FREE_TEST_MODE: true, PROVIDER: 'openrouter', OPENROUTER_KEY: '', STORY: { id: 'fixture' },
    gameState: {}, turnCount: 1, showStatToast: message => sb.notices.push(message), notices: [],
    setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { calls.push({ url, options }); return sb.response; },
    response: { ok: true, status: 200, json: async () => ({ data: { free_model_daily_requests: { used: 6, limit: 50, remaining: 44 } } }) }
  };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(['aiSettingsBusy', 'splitPipeOn', 'toggleSplitPipe', 'checkFreeApiQuota', 'renderAiPerformance', 'recordTurnPerformance'].map(grab).join('\n'), sb);
  return { sb, nodes, storage, calls, timers, setClock: n => { clock = n; } };
}
test('the page main script still parses after loading the independent validator', () => {
  const script = source.match(/<script>([\s\S]*?)<\/script>/);
  assert(script); new vm.Script(script[1]);
  assert(source.includes('src="pandora-consistency.js?v=369"'));
});
test('quota uses a single metadata GET, never chat completion or an API key URL', async () => {
  const h = harness(); await h.sb.checkFreeApiQuota();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://openrouter.ai/api/v1/key');
  assert.equal(h.calls[0].options.method, 'GET');
  assert.equal(h.calls[0].options.body, undefined);
  assert(h.nodes.freeApiQuotaStatus.textContent.includes('44 / 50'));
  assert(h.nodes.freeApiQuotaStatus.textContent.includes('22턴'));
  assert(!h.nodes.freeApiQuotaStatus.textContent.includes('fixture-key'));
  assert.equal(h.sb._freeQuotaProbe, null); assert.equal(h.timers.size, 0);
});
test('quota estimate follows the selected one-call mode and accounts for zero remaining', async () => {
  const h = harness(); h.nodes.aiPipelineSel.value = 'integrated';
  await h.sb.checkFreeApiQuota(); assert(h.nodes.freeApiQuotaStatus.textContent.includes('44턴'));
  h.sb.response.json = async () => ({ data: { free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } });
  await h.sb.checkFreeApiQuota(); assert(h.nodes.freeApiQuotaStatus.textContent.includes('0 / 50'));
  assert(h.nodes.freeApiQuotaStatus.textContent.includes('0턴'));
});
test('missing metadata is unknown, never an invented 50 request balance', async () => {
  const h = harness(); h.sb.response.json = async () => ({ data: { is_free_tier: true } });
  await h.sb.checkFreeApiQuota();
  assert(h.nodes.freeApiQuotaStatus.textContent.includes('제공하지 않았'));
  assert(!h.nodes.freeApiQuotaStatus.textContent.includes('50'));
  assert.equal(h.sb._freeQuotaResult, undefined);
});
test('malformed or contradictory quota counters cannot become a displayed balance', async () => {
  for (const q of [{ used: 1, limit: 50, remaining: 51 }, { used: -1, limit: 50, remaining: 50 }, { used: 2, limit: '50', remaining: 48 }]) {
    const h = harness(); h.sb.response.json = async () => ({ data: { free_model_daily_requests: q } });
    await h.sb.checkFreeApiQuota(); assert.equal(h.sb._freeQuotaResult, undefined);
  }
});
test('429 and transport failure do not retry or leak provider error bodies', async () => {
  const h = harness(); h.sb.response = { ok: false, status: 429, json: async () => { throw new Error('must not parse body'); } };
  await h.sb.checkFreeApiQuota(); assert.equal(h.calls.length, 1);
  assert(h.nodes.freeApiQuotaStatus.textContent.includes('HTTP 429'));
  h.sb.fetch = async () => { throw new Error('fixture-key-never-render'); };
  await h.sb.checkFreeApiQuota(); assert.equal(h.timers.size, 0);
  assert.equal(h.nodes.freeApiQuotaBtn.disabled, false);
  assert(!h.nodes.freeApiQuotaStatus.textContent.includes('fixture-key'));
});
test('quota request is blocked without key, in nonfree mode, and during owned work', async () => {
  for (const change of [h => h.nodes.orKeyInput.value = '', h => h.sb.FREE_TEST_MODE = false, h => h.sb._mainRequest = {}]) {
    const h = harness(); change(h); await h.sb.checkFreeApiQuota(); assert.equal(h.calls.length, 0);
  }
});
test('pipeline changes are blocked until main, state, summary, and quota jobs settle', () => {
  for (const job of ['_mainRequest', '_splitExtractPending', '_summaryPending', '_freeQuotaProbe']) {
    const h = harness(); h.sb[job] = {}; h.sb.toggleSplitPipe(); assert.equal(h.storage.size, 0);
  }
});
test('pipeline toggle preserves unrelated settings and idol stays integrated', () => {
  const h = harness(); h.storage.set('vn_cfg', JSON.stringify({ splitPipe: true, untouched: 5 }));
  h.sb.toggleSplitPipe(); assert.deepEqual(JSON.parse(h.storage.get('vn_cfg')), { splitPipe: false, untouched: 5 });
  assert.equal(h.sb.splitPipeOn(), false);
  h.sb.STORY.id = 'idol'; h.sb.toggleSplitPipe(); assert.equal(h.sb.splitPipeOn(), false);
});
test('first display, main completion and ready time remain distinct in the report', () => {
  const h = harness(); h.sb.gameState._turnStats = { turn: 1, startedAt: 1000, pipeline: 'split', model: 'fixture/model:free', visible: 2, elapsed: 5, extract: 4 };
  h.sb.recordTurnPerformance();
  const text = h.nodes.aiPerfPanel.textContent;
  assert(text.includes('첫 표시 2.0초')); assert(text.includes('본문 완료 5.0초')); assert(text.includes('상태까지 완료 9.0초'));
  assert.equal(h.sb._pandoraTurnPerf.length, 1);
  h.setClock(12000); h.sb.recordTurnPerformance(); assert.equal(h.sb._pandoraTurnPerf.length, 1);
  assert(!Object.keys(h.sb._pandoraTurnPerf[0]).some(k => /key|prompt$|text|dialogue/i.test(k)));
});
test('failed, pending and stale turns cannot enter completed latency averages', () => {
  const h = harness(); h.sb.gameState._turnStats = { turn: 1, startedAt: 1000, extractFailed: true };
  h.sb.recordTurnPerformance(); assert.equal(h.sb._pandoraTurnPerf, undefined);
  h.sb.gameState._turnStats = { turn: 2, startedAt: 1000 };
  h.sb.recordTurnPerformance(); assert.equal(h.sb._pandoraTurnPerf, undefined);
  h.sb.renderAiPerformance(); assert(h.nodes.aiPerfPanel.textContent.includes('아직 없습니다'));
});
test('latency samples are bounded and do not merge different modes', () => {
  const h = harness();
  for (let n = 1; n <= 40; n++) {
    h.sb.turnCount = n; h.setClock(n * 10000);
    h.sb.gameState._turnStats = { turn: n, startedAt: n * 10000 - 5000, sampleId: 'fixture-' + n,
      pipeline: n % 2 ? 'split' : 'integrated', model: 'fixture/model:free', visible: 1, elapsed: 3 };
    h.sb.recordTurnPerformance();
  }
  assert.equal(h.sb._pandoraTurnPerf.length, 30);
  assert(h.nodes.aiPerfPanel.textContent.includes('본문 먼저 읽기'));
  assert(h.nodes.aiPerfPanel.textContent.includes('요청 절약'));
});
(async () => {
  let passed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); passed++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} performance/settings tests passed`);
})();
