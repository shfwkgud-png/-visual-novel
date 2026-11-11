'use strict';
// Provider preferences and history budgets. Only fake keys and in-memory storage.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const src = fs.readFileSync(require('path').join(__dirname, 'novel.html'), 'utf8');
function grab(name) {
  const i = src.search(new RegExp('\\n(?:async )?function ' + name + '\\('));
  assert(i >= 0, 'missing ' + name);
  return src.slice(i, src.indexOf('\n}', i) + 2);
}
function sandbox(cfg = {}) {
  const storage = new Map([['vn_cfg', JSON.stringify(cfg)]]);
  const ids = ['apiScreen','provGemini','provNim','provOpenrouter','apiKeyInput','orKeyInput','orModelSel','orOnlyStory','orOnlyStoryRow','nimUrlInput','nimModelSel','geminiModelSel','freeTestModeChk','freeTestHint','freeModelSel','freeModelInput','freeApiCheckBtn','freeApiCheckStatus','aiContextSel','provHint'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', checked: false, disabled: false, style: {}, textContent: '', options: [], classList: { toggle() {} }, appendChild(o) { this.options.push(o); } }]));
  const sb = { console, JSON, Math, Number, String, Object, Array, RegExp, Date, Set, Map, Promise,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
    document: { getElementById: id => elements[id] || null, createElement: () => ({}) },
    showStatToast: text => sb.notices.push(text), notices: [], elements, storage,
    calls: [], callLlmTask: async (...args) => { sb.calls.push(args); return { text: '{"ok":true}', modelUsed: 'fixture/model:free' }; }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(`var PROVIDER='gemini', API_KEY='', OPENROUTER_KEY='fake-or', OPENROUTER_MODEL='google/gemini-2.5-flash', OR_MODEL_BY_STORY={story:'google/gemini-3.6-flash'}, GEMINI_MODEL='gemini-3.5-flash', FREE_TEST_MODE=false, FREE_TEST_MODEL='openrouter/free', FREE_TEST_PREVIOUS_PROVIDER='gemini', AI_CONTEXT_MODE='balanced', NIM_URL='https://worker.invalid', NIM_MODEL='fixture/nim'; var STORY={id:'story'}, gameHistory=[], storySummary='', summaryIndex=0; const CONTEXT_RECENT=10, RECENT_CHARS_CAP=120000; function modelCtxTokens(){ return 1000000; }`, sb);
  vm.runInContext(['isFreeApiMode','isFreeOpenRouterModel','curORModel','aiSettingsBusy','applyAiPreferences','showFreeModelInput','selectedFreeModel','setFreeTestMode','checkFreeApiConnection','setProvider','saveSettings','closeSettings','persistCfg','recentWindowCount'].map(grab).join('\n'), sb);
  elements.freeModelSel.value='openrouter/free'; elements.aiContextSel.value='balanced';
  elements.orKeyInput.value='fake-or';
  return sb;
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
test('legacy preferences retain model and unknown configuration fields', () => {
  const sb = sandbox({ splitPipe:false, customSetting:'keep', apiKey:'fake-gemini' });
  sb.applyAiPreferences({}); sb.API_KEY='fake-gemini'; sb.persistCfg();
  const cfg = JSON.parse(sb.storage.get('vn_cfg'));
  assert.equal(cfg.customSetting,'keep'); assert.equal(cfg.splitPipe,false);
  assert.equal(cfg.apiKey,'fake-gemini'); assert.equal(cfg.geminiModel,'gemini-3.5-flash');
  assert.equal(sb.FREE_TEST_MODE,false);
});
test('free mode restore overrides provider without overwriting paid story models', () => {
  const sb=sandbox();
  sb.applyAiPreferences({provider:'gemini',freeTestMode:true,freeTestModel:'fixture/model:free',freePreviousProvider:'nim'});
  assert.equal(sb.PROVIDER,'openrouter'); assert.equal(sb.curORModel(),'fixture/model:free');
  assert.equal(sb.OR_MODEL_BY_STORY.story,'google/gemini-3.6-flash');
  sb.setProvider('gemini'); assert.equal(sb.PROVIDER,'openrouter');
  sb.setFreeTestMode(false); assert.equal(sb.PROVIDER,'nim');
});
test('enabling only the free switch does not erase a stored Gemini key', () => {
  const sb=sandbox({apiKey:'fake-saved-gemini',orModel:'google/gemini-2.5-pro',splitPipe:false});
  sb.setFreeTestMode(true);
  const cfg=JSON.parse(sb.storage.get('vn_cfg'));
  assert.equal(cfg.apiKey,'fake-saved-gemini'); assert.equal(cfg.orModel,'google/gemini-2.5-pro');
  assert.equal(cfg.freeTestMode,true); assert.equal(cfg.splitPipe,false);
});
test('saving free model preserves paid default and per-story override', () => {
  const sb=sandbox(); sb.setFreeTestMode(true);
  sb.elements.freeModelSel.value='custom'; sb.elements.freeModelInput.value='fixture/model:free';
  sb.elements.orModelSel.value=''; sb.elements.orOnlyStory.checked=false; sb.saveSettings();
  const cfg=JSON.parse(sb.storage.get('vn_cfg'));
  assert.equal(cfg.freeTestModel,'fixture/model:free');
  assert.equal(cfg.orModel,'google/gemini-2.5-flash');
  assert.equal(cfg.orModelBy.story,'google/gemini-3.6-flash');
});
test('paid model cannot be saved into the free profile', () => {
  const sb=sandbox(); sb.setFreeTestMode(true);
  sb.elements.freeModelSel.value='custom'; sb.elements.freeModelInput.value='google/gemini-2.5-pro';
  sb.saveSettings(); assert.equal(sb.FREE_TEST_MODEL,'openrouter/free');
  assert(sb.notices.some(x=>x.includes('무료 모델')));
});
test('connection settings cannot change while generation owns the turn', () => {
  const sb=sandbox(); sb._mainRequest={}; sb.setFreeTestMode(true); sb.setProvider('nim');
  assert.equal(sb.FREE_TEST_MODE,false); assert.equal(sb.PROVIDER,'gemini');
  assert.equal(sb.elements.freeTestModeChk.checked,false);
});
test('state extraction, summary and input preparation also lock provider preferences', () => {
  for (const field of ['_splitExtractPending','_summaryPending','_inputRequest','_backgroundRecovery']) {
    const sb=sandbox(); sb[field]={}; sb.setFreeTestMode(true);
    assert.equal(sb.FREE_TEST_MODE,false,field+' must lock settings');
  }
});
test('connection probe rejects paid model before any model request', async () => {
  const sb=sandbox(); sb.setFreeTestMode(true);
  sb.elements.freeModelSel.value='custom'; sb.elements.freeModelInput.value='google/gemini-2.5-pro';
  await sb.checkFreeApiConnection(); assert.equal(sb.calls.length,0);
});
test('connection probe makes one tiny free request and restores the lock', async () => {
  const sb=sandbox(); sb.setFreeTestMode(true); await sb.checkFreeApiConnection();
  assert.equal(sb.calls.length,1); assert.equal(sb.calls[0][2].task,'probe');
  assert.equal(sb.calls[0][2].maxTok,128); assert.equal(sb._freeApiProbe,null);
  assert(sb.elements.freeApiCheckStatus.textContent.includes('확인 완료'));
});
test('balanced history budget excludes only already summarized entries', () => {
  const sb=sandbox(); sb.gameHistory=Array.from({length:60},()=>({role:'assistant',content:'가'.repeat(3000)}));
  sb.storySummary='Earlier events are recorded.'; sb.summaryIndex=50;
  assert.equal(sb.recentWindowCount(),16);
  sb.AI_CONTEXT_MODE='full'; assert.equal(sb.recentWindowCount(),40);
});
test('pending/failed summary never drops unsummarized source history', () => {
  const sb=sandbox(); sb.gameHistory=Array.from({length:60},()=>({role:'user',content:'가'.repeat(3000)}));
  assert.equal(sb.recentWindowCount(),60);
  sb.storySummary='Only the first twenty entries are covered.'; sb.summaryIndex=20;
  assert.equal(sb.recentWindowCount(),40);
  sb.summaryIndex=-10; assert.equal(sb.recentWindowCount(),60);
});
test('small and empty histories keep their exact bounds', () => {
  const sb=sandbox(); assert.equal(sb.recentWindowCount(),0);
  sb.gameHistory=[{role:'user',content:'안녕'}]; assert.equal(sb.recentWindowCount(),1);
});
(async()=>{
  let failed=0;
  for(const [name,fn] of tests){ try{ await fn(); console.log('PASS '+name); } catch(e){ failed++; console.error('FAIL '+name+' — '+e.message); } }
  console.log(`${tests.length-failed}/${tests.length} settings/history tests passed`);
  process.exitCode=failed?1:0;
})();
