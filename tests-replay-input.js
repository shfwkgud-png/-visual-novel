'use strict';
// Execute the production replay, typewriter, AUTO, input and recorder scheduling
// functions with a deterministic clock. Transport and visual assets are fixtures;
// no provider, relay or paid API is contacted.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const copy = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function grab(name) {
  const start = new RegExp('\\n(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(start, 'Missing production function: ' + name);
  return source.slice(start.index, source.indexOf('\n}', start.index) + 2);
}
function scene(prefix = '이전') {
  return { narration: prefix + ' 장면에서 포장지를 접었다.',
    dialogue: [
      { speaker: '민서', char_id: 'minseo', text: prefix + ' 장면의 첫 번째 남은 대사입니다.' },
      { speaker: '민서', char_id: 'minseo', text: prefix + ' 장면의 두 번째 남은 대사입니다.' }
    ], choices: ['서고로 이동한다', '민서에게 인사한다'] };
}
function savePayload(prefix = '이전') {
  const data = scene(prefix);
  return { gameState: { gold: 7, rep: 0, metChars: {}, player: {}, chronicle: [] },
    gameHistory: [{ role: 'user', content: prefix + ' 입력' }, { role: 'assistant', content: JSON.stringify(data) }],
    dialogueLog: [{ speaker: '다온', text: prefix + ' 입력', isPlayer: true },
      { speaker: '나레이터', text: data.narration, isPlayer: false },
      ...data.dialogue.map(d => ({ ...d, isPlayer: false }))],
    playerName: '다온', playerDesc: '', turnCount: 1, summaryIndex: 0, storySummary: '' };
}
function harness() {
  let time = 0, timerId = 0;
  const timers = new Map(), elements = new Map();
  const calls = { main: [], recorder: [], saves: [], choices: [], toasts: [], errors: [], snaps: [] };
  function node(id) {
    const classes = new Set();
    const n = { id, style: {}, dataset: {}, children: [], _text: '',
      classList: { add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); return child; },
      remove() { elements.delete(this.id); }, setAttribute() {}, removeAttribute() {}, focus() {} };
    for (const key of ['textContent', 'innerText', 'innerHTML']) Object.defineProperty(n, key, {
      get() { return this._text; }, set(value) { this._text = String(value); }
    });
    if (id) elements.set(id, n);
    return n;
  }
  for (const id of ['continueHint', 'redoBar', 'gameScreen', 'mainScreen', 'backlogPanel', 'genPill', 'planBtn']) node(id);
  const timeout = (fn, ms = 0) => { const id = ++timerId; timers.set(id, { fn, at: time + Math.max(0, ms) }); return id; };
  const sb = {
    console: { error: (...args) => calls.errors.push(args), warn() {}, log() {} },
    JSON, Math, Number, String, Object, Array, Set, Map, Date, Promise, RegExp,
    performance: { now: () => time },
    setTimeout: timeout, clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => timeout(() => fn(time), 16),
    document: { getElementById: id => elements.get(id) || null, createElement: () => node(), body: node('body') },
    gameState: { gold: 0, rep: 0, metChars: {}, player: {}, chronicle: [] }, gameHistory: [],
    turnCount: 0, histDropped: 0, dlogDropped: 0, storySummary: '', summaryIndex: 0,
    HISTORY_MAX: 60, STORY: { id: 'library', protagonist: { name: '다온' } },
    CHARACTERS: { minseo: { name: '민서' } },
    playerName: '다온', playerDesc: '', lastBg: null, currentBgFile: null,
    currentEmotion: 'normal', currentPose: 'upper', shownSprites: [],
    dialogueQueue: [], dialogueLog: [], _turnLineKeys: new Set(),
    isShowing: false, waitingForTap: false, replaying: false, inputMode: true, historyMode: false,
    autoPlay: true, autoTimer: null,
    sendBtn: { disabled: false }, userInput: node('userInput'), inputBar: node('inputBar'),
    dialogueText: node('dialogueText'), dialogueBox: node('dialogueBox'),
    speakerNameEl: node('speakerName'), charLayer: node('charLayer'), statusPanel: node('statusPanel'),
    Ambient: { setMood() {}, stop() {} }, SFX: { play() {} }, FX: { forSfx() {} },
    clearTurnReviewNotice() {}, updateStatusUI() {}, showThinking() {}, hideThinking() {},
    showStatToast: (...args) => calls.toasts.push(args),
    showEndingCard() {}, setNameplate() {}, ensureSprite() {}, highlightSpeaker() {},
    hideEventCG() {}, showEventCG() {}, fixSpeakerIds() {}, fixIdolDayWords() {}, idolTextFallback() {},
    scrubMetaNumbers: value => value, resolveSpeakerName: () => null,
    loadSnaps() {}, trimHistory() {}, applyLegacySaveConnection() {}, timeflowOn: () => false,
    setBg() {}, switchMainTab() {}, captureSnap: text => calls.snaps.push(text), idolRunInjected: () => false,
    pandoraPerfRecord() {}, detectActiveChars: () => ['minseo'],
    callGemini: async chars => { calls.main.push(copy(chars)); },
    resumeStateExtract() {},
    requestStateExtract: async (...args) => { calls.recorder.push(args); return { state_update: {}, choices: ['기록관 선택지'] }; },
    applyStateExtract: (task) => { task.meta.status = 'applied'; return true; }
  };
  sb.window = sb;
  sb.inputBar.style.display = 'flex';
  sb.autoSave = () => calls.saves.push(copy({ gameHistory: sb.gameHistory, dialogueLog: sb.dialogueLog }));
  sb.showChoices = choices => { calls.choices.push(copy(choices)); sb.enterInputMode(); };
  vm.createContext(sb);
  const names = ['turnWorkScope', 'turnWorkIsCurrent', 'resetTurnAsyncWork',
    'pendingStateExtractEntry', 'stateExtractIsCurrent', 'ensureStateExtractReady', 'fireStateExtract',
    'restoreAndReplay', 'restoreAndReplayInner', 'resetTurnLineKeys', 'enqueueLine', 'dropLogEntry',
    '_echoNorm', '_sameText', '_isNarrationEcho', 'splitNarration', 'processResponse', 'resetSprites',
    'showNextDialogue', 'typeText', 'scheduleAuto', 'navNext', 'enterInputMode',
    'liftDialogueForInput', 'resetDialogueLift', 'sendMessage', 'handlePlayerInput', 'exitToMain'];
  vm.runInContext(names.map(grab).join('\n'), sb);
  async function advance(ms) {
    const target = time + ms; let steps = 0;
    for (;;) {
      await flush();
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++steps < 10000, 'Clock failed to settle');
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = target; await flush();
  }
  async function record() {
    const index = sb.gameHistory.length - 1, entry = sb.gameHistory[index];
    return sb.fireStateExtract('이전 입력', JSON.parse(entry.content), ['minseo'], index);
  }
  return { sb, calls, elements, timers, node, advance, record };
}

