'use strict';
// Network-free regressions for mobile background pickup and request ownership.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
function grab(name) {
  let start = source.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = source.indexOf('\nasync function ' + name + '(');
  assert(start >= 0, name + ' missing');
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const tests = [];
const test = (name, run) => tests.push({ name, run });
const sse = text => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n';
function harness() {
  const fetches = [], regenerations = [], toasts = [], timers = new Map();
  let timerId = 0;
  const sb = {
    gameState: { gold: 10 }, STORY: { id: 'test' }, _turnEpoch: 1,
    gameHistory: [{ role: 'user', content: 'continue' }], _genFailed: true,
    _pendingGen: { id: 'parked/id' }, sendBtn: { disabled: false },
    SYNC_URL: 'https://test.invalid', NIM_MODEL: 'test-model', AbortController,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), showThinking: () => {},
    showStatToast: text => toasts.push(text),
    fetch: (url, options) => {
      const d = deferred();
      fetches.push({ ...d, url, signal: options.signal });
      options.signal.addEventListener('abort', () => d.reject(new Error('aborted')), { once: true });
      return d.promise;
    },
    regenerate: async parked => { regenerations.push({ parked, disabled: sb.sendBtn.disabled }); },
    historyMode: false, dialogueLog: [], inputBar: { style: {} }, inputMode: false,
    document: { getElementById: () => null }, detectActiveChars: () => [],
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(['turnWorkScope', 'turnWorkIsCurrent', 'resetTurnAsyncWork',
    'createSseParser', 'providerText', 'parseSseTranscript', 'recoverBackgroundGeneration'].map(grab).join('\n'), sb);
  const fireTimer = async ms => {
    const item = [...timers].find(([, x]) => x.ms === ms);
    assert(item, 'timer not found: ' + ms);
    timers.delete(item[0]); item[1].fn(); await tick();
  };
  const reply = async (i = 0, text = '완성된 응답') => {
    fetches[i].resolve({ ok: true, text: async () => sse(text) }); await tick();
  };
  return { sb, fetches, regenerations, toasts, timers, fireTimer, reply };
}

test('pickup transfers parsed result after releasing only its input lock', async () => {
  const h = harness(), work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  assert.equal(h.sb.sendBtn.disabled, true);
  assert.equal(h.fetches[0].url, 'https://test.invalid/gen?id=parked%2Fid');
  await h.reply();
  assert.equal(await work, true);
  assert.equal(h.regenerations.length, 1);
  assert.equal(h.regenerations[0].parked.text, '완성된 응답');
  assert.equal(h.regenerations[0].disabled, false);
  assert.equal(h.sb._pendingGen, null);
  assert.equal(h.sb._backgroundRecovery, null);
  assert.equal(h.timers.size, 0);
});

test('delayed callback from another epoch does nothing', async () => {
  const h = harness(), oldScope = h.sb.turnWorkScope();
  h.sb._turnEpoch++;
  assert.equal(await h.sb.recoverBackgroundGeneration(oldScope), false);
  assert.equal(h.fetches.length, 0);
  assert.equal(h.regenerations.length, 0);
  assert.equal(h.sb._genFailed, true);
});

test('duplicate callback does not create another pickup', async () => {
  const h = harness(), scope = h.sb.turnWorkScope();
  const work = h.sb.recoverBackgroundGeneration(scope);
  assert.equal(await h.sb.recoverBackgroundGeneration(scope), false);
  assert.equal(h.fetches.length, 1);
  await h.reply(); await work;
  assert.equal(h.regenerations.length, 1);
});

test('load/reset during fetch aborts pickup without unlocking new main request', async () => {
  const h = harness(), work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  h.sb.resetTurnAsyncWork();
  h.sb.gameState = { gold: 200 };
  const newer = h.sb._mainRequest = { newRequest: true };
  h.sb.sendBtn.disabled = true;
  const newPark = h.sb._pendingGen = { id: 'new-turn' };
  // A late response may still arrive even when the network aborts.
  await h.reply(); await work;
  assert.equal(h.fetches[0].signal.aborted, true);
  assert.equal(h.sb.sendBtn.disabled, true);
  assert.equal(h.sb._mainRequest, newer);
  assert.equal(h.sb._pendingGen, newPark);
  assert.equal(h.regenerations.length, 0);
  assert.equal(h.toasts.length, 0);
});

test('load during response body read cannot install the old parked response', async () => {
  const h = harness(), body = deferred();
  const work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  h.fetches[0].resolve({ ok: true, text: () => body.promise });
  await tick();
  h.sb.resetTurnAsyncWork();
  h.sb.gameState = { gold: 300 };
  h.sb._mainRequest = {};
  h.sb.sendBtn.disabled = true;
  body.resolve(sse('old response'));
  await work;
  assert.equal(h.regenerations.length, 0);
  assert.equal(h.sb._parkedResult, null);
  assert.equal(h.sb.sendBtn.disabled, true);
});

test('new request in same session retains its lock and relay identity', async () => {
  const h = harness(), work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  h.sb._mainRequest = {};
  const newer = h.sb._pendingGen = { id: 'new' };
  await h.reply(); await work;
  assert.equal(h.sb.sendBtn.disabled, true);
  assert.equal(h.sb._pendingGen, newer);
  assert.equal(h.regenerations.length, 0);
});

test('changed history tail invalidates pickup even without a new epoch', async () => {
  const h = harness(), work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  h.sb.gameHistory.push({ role: 'user', content: 'different input' });
  await h.reply(); await work;
  assert.equal(h.regenerations.length, 0);
  assert.equal(h.sb.sendBtn.disabled, true, 'old pickup must not release unowned input state');
});

test('new session pickup is not cleared by an older completion', async () => {
  const h = harness(), old = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  h.sb.resetTurnAsyncWork();
  h.sb._genFailed = true;
  h.sb._pendingGen = { id: 'new-session' };
  const newer = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  const token = h.sb._backgroundRecovery;
  await h.reply(0, 'old'); await old;
  assert.equal(h.sb._backgroundRecovery, token);
  assert.equal(h.sb.sendBtn.disabled, true);
  await h.reply(1, 'new'); await newer;
  assert.equal(h.regenerations.length, 1);
  assert.equal(h.regenerations[0].parked.text, 'new');
});

test('timeout falls back once after relinquishing pickup lock', async () => {
  const h = harness(), work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  await h.fireTimer(90000);
  await work;
  assert.equal(h.fetches[0].signal.aborted, true);
  assert.equal(h.regenerations.length, 1);
  assert.equal(h.regenerations[0].parked, null);
  assert.equal(h.regenerations[0].disabled, false);
});

test('polling an unfinished generation preserves the same pickup identity', async () => {
  const h = harness(), work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  h.fetches[0].resolve({ ok: false }); await tick();
  assert.equal(h.regenerations.length, 0);
  await h.fireTimer(3000);
  assert.equal(h.fetches.length, 2);
  await h.reply(1); await work;
  assert.equal(h.regenerations.length, 1);
});

test('completed pickup never unlocks the generation it handed off to', async () => {
  const h = harness(), generation = deferred();
  h.sb.regenerate = async () => {
    h.sb._mainRequest = {};
    h.sb.sendBtn.disabled = true;
    await generation.promise;
  };
  const work = h.sb.recoverBackgroundGeneration(h.sb.turnWorkScope());
  await h.reply();
  generation.resolve(); await work;
  assert.equal(h.sb.sendBtn.disabled, true);
});

test('real regenerate preserves parked response through reset and fetchNim uses no network', async () => {
  const h = harness(), outputs = [], chunks = [];
  vm.runInContext(grab('regenerate') + '\n' + grab('fetchNim'), h.sb);
  h.sb.callGemini = async () => {
    outputs.push(await h.sb.fetchNim('', [], 0.7, 4000, text => chunks.push(text)));
  };
  const parked = { text: 'completed JSON', finishReason: 'stop' };
  await h.sb.regenerate(parked);
  assert.equal(outputs[0], parked);
  assert.deepEqual(chunks, ['completed JSON']);
  assert.equal(h.sb._parkedResult, null);
  assert.equal(h.fetches.length, 0);
});

test('fallback choices are single-flight per scene and cannot cross a same-turn save load', async () => {
  const h = harness(), requests = [], shown = [];
  h.sb.gameHistory = [{ role: 'assistant', content: 'current scene' }];
  h.sb.turnCount = 8;
  h.sb.CHARACTERS = {};
  h.sb.llmSmall = () => { const d = deferred(); requests.push(d); return d.promise; };
  h.sb.showChoices = choices => shown.push(Array.from(choices));
  vm.runInContext(grab('genFallbackChoices'), h.sb);
  const old = h.sb.genFallbackChoices();
  await h.sb.genFallbackChoices();
  assert.equal(requests.length, 1, 'same scene must not issue duplicate fallback requests');
  h.sb.resetTurnAsyncWork();
  h.sb.gameState = { gold: 20 };
  h.sb.gameHistory = [{ role: 'assistant', content: 'loaded scene' }];
  const newer = h.sb.genFallbackChoices();
  assert.equal(requests.length, 2, 'same turn number in another save is a new scene');
  requests[0].resolve('["old A","old B"]'); await old;
  assert.equal(shown.length, 0);
  requests[1].resolve('["new A","new B"]'); await newer;
  assert.deepEqual(shown, [['new A', 'new B']]);
});

test('replaced scene invalidates fallback before it reads current characters or shows choices', async () => {
  const h = harness(), requests = [], shown = [];
  h.sb.gameHistory = [{ role: 'assistant', content: 'current scene' }];
  h.sb.turnCount = 8;
  h.sb.CHARACTERS = {};
  h.sb.llmSmall = () => { const d = deferred(); requests.push(d); return d.promise; };
  h.sb.showChoices = choices => shown.push(Array.from(choices));
  vm.runInContext(grab('genFallbackChoices'), h.sb);
  const old = h.sb.genFallbackChoices();
  h.sb.gameHistory[h.sb.gameHistory.length - 1] = { role: 'assistant', content: 'replacement' };
  const newer = h.sb.genFallbackChoices();
  assert.equal(requests.length, 2);
  requests[0].resolve(null); await old;
  assert.equal(shown.length, 0, 'stale failure must not generate a fallback for the replacement scene');
  requests[1].resolve('["current A","current B"]'); await newer;
  assert.deepEqual(shown, [['current A', 'current B']]);
});

test('setup steps and failed player requests never generate fallback API calls', async () => {
  const h = harness(); let calls = 0;
  h.sb.turnCount = 0;
  h.sb.llmSmall = async () => { calls++; return '["A","B"]'; };
  vm.runInContext(grab('genFallbackChoices'), h.sb);
  await h.sb.genFallbackChoices();
  h.sb.gameHistory = [{ role: 'assistant', content: 'fixed setup prompt' }];
  for (const phase of ['pro','mode','setup']) { h.sb._startPhase = phase; await h.sb.genFallbackChoices(); }
  assert.equal(calls, 0);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} background regressions passed`);
  if (failed) process.exitCode = 1;
})();
