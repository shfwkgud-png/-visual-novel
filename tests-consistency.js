// Grounded state receipts and repeat-event regressions. No network or API keys.
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const C = require('./pandora-consistency.js');
const tests = [];
const T = (name, fn) => tests.push([name, fn]);
const clone = value => JSON.parse(JSON.stringify(value));
const base = () => ({ gold: 10, location: '접수대', time: '1일차 오후', chronicle: [], player: { injuries: [], note: '' } });
const paper = (changes = {}) => ({ kind: 'purchase', item: '포장지', counterparty: '민서', delta: -3,
  evidence: '다온은 민서에게 3G를 지불하고 포장지를 받았다.', action_evidence: '', repeat_of: '', ...changes });
const scene = evidence => ({ narration: evidence, dialogue: [] });
const ctx = (state, userText = '포장지를 산다.', history = [], turn = 1) => C.createContext({ state, userText, history, turn, storyId: 'library' });
function check(context, receipt = paper(), extra = {}) {
  return C.reviewTurn(context, scene(receipt.evidence), { state_update: { gold: receipt.delta }, transactions: [receipt], ...extra });
}
function commit(state, context, receipt = paper()) {
  const review = check(context, receipt);
  assert.equal(review.ok, true, JSON.stringify(review.issues));
  state.gold += receipt.delta;
  C.commit(state, review);
  return review;
}
function purchased() {
  const state = base();
  commit(state, ctx(state));
  return state;
}
const hasIssue = (review, code) => review.issues.some(i => i.code === code);

T('first purchase requires quoted completed transfer and commits one application-owned receipt', () => {
  const state = base(), context = ctx(state), review = check(context);
  assert.equal(review.ok, true);
  assert.equal(state.gold, 10, 'review must not change game state');
  assert.equal(state.settledEvents, undefined);
  state.gold -= 3;
  assert.equal(C.commit(state, review), true);
  assert.equal(state.gold, 7, 'commit must not apply the delta a second time');
  assert.equal(state.settledEvents.receipts[0].id, 'e1-1');
});

T('actual v368 failure: movement repeats settled purchase and cannot commit 7 -> 4', () => {
  const state = purchased(), before = clone(state);
  const context = ctx(state, '접수대를 떠나 지하 서고로 내려가 준호 옆에 앉는다. 새로운 거래는 없다.', [], 2);
  const data = { state_update: { gold: -3, location: '지하 서고' }, transactions: [paper()] };
  const review = C.reviewTurn(context, scene(paper().evidence + ' 다온은 지하 서고로 내려갔다.'), data);
  assert.equal(review.ok, false);
  assert.ok(hasIssue(review, 'repeated_settled_event'));
  assert.ok(hasIssue(review, 'spending_against_action'));
  assert.throws(() => C.commit(state, review), /Unreviewed/);
  assert.deepEqual(state, before);
  assert.equal(data.state_update.gold, -3, 'do not silently rewrite invalid model output to success');
});

T('same earlier purchase with no repeated ID still gets detected', () => {
  const state = purchased();
  const result = check(ctx(state, '준호에게 인사한다.', [], 2));
  assert.ok(hasIssue(result, 'repeated_settled_event'));
});

T('changing purchase label to payment cannot mint a new event', () => {
  const state = purchased();
  const result = check(ctx(state, '서고에 도착한다.', [], 2), paper({ kind: 'payment' }));
  assert.ok(hasIssue(result, 'repeated_settled_event'));
});

T('same amount for another item is a legitimate different purchase', () => {
  const state = purchased();
  const receipt = paper({ item: '공책', evidence: '다온은 민서에게 3G를 지불하고 공책을 받았다.' });
  assert.equal(check(ctx(state, '공책을 구매한다.', [], 2), receipt).ok, true);
});

T('same item and amount from another counterparty is not blocked by amount alone', () => {
  const state = purchased();
  const receipt = paper({ counterparty: '준호', evidence: '다온은 준호에게 3G를 지불하고 포장지를 받았다.' });
  assert.equal(check(ctx(state, '준호에게 포장지를 구매한다.', [], 2), receipt).ok, true);
});

