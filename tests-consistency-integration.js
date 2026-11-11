// Execute production turn/recorder/rollback functions with the real consistency
// module. Only model transport and DOM rendering are fixtures. No network calls.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const C = require('./pandora-consistency.js');
const SRC = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const tests = [];
const T = (name, run) => tests.push([name, run]);
const copy = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function grab(name) {
  const match = new RegExp('\\n(?:async )?function ' + name + '\\(').exec(SRC);
  assert.ok(match, 'Missing production function ' + name);
  return SRC.slice(match.index, SRC.indexOf('\n}', match.index) + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const paper = () => ({ kind: 'purchase', item: '포장지', counterparty: '민서', delta: -3,
  evidence: '다온은 민서에게 3G를 지불하고 포장지를 받았다.', action_evidence: '', repeat_of: '' });
const scene = () => ({ narration: paper().evidence, dialogue: [] });
const answer = (tx = paper()) => ({ state_update: { gold: tx.delta }, transactions: [tx],
  choices: ['서고로 간다', '사서에게 인사한다'], chronicle: ['민서에게 포장지 3G 구매 완료'] });
function state() { return { rep: 0, gold: 10, location: '접수대', time: '1일차 오후', flags: {}, metChars: {},
  player: { injuries: [], abilities: [], note: '' }, chronicle: [], firedEvents: [], firedEventTurns: {} }; }

function harness(options = {}) {
  const calls = { model: [], apply: [], saves: [], choices: [], toasts: [], metrics: [], visible: [], perf: 0 };
  const elements = new Map(), timers = new Map(); let timerId = 0, time = 0;
  function node(tag) {
    const result = { tag, style: {}, children: [], attrs: {}, _text: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); return child; },
      remove() { elements.delete(this.id); } };
    Object.defineProperty(result, 'textContent', { get() { return this._text; }, set(value) { this._text = String(value); this.children = []; } });
    return result;
  }
  const initial = state();
  const sb = {
    console, JSON, Math, Number, String, Object, Array, Set, Map, Date, Promise, RegExp,
    PandoraConsistency: C,
    gameState: initial, gameHistory: [{ role: 'user', content: '포장지를 산다.' },
      { role: 'assistant', content: JSON.stringify(scene()), _turnBefore: { state: copy(initial), pendingEvent: null } }],
    turnCount: 1, STORY: { id: 'library', protagonist: { name: '다온' }, customBgs: {} },
    RPG_STORIES: new Set(['library']), BUILTIN_STORIES: { library: {} },
    CHARACTERS: { minseo: { name: '민서' }, junho: { name: '준호' } },
    dialogueQueue: [], dialogueLog: [], historyMode: false, replaying: false,
    sendBtn: { disabled: false }, userInput: { textContent: '', innerText: '' },
    document: { getElementById: id => elements.get(id) || null, createElement: node, body: node('body') },
    performance: { now: () => time += 5 },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    localStorage: { getItem: () => null },
    scrubMetaData: value => value, updateStatusUI() {},
    showStatToast: message => calls.toasts.push(message), showChoices: choices => calls.choices.push(copy(choices)),
    hideThinking() {}, showThinking() {}, enterInputMode() { sb.inputMode = true; },
    pandoraPerfRecord: (...args) => calls.metrics.push(args), recordTurnPerformance: () => calls.perf++,
    inputBar: { style: {} }, inputMode: true, histDropped: 0, turnSnaps: [],
    exitHistory() { sb.historyMode = false; }, detectActiveChars: () => ['minseo'],
    ...options.globals,
  };
  sb.window = sb;
  sb.autoSave = () => calls.saves.push(copy({ gameState: sb.gameState, gameHistory: sb.gameHistory, turnCount: sb.turnCount }));
  sb.processResponse = (data, active, stream, stateOnly) => {
    calls.apply.push({ data: copy(data), stateOnly });
    const patch = data.state_update || {};
    if (patch.gold) sb.gameState.gold += patch.gold;
    if (patch.location) sb.gameState.location = patch.location;
    if (Array.isArray(data.chronicle)) sb.gameState.chronicle.push(...data.chronicle);
    if (options.apply) options.apply(sb, data, stateOnly);
  };
  sb.llmSmall = async (...args) => {
    calls.model.push(args);
    return options.respond ? options.respond(...args) : JSON.stringify(answer());
  };
  vm.createContext(sb);
  const pipelineStart = SRC.indexOf('// ═══════════ 분리 응답 파이프라인');
  const pipelineEnd = SRC.indexOf('// ===== TEXT CHUNKING =====', pipelineStart);
  const helpers = ['stateExtractContract', 'createTurnConsistency', 'reviewTurnConsistency',
    'showTurnReviewNotice', 'clearTurnReviewNotice', 'regenerate'];
  vm.runInContext(helpers.map(grab).join('\n') + '\n' + SRC.slice(pipelineStart, pipelineEnd), sb, { timeout: 5000 });
  return { sb, calls, elements, timers, entry: () => sb.gameHistory[sb.gameHistory.length - 1] };
}
function fire(h, suppliedContext) {
  const entry = h.entry(), index = h.sb.gameHistory.indexOf(entry);
  return h.sb.fireStateExtract(h.sb.gameHistory[index - 1].content, JSON.parse(entry.content), ['minseo'], index, suppliedContext);
}
function appendScene(h, input, data = scene()) {
  const before = h.sb.rememberTurnBefore();
  for (const row of h.sb.gameHistory) delete row._turnBefore;
  h.sb.gameHistory.push({ role: 'user', content: input }, { role: 'assistant', content: JSON.stringify(data), _turnBefore: before });
  h.sb.turnCount++;
}
function restore(saved, options = {}) { return harness({ ...options, globals: { ...copy(saved), ...(options.globals || {}) } }); }

