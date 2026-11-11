// PANDORA v360: state extraction persistence, ordering and transaction regressions.
// No network calls or real API keys. Run: node tests-state-recovery.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const tests = [];
const T = (name, fn) => tests.push([name, fn]);
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function grabFn(name) {
  const match = new RegExp('\\n(?:async )?function ' + name + '\\(').exec(SRC);
  assert.ok(match, 'Missing production function: ' + name);
  const end = SRC.indexOf('\n}', match.index);
  assert.ok(end > match.index, 'Missing function end: ' + name);
  return SRC.slice(match.index, end + 2);
}

function extractionCode() {
  const start = SRC.indexOf('// ═══════════ 분리 응답 파이프라인');
  const end = SRC.indexOf('// ===== TEXT CHUNKING =====', start);
  assert.ok(start >= 0 && end > start, 'State pipeline section not found');
  let code = grabFn('stateExtractContract') + '\n' + SRC.slice(start, end);
  for (const name of ['resetTurnAsyncWork', 'rollbackAssistantTurn']) {
    if (!new RegExp('function ' + name + '\\(').test(code)) code += '\n' + grabFn(name);
  }
  return code;
}

function sandbox(options = {}) {
  const state = {
    rep: 1, gold: 10, location: '광장', time: '2일차 아침', flags: {},
    metChars: { old: { name: '기존 인물', intimacy: 20 } },
    player: { abilities: [], injuries: ['발목 부상'], note: '' },
    chronicle: [], firedEvents: [], firedEventTurns: {},
  };
  const scene = { narration: '광장에서 새로운 인물과 인사했다.', dialogue: [] };
  const history = [{ role: 'user', content: '광장으로 간다' },
    { role: 'assistant', content: JSON.stringify(scene) }];
  const calls = { requests: [], apply: [], saves: [], choices: [], toasts: [], metrics: [] };
  const timers = new Map();
  let nextTimer = 0;
  const sb = {
    console, JSON, Math, String, Array, Object, RegExp, Number, Set, Map, Date, Promise,
    performance: { now: () => 100 },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    gameState: clone(state), gameHistory: clone(history), turnCount: 3,
    STORY: { id: 'hero' }, RPG_STORIES: new Set(['hero']),
    CHARACTERS: { old: { name: '기존 인물' }, fresh: { name: '새 인물' } },
    dialogueQueue: [], historyMode: false, replaying: false,
    sendBtn: { disabled: false }, userInput: { textContent: '', innerText: '' },
    document: { getElementById: () => null },
    localStorage: { getItem: () => null },
    scrubMetaData: value => value,
    showStatToast: message => calls.toasts.push(message),
    showChoices: choices => calls.choices.push(clone(choices)),
    updateStatusUI: () => {},
    enterInputMode: () => {}, hideThinking: () => {}, showThinking: () => {},
    pandoraPerfRecord: (...args) => calls.metrics.push(args),
    ...options.globals,
  };
  sb.window = sb;
  sb.autoSave = () => calls.saves.push(clone({
    gameState: sb.gameState, gameHistory: sb.gameHistory, turnCount: sb.turnCount,
  }));
  sb.processResponse = (data, activeIds, stream, stateOnly) => {
    calls.apply.push({ data: clone(data), activeIds: clone(activeIds), stateOnly });
    if (options.apply) return options.apply(sb, data, activeIds, stream, stateOnly);
    const s = data.state_update || {};
    if (typeof s.gold === 'number') sb.gameState.gold += s.gold;
    if (typeof s.rep === 'number') sb.gameState.rep += s.rep;
    if (s.location) sb.gameState.location = s.location;
    if (Array.isArray(s.player && s.player.injuries)) sb.gameState.player.injuries = s.player.injuries.slice();
    if (Array.isArray(data.chronicle)) sb.gameState.chronicle.push(...data.chronicle);
  };
  sb.llmSmall = async (...args) => {
    calls.requests.push(args);
    return options.respond ? options.respond(...args) : JSON.stringify({ state_update: { gold: 4 }, choices: ['둘러본다', '인사한다'] });
  };
  vm.createContext(sb);
  vm.runInContext(extractionCode(), sb, { timeout: 5000 });
  return { sb, calls, timers, scene, entry: sb.gameHistory[sb.gameHistory.length - 1] };
}

