'use strict';
// Network-free regressions for asynchronous summary commits. Run: node tests-summary.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const begin = source.indexOf('\nasync function summarizeIfNeeded(');
assert(begin >= 0, 'summarizeIfNeeded missing');
const end = source.indexOf('\n}', begin);
const summaryCode = source.slice(begin, end + 2);
const cases = [];
const test = (name, run) => cases.push({ name, run });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const history = (n, prefix = 'turn') => Array.from({ length: n }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: i % 2 ? JSON.stringify({ narration: prefix + i, dialogue: [] }) : prefix + i,
}));
function harness(overrides = {}) {
  const fetches = [], chronicles = [], saves = [], toasts = [];
  const sb = {
    gameHistory: history(40), summaryIndex: 4, storySummary: '기존 요약',
    gameState: { chronicle: ['기존 사실'] }, STORY: { id: 'test' }, _turnEpoch: 1,
    SUMMARY_INTERVAL: 8, SUMMARY_KEEP: 16, PROVIDER: 'gemini', API_KEY: 'test-key',
    OPENROUTER_KEY: '', OPENROUTER_URL: 'https://test.invalid/or', NIM_URL: 'https://test.invalid/nim',
    NIM_MODEL: 'test-model', curORModel: () => 'google/gemini-2.5-flash', TextDecoder,
    fetch: (url, options) => { const d = deferred(); fetches.push({ ...d, body: JSON.parse(options.body) }); return d.promise; },
    llmSmall: () => { const d = deferred(); chronicles.push(d); return d.promise; },
    autoSave: () => saves.push({ state: sb.gameState, summary: sb.storySummary, boundary: sb.summaryIndex }),
    showStatToast: text => toasts.push(text),
    ...overrides,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(summaryCode, sb);
  return { sb, fetches, chronicles, saves, toasts };
}
async function replySummary(h, index = 0, text = '새 요약', finishReason = 'STOP') {
  h.fetches[index].resolve({ ok: true, json: async () => ({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
  }) });
  await tick();
}
async function replyChronicle(h, index = 0, text = '["새 사실"]') {
  h.chronicles[index].resolve(text);
  await tick();
}

test('same session has one request through summary and chronicle stages', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  await h.sb.summarizeIfNeeded();
  assert.equal(h.fetches.length, 1);
  await replySummary(h);
  assert.equal(h.sb.storySummary, '기존 요약', 'summary must not commit before final session validation');
  await h.sb.summarizeIfNeeded();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.chronicles.length, 1);
  await replyChronicle(h);
  await work;
  assert.equal(h.sb.storySummary, '새 요약');
  assert.equal(h.sb.summaryIndex, 24);
  assert.deepEqual(Array.from(h.sb.gameState.chronicle), ['기존 사실', '새 사실']);
  assert.equal(h.saves.length, 1);
  assert.equal(h.sb._summaryPending, null);
});

test('turns appended during either request remain unsummarized', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory.push(...history(2, 'new-a'));
  await replySummary(h);
  h.sb.gameHistory.push(...history(2, 'new-b'));
  await replyChronicle(h);
  await work;
  assert.equal(h.sb.summaryIndex, 24);
  assert.equal(h.sb.gameHistory.length - h.sb.summaryIndex, 20);
});

test('trimming already summarized prefixes preserves captured endpoint', async () => {
  const h = harness({ gameHistory: history(64), summaryIndex: 30 });
  const targetEnd = h.sb.gameHistory[47], work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory = h.sb.gameHistory.slice(20);
  h.sb.summaryIndex -= 20;
  await replySummary(h);
  h.sb.gameHistory = h.sb.gameHistory.slice(5);
  h.sb.summaryIndex -= 5;
  h.sb.gameHistory.push(...history(2, 'later'));
  await replyChronicle(h);
  await work;
  assert.equal(h.sb.summaryIndex, 23);
  assert.equal(h.sb.gameHistory[h.sb.summaryIndex - 1], targetEnd);
  assert.equal(h.saves.length, 1);
});

test('loading another save rejects old summary and skips its chronicle request', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.gameState = { chronicle: ['로드한 사실'] };
  h.sb.gameHistory = history(40, 'loaded');
  h.sb.storySummary = '로드한 요약';
  await replySummary(h);
  await work;
  assert.equal(h.sb.storySummary, '로드한 요약');
  assert.equal(h.sb.summaryIndex, 4);
  assert.equal(h.chronicles.length, 0);
  assert.equal(h.saves.length, 0);
});