T('split request stores pre-turn context before transport, commits once and removes bulky context', async () => {
  const pending = deferred(), h = harness({ respond: () => pending.promise });
  const original = h.sb.createTurnConsistency('포장지를 산다.', 1, h.sb.gameHistory.slice(0, 1), h.entry()._turnBefore.state);
  const work = fire(h, original);
  await flush();
  assert.equal(h.calls.model.length, 1);
  const firstSave = h.calls.saves[0];
  assert.equal(firstSave.gameHistory[1]._stateExtract.status, 'pending');
  assert.equal(firstSave.gameHistory[1]._stateExtract.consistency.balance, 10);
  assert.match(h.calls.model[0][0], /transactions/);
  assert.match(h.calls.model[0][1], /이번 행동과 이미 끝난 사건/);
  pending.resolve(JSON.stringify(answer()));
  assert.equal(await work, true);
  assert.equal(h.sb.gameState.gold, 7);
  assert.equal(h.sb.gameState.settledEvents.receipts.length, 1);
  assert.equal(h.entry()._stateExtract.status, 'applied');
  assert.equal(h.entry()._stateExtract.consistency, undefined);
  assert.equal(JSON.parse(h.entry().content).transactions.length, 1);
  assert.equal(await fire(h), true);
  assert.equal(h.calls.model.length, 1);
  assert.equal(h.sb.gameState.gold, 7);
});

T('persisted pending request recovers with the same context and a late old request cannot apply', async () => {
  const reply = deferred(), h = harness({ respond: () => reply.promise });
  const work = fire(h); await flush();
  const saved = h.calls.saves[0];
  h.sb.resetTurnAsyncWork();
  const next = restore(saved);
  assert.equal(await next.sb.ensureStateExtractReady(), true);
  assert.equal(next.sb.gameState.gold, 7);
  assert.equal(next.sb.gameState.settledEvents.receipts[0].id, 'e1-1');
  reply.resolve(JSON.stringify(answer())); await work;
  assert.equal(h.sb.gameState.gold, 10);
  assert.equal(h.sb.gameState.settledEvents, undefined);
});

