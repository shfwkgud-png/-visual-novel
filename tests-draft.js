'use strict';
// Exercise the real creator flow with deferred model fixtures. No network or keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
function grab(name) {
  const start = source.search(new RegExp('\\n(?:async )?function ' + name + '\\('));
  assert(start >= 0, name + ' missing');
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const draft = title => ({ text: JSON.stringify({
  title, desc: '새 소개', genre: '모험', worldLore: '새 세계관',
  protagonist: { name: '새 주인공', desc: '새 배경' },
  characters: [{ name: '동료', gender: '여성', role: '길잡이', personality: '신중함' }],
  startBg: 'alley', events: [{ t: '시작 사건' }], endings: []
}), finishReason: 'stop' });
function harness({ free = false, request = async () => draft('생성된 초안'), stories = {} } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false,
      style: {}, focus() {}, classList: { toggle() {} } });
    return elements.get(id);
  };
  const calls = [], notices = [];
  const sb = {
    console, FREE_TEST_MODE: free, cEditId: 'old', cStep: 1, cCoverUrl: null,
    cPickedFace: null, cChars: { kept: { name: '기존 인물' } }, cStartCharSel: {},
    cCustomBgs: {}, cEvents: [], cEndings: [],
    BG_OPTIONS: [['alley', '골목']], SPRITE_NUMS: ['101', '102'],
    SPRITE_GENDER: { 101: '남성', 102: '여성' }, BUILTIN_STORIES: {},
    document: { getElementById: element },
    needsAiSetup: () => false, openSettings() {}, requireLogin: () => true,
    showStatToast: text => notices.push(text), allStories: () => stories,
    refreshBgSelect() {}, renderEventLists() {}, renderCreatorStep() {},
    renderCoverGallery() {}, renderCharGallery() {}, renderCharList() {},
    callLlmTask: async (...args) => { calls.push(args); return await request(...args); }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(['aiSettingsBusy', 'isFreeApiMode', 'aiDraft', 'openCreator', 'closeCreator'].map(grab).join('\n'), sb);
  element('cIdea').value = '모험 이야기';
  element('cTitle').value = '기존 제목';
  element('cWorld').value = '사용자가 쓴 설정';
  return { sb, calls, notices, element };
}
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('free quota errors make exactly one request and preserve the existing draft', async () => {
  const h = harness({ free: true, request: async () => ({ error: { code: 429, message: 'rate limit', retryable: false } }) });
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][2].task, 'draft'); assert.equal(h.calls[0][2].json, true);
  assert.equal(h.element('cTitle').value, '기존 제목');
  assert.equal(h.element('cWorld').value, '사용자가 쓴 설정');
  assert.equal(h.sb.cChars.kept.name, '기존 인물');
  assert.equal(h.sb._aiDraftPending, null); assert.equal(h.element('aiDraftBtn').disabled, false);
});
test('a free empty response does not trigger another request', async () => {
  const h = harness({ free: true, request: async () => ({ text: '' }) });
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 1); assert.equal(h.element('cTitle').value, '기존 제목');
});
test('repeated clicks share the active draft operation', async () => {
  const pending = deferred(), h = harness({ request: () => pending.promise });
  const first = h.sb.aiDraft();
  assert.equal(h.element('aiDraftBtn').disabled, true); assert.equal(h.sb.aiSettingsBusy(), true);
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 1); assert.equal(h.element('cTitle').value, '기존 제목');
  pending.resolve(draft('첫 초안')); await first;
  assert.equal(h.element('cTitle').value, '첫 초안'); assert.equal(h.sb.aiSettingsBusy(), false);
  assert.equal(h.element('aiDraftBtn').disabled, false);
});
test('opening another editor prevents a late draft from overwriting its settings', async () => {
  const pending = deferred(), h = harness({ request: () => pending.promise, stories: {
    other: { title: '다른 작품', worldLore: '다른 작품의 사용자 설정', characters: { resident: { name: '기존 주역' } } }
  } });
  const first = h.sb.aiDraft();
  h.sb.openCreator('other');
  const buttonText = h.element('aiDraftBtn').textContent;
  pending.resolve(draft('옛 응답')); await first;
  assert.equal(h.element('cTitle').value, '다른 작품');
  assert.equal(h.element('cWorld').value, '다른 작품의 사용자 설정');
  assert.equal(h.sb.cChars.resident.name, '기존 주역');
  assert.equal(h.element('aiDraftBtn').textContent, buttonText);
  assert.equal(h.element('aiDraftBtn').disabled, false);
});
test('closing the creator cancels ownership of a late response', async () => {
  const pending = deferred(), h = harness({ request: () => pending.promise });
  const first = h.sb.aiDraft(); h.sb.closeCreator();
  pending.resolve(draft('닫은 뒤 응답')); await first;
  assert.equal(h.element('creatorScreen').style.display, 'none');
  assert.equal(h.element('cTitle').value, '기존 제목'); assert.equal(h.sb._aiDraftPending, null);
});
test('ordinary transient failure retains one retry and applies the successful draft', async () => {
  let count = 0;
  const h = harness({ request: async () => ++count === 1
    ? { error: { code: 503, message: 'temporary' } } : draft('재시도 성공') });
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 2); assert.equal(h.element('cTitle').value, '재시도 성공');
  assert.equal(h.sb.cChars.f102.name, '동료'); assert.equal(h.sb._aiDraftPending, null);
});
test('ordinary nonretryable failure is not retried', async () => {
  const h = harness({ request: async () => ({ error: { code: 'CANCELLED', message: 'cancelled', retryable: false } }) });
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 1); assert.equal(h.element('cWorld').value, '사용자가 쓴 설정');
});
test('a token-limited response cannot replace an existing draft even if JSON parses', async () => {
  const h = harness({ request: async () => ({ ...draft('잘린 초안'), finishReason: 'MAX_TOKENS' }) });
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 1); assert.equal(h.element('cTitle').value, '기존 제목');
  assert.equal(h.sb.cChars.kept.name, '기존 인물');
});
test('a blocked response is not retried and does not clear user content', async () => {
  const h = harness({ request: async () => ({ blocked: true, text: '', finishReason: 'SAFETY' }) });
  await h.sb.aiDraft();
  assert.equal(h.calls.length, 1); assert.equal(h.element('cTitle').value, '기존 제목');
  assert.equal(h.element('cWorld').value, '사용자가 쓴 설정');
});

(async () => {
  let failed = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
  }
  console.log(`${cases.length - failed}/${cases.length} creator draft regressions passed`);
  if (failed) process.exitCode = 1;
})();
