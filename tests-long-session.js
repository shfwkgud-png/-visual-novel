'use strict';
// Long-history transport/storage checks using production memory and save functions.
// Responses are deterministic local fixtures: this does NOT measure LLM memory,
// prose quality, provider latency, or physical mobile-OS suspension.
// Run: node tests-long-session.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tests = [];
const test = (name, run) => tests.push({ name, run });
const PROMISE = '민서와 내일 오전 10시 위층 열람실에서 장부를 확인한다. 준호에게는 알리지 않았다.';
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: v => resolve(v) }; };

function grab(name) {
  const match = new RegExp('\n(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(match, 'missing production function ' + name);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}

function newSession(saved, sharedStore = new Map()) {
  const calls = [], toasts = [];
  let failSummary = false, heldSummary = null;
  const initial = {
    gameState: { gold: 7, rep: 0, location: '도서관 접수대', time: '1일차 아침', flags: {},
      player: { note: PROMISE, injuries: [], abilities: [] },
      metChars: { guide: { name: '민서', knows: PROMISE }, friend: { name: '준호', knows: '' } }, chronicle: [] },
    gameHistory: [], storySummary: '', summaryIndex: 0, histDropped: 0, dlogDropped: 0,
    turnCount: 0, dialogueLog: [], lastBg: null, playerName: '다온', playerDesc: '성인 방문객',
  };
  const sb = {
    console, JSON, String, Number, Boolean, Object, Array, Set, Map, Date, Math, Promise,
    ...initial, ...(saved ? clone(saved) : {}),
    STORY: { id: 'u_long_fixture' }, _turnEpoch: 1,
    HISTORY_MAX: 60, DIALOG_MAX: 600, SUMMARY_KEEP: 16, SUMMARY_INTERVAL: 8,
    RECENT_CHARS_CAP: 120000, CONTEXT_RECENT: 10, AI_CONTEXT_MODE: 'balanced',
    SNAP_MAX: 30, SNAP_BYTES: 2000000, turnSnaps: [], snapWarned: false,
    SAVE_DATA_VERSION: 5, PROVIDER: 'openrouter', NIM_URL: '', API_KEY: '',
    modelCtxTokens: () => 128000,
    sendBtn: { disabled: false }, document: { getElementById: () => null },
    bulkSetSilent: (key, value) => { sharedStore.set(key, String(value)); return true; },
    bulkGet: key => sharedStore.get(key) ?? null, bulkDel: key => sharedStore.delete(key),
    saveKeyFor: id => 'vn_save_' + id, snapKeyFor: id => 'vn_snaps_' + id,
    persistCfg: () => {}, scheduleAutoBackup: () => {},
    updateStatusUI: () => {}, showStatToast: message => toasts.push(message),
    callLlmTask: async (system, messages, options) => {
      const input = messages.map(m => m.content).join('\n');
      const ids = [...new Set([...input.matchAll(/\[E(\d+)\]/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
      const result = { text: JSON.stringify({
        summary: PROMISE + ' ' + ids.map(id => `[E${id}]`).join(' '), chronicle: [],
      }), finishReason: 'stop' };
      calls.push({ system, input, options, ids });
      if (heldSummary) { const hold = heldSummary; heldSummary = null; await hold.promise; }
      return failSummary ? { error: { code: 503 }, text: '' } : result;
    },
  };
  sb.window = sb;
  vm.createContext(sb);
  const functions = ['recentWindowCount', 'trimHistory', 'autoSave', 'summarizeIfNeeded',
    'turnWorkScope', 'turnWorkIsCurrent', 'resetTurnAsyncWork', 'rememberTurnBefore',
    'assistantTurnCheckpoint', 'rollbackAssistantTurn', 'captureSnap', 'persistSnaps', 'loadSnaps'];
  vm.runInContext(functions.map(grab).join('\n'), sb);
  return {
    sb, calls, toasts, store: sharedStore,
    fail: value => { failSummary = value; }, hold: value => { heldSummary = value; },
    saved: () => JSON.parse(sharedStore.get('vn_save_u_long_fixture')),
  };
}

function appendTurn(h, n, padding = '') {
  const { sb } = h;
  sb.captureSnap(`장부 ${n}쪽 확인`);
  const checkpoint = sb.rememberTurnBefore();
  // These states are test fixtures. The test checks they survive the actual
  // save/trim/summary path, not whether a model would have inferred them.
  sb.gameState.fixturePage = n;
  sb.gameHistory.push({ role: 'user', content: `[E${n * 2 - 1}] 장부 ${n}쪽을 확인한다. ${padding}` },
    { role: 'assistant', content: JSON.stringify({
      narration: `[E${n * 2}] 장부 ${n}쪽을 확인했다. ${padding}`,
      dialogue: [{ speaker: '민서', char_id: 'guide', text: '확인했습니다.' }],
      state_update: {}, choices: ['다음 쪽을 확인한다', '잠시 쉰다'],
    }), _stateExtract: { id: 'fixture-' + n, turn: n, status: 'applied' }, _turnBefore: checkpoint });
  sb.turnCount = n;
  sb.autoSave();
}

async function play(h, from, to, options = {}) {
  for (let n = from; n <= to; n++) {
    appendTurn(h, n, options.padding || '');
    await h.sb.summarizeIfNeeded();
    h.sb.autoSave();
    if (options.afterTurn) options.afterTurn(n);
  }
}

function assertAllEntriesReachContext(h, turns) {
  const sb = h.sb;
  const context = sb.storySummary + JSON.stringify(sb.gameHistory.slice(-sb.recentWindowCount()));
  for (let id = 1; id <= turns * 2; id++) assert.ok(context.includes(`[E${id}]`), 'entry lost before next prompt: ' + id);
  assert.ok(sb.recentWindowCount() >= sb.gameHistory.length - sb.summaryIndex,
    'context window dropped original text that had no successful summary');
}

test('50 completed turns repeatedly summarize and trim without losing covered or original facts', async () => {
  const h = newSession();
  await play(h, 1, 50, { padding: '장부의 세부를 확인한다. '.repeat(120) });
  assert.equal(h.sb.turnCount, 50); assert.equal(h.sb.gameHistory.length, 60);
  assert.equal(h.sb.histDropped, 40); assert.ok(h.calls.length >= 5);
  assertAllEntriesReachContext(h, 50);
  assert.equal(h.saved().gameState.metChars.guide.knows, PROMISE);
  assert.equal(h.saved().gameState.metChars.friend.knows, '');
  assert.equal(h.saved().gameState.gold, 7);
  assert.equal(h.saved().storySummary, h.sb.storySummary);
  assert.ok(h.sb.turnSnaps.length <= 30);
  assert.equal(h.sb.histDropped + h.sb.gameHistory.length, 100);
  assert.ok(h.calls.every(call => call.options.task === 'summary' && call.options.json === true));
});

test('50-turn summary outage retains every unsummarized original, then recovers into the bounded save', async () => {
  const h = newSession(); h.fail(true);
  await play(h, 1, 50, { padding: '아직 요약하지 않은 근거. '.repeat(160) });
  assert.equal(h.sb.summaryIndex, 0); assert.equal(h.sb.histDropped, 0);
  assert.equal(h.sb.gameHistory.length, 100);
  assert.equal(h.sb.recentWindowCount(), 100, 'failed summaries were silently replaced by a size cap');
  assertAllEntriesReachContext(h, 50);
  const restored = newSession(h.saved());
  assertAllEntriesReachContext(restored, 50);
  await restored.sb.summarizeIfNeeded();
  assert.equal(restored.sb.gameHistory.length, 60);
  assert.equal(restored.sb.histDropped, 40);
  assertAllEntriesReachContext(restored, 50);
});

test('unfinished receipt in an imported long history remains recoverable and is never turned into settled memory', async () => {
  const h = newSession();
  for (let n = 1; n <= 50; n++) appendTurn(h, n);
  const entry = h.sb.gameHistory.find(x => x._stateExtract?.turn === 9);
  entry._stateExtract.status = 'failed'; h.sb.autoSave();
  await h.sb.summarizeIfNeeded();
  assert.equal(h.calls.length, 0);
  const restored = newSession(h.saved());
  const receipt = restored.sb.gameHistory.find(x => x._stateExtract?.turn === 9);
  assert.equal(receipt._stateExtract.status, 'failed');
  await restored.sb.summarizeIfNeeded(); assert.equal(restored.calls.length, 0);
  assertAllEntriesReachContext(restored, 50);
  receipt._stateExtract.status = 'applied';
  await restored.sb.summarizeIfNeeded();
  assert.equal(restored.calls.length, 1);
  assertAllEntriesReachContext(restored, 50);
});

test('old summary completing after a 25-turn restore cannot overwrite restored facts or history boundaries', async () => {
  const h = newSession(); let at25;
  await play(h, 1, 50, { afterTurn: n => { if (n === 25) at25 = h.saved(); } });
  appendTurn(h, 51); appendTurn(h, 52);
  const gate = deferred(); h.hold(gate);
  const old = h.sb.summarizeIfNeeded();
  assert.ok(h.sb._summaryPending);
  h.sb.resetTurnAsyncWork();
  Object.assign(h.sb, clone(at25));
  const before = clone({ state: h.sb.gameState, history: h.sb.gameHistory,
    summary: h.sb.storySummary, index: h.sb.summaryIndex, dropped: h.sb.histDropped });
  gate.resolve(); await old;
  assert.deepEqual(clone({ state: h.sb.gameState, history: h.sb.gameHistory,
    summary: h.sb.storySummary, index: h.sb.summaryIndex, dropped: h.sb.histDropped }), before);
  assertAllEntriesReachContext(h, 25);
  await play(h, 26, 30);
  assertAllEntriesReachContext(h, 30);
});

test('latest undo checkpoint survives 50 turns, history trimming, JSON persistence and session restart', async () => {
  const h = newSession(); await play(h, 1, 50);
  const saved = h.saved(), restored = newSession(saved, h.store);
  restored.sb.loadSnaps();
  assert.equal(restored.sb.turnSnaps.length, 30);
  assert.equal(restored.sb.turnSnaps.at(-1).turn, 49);
  const entry = restored.sb.gameHistory.at(-1);
  const checkpoint = clone(entry._turnBefore.state);
  assert.equal(checkpoint.fixturePage, 49);
  assert.equal(restored.sb.rollbackAssistantTurn(entry), true);
  assert.deepEqual(clone(restored.sb.gameState), checkpoint);
  assert.equal(restored.sb.gameState.metChars.guide.knows, PROMISE);
  assert.equal(restored.sb.gameState.metChars.friend.knows, '');
  assert.equal(restored.calls.length, 0);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} long-session regressions passed. All summaries were local fixtures.`);
  if (failed) process.exitCode = 1;
})();