T('recorder receives monetary evidence in the middle of a long displayed scene', async () => {
  const transfer = { kind: 'reward', item: '장부 회수 사례금', counterparty: '민서', delta: 10,
    evidence: '민서는 다온에게 사례금으로 동전 열 개를 건넸다.', action_evidence: '', repeat_of: '' };
  const h = harness({ respond: (system, user) => {
    assert.ok(user.includes(transfer.evidence), 'recording prompt silently discarded the completed transfer');
    return JSON.stringify({ state_update: { gold: 10 }, transactions: [transfer], chronicle: ['사례금 10닢을 받았다'] });
  } });
  h.sb.gameState.gold = 0; h.entry()._turnBefore.state.gold = 0;
  h.sb.gameHistory[0].content = '민서에게 장부를 돌려준다.';
  h.entry().content = JSON.stringify({ narration: '책장에는 오래된 서류들이 정리되어 있었다. '.repeat(180)
    + transfer.evidence + ' 창밖의 빛이 접수대를 조용히 비췄다.'.repeat(180), dialogue: [] });
  assert.ok(JSON.parse(h.entry().content).narration.length > 8000);
  assert.equal(await fire(h), true);
  assert.equal(h.sb.gameState.gold, 10);
  assert.equal(h.calls.model.length, 1);
  assert.equal(h.sb.gameState.settledEvents.receipts[0].delta, 10);
});

T('actual reproduced duplicate becomes durable review, including location and memory remaining uncommitted', async () => {
  let reply = answer();
  const h = harness({ respond: () => JSON.stringify(reply) });
  await fire(h);
  const correct = copy(h.sb.gameState);
  appendScene(h, '거래 없이 접수대를 떠나 지하 서고로 내려가 준호 옆에 앉는다.',
    { narration: paper().evidence + ' 다온은 지하 서고로 내려갔다.', dialogue: [] });
  reply = { ...answer(), state_update: { gold: -3, location: '지하 서고' }, chronicle: ['민서에게 다시 포장지를 샀다'] };
  assert.equal(await fire(h), false);
  assert.equal(h.entry()._stateExtract.status, 'review');
  assert.deepEqual(copy(h.sb.gameState), correct);
  assert.ok(h.elements.has('turnReviewNotice'));
  assert.match(h.elements.get('turnReviewNotice').textContent, /확정하지 않았/);
  const save = h.calls.saves[h.calls.saves.length - 1];
  assert.equal(save.gameHistory.at(-1)._stateExtract.status, 'review');
  assert.equal(save.gameState.gold, 7);
});

T('review state never makes another extraction call on next input, explicit extraction retry, or reload', async () => {
  const h = harness(); await fire(h);
  appendScene(h, '준호에게 인사한다.');
  await fire(h);
  const calls = h.calls.model.length;
  assert.equal(await h.sb.ensureStateExtractReady(), false);
  assert.equal(await fire(h), false);
  h.sb.resumeStateExtract(); await flush();
  assert.equal(h.calls.model.length, calls);
  const saved = h.calls.saves[h.calls.saves.length - 1], next = restore(saved);
  assert.equal(await next.sb.ensureStateExtractReady(), false);
  next.sb.resumeStateExtract(); await flush();
  assert.equal(next.calls.model.length, 0);
  assert.equal(next.sb.gameState.gold, 7);
});

T('applied save reload retains ledger and does not call the model', async () => {
  const h = harness(); await fire(h);
  const saved = h.calls.saves[h.calls.saves.length - 1], next = restore(saved);
  assert.equal(await next.sb.ensureStateExtractReady(), true);
  assert.equal(next.calls.model.length, 0);
  assert.deepEqual(copy(next.sb.gameState.settledEvents), saved.gameState.settledEvents);
});