test('restore closes inherited input and choices before replaying the saved scene', async () => {
  const h = harness();
  h.node('choiceBox'); h.sb.historyMode = true;
  h.sb.document.body.classList.add('history-mode');
  h.sb._pendingDialogues = [{ speaker: '옛 인물', text: '다른 슬롯의 보류 대사' }];
  h.sb._present = { text: '다른 슬롯의 화면', inputVisible: true };
  h.sb.restoreAndReplay(savePayload(), false);
  assert.equal(h.calls.errors.length, 0);
  assert.equal(h.sb.inputBar.style.display, 'none');
  assert.equal(h.sb.inputMode, false);
  assert.equal(h.sb.historyMode, false);
  assert.equal(h.sb.document.body.classList.contains('history-mode'), false);
  assert.equal(h.elements.has('choiceBox'), false);
  assert.equal(h.sb._pendingDialogues, null);
  assert.equal(h.sb._present, null);
  assert.equal(h.sb.replaying, true);
  assert.equal(h.sb.dialogueQueue.length, 2);
});

test('old AUTO, typewriter frame and watchdog cannot paint into a restored slot', async () => {
  const h = harness(); let staleTypeDone = 0;
  h.sb.isShowing = true;
  h.sb.typeText('이전 화면의 긴 대사입니다.', () => { staleTypeDone++; h.sb.waitingForTap = true; h.sb.scheduleAuto(); });
  h.sb.waitingForTap = true; h.sb.inputMode = false; h.sb.scheduleAuto();
  const oldAuto = h.sb.autoTimer;
  h.sb.restoreAndReplay(savePayload('새 슬롯'), false);
  assert.equal(h.timers.has(oldAuto), false);
  await h.advance(12000);
  assert.equal(staleTypeDone, 0);
  assert.equal(h.sb.dialogueLog.some(x => x.text.includes('이전 화면')), false);
  assert.equal(h.sb.dialogueText.textContent, scene('새 슬롯').dialogue[1].text);
});