function fire(ctx, activeIds = ['old']) {
  const index = ctx.sb.gameHistory.indexOf(ctx.entry);
  return ctx.sb.fireStateExtract('광장으로 간다', JSON.parse(ctx.entry.content), activeIds, index);
}

T('same response requested twice: one API call, one state commit', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  const first = fire(c), second = fire(c);
  await flush();
  assert.equal(c.calls.requests.length, 1);
  assert.equal(c.calls.apply.length, 0);
  assert.ok(c.sb._splitExtractPending);
  reply.resolve(JSON.stringify({ state_update: { gold: 4, combat: true }, choices: ['둘러본다', '인사한다'], chronicle: ['광장에 도착했다'] }));
  await Promise.all([first, second]);
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.calls.apply.length, 1);
  assert.equal(c.calls.apply[0].stateOnly, true);
  assert.ok(!('combat' in c.calls.apply[0].data.state_update));
  assert.equal(c.entry._stateExtract.status, 'applied');
  assert.equal(c.sb._splitExtractPending, null);
  await fire(c);
  assert.equal(c.calls.requests.length, 1, 'already applied response requested again');
  assert.equal(c.sb.gameState.gold, 14);
});

T('pending save reload: recover once, then applied reload performs no API call', async () => {
  const oldReply = deferred();
  const old = sandbox({ respond: () => oldReply.promise });
  const abandoned = fire(old);
  await flush();
  assert.equal(old.entry._stateExtract.status, 'pending');
  const saved = clone({ gameHistory: old.sb.gameHistory, gameState: old.sb.gameState, turnCount: old.sb.turnCount });
  old.sb.resetTurnAsyncWork();
  const resumed = sandbox({ globals: saved });
  assert.equal(await resumed.sb.ensureStateExtractReady(), true);
  assert.equal(resumed.calls.requests.length, 1);
  assert.equal(resumed.sb.gameState.gold, 14);
  assert.equal(resumed.entry._stateExtract.status, 'applied');
  assert.equal(await resumed.sb.ensureStateExtractReady(), true);
  assert.equal(resumed.calls.requests.length, 1);
  const appliedSave = clone({ gameHistory: resumed.sb.gameHistory, gameState: resumed.sb.gameState, turnCount: resumed.sb.turnCount });
  const applied = sandbox({ globals: appliedSave });
  assert.equal(await applied.sb.ensureStateExtractReady(), true);
  assert.equal(applied.calls.requests.length, 0);
  assert.equal(applied.sb.gameState.gold, 14);
  oldReply.resolve(JSON.stringify({ state_update: { gold: 900 } }));
  await abandoned;
  assert.equal(old.sb.gameState.gold, 10, 'old session committed after reset');
});

T('malformed extraction stays recoverable and a later retry commits exactly once', async () => {
  let attempt = 0;
  const c = sandbox({ respond: async () => ++attempt === 1 ? '{broken' : JSON.stringify({ state_update: { gold: 4 }, choices: [] }) });
  await fire(c);
  assert.equal(c.entry._stateExtract.status, 'failed');
  assert.equal(c.sb.gameState.gold, 10);
  assert.equal(c.calls.apply.length, 0);
  assert.equal(await c.sb.ensureStateExtractReady(), true);
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.entry._stateExtract.status, 'applied');
  await c.sb.ensureStateExtractReady();
  assert.equal(c.calls.apply.length, 1);
});

T('partial state-apply exception rolls back data before retry', async () => {
  let fail = true;
  const c = sandbox({ apply: (sb, data) => {
    sb.gameState.gold += data.state_update.gold;
    sb.gameState.player.injuries = [];
    if (fail) { fail = false; throw new Error('simulated apply failure'); }
  } });
  const original = clone(c.sb.gameState);
  const originalContent = c.entry.content;
  await fire(c);
  assert.deepEqual(clone(c.sb.gameState), original);
  assert.equal(c.entry.content, originalContent, 'failed state was merged into history');
  assert.equal(c.entry._stateExtract.status, 'failed');
  assert.equal(await c.sb.ensureStateExtractReady(), true);
  assert.equal(c.sb.gameState.gold, 14, 'partial failure was counted twice');
  assert.equal(c.entry._stateExtract.status, 'applied');
});