T('real explicit second purchase survives recorder integration', async () => {
  let reply = answer();
  const h = harness({ respond: () => JSON.stringify(reply) }); await fire(h);
  const input = '포장지를 한 장 더 산다.';
  appendScene(h, input);
  reply = answer({ ...paper(), action_evidence: input, repeat_of: h.sb.gameState.settledEvents.receipts[0].id });
  assert.equal(await fire(h), true);
  assert.equal(h.sb.gameState.gold, 4);
  assert.equal(h.sb.gameState.settledEvents.receipts.length, 2);
  assert.equal(h.entry()._stateExtract.status, 'applied');
});

T('state render exception rolls back gold and original history before retrying one receipt', async () => {
  let fail = true;
  const h = harness({ apply: () => { if (fail) { fail = false; throw new Error('fixture rendering failed'); } } });
  const original = copy(h.sb.gameState), originalEntry = h.entry().content;
  assert.equal(await fire(h), false);
  assert.deepEqual(copy(h.sb.gameState), original);
  assert.equal(h.entry().content, originalEntry);
  assert.equal(h.entry()._stateExtract.status, 'failed');
  assert.equal(await h.sb.ensureStateExtractReady(), true);
  assert.equal(h.sb.gameState.gold, 7);
  assert.equal(h.sb.gameState.settledEvents.receipts.length, 1);
});

T('failure after ledger commit rolls back both ledger and money together', async () => {
  const h = harness(), actualCommit = h.sb.commitPendingEventFrom;
  h.sb.commitPendingEventFrom = () => { throw new Error('fixture event rendering failed after receipt commit'); };
  const original = copy(h.sb.gameState);
  assert.equal(await fire(h), false);
  assert.deepEqual(copy(h.sb.gameState), original);
  assert.equal(h.entry()._stateExtract.status, 'failed');
  h.sb.commitPendingEventFrom = actualCommit;
  assert.equal(await h.sb.ensureStateExtractReady(), true);
  assert.equal(h.sb.gameState.gold, 7);
  assert.equal(h.sb.gameState.settledEvents.next, 2);
});

T('manual regenerate restores pre-turn state and ledger while retaining player input', async () => {
  const h = harness(); await fire(h);
  appendScene(h, '준호에게 인사한다.'); await fire(h);
  let received;
  h.sb.callGemini = async () => { received = copy({ state: h.sb.gameState, history: h.sb.gameHistory, turn: h.sb.turnCount }); };
  await h.sb.regenerate();
  assert.equal(received.state.gold, 7);
  assert.equal(received.state.settledEvents.receipts.length, 1);
  assert.equal(received.history.at(-1).role, 'user');
  assert.equal(received.history.at(-1).content, '준호에게 인사한다.');
  assert.equal(received.turn, 1);
  assert.equal(h.elements.has('turnReviewNotice'), false);
});

T('undoing a valid purchase restores money and removes its receipt before new generation', async () => {
  const h = harness(); await fire(h);
  let received;
  h.sb.callGemini = async () => { received = copy(h.sb.gameState); };
  await h.sb.regenerate();
  assert.equal(received.gold, 10);
  assert.equal(received.settledEvents, undefined);
  assert.equal(h.sb.gameHistory.length, 1);
});