test('premature Enter preserves the draft and cannot append old dialogue after a new input', async () => {
  const h = harness(), saved = savePayload();
  const previousHistoryLength = saved.gameHistory.length;
  h.sb.restoreAndReplay(saved, false);
  const history = JSON.stringify(h.sb.gameHistory);
  h.sb.userInput.innerText = '이제 지하 서고로 내려간다.';
  await h.sb.sendMessage(); await flush();
  assert.equal(h.sb.userInput.innerText, '이제 지하 서고로 내려간다.');
  assert.equal(JSON.stringify(h.sb.gameHistory), history);
  assert.equal(h.calls.main.length, 0);
  await h.advance(12000);
  assert.equal(h.sb.replaying, false);
  assert.equal(h.sb.inputMode, true);
  await h.sb.sendMessage(); await flush();
  assert.equal(h.calls.main.length, 1);
  assert.equal(h.sb.dialogueLog.at(-1).text, '이제 지하 서고로 내려간다.');
  const afterInput = copy(h.sb.dialogueLog);
  await h.advance(12000);
  assert.deepEqual(copy(h.sb.dialogueLog), afterInput);
  assert.equal(h.sb.gameHistory.length, previousHistoryLength + 1);
});

test('direct choice/input handlers cannot acquire an input during replay', async () => {
  const h = harness(); h.sb.restoreAndReplay(savePayload(), false);
  const before = copy(h.sb.gameHistory);
  await h.sb.handlePlayerInput('성급한 선택지');
  assert.equal(h.sb._inputRequest, null);
  assert.equal(h.sb.sendBtn.disabled, false);
  assert.equal(h.calls.main.length, 0);
  assert.deepEqual(copy(h.sb.gameHistory), before);
});

test('a complete replay rebuilds each saved dialogue once and leaves canonical history unchanged', async () => {
  const h = harness(), saved = savePayload(), originalHistory = copy(saved.gameHistory);
  const originalDialogue = saved.dialogueLog.map(x => x.text);
  h.sb.restoreAndReplay(saved, false); await h.advance(12000);
  assert.deepEqual(copy(h.sb.gameHistory), originalHistory);
  assert.deepEqual(h.sb.dialogueLog.map(x => x.text), originalDialogue);
  assert.equal(h.sb.dialogueLog.length, 4);
  assert.equal(h.calls.main.length, 0);
  assert.equal(h.calls.recorder.length, 0);
  assert.deepEqual(h.calls.saves.at(-1).dialogueLog.map(x => x.text), h.sb.dialogueLog.map(x => x.text));
});

test('home then continue cannot inherit the previous input mode or replay queue', async () => {
  const h = harness();
  h.sb.restoreAndReplay(savePayload('첫 슬롯'), false); await h.advance(12000);
  assert.equal(h.sb.inputMode, true);
  h.sb.exitToMain();
  h.sb.restoreAndReplay(savePayload('다음 슬롯'), false);
  assert.equal(h.sb.inputMode, false);
  assert.equal(h.sb.inputBar.style.display, 'none');
  await h.advance(12000);
  assert.equal(h.sb.dialogueLog.length, 4);
  assert.ok(h.sb.dialogueLog.every(x => x.text.includes('다음 슬롯')));
});