test('session epoch change during chronicle prevents any commit', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  await replySummary(h);
  h.sb._turnEpoch++;
  await replyChronicle(h);
  await work;
  assert.equal(h.sb.storySummary, '기존 요약');
  assert.equal(h.sb.summaryIndex, 4);
  assert.deepEqual(h.sb.gameState.chronicle, ['기존 사실']);
  assert.equal(h.saves.length, 0);
});

test('replaced history entry invalidates batch even when endpoint survives', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory[9] = { ...h.sb.gameHistory[9] };
  await replySummary(h);
  await work;
  assert.equal(h.sb.storySummary, '기존 요약');
  assert.equal(h.chronicles.length, 0);
  assert.equal(h.saves.length, 0);
});

test('replaced story with same id does not accept old result', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.STORY = { id: 'test' };
  await replySummary(h);
  await work;
  assert.equal(h.sb.storySummary, '기존 요약');
  assert.equal(h.saves.length, 0);
});

test('old job cannot clear new session job or block new session requests', async () => {
  const h = harness(), old = h.sb.summarizeIfNeeded();
  h.sb._turnEpoch++;
  h.sb.gameState = { chronicle: [] };
  h.sb.gameHistory = history(40, 'new-session');
  h.sb.storySummary = '새 세션 기존 요약';
  const newer = h.sb.summarizeIfNeeded(), token = h.sb._summaryPending;
  assert.equal(h.fetches.length, 2);
  await replySummary(h, 0, '옛 세션 요약');
  await old;
  assert.equal(h.sb._summaryPending, token);
  assert.equal(h.chronicles.length, 0);
  await replySummary(h, 1, '새 세션 요약');
  await replyChronicle(h);
  await newer;
  assert.equal(h.sb.storySummary, '새 세션 요약');
  assert.equal(h.saves.length, 1);
  assert.equal(h.sb._summaryPending, null);
});

test('failed network releases job and allows a later retry', async () => {
  const h = harness(), first = h.sb.summarizeIfNeeded();
  h.fetches[0].reject(new Error('offline'));
  await first;
  assert.equal(h.sb._summaryPending, null);
  assert.equal(h.sb.storySummary, '기존 요약');
  const retry = h.sb.summarizeIfNeeded();
  assert.equal(h.fetches.length, 2);
  await replySummary(h, 1);
  await replyChronicle(h);
  await retry;
  assert.equal(h.saves.length, 1);
});

test('chronicle failure still commits valid summary without changing facts', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  await replySummary(h);
  h.chronicles[0].reject(new Error('offline'));
  await work;
  assert.equal(h.sb.storySummary, '새 요약');
  assert.equal(h.sb.summaryIndex, 24);
  assert.deepEqual(h.sb.gameState.chronicle, ['기존 사실']);
  assert.equal(h.saves.length, 1);
});

test('edited prior summary cannot be overwritten by an outdated request', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.storySummary = '사용자가 바로잡은 요약';
  await replySummary(h);
  await work;
  assert.equal(h.sb.storySummary, '사용자가 바로잡은 요약');
  assert.equal(h.saves.length, 0);
});

test('truncated summary keeps prior memory and releases job', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  await replySummary(h, 0, '잘린 요약', 'MAX_TOKENS');
  await work;
  assert.equal(h.sb.storySummary, '기존 요약');
  assert.equal(h.sb.summaryIndex, 4);
  assert.equal(h.sb._summaryPending, null);
  assert.equal(h.chronicles.length, 0);
  assert.equal(h.toasts.length, 1);
});

test('OpenRouter streaming summary obeys the same captured boundary', async () => {
  const h = harness({ PROVIDER: 'openrouter' }), work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory.push(...history(2, 'later'));
  const bytes = new TextEncoder().encode('data: ' + JSON.stringify({
    choices: [{ delta: { content: '스트림 요약' } }],
  }) + '\n\ndata: [DONE]\n\n');
  let sent = false;
  h.fetches[0].resolve({ ok: true, body: { getReader: () => ({ read: async () => {
    if (sent) return { done: true };
    sent = true;
    return { done: false, value: bytes };
  } }) } });
  await tick();
  await replyChronicle(h);
  await work;
  assert.equal(h.sb.storySummary, '스트림 요약');
  assert.equal(h.sb.summaryIndex, 24);
  assert.equal(h.fetches[0].body.model, 'google/gemini-2.5-flash');
  assert.equal(h.saves.length, 1);
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`${cases.length - failed}/${cases.length} summary regressions passed`);
  if (failed) process.exitCode = 1;
})();