function installMain(h, response, split = false) {
  const main = { requests: [], summaries: 0 };
  Object.assign(h.sb, {
    playerName: '다온', playerDesc: '', lastBg: '접수대', currentBgFile: '접수대', shownSprites: [],
    autoTimer: null, isShowing: false, waitingForTap: false, FREE_TEST_MODE: true,
    resetTurnLineKeys() { h.sb._turnLineKeys = new Set(); },
    setBg(bg) { h.sb.lastBg = bg; h.sb.currentBgFile = bg; },
    WORLD_PROMPT: '', ENGINE_MOD_RPG: '', ENGINE_MOD_CG: '', ENGINE_MOD_IDOL: '',
    CG_MANIFEST: {}, STORY_BG_FILES: {}, presentCharIds: () => [], eraToneRule: () => '', buildStatePrompt: () => '',
    buildMessages: () => h.sb.gameHistory.map(row => ({ role: row.role, content: row.content })),
    resetDialogueLift() {}, PROVIDER: 'test', NIM_MODEL: 'test-model',
    extractStreamUnits: () => ({ narration: null, narrationPartial: null, dialogues: [] }),
    isSoftRefusal: () => false, fixSpeakerIds() {}, recTokens() {},
    showDialogue: lines => h.calls.visible.push(copy(lines)),
    summarizeIfNeeded: () => main.summaries++, waitWithCountdown: () => { throw new Error('Unexpected automatic retry'); },
    fetchNim: async (...args) => {
      main.requests.push(args);
      return { text: JSON.stringify(typeof response === 'function' ? response() : response), finishReason: 'stop',
        modelUsed: 'fixture:free', timing: { total: 20, ttfb: 10 } };
    },
  });
  h.sb.localStorage.getItem = () => JSON.stringify({ splitPipe: split });
  vm.runInContext(['sceneOutputContract', 'discardIncompleteScene', 'discardInconsistentScene', 'callGemini'].map(grab).join('\n'), h.sb);
  return main;
}

T('integrated production call requests transaction proof and commits one model reply', async () => {
  const h = harness(); h.sb.gameHistory = h.sb.gameHistory.slice(0, 1); h.sb.turnCount = 0;
  const main = installMain(h, { ...scene(), ...answer() });
  await h.sb.callGemini(['minseo']); await flush();
  assert.equal(main.requests.length, 1);
  assert.match(main.requests[0][0], /transactions/);
  assert.match(main.requests[0][1].at(-1).content, /이번 행동과 이미 끝난 사건/);
  assert.equal(h.calls.model.length, 0, 'integrated turn must not invoke a recorder');
  assert.equal(h.sb.gameState.gold, 7);
  assert.equal(h.sb.gameState.settledEvents.receipts.length, 1);
  assert.equal(h.sb.turnCount, 1);
  assert.equal(main.summaries, 1);
});

T('integrated duplicate stops before state, completed history and summary are changed', async () => {
  const h = harness(); await fire(h);
  h.sb.gameHistory.push({ role: 'user', content: '서고로 내려간다.' });
  const beforeState = copy(h.sb.gameState), beforeHistory = copy(h.sb.gameHistory), beforeTurn = h.sb.turnCount;
  const main = installMain(h, { ...scene(), ...answer() });
  await h.sb.callGemini(['minseo']); await flush();
  const after = copy(h.sb.gameState); delete after._turnStats;
  assert.deepEqual(after, beforeState);
  assert.deepEqual(copy(h.sb.gameHistory), beforeHistory);
  assert.equal(h.sb.turnCount, beforeTurn);
  assert.equal(main.requests.length, 1);
  assert.equal(main.summaries, 0);
  assert.ok(h.elements.has('turnReviewNotice'));
  assert.equal(h.sb.sendBtn.disabled, false);
  assert.equal(h.sb.inputMode, true);
});

T('integrated render failure rolls back state/receipt/history and leaves manual recovery visible', async () => {
  const h = harness({ apply: () => { throw new Error('fixture renderer failure'); } });
  h.sb.gameHistory = h.sb.gameHistory.slice(0, 1); h.sb.turnCount = 0;
  const main = installMain(h, { ...scene(), ...answer() });
  await h.sb.callGemini(['minseo']); await flush();
  assert.equal(h.sb.gameState.gold, 10);
  assert.equal(h.sb.gameState.settledEvents, undefined);
  assert.equal(h.sb.gameHistory.length, 1);
  assert.equal(h.sb.turnCount, 0);
  assert.equal(main.summaries, 0);
  assert.equal(h.sb.sendBtn.disabled, false);
  assert.equal(h.sb.inputMode, true, 'failed turn must restore input controls');
  assert.ok(h.calls.visible.length, 'failed turn must show a recoverable error');
});

(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} consistency integration regressions passed`);
  if (failed) process.exitCode = 1;
})();