T('explicit real second purchase is allowed and gets a distinct event ID', () => {
  const state = purchased(), input = '포장지를 한 장 더 산다.';
  const receipt = paper({ action_evidence: input, repeat_of: state.settledEvents.receipts[0].id });
  const review = commit(state, ctx(state, input, [], 2), receipt);
  assert.equal(state.gold, 4);
  assert.equal(review.receipts[0].id, 'e2-2');
  assert.equal(state.settledEvents.receipts.length, 2);
});

const unrealActions = [
  ['구매했던 일을 회상한다.', '구매'],
  ['포장지를 한 장 더 산다고 상상한다.', '포장지를 한 장 더 산다'],
  ['포장지를 한 장 더 산다고 생각만 한다.', '한 장 더 산다'],
  ['만약 포장지를 한 장 더 산다면 어떨까?', '한 장 더'],
  ['포장지를 구매할까?', '구매'],
  ['포장지는 사지 않는다.', '사지 않는다'],
  ['민서에게 돈을 건네줄까?', '돈을 건네'],
  ['포장지를 구매한다는 말만 한다.', '포장지를 구매한다'],
  ['포장지를 구매한다는 농담을 한다.', '포장지를 구매한다'],
  ['포장지를 구매한다는 말을 취소한다.', '포장지를 구매한다'],
  ['I imagine I buy another paper.', 'buy another paper'],
  ['What if I buy another paper?', 'buy another paper'],
];
for (const [input, quote] of unrealActions) T('recall/hypothesis/negation cannot authorize another purchase: ' + input, () => {
  const state = purchased();
  const result = check(ctx(state, input, [], 2), paper({ action_evidence: quote }));
  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'repeated_settled_event'));
});

T('past recollection and separate explicit new action can coexist', () => {
  const state = purchased(), input = '아까 구매했던 일을 회상한다. 그리고 포장지를 한 장 더 산다.';
  assert.equal(check(ctx(state, input, [], 2), paper({ action_evidence: '포장지를 한 장 더 산다.' })).ok, true);
});

T('model cannot fabricate current input authorization', () => {
  const state = purchased();
  const result = check(ctx(state, '서고로 내려간다.', [], 2), paper({ action_evidence: '포장지를 한 장 더 산다.' }));
  assert.ok(hasIssue(result, 'unquoted_action_evidence'));
  assert.ok(hasIssue(result, 'repeated_settled_event'));
});

T('initial spontaneous NPC reward does not require a player money instruction', () => {
  const state = base();
  const receipt = paper({ kind: 'reward', item: '장부 회수 사례금', delta: 10,
    evidence: '민서는 다온에게 사례금으로 10닢을 건넸다.' });
  assert.equal(check(ctx(state, '민서에게 장부를 돌려준다.'), receipt).ok, true);
});

