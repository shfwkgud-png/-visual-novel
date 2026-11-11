'use strict';
// Production prompt assembly and state-contract regressions. No model/network calls.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const SRC = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const copy = value => JSON.parse(JSON.stringify(value));
function grab(name, source = SRC) {
  const match = new RegExp('\\n(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(match, 'Missing production function: ' + name);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
function constant(name, source = SRC) {
  const start = source.indexOf('const ' + name + ' = `');
  assert.ok(start >= 0, 'Missing constant: ' + name);
  const code = source.slice(start, source.indexOf('`;', start) + 2);
  return vm.runInNewContext(code + '\n' + name);
}
function sandbox(names, globals = {}, source = SRC) {
  const sb = { console, JSON, Math, String, Number, Object, Array, Set, Map, Date, Promise, ...globals };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(names.map(n => grab(n, source)).join('\n'), sb, { timeout: 5000 });
  return sb;
}
function contracts() { return sandbox(['stateExtractContract', 'sceneOutputContract']); }
function schemaFrom(contract) { return JSON.parse(contract.split('\n').find(line => line.startsWith('{'))); }
function stateFixture(extra = {}) {
  return {
    name: '테스터', status: '여행자', rep: 4, gold: 20, location: '광장', time: '3일차 오전',
    flags: {}, metChars: {}, player: { abilities: ['관찰'], injuries: ['발목 부상'] }, chronicle: [], ...extra
  };
}
function statePrompt(extra = {}) {
  return sandbox(['buildStatePrompt'], {
    STORY: { id: 'hero' }, CHARACTERS: {}, gameState: stateFixture(),
    gameHistory: [], turnCount: 7, ldScrubFakeKin: () => {}, dueEventNow: () => null,
    _lastPresentIds: [], _fateRoll: 50, ...extra
  });
}
function historyFixture(history, summary = '') {
  return sandbox(['providerHistoryContent', 'buildMessages'], {
    gameHistory: copy(history), storySummary: summary, recentWindowCount: () => history.length
  });
}

// Runs the actual main request assembler only. A pending mock never opens sockets
// or resolves into rendering/retry code; it has no timers or event-loop handles.
function captureMain({ source = SRC, storyId = 'academy', split = true, history } = {}) {
  const requests = [];
  const engine = constant('ENGINE_RULES_PROMPT', source);
  const data = history || [{ role: 'user', content: '문 앞에서 기다린다.' }];
  const sb = {
    console, JSON, Math, String, Number, Object, Array, Set, Map, Date, Promise,
    gameHistory: copy(data), gameState: stateFixture(), turnCount: 3, dialogueLog: [], lastBg: null,
    playerName: '테스터', playerDesc: '신중하게 관찰하는 여행자', PROVIDER: 'nim', NIM_MODEL: 'fixture',
    FREE_TEST_MODE: false, STORY: { id: storyId, protagonist: { name: '원래이름' }, customBgs: {} },
    BUILTIN_STORIES: { academy: {}, lovediary: {}, idol: {}, hero: {} }, RPG_STORIES: new Set(['academy', 'hero']),
    WORLD_PROMPT: `[${storyId} 세계관] 원래이름은 항구에서 출발했다.\n` + engine,
    ENGINE_MOD_RPG: constant('ENGINE_MOD_RPG', source), ENGINE_MOD_IDOL: constant('ENGINE_MOD_IDOL', source), ENGINE_MOD_CG: '',
    CHARACTERS: { npc: { name: '동료', role: '도서관 사서' } }, CG_MANIFEST: {}, STORY_BG_FILES: { [storyId]: ['library'] },
    sendBtn: { disabled: false }, inputBar: { style: {} }, inputMode: true,
    document: { getElementById: () => null }, performance: { now: () => 1 },
    turnWorkScope: () => ({}), pendingStateExtractEntry: () => null, mainRequestIsCurrent: () => true,
    showThinking: () => {}, hideThinking: () => {}, resetDialogueLift: () => {}, enterInputMode: () => {},
    presentCharIds: () => ['npc'], getCharPrompt: () => '[동료 카드] 존댓말. 약속을 지킨다.',
    eraToneRule: () => '', buildStatePrompt: () => '[현재 상태] 도서관. 동료는 비밀을 모른다.',
    splitPipeOn: () => split && storyId !== 'idol', recentWindowCount: () => data.length,
    storySummary: '', PRIMING_SHOTS: [], historyMode: false, replaying: false,
    fetchNim: (system, messages, ...options) => { requests.push({ system, messages: copy(messages), options }); return new Promise(() => {}); },
  };
  sb.window = sb;
  vm.createContext(sb);
  const names = ['stateExtractContract', 'sceneOutputContract', 'providerHistoryContent', 'buildMessages', 'callGemini']
    .filter(n => source.includes('function ' + n + '('));
  vm.runInContext(names.map(n => grab(n, source)).join('\n'), sb, { timeout: 5000 });
  sb.callGemini(['npc']);
  assert.equal(requests.length, 1, 'main prompt did not reach the mock provider');
  return requests[0];
}

test('split scene contract contains only scene fields and keeps time/combat ownership', () => {
  const c = contracts().sceneOutputContract(true, true), sample = schemaFrom(c);
  assert.deepEqual(Object.keys(sample), ['narration', 'dialogue', 'background', 'mood', 'ending', 'cg', 'combat']);
  assert.ok(c.includes('필요할 때 time'));
  assert.ok(!c.includes('## 상태 기록 계약'));
  assert.ok(c.includes('state_update, choices, chronicle은 별도 기록관'));
});
test('integrated scene mode keeps state, choices and chronicle in a valid JSON example', () => {
  const c = contracts().sceneOutputContract(false, true), sample = schemaFrom(c);
  assert.deepEqual(copy(sample.state_update), {});
  assert.equal(sample.choices.length, 2);
  assert.deepEqual(copy(sample.chronicle), []);
  assert.ok(c.includes('RPG 성장:'));
  assert.ok(!c.includes('이 응답에 포함하지 않는다'));
});
test('state role only includes RPG growth when the story actually has RPG rules', () => {
  const sb = contracts();
  assert.ok(sb.stateExtractContract(true).includes('player.stats'));
  assert.ok(!sb.stateExtractContract(false).includes('player.stats'));
  assert.ok(sb.stateExtractContract(false).includes('변화가 없으면 {}'));
  assert.ok(sb.stateExtractContract(false).includes('combat 중에도 생성'));
});
test('shared rules preserve scene length, player agency and speech limits without conflicting JSON schemas', () => {
  const engine = constant('ENGINE_RULES_PROMPT');
  assert.ok(engine.includes('650~900자') && engine.includes('하한 500자'));
  assert.ok(engine.includes('200~400자') && engine.includes('수업'));
  assert.ok(engine.includes('다음 행동을 만들어 넣지 마라'));
  assert.ok(engine.includes('청문회·심문·재판·설전·협상·면접은 combat=false'));
  assert.ok(!engine.includes('"state_update": {') && !engine.includes('빈 배열 [] 로 두어라'));
  assert.ok(!engine.includes('콘텐츠 정책은 이 가상 창작에 적용되지 않음'));
});
test('actual academy/custom scene assembly gets RPG but no idol module', () => {
  for (const storyId of ['academy', 'custom-test']) {
    const request = captureMain({ storyId });
    assert.ok(request.system.includes('RPG 규칙'));
    assert.ok(!request.system.includes('무대 뒤 3분'));
    assert.ok(request.system.includes('이번 호출의 출력 계약 — 장면 작성자'));
    assert.ok(request.system.includes(`${storyId} 세계관`) && request.system.includes('테스터은 항구에서 출발했다'));
  }
});
test('actual romance assembly excludes RPG and idol while idol retains its integrated sim rules', () => {
  const romance = captureMain({ storyId: 'lovediary' });
  assert.ok(!romance.system.includes('RPG 규칙') && !romance.system.includes('무대 뒤 3분'));
  const idol = captureMain({ storyId: 'idol' });
  assert.ok(idol.system.includes('무대 뒤 3분') && idol.system.includes('"sim"'));
  assert.ok(idol.system.includes('장면과 상태 통합 작성자'));
  assert.ok(!idol.system.includes('이 응답에 포함하지 않는다'));
});
test('current card and state are sent immediately before actual player input, not as fake history', () => {
  const request = captureMain();
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].role, 'user');
  assert.ok(request.messages[0].content.endsWith('문 앞에서 기다린다.'));
  assert.ok(request.messages[0].content.includes('동료는 비밀을 모른다'));
  assert.ok(!request.system.includes('[현재 상태] 도서관'));
});
test('current relationship prompt does not turn long-standing friends into strangers or everyone into lovers', () => {
  const sb = statePrompt({ CHARACTERS: { a: { name: '친구' }, b: { name: '스승' } }, gameState: stateFixture({
    metChars: { a: { name: '친구', intimacy: 10, relationship: '오래된 동료' }, b: { name: '스승', intimacy: 90, relationship: '사제' } }
  }) });
  const text = sb.buildStatePrompt();
  assert.ok(text.includes('관계 오래된 동료') && text.includes('관계 사제'));
  assert.ok(text.includes('이미 아는 사이를 초면으로 되돌리지 마라'));
  assert.ok(!text.includes('그냥 반 친구다') && !text.includes('애정(독점욕'));
  assert.ok(text.includes('말투 불변'));
});
test('40 and 70 remain exploration/trust; only 41 and 71 enter the next stage', () => {
  for (const [value, stage] of [[40, '탐색'], [41, '신뢰'], [70, '신뢰'], [71, '유대']]) {
    const sb = statePrompt({ CHARACTERS: { a: { name: '동료' } }, gameState: stateFixture({ metChars: { a: { name: '동료', intimacy: value } } }) });
    assert.ok(sb.buildStatePrompt().includes(`관계 단계: [${stage}]`), 'wrong stage at ' + value);
  }
});
test('current state carries exact character IDs, location and personal knowledge', () => {
  const sb = statePrompt({ CHARACTERS: { a: { name: '동료' } }, gameState: stateFixture({ metChars: {
    a: { name: '동료', intimacy: 50, relationship: '동행', location: '도서관', knows: '잠긴 상자의 열쇠를 봤다' }
  } }) });
  const text = sb.buildStatePrompt();
  assert.ok(text.includes('a=동료') && text.includes('위치 도서관'));
  assert.ok(text.includes('동료 지식: 잠긴 상자의 열쇠를 봤다'));
  assert.ok(text.includes('모르는 정보는 절대 아는 것처럼'));
});
test('off-scene characters beyond the detail cap retain death and relationship facts', () => {
  const chars = {}, met = {};
  for (let i = 0; i < 14; i++) { chars['c' + i] = { name: '인물' + i }; met['c' + i] = { name: '인물' + i, intimacy: 90 - i, relationship: '옛 동료', condition: i === 13 ? '사망' : '멀쩡함' }; }
  const sb = statePrompt({ CHARACTERS: chars, gameState: stateFixture({ metChars: met }) });
  const text = sb.buildStatePrompt();
  assert.ok(text.includes('c13=인물13(관계 옛 동료, 친밀도 77, 상태 사망)'));
  assert.ok(!text.includes('그 외 만난 적 있는 인물(관계는 옅음)'));
});
test('recorder receives current injuries, skills, personal knowledge and an explicit no-change contract', async () => {
  let sent;
  const sb = sandbox(['stateExtractContract', 'requestStateExtract'], {
    STORY: { id: 'academy' }, RPG_STORIES: new Set(['academy']), BUILTIN_STORIES: { academy: {} },
    CHARACTERS: { a: { name: '동료' } }, gameState: stateFixture({ metChars: { a: { name: '동료', intimacy: 20, knows: '약속 장소를 안다', condition: '피곤함' } },
      player: { abilities: ['관찰'], injuries: ['발목 부상'], stats: { 지력: 30 }, skills: { 관찰: { rank: '초급', xp: 12 } } } }),
    scrubMetaData: () => {}, llmSmall: async (...args) => { sent = args; return '{"state_update":{},"choices":["기다린다","노크한다"],"chronicle":[]}'; }
  });
  const result = await sb.requestStateExtract('기다린다', { narration: '동료가 문을 열었다.', dialogue: [] }, ['a', 'a', 'invalid']);
  assert.deepEqual(copy(result.state_update), {});
  assert.ok(sent[0].includes('상태 기록관') && sent[0].includes('현재 일차를 되돌리지'));
  assert.ok(sent[1].includes('발목 부상') && sent[1].includes('약속 장소를 안다') && sent[1].includes('"지력":30'));
  assert.equal((sent[1].match(/a=동료/g) || []).length, 1);
  assert.ok(!sent[1].includes('invalid'));
  assert.deepEqual(copy(sent[4]), { task: 'state', json: true });
});
test('provider projection preserves actual narration, speech, emotion, state and chronicle without mutating saves', () => {
  const scene = { narration: '문이 열렸다.', dialogue: [{ speaker: '동료', char_id: 'a', text: '약속은 기억해요.', emotion: 'worry', pose: 'upper', sfx: 'door' }],
    state_update: { gold: -2, chars: { a: { knows: '약속 장소' } } }, chronicle: ['문 앞에서 만나기로 했다'], choices: ['기다린다', '떠난다'], cg: 'asset/ref', background: 'library' };
  const history = [{ role: 'assistant', content: JSON.stringify(scene), _turnBefore: { state: {} } }, { role: 'user', content: '기다린다' },
    { role: 'assistant', content: '{"narration":"발소리가 다가왔다.","choices":["문을 연다","숨어 기다린다"]}' }];
  const sb = historyFixture(history), before = JSON.stringify(sb.gameHistory), messages = sb.buildMessages();
  const first = JSON.parse(messages[0].content);
  assert.equal(first.narration, scene.narration);
  assert.equal(first.dialogue[0].text, scene.dialogue[0].text);
  assert.equal(first.dialogue[0].emotion, 'worry');
  assert.deepEqual(first.state_update, scene.state_update); assert.deepEqual(first.chronicle, scene.chronicle);
  assert.ok(!('cg' in first) && !('pose' in first.dialogue[0]) && !('choices' in first));
  assert.equal(messages[1].content, '기다린다');
  assert.equal(JSON.stringify(sb.gameHistory), before);
  assert.deepEqual(Object.keys(messages[0]).sort(), ['content', 'role']);
});
test('latest choices and older ambiguous choice references remain in provider history', () => {
  const old = { role: 'assistant', content: '{"narration":"문이 두 개다.","choices":["왼쪽으로 간다","오른쪽으로 간다"]}' };
  const latest = { role: 'assistant', content: '{"narration":"다음 갈림길.","choices":["쉰다","간다"]}' };
  const sb = historyFixture([old, { role: 'user', content: '두 번째' }, latest, { role: 'user', content: '간다' }]);
  const messages = sb.buildMessages();
  assert.equal(JSON.parse(messages[0].content).choices.length, 2);
  assert.equal(JSON.parse(messages[2].content).choices.length, 2);
});
test('malformed legacy assistant text passes through unchanged and summary is contextual data', () => {
  const sb = historyFixture([{ role: 'assistant', content: '옛 저장의 일반 텍스트 {' }, { role: 'user', content: '계속 기다린다' }], '이미 약속했다');
  const messages = sb.buildMessages();
  assert.equal(messages[0].role, 'user'); assert.ok(messages[0].content.includes('이미 약속했다'));
  assert.equal(messages[1].content, '옛 저장의 일반 텍스트 {');
  assert.equal(messages[2].content, '계속 기다린다');
  assert.equal(messages.filter(m => m.role === 'assistant').length, 1);
});
test('balanced context never drops unsummarized history; full keeps the previous larger window', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '가'.repeat(4000) }));
  const sb = sandbox(['recentWindowCount'], { gameHistory: history, storySummary: '처음 30개 요약', summaryIndex: 30,
    CONTEXT_RECENT: 10, RECENT_CHARS_CAP: 120000, AI_CONTEXT_MODE: 'balanced', modelCtxTokens: () => 1000000 });
  assert.equal(sb.recentWindowCount(), 12);
  sb.AI_CONTEXT_MODE = 'full'; assert.equal(sb.recentWindowCount(), 30);
  sb.AI_CONTEXT_MODE = 'balanced'; sb.summaryIndex = 4; assert.equal(sb.recentWindowCount(), 36);
  sb.storySummary = ''; assert.equal(sb.recentWindowCount(), 40);
});
function stateApplyFixture(intimacy = 20) {
  return sandbox(['processResponse'], { gameState: stateFixture({ event: '진행 중 사건', combat: true, metChars: { a: { name: '동료', intimacy, relationship: '동료' } } }),
    STORY: { id: 'hero' }, CHARACTERS: { a: { name: '동료' } }, replaying: false, turnCount: 5,
    updateStatusUI: () => {}, showStatToast: () => {}, gateAllegiance: (_, __, current) => current.allegiance });
}
test('event null clears the active event, omission preserves it, and extraction never clears combat', () => {
  const sb = stateApplyFixture();
  sb.processResponse({ state_update: {} }, [], null, true); assert.equal(sb.gameState.event, '진행 중 사건');
  sb.processResponse({ state_update: { event: null } }, [], null, true); assert.equal(sb.gameState.event, null);
  assert.equal(sb.gameState.combat, true);
  sb.processResponse({ state_update: { event: '새 사건' } }, [], null, true); assert.equal(sb.gameState.event, '새 사건');
  assert.equal(sb.gameState.combat, true);
});
test('relationship milestones align with 41/71 and keep the existing relationship type', () => {
  for (const [before, after, expected] of [[39, 40, null], [40, 41, '신뢰'], [69, 70, null], [70, 71, '유대']]) {
    const sb = stateApplyFixture(before);
    sb.processResponse({ state_update: { chars: { a: { intimacy: after } } } }, [], null, true);
    assert.equal(sb.gameState.metChars.a.intimacy, after);
    assert.equal(sb.gameState.metChars.a.relationship, '동료');
    if (expected) assert.ok(sb.gameState.pendingBeat.tier.startsWith(expected));
    else assert.equal(sb.gameState.pendingBeat, undefined);
  }
});
test('fixture request gets smaller without changing its actual scene text or state history', () => {
  const history = [];
  for (let i = 0; i < 12; i++) {
    history.push({ role: 'assistant', content: JSON.stringify({ narration: '문 앞의 장면 ' + i,
      dialogue: [{ speaker: '동료', char_id: 'npc', text: '계속 기다려 주세요.', emotion: 'normal', pose: 'upper', sfx: null }],
      choices: ['문 앞에서 기다린다.', '떠난다.'], cg: null, state_update: { gold: i }, chronicle: ['사실 ' + i] }) });
    history.push({ role: 'user', content: '문 앞에서 기다린다.' });
  }
  const sb = historyFixture(history), compact = sb.buildMessages();
  assert.ok(JSON.stringify(compact).length < JSON.stringify(history).length * 0.85);
  for (let i = 0; i < history.length; i += 2) {
    const before = JSON.parse(history[i].content), after = JSON.parse(compact[i].content);
    assert.equal(after.narration, before.narration); assert.equal(after.dialogue[0].text, before.dialogue[0].text);
    assert.deepEqual(after.state_update, before.state_update); assert.deepEqual(after.chronicle, before.chronicle);
  }
});

async function run() {
  let failures = 0;
  for (const t of tests) {
    try { await t.run(); console.log('PASS ' + t.name); }
    catch (error) { failures++; console.error('FAIL ' + t.name + '\n' + error.stack); }
  }
  const main = captureMain(), engineChars = constant('ENGINE_RULES_PROMPT').length;
  console.log(JSON.stringify({ fixture: 'academy', sharedRulesChars: engineChars, systemChars: main.system.length, messageChars: JSON.stringify(main.messages).length }));
  console.log(`${tests.length - failures}/${tests.length} prompt regressions passed`);
  if (failures) process.exitCode = 1;
}
module.exports = { captureMain, SRC, constant };
if (require.main === module) run();