for (const kind of ['state replacement', 'history replacement', 'epoch change', 'turn advance']) {
  T('stale result is rejected after ' + kind, async () => {
    const reply = deferred();
    const c = sandbox({ respond: () => reply.promise });
    const work = fire(c);
    await flush();
    const saves = c.calls.saves.length;
    if (kind === 'state replacement') c.sb.gameState = clone(c.sb.gameState);
    if (kind === 'history replacement') c.sb.gameHistory = clone(c.sb.gameHistory);
    if (kind === 'epoch change') c.sb.resetTurnAsyncWork();
    if (kind === 'turn advance') c.sb.turnCount++;
    reply.resolve(JSON.stringify({ state_update: { gold: 900 }, choices: ['오래된 선택지'] }));
    await work;
    assert.equal(c.sb.gameState.gold, 10);
    assert.equal(c.calls.apply.length, 0);
    assert.equal(c.calls.saves.length, saves, 'stale result wrote a save');
    assert.equal(c.calls.choices.length, 0, 'stale choices entered current screen');
  });
}

T('old completion cannot clear the new session pending task', async () => {
  const firstReply = deferred(), secondReply = deferred();
  let request = 0;
  const c = sandbox({ respond: () => ++request === 1 ? firstReply.promise : secondReply.promise });
  const old = fire(c);
  await flush();
  c.sb.resetTurnAsyncWork();
  c.sb.gameState = clone(c.sb.gameState);
  c.sb.gameHistory = clone(c.sb.gameHistory);
  c.entry = c.sb.gameHistory[c.sb.gameHistory.length - 1];
  const current = c.sb.ensureStateExtractReady();
  await flush();
  const active = c.sb._splitExtractPending;
  assert.ok(active);
  firstReply.resolve(JSON.stringify({ state_update: { gold: 900 } }));
  await old;
  assert.equal(c.sb._splitExtractPending, active);
  secondReply.resolve(JSON.stringify({ state_update: { gold: 4 }, choices: [] }));
  assert.equal(await current, true);
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.sb._splitExtractPending, null);
});

T('newly speaking characters are included, unknown IDs excluded', async () => {
  const c = sandbox();
  c.entry.content = JSON.stringify({ narration: '인사했다.', dialogue: [
    { speaker: '새 인물', char_id: 'fresh', text: '안녕하세요.' },
    { speaker: '주인공', char_id: null, text: '반가워요.' },
    { speaker: '없는 인물', char_id: 'missing', text: '없음' },
  ] });
  await fire(c, ['old', 'old', 'missing']);
  assert.deepEqual(Array.from(c.entry._stateExtract.activeCharIds).sort(), ['fresh', 'old']);
  const userPrompt = c.calls.requests[0][1];
  assert.ok(userPrompt.includes('fresh=새 인물'));
  assert.ok(userPrompt.includes('old=기존 인물'));
  assert.ok(!userPrompt.includes('missing='));
});

T('history trimming preserves the exact pending response and commits to its moved position', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  c.sb.gameHistory.unshift({ role: 'user', content: '오래된 입력' }, { role: 'assistant', content: '{"narration":"오래된 응답"}' });
  const work = fire(c);
  await flush();
  c.sb.gameHistory = c.sb.gameHistory.slice(2);
  reply.resolve(JSON.stringify({ state_update: { gold: 4 }, choices: [] }));
  assert.equal(await work, true);
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(JSON.parse(c.sb.gameHistory[1].content).state_update.gold, 4);
  assert.equal(c.sb.gameHistory[1], c.entry);
});

T('extraction confirms its own event without clearing a different pending event', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  c.sb._pendingEvent = { t: '광장 모임', tries: 0 };
  const work = fire(c);
  await flush();
  c.sb._pendingEvent = { t: '다른 모임', tries: 0 };
  reply.resolve(JSON.stringify({ state_update: { event: '광장 모임' }, choices: [] }));
  await work;
  assert.equal(c.sb.gameState.firedEventTurns['광장 모임'], 3);
  assert.equal(c.sb._pendingEvent.t, '다른 모임');
  assert.equal(c.sb._pendingEvent.tries, 0);
});

T('choices-only response is not mistaken for a successful state commit', async () => {
  const c = sandbox({ respond: async () => JSON.stringify({ choices: ['첫 선택', '둘째 선택'] }) });
  assert.equal(await fire(c), false);
  assert.equal(c.entry._stateExtract.status, 'failed');
  assert.equal(c.calls.apply.length, 0);
  assert.equal(c.sb.gameState.gold, 10);
});

