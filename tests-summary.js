"use strict";
// Single factual-memory request; deterministic provider fixtures, no live APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const begin = source.indexOf('\nasync function summarizeIfNeeded(');
assert(begin >= 0, 'summarizeIfNeeded missing');
const summaryCode = source.slice(begin, source.indexOf('\n}', begin) + 2);
const cases = [], test = (name, run) => cases.push({ name, run });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const history = (n, prefix = 'turn') => Array.from({ length: n }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user', content: i % 2 ? JSON.stringify({ narration: prefix + i, dialogue: [] }) : prefix + i
}));
function harness(overrides = {}) {
  const requests = [], saves = [], toasts = [];
  const sb = {
    gameHistory: history(40), summaryIndex: 4, storySummary: '기존 요약',
    gameState: { chronicle: ['기존 사실'] }, STORY: { id: 'test' }, _turnEpoch: 1,
    SUMMARY_INTERVAL: 8, SUMMARY_KEEP: 16,
    callLlmTask: (system, messages, options) => { const d = deferred(); requests.push({ ...d, system, messages, options }); return d.promise; },
    autoSave: () => saves.push({ state: sb.gameState, summary: sb.storySummary, boundary: sb.summaryIndex }),
    showStatToast: text => toasts.push(text), ...overrides
  };
  sb.window = sb; vm.createContext(sb); vm.runInContext(summaryCode, sb);
  const reply = (index = 0, summary = '새 요약', chronicle = ['새 사실'], finishReason = 'stop') =>
    requests[index].resolve({ text: JSON.stringify({ summary, chronicle }), finishReason });
  return { sb, requests, saves, toasts, reply };
}