test('switching slots mid-type invalidates old completion callbacks without duplicate logs', async () => {
  const h = harness(); h.sb.restoreAndReplay(savePayload('첫 슬롯'), false);
  await h.advance(160);
  h.sb.restoreAndReplay(savePayload('다음 슬롯'), false); await h.advance(12000);
  assert.equal(h.sb.dialogueLog.length, 4);
  assert.ok(h.sb.dialogueLog.every(x => x.text.includes('다음 슬롯')));
  assert.equal(h.sb.gameHistory.length, 2);
  assert.equal(h.sb.replaying, false);
});

test('manual replay reaches input only after the final line and does not duplicate the transcript', async () => {
  const h = harness(); h.sb.autoPlay = false; h.sb.restoreAndReplay(savePayload(), false);
  for (let i = 0; i < 3; i++) {
    assert.equal(h.sb.inputMode, false);
    h.sb.navNext(); // complete current typewriter
    assert.equal(h.sb.waitingForTap, true);
    h.sb.navNext(); // advance to next line or input
  }
  assert.equal(h.sb.replaying, false);
  assert.equal(h.sb.inputMode, true);
  assert.equal(h.sb.dialogueLog.length, 4);
  await h.advance(12000);
  assert.equal(h.sb.dialogueLog.length, 4);
});

test('a damaged assistant payload releases replay and keeps input usable', async () => {
  const h = harness(), saved = savePayload(); saved.gameHistory[1].content = '{broken';
  h.sb.replaying = true; h.sb._replayFill = true;
  h.sb.restoreAndReplay(saved, false);
  assert.equal(h.sb.replaying, false);
  assert.equal(h.sb._replayFill, false);
  assert.equal(h.sb.inputMode, true);
  h.sb.userInput.innerText = '다시 이어간다'; await h.sb.sendMessage(); await flush();
  assert.equal(h.calls.main.length, 1);
});

test('a save without an assistant opens input without leaving stale replay state', async () => {
  const h = harness(), saved = savePayload(); saved.gameHistory = [];
  h.sb.replaying = true; h.sb._replayFill = true;
  h.sb.restoreAndReplay(saved, false);
  assert.equal(h.sb.replaying, false);
  assert.equal(h.sb.inputMode, true);
  assert.equal(h.sb.dialogueQueue.length, 0);
});

for (const phase of ['typing', 'waiting', 'replaying']) {
  test('late recorder choices stay deferred while the final line is ' + phase, async () => {
    const h = harness();
    h.sb.autoPlay = false; h.sb.inputMode = false; h.sb.inputBar.style.display = 'none';
    h.sb.gameHistory = copy(savePayload().gameHistory); h.sb.turnCount = 1;
    h.sb.isShowing = phase === 'typing'; h.sb.waitingForTap = phase === 'waiting';
    h.sb.replaying = phase === 'replaying'; h.sb.dialogueQueue = [];
    assert.equal(await h.record(), true);
    assert.equal(h.calls.recorder.length, 1);
    assert.equal(h.calls.choices.length, 0);
    assert.equal(h.sb.inputMode, false);
    assert.deepEqual(copy(h.sb._pendingChoices), ['기록관 선택지']);
    h.sb.isShowing = false; h.sb.waitingForTap = false;
    h.sb.showNextDialogue();
    assert.equal(h.calls.choices.length, 1);
    assert.equal(h.sb.inputMode, true);
    assert.equal(h.sb.replaying, false);
  });
}

test('late recorder choices open normally after all playback has already finished', async () => {
  const h = harness(); h.sb.gameHistory = copy(savePayload().gameHistory); h.sb.turnCount = 1;
  assert.equal(await h.record(), true);
  assert.equal(h.calls.choices.length, 1);
  assert.equal(h.sb.inputMode, true);
  assert.equal(h.calls.main.length, 0);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('✓ ' + name); }
    catch (error) { failed++; console.error('✗ ' + name + '\n' + error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} replay/input tests passed`);
  if (failed) process.exitCode = 1;
})();
