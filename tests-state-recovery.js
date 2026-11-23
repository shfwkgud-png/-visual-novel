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
    AbortController,
    performance: { now: () => 100 },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    gameState: clone(state), gameHistory: clone(history), turnCount: 3,
    STORY: { id: 'hero' }, RPG_STORIES: new Set(['hero']),
    CHARACTERS: { old: { name: '기존 인물' }, fresh: { name: '새 인물' } },
    dialogueQueue: [], historyMode: false, replaying: false, isShowing: false, waitingForTap: false,
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
  sb.processResponse = (data, activeIds, stream, stateOnly, source) => {
    calls.apply.push({ data: clone(data), activeIds: clone(activeIds), stateOnly, source:source?clone(source):null });
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
  assert.equal(c.calls.apply[0].data.dialogue,undefined,'recording must not replay speaker metadata');
  assert.equal(c.calls.apply[0].source.scene.narration,c.scene.narration);
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

T('one corrective pass for malformed output is shared by the next input and commits exactly once', async () => {
  const repair=deferred();
  let attempt = 0;
  const c = sandbox({ respond: async () => ++attempt === 1 ? '{broken' : repair.promise });
  const original=fire(c);
  const waiting=c.sb.ensureStateExtractReady();
  await flush();
  assert.equal(c.entry._stateExtract.status, 'pending');
  assert.equal(c.entry._stateExtract.attempts,2);
  assert.equal(c.sb.gameState.gold, 10);
  assert.equal(c.calls.apply.length, 0);
  assert.equal(c.calls.toasts.length,0);
  assert.match(c.calls.requests[1][1], /직전 상태 기록 재검토.*완전한 JSON/);
  repair.resolve(JSON.stringify({state_update:{gold:4}}));
  assert.deepEqual(await Promise.all([original,waiting]),[true,true]);
  assert.equal(c.sb.gameState.gold, 14);
  assert.equal(c.entry._stateExtract.status, 'applied');
  await c.sb.ensureStateExtractReady();
  assert.equal(c.calls.apply.length, 1);
  assert.equal(c.calls.requests.length,2);
});

T('a reload in the middle of corrective extraction preserves the used allowance and discards the abandoned result', async () => {
  const repair=deferred();
  let count=0;
  const c=sandbox({respond:()=> ++count===1 ? '{broken' : repair.promise});
  const abandoned=fire(c);
  await flush();
  const saved=clone(c.calls.saves.at(-1));
  assert.equal(saved.gameHistory.at(-1)._stateExtract.attempts,2);
  c.sb.resetTurnAsyncWork();
  const resumed=sandbox({globals:saved,respond:()=>'{still broken'});
  assert.equal(await resumed.sb.ensureStateExtractReady(),false);
  assert.equal(resumed.calls.requests.length,1);
  assert.equal(resumed.entry._stateExtract.status,'failed');
  assert.equal(resumed.sb.gameState.gold,10);
  repair.resolve('{"state_update":{"gold":99}}');
  assert.equal(await abandoned,false);
  await flush();
  assert.equal(c.sb.gameState.gold,10);
});

T('provider failures do not spend a second request on correction', async () => {
  const c=sandbox({respond:()=>{throw Object.assign(Error('rate limited'),{recorderNotice:'API 요청 한도 (429)'});}});
  assert.equal(await fire(c),false);
  assert.equal(c.calls.requests.length,1);
  assert.equal(c.entry._stateExtract.status,'failed');
  assert.match(c.calls.toasts.at(-1),/429/);
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

T('cold restore waits for the canon ledger, then applies the saved canon-changing scene exactly once', async () => {
  const time = require('./storypacks/hogwarts-au/time.js'), world = require('./storypacks/hogwarts-au/world.js');
  const bridge = require('./storypacks/hogwarts-au/canon-bridge.js'), engine = require('./storypacks/hogwarts-au/canon-engine.js');
  const evidence = '교수들이 트롤을 대피 통로에서 막아 학생들이 안전하게 연회장에 남았다.';
  const outcome = { event_id:null, summary:evidence, evidence, complete:false, choice:'freeform', ties:{},
    canon:[{ id:'b01c10s01', outcome:'prevented', summary:evidence, evidence, effects:{} }] };
  const c = sandbox({respond: () => {
    assert.equal(c.sb.gameState.hogwarts.canon, undefined, 'static fetch committed the original event before validating the saved scene');
    return JSON.stringify({state_update:{hogwarts:outcome}});
  }});
  let online=false, fetches=0;
  Object.assign(c.sb, { STORY:{id:'hogwarts'}, PandoraHogwartsTime:time, PandoraHogwartsWorld:world,
    PandoraHogwartsBridge:bridge, PandoraHogwartsCanon:engine, HOGWARTS_CANON_BUNDLE:null, HOGWARTS_CANON_PENDING:null,
    fixSpeakerIds(){}, fetch:async (url, {signal}) => {
      assert.ok(signal); fetches++;
      if (!online) throw Error('offline fixture');
      return {ok:true, json:async () => JSON.parse(fs.readFileSync(path.join(__dirname,url.split('?')[0]),'utf8'))};
    } });
  const hp = c.sb.gameState.hogwarts = time.createState();
  time.chooseHouse(hp,'그리핀도르'); time.moveToScene(hp,'1991-10-31',2); hp.world=world.createState();
  c.entry.content=JSON.stringify({narration:evidence,dialogue:[]});
  c.entry._stateExtract={id:'restored',turn:c.sb.turnCount,status:'pending',attempts:0,userText:'트롤을 막는다',activeCharIds:[]};
  vm.runInContext(['loadHogwartsCanonBundle','hogwartsOutcomeContract','applyHogwartsSceneState','commitHogwartsCanon'].map(grabFn).join('\n'),c.sb);
  c.sb.processResponse=(data, ids, stream, stateOnly, source)=>c.sb.applyHogwartsSceneState(data,ids,source);
  assert.equal(await c.sb.ensureStateExtractReady(),false);
  assert.equal(c.entry._stateExtract.status,'failed'); assert.equal(c.entry._stateExtract.attempts,0);
  assert.equal(c.calls.requests.length,0); assert.match(c.calls.toasts.at(-1),/호그와트 사건 자료/);
  assert.equal(hp.canon,undefined); assert.equal(c.sb.HOGWARTS_CANON_PENDING,null);
  online=true; const before=fetches;
  const results=await Promise.all([c.sb.ensureStateExtractReady(),c.sb.ensureStateExtractReady()]);
  assert.deepEqual(results,[true,true]); assert.equal(fetches-before,9);
  assert.equal(c.calls.requests.length,1); assert.equal(c.entry._stateExtract.attempts,1);
  assert.equal(hp.canon.statuses.b01c10s01,'prevented'); assert.equal(c.entry._stateExtract.status,'applied');
  assert.equal(await c.sb.ensureStateExtractReady(),true); assert.equal(c.calls.requests.length,1);
});

T('Hogwarts action retries with time and event feedback, then commits the unchanged clock and actual action once', async () => {
  const time = require('./storypacks/hogwarts-au/time.js');
  const world = require('./storypacks/hogwarts-au/world.js');
  const hp = time.createState();
  time.chooseHouse(hp, '그리핀도르');
  time.moveToScene(hp, '1991-09-03', 2);
  hp.world = world.createState();
  world.offer(hp.world, world.EVENTS.find(e => e.id === 'first_invitations'));
  world.start(hp.world, {eventId:'first_invitations', optionId:'hermione'});
  assert.equal(hp.world.active.needsResult, true);
  const evidence='저녁 식탁에서 두 사람은 함께 도서관에 가기로 약속했다.';
  const outcome={event_id:'first_invitations', choice:'hermione', summary:'도서관에 가기로 약속했다.',
    evidence, complete:false, ties:{}, canon:[], time:{value:'1991-09-03 저녁', days:0, evidence}};
  const replies = [{}, {...outcome, time:{...outcome.time, value:'1991-09-03 오후'}}, outcome];
  const c = sandbox({respond: () => {
    const next = replies.shift();
    return JSON.stringify({state_update: {gold:4, ...(next.choice ? {hogwarts:next} : {})}});
  }});
  Object.assign(c.sb, {STORY:{id:'hogwarts'}, PandoraHogwartsTime:time, PandoraHogwartsWorld:world,
    HOGWARTS_CANON_BUNDLE:null, fixSpeakerIds(){}});
  c.sb.gameState.hogwarts=hp;
  c.entry.content=JSON.stringify({narration:evidence,dialogue:[]});
  vm.runInContext(grabFn('hogwartsOutcomeContract') + grabFn('applyHogwartsSceneState'), c.sb);
  const originalApply=c.sb.processResponse;
  c.sb.processResponse=(data, ids, stream, stateOnly, source) => {
    originalApply(data, ids, stream, stateOnly, source);
    c.sb.applyHogwartsSceneState(data,ids,source);
  };
  const transitions=hp.transitions;
  assert.equal(await fire(c), false);
  assert.equal(c.sb.gameState.gold,10);
  assert.equal(c.entry._stateExtract.correction,'time');
  assert.match(c.calls.requests[0][0], /진행 중인 행동은 state_update.hogwarts 기록이 필수/);
  assert.doesNotMatch(c.calls.requests[0][0], /"state_update":\{\}|state_update는 항상 객체다\. 변화가 없으면 \{\}/);
  assert.doesNotMatch(c.calls.requests[0][0], /'N일차 새벽/);
  assert.equal(c.entry._stateExtract.attempts,2);
  assert.match(c.calls.requests[1][1], /직전 상태 기록 재검토.*현재 event_id/);
  assert.match(c.calls.toasts.at(-1), /날짜가 맞지/);
  assert.equal(c.sb.gameState.gold,10);
  assert.equal(await c.sb.ensureStateExtractReady(),true);
  assert.match(c.calls.requests[2][1], /직전 상태 기록 재검토.*days/);
  assert.equal(c.sb.gameState.hogwarts.transitions,transitions);
  assert.equal(c.sb.gameState.hogwarts.world.active.outcome.choice,'hermione');
  assert.equal(c.sb.gameState.hogwarts.world.active.needsResult,false);
  assert.equal(c.sb.gameState.gold,14);
  assert.equal(c.entry._stateExtract.correction,undefined);
  assert.equal(await c.sb.ensureStateExtractReady(),true);
  assert.equal(c.calls.requests.length,3);
});

T('afternoon class dismissal survives a next-morning recorder timestamp and receipt reload',async()=>{
  const time=require('./storypacks/hogwarts-au/time.js'),world=require('./storypacks/hogwarts-au/world.js');
  const narration='오후 마법 수업이 끝났다. 플리트윅이 교재를 덮는다.';
  const text='다음 수업에 뵙죠!';
  const c=sandbox({respond:()=>JSON.stringify({state_update:{hogwarts:{event_id:null,choice:null,
    complete:false,summary:'마법 수업 종료',evidence:narration,canon:[],ties:{},
    time:{value:'1991-09-05 아침',days:1,evidence:text}}},choices:['교실을 나선다.']})});
  const hp={...time.createState(),house:'그리핀도르',date:'1991-09-04',slot:0,world:world.createState()};
  Object.assign(c.sb,{STORY:{id:'hogwarts'},PandoraHogwartsTime:time,PandoraHogwartsWorld:world,
    HOGWARTS_CANON_BUNDLE:null,fixSpeakerIds(){}});
  c.sb.gameState.hogwarts=hp;
  const data={narration,dialogue:[{speaker:'플리트윅',text}]};
  c.entry.content=JSON.stringify(data);
  vm.runInContext(grabFn('hogwartsOutcomeContract')+grabFn('applyHogwartsSceneState'),c.sb);
  c.sb.processResponse=(data,ids,stream,stateOnly,source)=>c.sb.applyHogwartsSceneState(data,ids,source);
  c.sb.applyHogwartsSceneState(data,[]);
  assert.match(c.sb.gameState.time,/9월 4일 오후/);
  assert(await c.sb.fireStateExtract('교재를 덮는다.',data,[],1));
  assert.equal(c.entry._stateExtract.status,'applied');
  assert.match(c.sb.gameState.time,/9월 4일 오후/);
  assert.equal(hp.transitions,1);
  assert.deepEqual(JSON.parse(c.entry.content).choices,['교실을 나선다.']);
  assert.equal(JSON.parse(c.entry.content).state_update.hogwarts.time,undefined);
  c.sb.gameState=clone(c.sb.gameState);
  assert(await c.sb.ensureStateExtractReady());
  assert.equal(c.calls.requests.length,1);
  assert.match(time.display(c.sb.gameState.hogwarts),/9월 4일 오후/);
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

T('multi-day request at the end of a long player message survives first extraction and legacy retry', async () => {
  const time=require('./storypacks/hogwarts-au/time.js');
  const world=require('./storypacks/hogwarts-au/world.js');
  const request='사흘 동안 수업을 들으며 지낸다';
  const input='도서관에서 읽은 내용에 관해 친구들과 이야기한다. '.repeat(58)+request;
  assert.ok(input.indexOf(request)>1200);
  const evidence='사흘간 수업을 들은 뒤 수요일 아침에 일어났다.';
  for (const legacy of [false,true]) {
    const c=sandbox({respond:()=>JSON.stringify({state_update:{hogwarts:{event_id:null,choice:null,
      complete:false,summary:evidence,evidence,time:{value:'1991-09-04 아침',days:3,evidence,request}}}})});
    const hp=time.createState();
    time.chooseHouse(hp,'그리핀도르');
    hp.world=world.createState();
    Object.assign(c.sb,{STORY:{id:'hogwarts'},PandoraHogwartsTime:time,PandoraHogwartsWorld:world,
      HOGWARTS_CANON_BUNDLE:null,fixSpeakerIds(){}});
    c.sb.gameState.hogwarts=hp;
    c.sb.gameHistory[0].content=input;
    c.entry.content=JSON.stringify({narration:evidence,dialogue:[]});
    c.sb.processResponse=(data,ids,stream,stateOnly,source)=>c.sb.applyHogwartsSceneState(data,ids,source);
    vm.runInContext(grabFn('hogwartsOutcomeContract') + grabFn('applyHogwartsSceneState'),c.sb);
    if (legacy) {
      c.entry._stateExtract={turn:3,status:'failed',attempts:1,userText:input.slice(0,1200),activeCharIds:[]};
      c.sb.gameHistory.push({role:'user',content:'별개의 새 입력'});
      assert.equal(await c.sb.ensureStateExtractReady(),true);
    } else {
      const author=c.sb.userMessageForExtract();
      assert.equal(author,input);
      assert.equal(await c.sb.fireStateExtract(author,JSON.parse(c.entry.content),[],1),true);
    }
    assert.equal(c.calls.requests.length,1);
    assert.ok(c.calls.requests[0][1].includes(input));
    assert.ok(!c.calls.requests[0][1].includes('별개의 새 입력'));
    assert.equal(hp.date,'1991-09-04');
    assert.equal(c.entry._stateExtract.status,'applied');
    assert.equal(c.entry._stateExtract.userText,undefined);
  }
});

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
  vm.runInContext(['sceneVisualSnapshot','handlePlayerInput','dispatchPlayerInput'].map(grabFn).join('\n'), c.sb);
  return { snapshots, generations };
}

T('restored historical receipt no longer blocks sends after a later committed scene, including a second reload', async () => {
  for (const kind of ['split', 'integrated']) {
    const c = sandbox();
    const past = {id:'unresolved',status:'failed',turn:2,attempts:3,userText:'과거 입력',activeCharIds:[]};
    c.sb.gameHistory.unshift({role:'assistant',content:'{"narration":"과거 장면"}',_stateExtract:clone(past)});
    c.entry.content = '{"narration":"새 장면","state_update":{"gold":50}}';
    if (kind === 'split') c.entry._stateExtract = {id:'settled',turn:3,status:'applied'};
    else c.entry._turnBefore = {state:{gold:9}};
    c.sb.resumeStateExtract();
    await flush();
    assert.equal(c.calls.saves.length,1);
    assert.deepEqual(clone(c.sb.gameHistory[0]._stateExtract),{...past,status:'superseded',previousStatus:'failed'});
    assert.equal(c.sb.gameHistory[0].content,'{"narration":"과거 장면"}');
    assert.equal(c.calls.toasts.length,1);
    assert.equal(c.calls.requests.length,0);
    const again=sandbox({globals:clone(c.calls.saves[0])});
    again.sb.resumeStateExtract();
    const { generations }=installPlayerInput(again);
    await again.sb.handlePlayerInput('보관된 장면에서 대화를 잇는다');
    assert.equal(generations.length,1);
    assert.equal(generations[0].gold,10);
    assert.equal(again.calls.requests.length,0);
    assert.equal(again.calls.toasts.length,0);
  }
});

T('fixed scenes, unfinished later work and unproven state never supersede an old receipt', async () => {
  for (const later of [
    {content:'{"narration":"고정 장면","state_update":null}',_turnBefore:{state:{}}},
    {content:'{"narration":"결과 대기"}',_stateExtract:{turn:3,status:'pending'}},
    {content:'{"state_update":{}}'},
  ]) {
    const c=sandbox();
    c.sb.gameHistory.unshift({role:'assistant',content:'{"narration":"이전 장면"}',_stateExtract:{turn:2,status:'pending'}});
    Object.assign(c.entry,later);
    assert.equal(await c.sb.ensureStateExtractReady(), false);
    assert.equal(c.sb.gameHistory[0]._stateExtract.status,'pending');
    assert.equal(c.calls.saves.length,0);
    assert.equal(c.calls.requests.length,0);
  }
});

T('next input snapshots and generates only after previous state commits', async () => {
  const reply = deferred();
  const c = sandbox({ respond: () => reply.promise });
  const { snapshots, generations } = installPlayerInput(c);
  const old = fire(c);
  const next = c.sb.handlePlayerInput('인사를 나눈다');
  await flush();
  assert.deepEqual(c.calls.toasts, [], 'a normal recorder wait showed a warning before any failure');
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

T('switching saves while the input awaits the Hogwarts catalog cannot submit to the next save', async () => {
  const c=sandbox(), wait=deferred();
  const {generations,snapshots}=installPlayerInput(c);
  c.sb.STORY={id:'hogwarts'}; c.sb.gameState.hogwarts={};
  Object.assign(c.sb,{HOGWARTS_CANON_BUNDLE:null, choiceDisplayText:x=>x,syncHogwartsCanon:()=>wait.promise});
  const pending=c.sb.handlePlayerInput('원래 저장의 입력');
  await flush();
  assert.ok(c.sb._inputRequest); assert.equal(c.sb.sendBtn.disabled,true);
  await c.sb.handlePlayerInput('중복 입력');
  c.sb.resetTurnAsyncWork();
  c.sb.gameHistory=[{role:'user',content:'새 저장'}];
  const newOwner={scope:c.sb.turnWorkScope()};
  c.sb._inputRequest=newOwner; c.sb.sendBtn.disabled=true;
  wait.resolve(true);
  await pending;
  assert.equal(c.sb._inputRequest,newOwner);assert.equal(c.sb.sendBtn.disabled,true);
  assert.equal(c.sb.gameHistory.length,1);
  assert.equal(snapshots.length,0);assert.equal(generations.length,0);
});

T('pre-submit exception restores the exact draft and releases only its own send lock', async () => {
  const c=sandbox(), input='보존할 입력';
  const {generations}=installPlayerInput(c);
  c.sb.captureSnap=()=>{throw new Error('fixture input setup failure');};
  const history=clone(c.sb.gameHistory);
  await c.sb.handlePlayerInput(input);
  assert.deepEqual(clone(c.sb.gameHistory),history);
  assert.equal(c.sb.userInput.textContent,input);
  assert.equal(c.sb.sendBtn.disabled,false);assert.equal(c.sb._inputRequest,null);
  assert.equal(generations.length,0);
});

T('created character names remain literal when detecting actors for a new input', () => {
  const c=sandbox();
  c.sb.CHARACTERS={a:{name:'안내원['},b:{name:'주.인'},c:{name:''},d:null};
  vm.runInContext(grabFn('detectActiveChars'),c.sb);
  assert.deepEqual(clone(c.sb.detectActiveChars([{role:'user',content:'주인공이 안내원[에게 인사한다.'}])),['a']);
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
  assert.match(c.calls.toasts.at(-1), /기록 형식.*입력을 보관/);
  assert.equal(c.calls.toasts.length,2,'a failed send should show one notice with both the reason and retry action');
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
  const main = { requests: [], streamParses: 0, visible: [], summaries: 0, countdowns: 0 };
  Object.assign(c.sb, {
    playerName: '테스터', playerDesc: '', inputBar: { style: {} }, inputMode: false,
    dialogueLog: c.sb.dialogueLog || [], lastBg: c.sb.lastBg || 'fixture-original-bg',
    currentBgFile: c.sb.currentBgFile || 'fixture-original-bg', shownSprites: [],
    autoTimer: null, isShowing: false, waitingForTap: false,
    clearInterval: id => c.timers.delete(id),
    resetTurnLineKeys: () => { c.sb._turnLineKeys = new Set(); },
    setBg: bg => { c.sb.lastBg = bg; c.sb.currentBgFile = bg; },
    WORLD_PROMPT: '', ENGINE_MOD_RPG: '', ENGINE_MOD_CG: '', ENGINE_MOD_IDOL: '',
    BUILTIN_STORIES: { hero: {} }, CG_MANIFEST: {}, STORY_BG_FILES: {},
    presentCharIds: () => [], eraToneRule: () => '', buildStatePrompt: () => '',
    buildMessages: () => c.sb.gameHistory.map(h => ({ role: h.role, content: h.content })),
    resetDialogueLift: () => {}, PROVIDER: 'test', NIM_MODEL: 'test-model', FREE_TEST_MODE: false,
    extractStreamUnits: () => { main.streamParses++; return { narration: null, narrationPartial: null, dialogues: [] }; },
    isSoftRefusal: () => false, fixSpeakerIds: () => {}, recTokens: () => {},
    showDialogue: lines => main.visible.push(clone(lines)),
    summarizeIfNeeded: () => { main.summaries++; },
    waitWithCountdown: async () => { main.countdowns++; },
  });
  c.sb.fetchNim = async (...args) => {
    main.requests.push({ onChunk: args[4] });
    return responder(main.requests.length, ...args);
  };
  vm.runInContext(grabFn('sceneOutputContract') + grabFn('safeProviderErrorText') + grabFn('providerFailureText') + grabFn('permanentProviderError') + grabFn('readParkedScene') + grabFn('discardIncompleteScene') + grabFn('callGemini'), c.sb);
  return main;
}

function installMainStreaming(c, main) {
  // Exercise the production partial-JSON parser and queue's real dialogueLog
  // writes. Rendering itself remains a small DOM-free sink.
  vm.runInContext(['extractStreamUnits', 'resolveSpeakerName', 'scrubMetaNumbers',
    '_echoNorm', '_isNarrationEcho', 'enqueueLine', 'splitNarration', 'dlgToChunks'].map(grabFn).join('\n'), c.sb);
  c.sb._turnLineKeys = new Set();
  c.sb.autoPlay = false;
  c.sb.resetSprites = () => {};
  c.sb.Ambient = { setMood() {} };
  main.streamVisible = [];
  c.sb.showNextDialogue = () => {
    const line = c.sb.dialogueQueue.shift();
    if (line) {
      main.streamVisible.push(clone(line));
      if (line._log) line._log.pending = false;
      c.sb.isShowing = true;
      c.sb.waitingForTap = true;
    }
  };
}

function failedMainFixture(split) {
  const c = sandbox();
  if (!split) c.sb.localStorage.getItem = () => '{"splitPipe":false}';
  const input = '성인 사서에게 약속한 책을 돌려주고 영수증을 요청한다';
  c.sb.gameHistory = [
    { role: 'user', content: '도서관으로 간다' },
    { role: 'assistant', content: '{"narration":"성인 사서가 서가 옆에서 기다렸다.","dialogue":[]}',
      _turnBefore: { state: clone(c.sb.gameState), pendingEvent: null } },
    { role: 'user', content: input }
  ];
  c.sb.dialogueLog = [
    { speaker: '나레이터', text: '성인 사서가 서가 옆에서 기다렸다.', isPlayer: false },
    { speaker: '테스터', text: input, isPlayer: true }
  ];
  c.sb._genText = input;
  c.sb._pendingEvent = { t: '도서관 약속', tries: 0 };
  c.sb._pendingGen = { id: 'fixture-incomplete-main' };
  return { c, input, history: clone(c.sb.gameHistory), log: clone(c.sb.dialogueLog),
    state: clone(c.sb.gameState), event: clone(c.sb._pendingEvent), turn: c.sb.turnCount };
}

T('dialogue-only streaming shows the first real speaker automatically in manual mode', async () => {
  const fixture = failedMainFixture(false), { c, input } = fixture, reply = deferred();
  const main = installMainRequest(c, () => reply.promise);
  installMainStreaming(c, main);
  const work = c.sb.callGemini([]); await flush();
  const chunk = main.requests[0].onChunk;
  const start = '{"narration":"","dialogue":[';
  chunk(start);
  assert.equal(c.sb._stream.active, false, 'empty narration started blank playback');
  const echo = JSON.stringify({speaker:'테스터',text:input});
  chunk(start + echo + ',');
  assert.equal(main.streamVisible.length, 0);
  assert(!c.calls.metrics.some(([name]) => name === 'main_first_display'), 'an input echo counted as first display');
  const spoken = {speaker:'새 인물',char_id:'fresh',text:'빌려준 책을 돌려주러 왔어.'};
  const final = start + echo + ',' + JSON.stringify(spoken) + ']}';
  chunk(final);
  assert.deepEqual(main.streamVisible.map(d => d.text), [spoken.text]);
  assert.equal(c.calls.metrics.filter(([name]) => name === 'main_first_display').length, 1);
  reply.resolve({text:final, finishReason:'stop', timing:{ttfb:50,total:100}});
  await work;
});

function assertUncommittedMain(fixture, main, finishReason) {
  const { c, input, history, state, event, turn } = fixture;
  const stateNow = clone(c.sb.gameState);
  // The failure remains visible in diagnostics; gameplay state must not commit.
  delete stateNow._turnStats;
  assert.deepEqual(stateNow, state);
  assert.deepEqual(clone(c.sb.gameHistory), history, 'a failed model answer entered history or replaced a checkpoint');
  assert.equal(c.sb.turnCount, turn);
  assert.deepEqual(clone(c.sb._pendingEvent), event);
  assert.equal(main.requests.length, 1, 'truncation must not start another main request');
  assert.equal(c.calls.requests.length, 0, 'truncation started state extraction');
  assert.equal(c.calls.apply.length, 0, 'truncation applied gameplay state');
  assert.equal(c.calls.saves.length, 0, 'truncation was auto-saved as a completed turn');
  assert.equal(main.summaries, 0, 'truncation entered long-term memory');
  assert.equal(main.countdowns, 0, 'truncation scheduled an automatic retry');
  assert.equal(c.sb.gameHistory[c.sb.gameHistory.length - 1].content, input);
  assert.equal(c.sb._genText, input, 'failed player input was discarded');
  assert.equal(c.sb._genFailed, false, 'visibility recovery must not regenerate a truncated reply');
  assert.equal(c.sb._pendingGen, null);
  assert.equal(c.sb._stream, null);
  assert.equal(c.sb._mainRequest, null);
  assert.equal(c.sb.sendBtn.disabled, false);
  assert.equal(c.sb.gameState._turnStats.fin, finishReason);
  const message = main.visible.flat().map(line => line.text || '').join('\n');
  assert(/출력 한도|출력.*상한|응답.*잘/.test(message), 'missing explicit truncation explanation');
  assert(/자동.*(?:호출하지|재시도.*않)|자동.*없이/.test(message), 'failure message must explain that it will not retry automatically');
  assert(/다시 답변|직접.*재시도/.test(message), 'failure message must explain manual recovery');
}

T('a stalled parked response releases the input and preserves the failed turn', async () => {
  const fixture=failedMainFixture(true), { c, input }=fixture;
  c.sb.SYNC_URL='https://fixture.invalid';
  let signal;
  c.sb.fetch=async (_, opts) => { signal=opts.signal; return new Promise((resolve,reject) => {
    signal.addEventListener('abort',() => reject(new Error('aborted')),{once:true});
  }); };
  const main=installMainRequest(c,async (...args) => {
    args[5]('{"narration":"Partial."}');
    c.sb._stream.active=true;
    return {error:{code:'NETWORK_ERROR',message:'connection closed'}};
  });
  const work=c.sb.callGemini([]);
  await flush();
  assert.ok(signal);
  [...c.timers.values()].find(t=>t.ms===15000).fn();
  await work;
  assert.equal(c.sb.sendBtn.disabled,false);
  assert.equal(c.sb._mainRequest,null);
  assert.equal(c.sb._stream,null);
  assert.equal(c.sb.gameHistory.at(-1).content,input);
  assert.ok(main.visible.flat().some(line => line.text.includes('NETWORK_ERROR')));
});

T('empty EOF before the first rendered line uses the completed relay answer once', async () => {
  const c = failedMainFixture(false).c;
  c.sb.SYNC_URL='https://relay.fixture.invalid';
  const saved=JSON.stringify({narration:'성인 사서는 반납 기록을 차분하게 확인했다.',dialogue:[],
    state_update:{},choices:[],chronicle:[]});
  let reads=0;
  c.sb.fetch=async url=>{
    assert.equal(url,c.sb.SYNC_URL+'/gen?id=fixture-relay');
    reads++;
    return {ok:true,text:async()=>'completed transcript'};
  };
  c.sb.parseSseTranscript=()=>({text:saved,finishReason:'stop'});
  const main=installMainRequest(c,async()=>({error:{code:'EMPTY_RESPONSE',message:'empty response'},
    relayId:'fixture-relay'}));
  await c.sb.callGemini([]);
  assert.equal(main.requests.length,1); assert.equal(reads,1); assert.equal(main.countdowns,0);
  assert.equal(JSON.parse(c.sb.gameHistory.at(-1).content).narration,JSON.parse(saved).narration);
});

for (const active of [false, true]) {
  for (const completes of [true, false]) {
    T('relay loss ' + (active ? 'during' : 'before') + ' playback, original ' + (completes ? 'ready after 6s' : 'never ready') + ': one generation', async () => {
      const fixture = failedMainFixture(false), { c } = fixture;
      const line = '사서가 반납 장부를 펼쳤다.';
      const saved = JSON.stringify({ narration: line + ' 돌려준 책을 찾아 표시했다.', dialogue: [], state_update: {}, choices: [] });
      let clock = 0, reads = 0;
      const schedule = c.sb.setTimeout;
      c.sb.setTimeout = (fn, ms) => {
        const id = schedule(fn, ms);
        c.timers.get(id).at = clock + ms;
        return id;
      };
      c.sb.SYNC_URL = 'https://relay.fixture.invalid';
      c.sb.fetch = async url => {
        assert.equal(url, c.sb.SYNC_URL + '/gen?id=fixture-original');
        reads++;
        return completes && clock >= 6000 ? { ok: true, text: async () => 'transcript' } : { ok: false, status: 404 };
      };
      c.sb.parseSseTranscript = () => ({ text: saved, finishReason: 'stop' });
      const main = installMainRequest(c, async (n, ...args) => {
        if (active) args[4]('{"narration":"' + line + ' 아직');
        return { error: { code: 'NETWORK_ERROR', message: 'Failed to fetch' }, relayId: 'fixture-original' };
      });
      installMainStreaming(c, main);
      let done = false;
      const work = c.sb.callGemini([]).then(() => { done = true; });
      await flush();
      while (!done) {
        const next = [...c.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        assert.ok(next && next[1].at <= 20000, 'recovery failed to return control within its budget');
        const [id, timer] = next;
        c.timers.delete(id); clock = timer.at; timer.fn();
        await flush();
      }
      await work;
      assert.ok(reads > 3);
      assert.equal(main.requests.length, 1); assert.equal(main.countdowns, 0);
      assert.equal(c.sb.sendBtn.disabled, false); assert.equal(c.sb._mainRequest, null);
      if (completes) {
        assert.equal(c.sb.turnCount, fixture.turn + 1);
        assert.equal(JSON.parse(c.sb.gameHistory.at(-1).content).narration, JSON.parse(saved).narration);
      } else {
        assert.deepEqual(clone(c.sb.gameHistory), fixture.history);
        assert.deepEqual(clone(c.sb.dialogueLog), fixture.log);
        assert.equal(c.sb._genText, fixture.input);
        assert.equal(c.sb._genFailed, false, 'resuming the app must not generate again');
        assert.ok(main.visible.flat().some(row => row.text.includes('다시 답변')));
      }
      assert.equal(c.timers.size, 0);
    });
  }
}

T('changing saves cancels an in-flight parked read without retrying or touching the new scene', async () => {
  const { c } = failedMainFixture(false);
  c.sb.SYNC_URL = 'https://relay.fixture.invalid';
  let signal;
  c.sb.fetch = (_, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
  });
  const main = installMainRequest(c, async () => ({ error: { code:'NETWORK_ERROR', message:'Failed to fetch' }, relayId:'fixture-original' }));
  const work = c.sb.callGemini([]);
  await flush();
  c.sb.resetTurnAsyncWork();
  assert.equal(signal.aborted, true);
  await work;
  assert.equal(main.requests.length, 1); assert.equal(main.visible.length, 0);
  assert.equal(c.timers.size, 0);
});

T('integrated malformed JSON cannot become a completed scene with invented empty state', async () => {
  const fixture = failedMainFixture(false), { c } = fixture;
  const main = installMainRequest(c, async () => ({
    text: '{"narration":"동전 네 개를 건넸다.","dialogue":[],"state_update":{"gold":4,',
    finishReason: 'stop', relayId: null, timing: {ttfb:1,total:2}
  }));
  vm.runInContext(grabFn('extractFallback'), c.sb);
  await c.sb.callGemini([]); await flush();
  assert.deepEqual(clone(c.sb.gameHistory), fixture.history);
  assert.equal(c.sb.gameState.gold, fixture.state.gold);
  assert.equal(c.sb.turnCount, fixture.turn);
  assert.equal(c.calls.apply.length, 0);
  assert.equal(c.calls.requests.length, 0);
  assert.equal(main.requests.length, 1);
  assert.equal(c.sb.sendBtn.disabled, false);
  assert.equal(c.sb._mainRequest, null);
  assert.equal(c.sb._genText, fixture.input);
  assert.ok(main.visible.flat().some(line => /완성된 장면과 상태/.test(line.text)));
  assert.deepEqual(clone(c.sb.dialogueLog), fixture.log);
});

for (const split of [false, true]) {
  const mode = split ? 'split' : 'integrated';
  T(mode + ' main rejects valid-looking JSON when finishReason is length without committing a turn', async () => {
    const fixture = failedMainFixture(split), { c } = fixture;
    const main = installMainRequest(c, async () => ({
      text: JSON.stringify({ narration: '성인 사서가 동전 아홉 개를 건넸다.', dialogue: [],
        state_update: { gold: 9, event: '도서관 약속' }, choices: ['영수증을 본다', '돌아간다'],
        chronicle: ['동전 아홉 개를 받았다.'] }),
      finishReason: 'length', timing: { ttfb: 100, total: 500 }, modelUsed: 'fixture/model:free'
    }));
    let relayReads = 0;
    c.sb.fetch = async () => { relayReads++; throw new Error('unexpected relay recovery'); };
    await c.sb.callGemini([]); await flush();
    assertUncommittedMain(fixture, main, 'length');
    assert.deepEqual(clone(c.sb.dialogueLog), fixture.log);
    assert.equal(relayReads, 0);
    assert.equal(c.timers.size, 0);
  });

  T(mode + ' streamed max_tokens failure removes partial lines and never recovers them as a completed turn', async () => {
    const fixture = failedMainFixture(split), { c } = fixture, reply = deferred();
    const main = installMainRequest(c, () => reply.promise);
    c.sb.FREE_TEST_MODE = true;
    installMainStreaming(c, main);
    const originalBg = c.sb.lastBg;
    const partial = '성인 사서는 책의 목록을 살펴보며 영수증을 작성하기 시작했다.';
    let relayReads = 0, oldCallbacks = 0;
    c.sb.fetch = async () => { relayReads++; throw new Error('unexpected relay recovery'); };
    const work = c.sb.callGemini([]); await flush();
    main.requests[0].onChunk('{"background":"fixture-incomplete-bg","narration":"' + partial + ' 아직 작성 중');
    assert(main.streamVisible.some(line => line.text === partial), 'fixture never displayed a partial sentence');
    assert(c.sb.dialogueLog.some(line => line.text === partial), 'real enqueueLine never recorded the temporary stream');
    assert.equal(c.sb.currentBgFile, 'fixture-incomplete-bg');
    c.sb._typeTimer = c.sb.setTimeout(() => { oldCallbacks++; }, 30);
    c.sb.autoTimer = c.sb.setTimeout(() => { oldCallbacks++; }, 900);
    c.sb._typeCallback = () => { oldCallbacks++; };
    const priorTypeGen = c.sb._typeGen || 0;
    reply.resolve({
      text: JSON.stringify({ narration: partial, dialogue: [], state_update: { gold: 9 },
        choices: ['허구 선택지'], chronicle: ['아직 확정하지 않은 사건'] }),
      finishReason: 'MAX_TOKENS', timing: { ttfb: 100, total: 500 }, modelUsed: 'fixture/model:free',
      error: { code: 503, message: 'fixture stream ended at its output limit' }
    });
    await work; await flush();
    assertUncommittedMain(fixture, main, 'MAX_TOKENS');
    assert.deepEqual(clone(c.sb.dialogueLog), fixture.log, 'uncommitted stream leaked into dialogue history');
    assert.equal(c.sb.dialogueQueue.length, 0);
    assert.equal(c.sb.lastBg, originalBg);
    assert.equal(c.sb.currentBgFile, originalBg);
    assert.equal(c.sb._typeCallback, null);
    assert(c.sb._typeGen > priorTypeGen);
    assert.equal(c.sb.isShowing, false);
    assert.equal(c.sb.waitingForTap, false);
    assert.equal(c.timers.size, 0, 'stale display callbacks survived failure');
    assert.equal(oldCallbacks, 0);
    assert.equal(relayReads, 0, 'provider truncation must not be relabeled as a complete parked response');
  });
}

for (const split of [false, true]) {
  for (const recovery of ['stream-error', 'incomplete-json']) {
    const mode = split ? 'split' : 'integrated';
    T(mode + ' ' + recovery + ' relay recovery rejects a truncated parked SSE without committing partial content', async () => {
      const fixture = failedMainFixture(split), { c } = fixture, reply = deferred();
      const main = installMainRequest(c, () => reply.promise);
      installMainStreaming(c, main);
      vm.runInContext(['createSseParser', 'providerText', 'parseSseTranscript'].map(grabFn).join('\n'), c.sb);
      const finishReason = recovery === 'stream-error' ? 'length' : 'MAX_TOKENS';
      const partial = '성인 사서는 반납한 책의 장부를 펼치고 영수증 작성을 시작했다.';
      const partialJson = '{"background":"fixture-parked-bg","narration":"' + partial + ' 아직';
      const fullText = JSON.stringify({
        narration: partial + ' 서가의 기록을 확인하는 동안 창밖에는 조용히 비가 내렸다.',
        dialogue: [{ speaker: '새 인물', char_id: 'fresh', text: '반납 기록을 자세히 확인하겠습니다.' }],
        state_update: { gold: 999, event: '도서관 약속' },
        choices: ['서가를 본다', '기다린다'], chronicle: ['아직 확정할 수 없는 반납 사건']
      });
      assert(fullText.length > partialJson.length, 'fixture must reach the longer parked response recovery branch');
      const midpoint = Math.floor(fullText.length / 2);
      const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
      const transcript = frame({ model: 'fixture/parked-model:free', choices: [{ delta: { content: fullText.slice(0, midpoint) } }] })
        + frame({ choices: [{ delta: { content: fullText.slice(midpoint) } }] })
        + frame({ choices: [{ delta: {}, finish_reason: finishReason }] }) + 'data: [DONE]\n\n';
      // Validate the synthetic SSE using the exact parser used during recovery.
      const parsedFixture = c.sb.parseSseTranscript(transcript);
      assert.equal(parsedFixture.text, fullText);
      assert.equal(parsedFixture.finishReason, finishReason);
      assert.equal(JSON.parse(parsedFixture.text).state_update.gold, 999);
      let relayReads = 0, transcriptReads = 0, transcriptParses = 0;
      const parseTranscript = c.sb.parseSseTranscript;
      c.sb.parseSseTranscript = sse => { transcriptParses++; return parseTranscript(sse); };
      c.sb.SYNC_URL = 'https://relay.fixture.invalid';
      c.sb.fetch = async url => {
        relayReads++;
        assert.equal(String(url), c.sb.SYNC_URL + '/gen?id=fixture-incomplete-main');
        return { ok: true, text: async () => { transcriptReads++; return transcript; } };
      };
      const originalBg = c.sb.lastBg;
      const work = c.sb.callGemini([]); await flush();
      main.requests[0].onChunk(partialJson);
      assert(main.streamVisible.some(line => line.text === partial), 'fixture never displayed its partial scene');
      assert(c.sb.dialogueLog.some(line => line.text === partial), 'fixture did not exercise real stream logging');
      reply.resolve({
        text: recovery === 'stream-error' ? '' : partialJson,
        finishReason: recovery === 'stream-error' ? null : 'stop',
        ...(recovery === 'stream-error' ? { error: { code: 503, message: 'fixture interrupted connection' } } : {}),
        timing: { ttfb: 100, total: 500 }, modelUsed: 'fixture/client-model:free'
      });
      await work; await flush();
      assert.equal(relayReads, 1, 'recovery must only read the existing parked generation once');
      assert.equal(transcriptReads, 1);
      assert.equal(transcriptParses, 1, 'recovery bypassed the real SSE finish-reason parser');
      assertUncommittedMain(fixture, main, finishReason);
      assert.deepEqual(clone(c.sb.dialogueLog), fixture.log, 'parked truncation retained partial stream content');
      assert.equal(c.sb.dialogueQueue.length, 0);
      assert.equal(c.sb.lastBg, originalBg);
      assert.equal(c.sb.currentBgFile, originalBg);
      assert.equal(c.timers.size, 0, 'parked truncation left a retry or playback timer');
      assert(!c.calls.toasts.some(message => /복구했습니다/.test(message)),
        'a truncated parked response must not be announced as successfully recovered');
    });
  }
}

T('first failed playing input exposes manual retry while setup and empty history keep it hidden', () => {
  const c = sandbox();
  const elements = { continueHint: { style: {} }, redoBar: { style: {} } };
  Object.assign(c.sb, { autoTimer: null, inputBar: { style: {} }, liftDialogueForInput() {},
    document: { getElementById: id => elements[id] || null } });
  vm.runInContext(grabFn('enterInputMode'), c.sb);
  for (const scenario of [
    { phase: 'playing', history: [{ role: 'user', content: '첫 요청' }], visible: true },
    { phase: undefined, history: [{ role: 'user', content: '기존 저장의 요청' }], visible: true },
    { phase: 'setup', history: [{ role: 'user', content: '설정 입력' }], visible: false },
    { phase: 'playing', history: [], visible: false }
  ]) {
    c.sb._startPhase = scenario.phase;
    c.sb.gameHistory = scenario.history;
    c.sb.enterInputMode();
    assert.equal(elements.redoBar.style.display, scenario.visible ? 'flex' : 'none');
    assert.equal(c.sb.inputBar.style.display, 'flex');
  }
});

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

T('integrated and split turns persist the same valid numeric and on-scene character changes', async () => {
  for (const split of [false, true]) {
    const proposed = { gold: 2, rep: '5', chars: {
      old: { location: '광장' }, fresh: { knows: '약속' },
      absent: { knows: '몰래 한 약속' }, invented: { intimacy: 99 },
    } };
    const c = sandbox({ respond: () => Promise.resolve(JSON.stringify({ state_update: proposed })) });
    c.sb.CHARACTERS.absent = { name: '자리에 없는 인물' };
    c.sb.gameHistory = [{ role: 'user', content: '주변을 본다' }];
    c.sb.localStorage.getItem = () => JSON.stringify({ splitPipe: split });
    installMainRequest(c, async () => ({ text: JSON.stringify({ narration: '광장에서 동전을 받았다.',
      dialogue: [{ speaker: '새 인물', text: '약속할게.' }], ...(split ? {} : { state_update: proposed }) }) }));
    vm.runInContext(grabFn('resolveSpeakerName') + grabFn('fixSpeakerIds'), c.sb);
    await c.sb.callGemini(['old']);
    assert.equal(await c.sb.ensureStateExtractReady(), true);
    const saved = JSON.parse(c.sb.gameHistory.at(-1).content);
    assert.equal(saved.dialogue[0].char_id, 'fresh');
    const expected = { gold: 2, chars: { old: proposed.chars.old, fresh: proposed.chars.fresh } };
    assert.deepEqual(saved.state_update, expected, 'saved provider state for split=' + split);
    assert.deepEqual(c.calls.apply.find(x => x.data.state_update).data.state_update, expected);
    assert.equal(c.sb.gameState.rep, 1); assert.equal(c.sb.gameState.gold, 12);
  }
});

T('resuming an older pending receipt preserves the known speaker named in its saved scene', async () => {
  const scene = { narration: '인사를 나눴다.', dialogue: [{ speaker: '새 인물', text: '약속할게.' }] };
  const c = sandbox({ respond: async () => JSON.stringify({
    state_update: { rep: 1, chars: { fresh: { knows: '약속' }, invented: { knows: '허구' } } }
  }) });
  c.entry.content = JSON.stringify(scene);
  c.entry._stateExtract = { id: 'older', turn: 3, status: 'failed', activeCharIds: [], userText: '인사한다' };
  vm.runInContext(grabFn('resolveSpeakerName') + grabFn('fixSpeakerIds'), c.sb);
  assert.equal(await c.sb.ensureStateExtractReady(), true);
  assert.deepEqual(JSON.parse(c.entry.content).state_update, { rep: 1, chars: { fresh: { knows: '약속' } } });
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

T('a prompt assembly failure releases the send lock and keeps the submitted input for retry', async () => {
  const c = sandbox();
  c.sb.gameHistory = [{ role: 'user', content: '문을 열고 들어간다.' }];
  const main = installMainRequest(c, () => { throw new Error('must not call provider'); });
  c.sb.buildStatePrompt = () => { throw new Error('stored scene could not be read'); };
  await c.sb.callGemini([]);
  assert.equal(c.sb.sendBtn.disabled, false);
  assert.equal(c.sb._mainRequest, null);
  assert.equal(main.requests.length, 0);
  assert.equal(c.sb.gameHistory.at(-1).content, '문을 열고 들어간다.');
  assert.ok(main.visible.flat().some(line => /stored scene could not be read/.test(line.text)));
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