test('summary and chronicle commit through exactly one provider request', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  await h.sb.summarizeIfNeeded();
  assert.equal(h.requests.length, 1); assert.equal(h.sb.storySummary, '기존 요약');
  assert.equal(h.requests[0].options.task, 'summary'); assert.equal(h.requests[0].options.json, true);
  h.reply(); await work;
  assert.equal(h.sb.storySummary, '새 요약'); assert.equal(h.sb.summaryIndex, 24);
  assert.deepEqual(Array.from(h.sb.gameState.chronicle), ['기존 사실', '새 사실']);
  assert.equal(h.saves.length, 1); assert.equal(h.sb._summaryPending, null);
});
test('turns appended while memory is being generated remain unsummarized', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory.push(...history(4, 'new')); h.reply(); await work;
  assert.equal(h.sb.summaryIndex, 24); assert.equal(h.sb.gameHistory.length - h.sb.summaryIndex, 20);
});
test('trimming already summarized prefixes preserves the exact captured endpoint', async () => {
  const h = harness({ gameHistory: history(64), summaryIndex: 30 });
  const targetEnd = h.sb.gameHistory[47], work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory = h.sb.gameHistory.slice(25); h.sb.summaryIndex -= 25;
  h.sb.gameHistory.push(...history(2, 'later')); h.reply(); await work;
  assert.equal(h.sb.summaryIndex, 23); assert.equal(h.sb.gameHistory[h.sb.summaryIndex - 1], targetEnd);
  assert.equal(h.saves.length, 1);
});
test('loading another save discards both old outputs', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.gameState = { chronicle: ['로드한 사실'] }; h.sb.gameHistory = history(40, 'loaded'); h.sb.storySummary = '로드한 요약';
  assert.equal(h.requests[0].options.isCurrent(), false); h.reply(); await work;
  assert.equal(h.sb.storySummary, '로드한 요약'); assert.deepEqual(h.sb.gameState.chronicle, ['로드한 사실']);
  assert.equal(h.sb.summaryIndex, 4); assert.equal(h.saves.length, 0);
});
test('session epoch change prevents memory commit', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded(); h.sb._turnEpoch++; h.reply(); await work;
  assert.equal(h.sb.storySummary, '기존 요약'); assert.deepEqual(h.sb.gameState.chronicle, ['기존 사실']);
  assert.equal(h.saves.length, 0);
});
test('replaced history entry invalidates the batch even when endpoint survives', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded();
  h.sb.gameHistory[9] = { ...h.sb.gameHistory[9] }; h.reply(); await work;
  assert.equal(h.sb.storySummary, '기존 요약'); assert.equal(h.saves.length, 0);
});
test('replaced story with same id does not accept old memory', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded(); h.sb.STORY = { id: 'test' }; h.reply(); await work;
  assert.equal(h.sb.storySummary, '기존 요약'); assert.equal(h.saves.length, 0);
});
test('old job cannot clear or block a new session job', async () => {
  const h = harness(), old = h.sb.summarizeIfNeeded();
  h.sb._turnEpoch++; h.sb.gameState = { chronicle: [] }; h.sb.gameHistory = history(40, 'new-session'); h.sb.storySummary = '새 세션 요약';
  const newer = h.sb.summarizeIfNeeded(), token = h.sb._summaryPending;
  assert.equal(h.requests.length, 2); h.reply(0, '옛 요약'); await old;
  assert.equal(h.sb._summaryPending, token); assert.equal(h.saves.length, 0);
  h.reply(1, '새 결과'); await newer;
  assert.equal(h.sb.storySummary, '새 결과'); assert.equal(h.saves.length, 1); assert.equal(h.sb._summaryPending, null);
});
test('network failure releases job for a later retry', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded(); h.requests[0].reject(new Error('offline')); await work;
  assert.equal(h.sb._summaryPending, null); assert.equal(h.sb.storySummary, '기존 요약');
  const retry = h.sb.summarizeIfNeeded(); assert.equal(h.requests.length, 2); h.reply(1); await retry;
  assert.equal(h.saves.length, 1);
});
test('malformed memory or incomplete JSON preserves all existing facts', async () => {
  for (const text of ['not json', '{"summary":"new"}', '{"summary":"new","chronicle":[2]}', '{"summary":"","chronicle":[]}']) {
    const h = harness(), work = h.sb.summarizeIfNeeded(); h.requests[0].resolve({ text }); await work;
    assert.equal(h.sb.storySummary, '기존 요약'); assert.deepEqual(h.sb.gameState.chronicle, ['기존 사실']);
    assert.equal(h.sb.summaryIndex, 4); assert.equal(h.saves.length, 0); assert.equal(h.sb._summaryPending, null);
  }
});
test('edited prior summary cannot be overwritten by an outdated request', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded(); h.sb.storySummary = '사용자가 바로잡은 요약'; h.reply(); await work;
  assert.equal(h.sb.storySummary, '사용자가 바로잡은 요약'); assert.equal(h.saves.length, 0);
});
test('truncation from either provider preserves prior memory', async () => {
  for (const finish of ['MAX_TOKENS', 'length']) {
    const h = harness(), work = h.sb.summarizeIfNeeded(); h.reply(0, '잘린 요약', ['불완전 사건'], finish); await work;
    assert.equal(h.sb.storySummary, '기존 요약'); assert.equal(h.sb.summaryIndex, 4);
    assert.equal(h.sb._summaryPending, null); assert.equal(h.toasts.length, 1); assert.equal(h.saves.length, 0);
  }
});
test('provider error and blocked response never commit JSON-looking partial output', async () => {
  for (const failure of [{ error: { code: 503 } }, { blocked: true }]) {
    const h = harness(), work = h.sb.summarizeIfNeeded();
    h.requests[0].resolve({ text: '{"summary":"partial","chronicle":[]}', ...failure }); await work;
    assert.equal(h.sb.storySummary, '기존 요약'); assert.equal(h.saves.length, 0);
  }
});
test('new chronicle entries are deduplicated without erasing known facts', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded(); h.reply(0, '새 요약', ['기존 사실', '새 사실', '새 사실', ' ']); await work;
  assert.deepEqual(Array.from(h.sb.gameState.chronicle), ['기존 사실', '새 사실']);
});
test('explicit empty chronicle commits a valid summary without changing facts', async () => {
  const h = harness(), work = h.sb.summarizeIfNeeded(); h.reply(0, '새 요약', []); await work;
  assert.equal(h.sb.storySummary, '새 요약'); assert.deepEqual(h.sb.gameState.chronicle, ['기존 사실']);
});
test('uncommitted history receipts postpone summary without dropping recovery data', async () => {
  for (const status of ['pending', 'failed']) {
    const h = harness(); h.sb.gameHistory[9]._stateExtract = { status };
    await h.sb.summarizeIfNeeded(); assert.equal(h.requests.length, 0); assert.equal(h.sb.summaryIndex, 4);
    h.sb.gameHistory[9]._stateExtract.status = 'applied';
    const work = h.sb.summarizeIfNeeded(); assert.equal(h.requests.length, 1); h.reply(); await work;
    assert.equal(h.saves.length, 1);
  }
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
  }
  console.log(`${cases.length - failed}/${cases.length} summary regressions passed`);
  if (failed) process.exitCode = 1;
})();