T('explicit empty state object completes a no-change turn without blocking the next input', async () => {
  const c = sandbox({ respond: async () => JSON.stringify({ state_update: {}, choices: ['둘러본다', '기다린다'], chronicle: [] }) });
  const before = clone(c.sb.gameState);
  assert.equal(await fire(c), true);
  assert.deepEqual(clone(c.sb.gameState), before);
  assert.equal(c.entry._stateExtract.status, 'applied');
  assert.deepEqual(JSON.parse(c.entry.content).state_update, {});
  assert.equal(await c.sb.ensureStateExtractReady(), true);
  assert.equal(c.calls.requests.length, 1, 'unchanged turn was unnecessarily retried');
  assert.equal(c.calls.choices.length, 1);
  assert.equal(c.sb._splitExtractPending, null);
});

T('barrier waits for completed state commit and reuses an in-flight request', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  const work = fire(c);
  let advanced = false;
  const ready = c.sb.ensureStateExtractReady().then(value => {
    assert.equal(c.sb.gameState.gold, 14, 'barrier released before state commit');
    advanced = true;
    return value;
  });
  await flush();
  assert.equal(advanced, false);
  assert.equal(c.calls.requests.length, 1);
  reply.resolve(JSON.stringify({ state_update: { gold: 4 }, choices: [] }));
  await work;
  assert.equal(await ready, true);
  assert.equal(advanced, true);
});

T('legacy history without recovery metadata is not re-extracted speculatively', async () => {
  const c = sandbox();
  assert.equal(await c.sb.ensureStateExtractReady(), true);
  assert.equal(c.calls.requests.length, 0);
  assert.equal(c.sb.gameState.gold, 10);
});

T('regenerate restores the original turn state before applying its replacement', async () => {
  const c = sandbox();
  c.sb._pendingEvent = { t: '광장 모임', tries: 0 };
  c.entry._turnBefore = c.sb.rememberTurnBefore();
  await fire(c);
  assert.equal(c.sb.gameState.gold, 14);
  c.sb.inputBar = { style: {} };
  c.sb.inputMode = false;
  c.sb.dialogueLog = [{ isPlayer: true, text: '광장으로 간다' }, { text: '광장에 도착했다' }];
  c.sb.detectActiveChars = () => [];
  let regenerationBase;
  c.sb.callGemini = async () => { regenerationBase = c.sb.gameState.gold; c.sb.gameState.gold += 4; };
  vm.runInContext(grabFn('regenerate'), c.sb);
  await c.sb.regenerate();
  assert.equal(regenerationBase, 10, 'replacement began from already applied state');
  assert.equal(c.sb.gameState.gold, 14, 'replacement applied the original delta twice');
  assert.equal(c.sb.turnCount, 2);
  assert.ok(!c.sb.gameHistory.includes(c.entry), 'regenerated response stayed in history');
});

T('two completed turns then rewind and regenerate preserves the restored answer checkpoint', async () => {
  const c = sandbox({ respond: async (_system, user) => JSON.stringify({ state_update: { gold: user.includes('장면 2') ? 7 : 4 }, choices: ['기다린다', '살펴본다'] }) });
  Object.assign(c.sb, {
    gameHistory: [], turnCount: 0, dialogueLog: [], turnSnaps: [], SNAP_MAX: 30,
    histDropped: 0, dlogDropped: 0, storySummary: '', summaryIndex: 0, lastBg: null,
    shownSprites: [], currentBgFile: null, playerName: '테스터', playerDesc: '',
    persistSnaps: () => {}, closeRewind: () => {}, resetSprites: () => {},
    updateSceneBanner: () => {}, detectActiveChars: () => [],
  });
  const main = installMainRequest(c, async number => ({ text: JSON.stringify({
    narration: '장면 ' + number, dialogue: [], combat: false,
  }) }));
  vm.runInContext(grabFn('captureSnap') + grabFn('restoreSnap') + grabFn('regenerate'), c.sb);

  c.sb.captureSnap('첫 입력');
  c.sb.gameHistory.push({ role: 'user', content: '첫 입력' });
  c.sb.dialogueLog.push({ isPlayer: true, text: '첫 입력' });
  await c.sb.callGemini([]);
  await c.sb.ensureStateExtractReady();
  assert.equal(c.sb.gameState.gold, 14);
  const firstAnswer = c.sb.gameHistory[1];
  assert.equal(firstAnswer._turnBefore.state.gold, 10);

  c.sb.captureSnap('둘째 입력');
  assert.equal(JSON.parse(c.sb.turnSnaps[1].s).lastTurnBefore.state.gold, 10);
  c.sb.gameHistory.push({ role: 'user', content: '둘째 입력' });
  c.sb.dialogueLog.push({ isPlayer: true, text: '둘째 입력' });
  await c.sb.callGemini([]);
  await c.sb.ensureStateExtractReady();
  assert.equal(c.sb.gameState.gold, 21);
  assert.equal(firstAnswer._turnBefore, undefined, 'test must exercise checkpoint compaction');

  c.sb.restoreSnap(1);
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.sb.turnCount, 1);
  assert.equal(c.sb.gameHistory[1]._turnBefore.state.gold, 10, 'rewind lost the prior answer checkpoint');
  await c.sb.regenerate();
  await c.sb.ensureStateExtractReady();
  assert.equal(main.requests.length, 3);
  assert.equal(c.sb.gameState.gold, 14, 'rewound answer delta applied twice during regeneration');
  assert.equal(c.sb.turnCount, 1);
  assert.equal(c.sb.gameHistory.length, 2);
});