T('distinct additional spontaneous reward from NPC is permitted', () => {
  const state = base();
  const receipt = paper({ kind: 'reward', item: '사례금', delta: 10, evidence: '민서는 다온에게 사례금 10닢을 건넸다.' });
  commit(state, ctx(state, '민서에게 장부를 돌려준다.'), receipt);
  const additional = { ...receipt, evidence: '민서는 이번에는 정리를 도와준 별도 보상으로 추가 10닢을 건넸다.' };
  const result = check(ctx(state, '민서를 도와 책들을 정리한다.', [], 2), additional);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

T('same NPC reward re-enacted without a new occurrence remains pending', () => {
  const state = base();
  const receipt = paper({ kind: 'reward', item: '사례금', delta: 10, evidence: '민서는 다온에게 사례금 10닢을 건넸다.' });
  commit(state, ctx(state), receipt);
  const result = check(ctx(state, '서고로 내려간다.', [], 2), receipt);
  assert.ok(hasIssue(result, 'repeated_settled_event'));
});

T('different reward reason is not confused with an earlier equal amount', () => {
  const state = base();
  const receipt = paper({ kind: 'reward', item: '장부 회수 사례금', delta: 10, evidence: '민서는 다온에게 사례금 10닢을 건넸다.' });
  commit(state, ctx(state), receipt);
  const next = { ...receipt, item: '청소 사례금', evidence: '민서는 다온에게 청소 사례금 10닢을 건넸다.' };
  assert.equal(check(ctx(state, '청소를 마친다.', [], 2), next).ok, true);
});

T('evidence must quote this scene, not an invented or earlier-only sentence', () => {
  const state = base();
  const result = C.reviewTurn(ctx(state), scene('민서는 다온에게 인사했다.'), { state_update: { gold: -3 }, transactions: [paper()] });
  assert.ok(hasIssue(result, 'unquoted_scene_evidence'));
});

T('cherry-picking a transfer inside a recollection cannot ground a new delta', () => {
  const state = base(), receipt = paper({ evidence: '민서에게 3G를 지불' });
  const result = C.reviewTurn(ctx(state), scene('다온은 민서에게 3G를 지불했던 일을 회상했다.'), { state_update: { gold: -3 }, transactions: [receipt] });
  assert.ok(hasIssue(result, 'uncompleted_transaction'));
});

T('price quotation is not completed transfer evidence', () => {
  const receipt = paper({ evidence: '포장지의 가격은 3G다.' });
  assert.ok(hasIssue(check(ctx(base()), receipt), 'uncompleted_transaction'));
});

T('conditional completed-looking quote is not an actual transfer', () => {
  const receipt = paper({ evidence: '다온은 민서에게 3G를 지불했다' });
  const result = C.reviewTurn(ctx(base()), scene('다온은 민서에게 3G를 지불했다면 포장지를 받았을 것이다.'), { state_update: { gold: -3 }, transactions: [receipt] });
  assert.ok(hasIssue(result, 'uncompleted_transaction'));
});

T('a number for quantity or room number cannot verify monetary delta', () => {
  const receipt = paper({ evidence: '다온은 민서에게 포장지 3장을 받아 3층으로 갔다.' });
  assert.ok(hasIssue(check(ctx(base()), receipt), 'unverified_amount'));
});

T('quoted 9G cannot substantiate an invented 3G delta', () => {
  const receipt = paper({ evidence: '다온은 민서에게 9G를 지불하고 포장지를 받았다.' });
  assert.ok(hasIssue(check(ctx(base()), receipt), 'unverified_amount'));
});

T('native Korean monetary amount is accepted without inventing a correction', () => {
  const receipt = paper({ evidence: '다온은 민서에게 세 닢을 건넸다.' });
  assert.equal(check(ctx(base()), receipt).ok, true);
});

T('currency before a native numeral and counter is a monetary amount', () => {
  const receipt = paper({ kind: 'reward', item: '사례금', delta: 10,
    evidence: '민서가 다온에게 사례금으로 동전 열 개를 내민다.' });
  assert.equal(check(ctx(base(), '민서에게 장부를 돌려준다.'), receipt).ok, true);
});

T('a financial change with no receipts is not considered success', () => {
  const result = C.reviewTurn(ctx(base()), scene(paper().evidence), { state_update: { gold: -3 } });
  assert.ok(hasIssue(result, 'missing_transaction_evidence'));
});

T('a non-money state update does not require fabricated transactions', () => {
  const result = C.reviewTurn(ctx(base(), '서고로 내려간다.'), scene('다온은 서고에 도착했다.'), { state_update: { location: '서고' }, transactions: [] });
  assert.equal(result.ok, true);
  const state = base();
  assert.equal(C.commit(state, result), false);
  assert.equal(state.settledEvents, undefined);
});

T('net zero with an actual purchase and reward still records both transactions', () => {
  const state = base(), spend = paper();
  const gift = paper({ kind: 'gift', item: '격려금', delta: 3, evidence: '민서는 다온에게 격려금 3G를 건넸다.' });
  const result = C.reviewTurn(ctx(state), scene(spend.evidence + ' ' + gift.evidence), { state_update: { gold: 0 }, transactions: [spend, gift] });
  assert.equal(result.ok, true);
  C.commit(state, result);
  assert.equal(state.gold, 10);
  assert.equal(state.settledEvents.receipts.length, 2);
});

T('receipts must balance the exact proposed delta', () => {
  assert.ok(hasIssue(check(ctx(base()), paper(), { state_update: { gold: -9 } }), 'transaction_total_mismatch'));
});

T('same piece of evidence cannot be counted twice within a turn', () => {
  const result = C.reviewTurn(ctx(base()), scene(paper().evidence), { state_update: { gold: -6 }, transactions: [paper(), paper()] });
  assert.ok(hasIssue(result, 'duplicate_in_turn'));
});

T('separate actual equal-price purchases within a turn are allowed', () => {
  const one = paper(), two = paper({ evidence: '그 뒤 다온은 민서에게 추가 포장지 대금 3G를 지불했다.' });
  const result = C.reviewTurn(ctx(base(), '포장지 두 장을 산다.'), scene(one.evidence + ' ' + two.evidence), { state_update: { gold: -6 }, transactions: [one, two] });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

T('invented previous event ID is rejected even when the action is new', () => {
  const state = purchased(), input = '포장지를 한 장 더 산다.';
  const result = check(ctx(state, input, [], 2), paper({ repeat_of: 'model-invented-id', action_evidence: input }));
  assert.ok(hasIssue(result, 'invalid_previous_event'));
});

T('legacy save: a committed exact delta plus matching prose detects the repeated purchase', () => {
  const state = base(); state.gold = 7;
  const old = { narration: paper().evidence, dialogue: [], state_update: { gold: -3 }, chronicle: ['민서에게 포장지 3G 구매 완료'] };
  const history = [{ role: 'assistant', content: JSON.stringify(old) }];
  const context = ctx(state, '서고로 내려간다.', history, 2);
  assert.equal(state.settledEvents, undefined, 'reading an old save must not manufacture a ledger');
  assert.ok(hasIssue(check(context), 'repeated_settled_event'));
});

T('legacy save: another equal-sized delta without matching item/party is not a duplicate', () => {
  const state = base(); state.gold = 7;
  const old = { narration: '준호에게 물값 3G를 지불했다.', state_update: { gold: -3 }, chronicle: ['준호에게 생수 3G 구매'] };
  const context = ctx(state, '민서에게 포장지를 구매한다.', [{ role: 'assistant', content: JSON.stringify(old) }], 2);
  assert.equal(check(context).ok, true);
});

T('legacy save: prose without a completed numeric delta cannot invent a past receipt', () => {
  const state = base();
  const history = [{ role: 'assistant', content: JSON.stringify({ narration: paper().evidence }) }];
  assert.equal(check(ctx(state, '포장지를 구매한다.', history, 2)).ok, true);
});

T('legacy save: failed or pending state extraction is never an authoritative earlier transaction', () => {
  const state = base();
  for (const status of ['pending', 'failed', 'needs_review']) {
    const old = { narration: paper().evidence, state_update: { gold: -3 } };
    const history = [{ role: 'assistant', content: JSON.stringify(old), _stateExtract: { status } }];
    assert.equal(check(ctx(state, '포장지를 구매한다.', history, 2)).ok, true);
  }
});

T('normal save serialization preserves settled IDs and duplicate guard', () => {
  const saved = clone(purchased());
  assert.ok(hasIssue(check(ctx(saved, '서고에 간다.', [], 2)), 'repeated_settled_event'));
});

T('context snapshots do not change when original state/history/input object is mutated', () => {
  const state = purchased(), context = ctx(state, '서고에 간다.', [], 2);
  state.settledEvents.receipts.length = 0;
  state.chronicle.push('새로운 일');
  assert.ok(hasIssue(check(context), 'repeated_settled_event'));
  assert.deepEqual(context.facts, []);
});

T('another committed turn invalidates an earlier review instead of overwriting its journal', () => {
  const state = base(), context = ctx(state), first = check(context), second = check(context);
  C.commit(state, first);
  const after = clone(state);
  assert.throws(() => C.commit(state, second), /changed|already/);
  assert.deepEqual(state, after);
});

T('malformed versioned ledger is not silently discarded to permit a new charge', () => {
  const state = base(); state.settledEvents = { version: 999, receipts: [] };
  const result = check(ctx(state));
  assert.ok(hasIssue(result, 'invalid_saved_ledger'));
  assert.equal(state.settledEvents.version, 999);
});

T('model-provided ID cannot replace the application-generated ID', () => {
  const receipt = { ...paper(), id: 'forged' };
  const result = check(ctx(base()), receipt);
  assert.equal(result.receipts[0].id, 'e1-1');
});

T('committed reminders are bounded while original history evidence can remain complete', () => {
  const state = base();
  const longEvidence = '다온은 민서에게 3G를 지불하고 포장지를 받았다. ' + '창밖에서 바람이 분다. '.repeat(45);
  const receipt = paper({ evidence: longEvidence }), review = check(ctx(state), receipt);
  assert.equal(review.ok, true);
  C.commit(state, review);
  assert.equal(state.settledEvents.receipts[0].evidence.length, 200);
  assert.equal(review.receipts[0].evidence, longEvidence.trim(), 'journal compaction must not alter reviewed source evidence');
  assert.ok(hasIssue(check(ctx(state, '서고로 간다.', [], 2)), 'repeated_settled_event'));
});

T('malformed persisted context yields a recoverable review instead of throwing', () => {
  const context = { version: 1, turn: 1 };
  const result = C.reviewTurn(context, scene('서고에 도착했다.'), { state_update: {} });
  assert.ok(hasIssue(result, 'invalid_turn'));
  assert.equal(C.contextPrompt(context), '');
});

T('an 80-turn sequence keeps exact balances, bounded storage and unique monotonic receipts', () => {
  const state = base(); state.gold = 1000;
  for (let turn = 1; turn <= 80; turn++) {
    const input = '포장지를 한 장 더 산다.';
    commit(state, ctx(state, input, [], turn), paper({ action_evidence: input }));
    assert.equal(state.gold, 1000 - turn * 3);
  }
  assert.equal(state.settledEvents.next, 81);
  assert.equal(state.settledEvents.receipts.length, C.MAX_EVENTS);
  assert.equal(new Set(state.settledEvents.receipts.map(r => r.id)).size, C.MAX_EVENTS);
  assert.ok(hasIssue(check(ctx(state, '서고에 간다.', [], 81)), 'repeated_settled_event'));
});

T('exact long-scene repetition is a diagnosis rather than deletion of player-visible prose', () => {
  const prior = '민서가 책장을 정리하는 동안 다온은 접수대의 작은 종을 바라보았다. '.repeat(12);
  const context = ctx(base(), '다음 방으로 간다.', [{ role: 'assistant', content: JSON.stringify(scene(prior)) }]);
  const data = scene(prior), before = clone(data);
  const result = C.reviewTurn(context, data, { state_update: {} });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(i => i.code === 'repeated_scene'));
  assert.deepEqual(data, before);
});

T('browser export installs the same API without DOM or network access', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('./pandora-consistency.js'), 'utf8'), { window });
  assert.equal(window.PandoraConsistency.VERSION, C.VERSION);
  assert.equal(typeof window.PandoraConsistency.reviewTurn, 'function');
});

T('model contract uses a parseable example and one valid kind, not a pipe-separated enum value', () => {
  const contract = C.responseContract(), sample = JSON.parse(contract.slice(contract.indexOf('{'), contract.indexOf('}') + 1));
  assert.equal(sample.kind, 'purchase');
  assert.equal(typeof sample.delta, 'number');
  assert.ok(!sample.kind.includes('|'));
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} consistency regressions passed`);
if (failed) process.exitCode = 1;