T('legacy regeneration requires an exact snapshot boundary and safely blocks missing checkpoints', async () => {
  const c = sandbox();
  const before = clone(c.sb.gameState);
  c.sb.gameState.gold = 14;
  Object.assign(c.sb, {
    histDropped: 24, turnSnaps: [{ turn: 2, hL: 25, s: JSON.stringify({ gameState: { ...before, gold: 999 } }) }],
    inputBar: { style: {} }, inputMode: false,
    dialogueLog: [{ isPlayer: true, text: '광장으로 간다' }], detectActiveChars: () => [],
  });
  let calls = 0, replacementBase;
  c.sb.callGemini = async () => { calls++; replacementBase = c.sb.gameState.gold; c.sb.gameState.gold += 4; };
  vm.runInContext(grabFn('regenerate') + grabFn('undoInput'), c.sb);
  const oldHistory = clone(c.sb.gameHistory);
  await c.sb.regenerate();
  await c.sb.undoInput();
  assert.equal(calls, 0, 'mismatched snapshot was treated as an exact checkpoint');
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.sb.turnCount, 3);
  assert.deepEqual(clone(c.sb.gameHistory), oldHistory, 'unsafe operation removed history before validating checkpoint');

  c.sb.turnSnaps.push({ turn: 2, hL: 24, s: JSON.stringify({ gameState: before, pendingEvent: { t: '광장 모임', tries: 0 } }) });
  await c.sb.regenerate();
  assert.equal(calls, 1);
  assert.equal(replacementBase, 10, 'exact legacy snapshot was not used as regeneration base');
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.sb._pendingEvent.t, '광장 모임');
  assert.equal(c.sb.turnCount, 2);
});

function installPlayerInput(c) {
  const snapshots = [], generations = [];
  Object.assign(c.sb, {
    playerName: '테스터', playerDesc: '', currentBgFile: 'test.webp', shownSprites: [],
    dialogueLog: [], inputBar: { style: {} }, inputMode: false,
    _startPhase: 'playing', _modeChosen: true,
    idolRunInjected: () => false,
    captureSnap: text => snapshots.push({ text, gold: c.sb.gameState.gold }),
    detectActiveChars: () => [],
    callGemini: async () => generations.push({ gold: c.sb.gameState.gold }),
    resetDialogueLift: () => {},
  });
  vm.runInContext(grabFn('handlePlayerInput'), c.sb);
  return { snapshots, generations };
}

T('next input snapshots and generates only after previous state commits', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  const { snapshots, generations } = installPlayerInput(c);
  const old = fire(c);
  const next = c.sb.handlePlayerInput('인사를 나눈다');
  await flush();
  assert.equal(snapshots.length, 0, 'snapshot captured uncommitted state');
  assert.equal(generations.length, 0, 'next main request used stale state');
  assert.equal(c.sb.gameHistory.length, 2, 'next input appended before state barrier');
  reply.resolve(JSON.stringify({ state_update: { gold: 4 }, choices: [] }));
  await Promise.all([old, next]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].gold, 14);
  assert.equal(generations.length, 1);
  assert.equal(generations[0].gold, 14);
});

T('failed previous state keeps the new draft and creates no snapshot or model request', async () => {
  const c = sandbox({ respond: async () => null });
  const { snapshots, generations } = installPlayerInput(c);
  await fire(c);
  const oldHistory = clone(c.sb.gameHistory);
  await c.sb.handlePlayerInput('보관할 입력');
  assert.equal(snapshots.length, 0);
  assert.equal(generations.length, 0);
  assert.deepEqual(c.sb.gameHistory.map(h => ({ role: h.role, content: h.content })),
    oldHistory.map(h => ({ role: h.role, content: h.content })));
  assert.equal(c.sb.userInput.textContent, '보관할 입력');
  assert.equal(c.sb.sendBtn.disabled, false, 'failed barrier locked input indefinitely');
});

T('reset while next input is waiting does not append the input to a loaded game', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  const { snapshots, generations } = installPlayerInput(c);
  const work = fire(c);
  const next = c.sb.handlePlayerInput('이전 게임 입력');
  await flush();
  c.sb.resetTurnAsyncWork();
  c.sb.gameState = clone(c.sb.gameState);
  c.sb.gameHistory = [{ role: 'user', content: '새 게임 기록' }];
  reply.resolve(JSON.stringify({ state_update: { gold: 900 } }));
  await Promise.all([work, next]);
  assert.equal(snapshots.length, 0);
  assert.equal(generations.length, 0);
  assert.equal(c.sb.gameHistory.length, 1);
  assert.equal(c.sb.gameHistory[0].content, '새 게임 기록');
});

T('slot payload preserves save version, history offsets and unfinished state receipt', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  const work = fire(c);
  await flush();
  Object.assign(c.sb, { SAVE_DATA_VERSION: 5, histDropped: 24, dlogDropped: 60,
    storySummary: '기존 요약', summaryIndex: 1, lastBg: 'test', dialogueLog: [],
    playerName: '테스터', playerDesc: '', PROVIDER: 'test', NIM_URL: '', API_KEY: '' });
  vm.runInContext(grabFn('currentSavePayload'), c.sb);
  const saved = clone(c.sb.currentSavePayload());
  assert.equal(saved.dataVersion, 5);
  assert.equal(saved.histDropped, 24);
  assert.equal(saved.dlogDropped, 60);
  assert.equal(saved.gameHistory[1]._stateExtract.status, 'pending');
  c.sb.resetTurnAsyncWork();
  reply.resolve(null);
  await work;
});

T('only role and content enter model messages, recovery metadata stays local', () => {
  const c = sandbox();
  c.entry._stateExtract = { id: 'private-job', status: 'pending', userText: 'local metadata' };
  c.entry._turnBefore = { state: { gold: 999 } };
  c.sb.PRIMING_SHOTS = [];
  c.sb.storySummary = '';
  c.sb.recentWindowCount = () => 10;
  vm.runInContext(grabFn('providerHistoryContent') + grabFn('buildMessages'), c.sb);
  const messages = c.sb.buildMessages();
  assert.deepEqual(Object.keys(messages[messages.length - 1]).sort(), ['content', 'role']);
  assert.equal(messages[messages.length - 1].content, c.entry.content);
  assert.ok(c.entry._stateExtract, 'building request removed save metadata');
});

function installMainRequest(c, responder) {
  const main = { requests: [], streamParses: 0, visible: [], summaries: 0 };
  Object.assign(c.sb, {
    playerName: '테스터', playerDesc: '', inputBar: { style: {} }, inputMode: false,
    WORLD_PROMPT: '', ENGINE_MOD_RPG: '', ENGINE_MOD_CG: '', ENGINE_MOD_IDOL: '',
    BUILTIN_STORIES: { hero: {} }, CG_MANIFEST: {}, STORY_BG_FILES: {},
    presentCharIds: () => [], eraToneRule: () => '', buildStatePrompt: () => '',
    buildMessages: () => c.sb.gameHistory.map(h => ({ role: h.role, content: h.content })),
    resetDialogueLift: () => {}, PROVIDER: 'test', NIM_MODEL: 'test-model', FREE_TEST_MODE: false,
    extractStreamUnits: () => { main.streamParses++; return { narration: null, narrationPartial: null, dialogues: [] }; },
    isSoftRefusal: () => false, fixSpeakerIds: () => {}, recTokens: () => {},
    showDialogue: lines => main.visible.push(clone(lines)),
    summarizeIfNeeded: () => { main.summaries++; },
    waitWithCountdown: async () => {},
  });
  c.sb.fetchNim = async (...args) => {
    main.requests.push({ onChunk: args[4] });
    return responder(main.requests.length, ...args);
  };
  vm.runInContext(grabFn('sceneOutputContract') + grabFn('callGemini'), c.sb);
  return main;
}

T('split main cannot bypass recorder with invented state, choices or chronicle', async () => {
  const c = sandbox({ respond: async () => JSON.stringify({ state_update: { gold: 4 }, choices: ['기다린다', '떠난다'], chronicle: ['장면에서 확인한 사실'] }) });
  c.sb.gameHistory = [{ role: 'user', content: '광장으로 간다' }];
  const main = installMainRequest(c, async () => ({ text: JSON.stringify({ narration: '동료에게 동전 네 개를 받았다.', dialogue: [], combat: false,
    state_update: { gold: 999 }, choices: ['허구 선택지'], chronicle: ['허구 사실'] }) }));
  await c.sb.callGemini([]);
  await c.sb.ensureStateExtractReady();
  assert.equal(main.requests.length, 1);
  assert.equal(c.calls.requests.length, 1);
  assert.equal(c.sb.gameState.gold, 14);
  assert.deepEqual(clone(c.sb.gameState.chronicle), ['장면에서 확인한 사실']);
  const mainApplied = c.calls.apply.find(x => !x.stateOnly);
  assert.ok(mainApplied && !mainApplied.data.state_update && !mainApplied.data.choices && !mainApplied.data.chronicle);
  assert.equal(c.calls.apply.filter(x => x.stateOnly).length, 1);
  const answer = c.sb.gameHistory[c.sb.gameHistory.length - 1];
  assert.equal(answer._stateExtract.status, 'applied');
  assert.ok(!answer.content.includes('999') && !answer.content.includes('허구'));
});

T('integrated setting and idol mode keep main state and never schedule a recorder', async () => {
  for (const id of ['hero', 'idol']) {
    const c = sandbox();
    c.sb.STORY = { id };
    c.sb.gameHistory = [{ role: 'user', content: '동전을 받는다' }];
    if (id === 'hero') c.sb.localStorage.getItem = () => '{"splitPipe":false}';
    installMainRequest(c, async () => ({ text: JSON.stringify({ narration: '동전 네 개를 받았다.', dialogue: [], state_update: { gold: 4 }, choices: ['기다린다', '떠난다'], chronicle: ['네 개를 받았다'] }) }));
    await c.sb.callGemini([]);
    assert.equal(c.sb.gameState.gold, 14, id);
    assert.equal(c.calls.requests.length, 0, id);
    assert.equal(c.calls.apply.filter(x => x.stateOnly).length, 0, id);
    assert.ok(JSON.parse(c.sb.gameHistory[c.sb.gameHistory.length - 1].content).state_update);
  }
});

T('split legacy nested combat and time remain main-owned while other state waits for extraction', async () => {
  const reply = deferred(), c = sandbox({ respond: () => reply.promise });
  c.sb.gameHistory = [{ role: 'user', content: '검을 든다' }];
  installMainRequest(c, async () => ({ text: JSON.stringify({ narration: '칼날이 부딪혔다.', dialogue: [],
    state_update: { gold: 999, combat: true, time: '2일차 오후' } }) }));
  await c.sb.callGemini([]);
  const parsed = c.calls.apply.find(x => !x.stateOnly).data;
  assert.equal(parsed.combat, true);
  assert.equal(parsed.time, '2일차 오후');
  assert.equal(parsed.state_update, undefined);
  assert.equal(c.sb.gameState.gold, 10);
  reply.resolve('{"state_update":{},"choices":["막는다","피한다"],"chronicle":[]}');
  await c.sb.ensureStateExtractReady();
  assert.equal(c.sb.gameState.gold, 10);
  const topWins = c.sb.normalizeSceneContract({ narration: '장면', combat: false, time: '3일차 아침', state_update: { combat: true, time: '2일차 밤' } }, true);
  assert.equal(topWins.combat, false);
  assert.equal(topWins.time, '3일차 아침');
});

T('main stream and result cannot affect a game loaded while the request is in flight', async () => {
  const reply = deferred();
  const c = sandbox();
  c.sb.gameHistory = [{ role: 'user', content: '이전 요청' }];
  const main = installMainRequest(c, () => reply.promise);
  const work = c.sb.callGemini([]);
  await flush();
  assert.equal(main.requests.length, 1);
  c.sb.resetTurnAsyncWork();
  c.sb.gameState = clone(c.sb.gameState);
  c.sb.gameHistory = [{ role: 'user', content: '불러온 기록' }];
  const saves = c.calls.saves.length;
  main.requests[0].onChunk('{"narration":"오래된 장면"}');
  assert.equal(main.streamParses, 0, 'old stream parsed after session reset');
  reply.resolve({ text: JSON.stringify({ narration: '오래된 장면', state_update: { gold: 900 }, dialogue: [] }) });
  await work;
  assert.equal(c.sb.gameState.gold, 10);
  assert.equal(c.sb.gameHistory.length, 1);
  assert.equal(c.sb.gameHistory[0].content, '불러온 기록');
  assert.equal(c.calls.saves.length, saves);
  assert.equal(main.summaries, 0);
  assert.equal(main.visible.length, 0);
});

T('old main completion and finally cannot unlock a new main request', async () => {
  const oldReply = deferred(), newReply = deferred();
  const c = sandbox();
  c.sb.gameHistory = [{ role: 'user', content: '이전 요청' }];
  const main = installMainRequest(c, number => number === 1 ? oldReply.promise : newReply.promise);
  const old = c.sb.callGemini([]);
  await flush();
  c.sb.resetTurnAsyncWork();
  c.sb.gameState = clone(c.sb.gameState);
  c.sb.gameHistory = [{ role: 'user', content: '새 요청' }];
  const current = c.sb.callGemini([]);
  await flush();
  const active = c.sb._mainRequest;
  assert.ok(active);
  assert.equal(main.requests.length, 2);
  oldReply.resolve({ text: JSON.stringify({ narration: '이전 장면', state_update: { gold: 900 } }) });
  await old;
  assert.equal(c.sb._mainRequest, active);
  assert.equal(c.sb.sendBtn.disabled, true);
  assert.equal(c.sb.gameState.gold, 10);
  newReply.resolve({ text: JSON.stringify({ narration: '새 장면', state_update: { gold: 4 }, dialogue: [] }) });
  await current;
  await c.sb.ensureStateExtractReady();
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.sb.gameHistory.length, 2);
  assert.equal(c.sb.turnCount, 4);
  assert.equal(c.sb._mainRequest, null);
  assert.equal(c.sb.sendBtn.disabled, false);
});

T('old main rejection does not show an error or unlock a new request', async () => {
  const reply = deferred();
  const c = sandbox();
  c.sb.gameHistory = [{ role: 'user', content: '이전 요청' }];
  const main = installMainRequest(c, () => reply.promise);
  const work = c.sb.callGemini([]);
  await flush();
  c.sb.resetTurnAsyncWork();
  const active = { newRequest: true };
  c.sb._mainRequest = active;
  c.sb.sendBtn.disabled = true;
  reply.reject(new Error('old request failed'));
  await work;
  assert.equal(main.visible.length, 0);
  assert.equal(c.sb._mainRequest, active);
  assert.equal(c.sb.sendBtn.disabled, true);
});

T('session reset during server retry countdown prevents an old retry request', async () => {
  const countdown = deferred();
  const c = sandbox();
  c.sb.gameHistory = [{ role: 'user', content: '이전 요청' }];
  const main = installMainRequest(c, async () => ({ error: { code: 429, message: 'retry in 1 s' } }));
  c.sb.waitWithCountdown = () => countdown.promise;
  const work = c.sb.callGemini([]);
  await flush();
  assert.equal(main.requests.length, 1);
  c.sb.resetTurnAsyncWork();
  c.sb.gameState = clone(c.sb.gameState);
  c.sb.gameHistory = [{ role: 'user', content: '불러온 기록' }];
  countdown.resolve();
  await work;
  assert.equal(main.requests.length, 1, 'old countdown restarted generation in new game');
  assert.equal(c.sb.gameHistory.length, 1);
  assert.equal(c.sb.sendBtn.disabled, false);
});

(async () => {
  let failures = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (error) { failures++; console.error('  ✗ ' + name + '\n    ' + (error && error.stack || error)); }
  }
  console.log('\n' + (tests.length - failures) + '/' + tests.length + ' state recovery regressions passed');
  process.exitCode = failures ? 1 : 0;
})();
