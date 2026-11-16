'use strict';
/* Offline Node verification. No model API call; no copyrighted novel text. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./canon-engine');
const root = __dirname;
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const meta = read('canon-index.json'), cast = read('cast.json');
const books = meta.books.map(x => read(x.path));
const canon = engine.compile(meta, books, cast);
const count = { books: books.length, chapters:books.reduce((n,b) => n + b.chapters.length,0),
  beats:canon.events.length, cast:cast.actors.length };

assert.deepEqual({books:count.books,chapters:count.chapters,beats:count.beats},
  {books:7,chapters:198,beats:433});
assert(cast.actors.some(a => a.id === 'malfoy' && a.auGender === 'female'));
assert(canon.events.every(x => /^b\d{2}c\d{2}s\d{2}$/.test(x.id)));
assert(canon.events.every(x => typeof x.chapterSource === 'string' && x.chapterSource.startsWith('https://')));

const first = engine.createState();
assert.deepEqual(engine.playerKnowledge(canon, first), []);
assert.equal(first.cursor, 0, 'chat turns must not advance narrative world time');
engine.advanceTo(canon, first, 'b01c07s02');
assert.equal(first.world.houses_assigned, true);
assert.equal(first.cursor > 0, true);
assert.equal(first.playerPlace, null, 'player cannot teleport to off-screen canonical events');
assert(engine.publicNews(canon, first).some(r => r.id.startsWith('b01c07')));
assert(!engine.playerKnowledge(canon, first).some(r => r.fact.includes('퀴렐이 볼드모트의 숙주')));

const all = engine.createState();
engine.advanceTo(canon, all, canon.events[canon.events.length - 1].id);
assert.equal(all.cursor, 433);
assert.equal(all.world.horcrux_diary_destroyed, true);
assert.equal(all.world.horcrux_ring_destroyed, true);
assert.equal(all.world.horcrux_locket_destroyed, true);
assert.equal(all.world.horcrux_cup_destroyed, true);
assert.equal(all.world.horcrux_diadem_destroyed, true);
assert.equal(all.world.horcrux_nagini_destroyed, true);
assert.equal(all.world.horcrux_harry_destroyed, true);
assert.equal(all.world.voldemort_alive, false);
assert.equal(all.world.wizard_war_stage, 'ended');
assert.equal(all.world.elder_wand_allegiance, 'harry');
assert.equal(engine.progress(canon, all).pending, 0);
assert.equal(engine.progress(canon, all).canonical, 433);
assert(!engine.playerKnowledge(canon, all, {limit:150}).some(x => x.source === 'GM 미래 기록'));

const s = engine.createState();
engine.advanceTo(canon, s, 'b02c13s02');
assert(!engine.playerKnowledge(canon, s, {limit:150}).some(x => x.id === 'b02c13s02'),
  'secret diary identity must not leak to player without discovery');
engine.observe(canon, s, 'b02c13s02', '플레이어가 실제 일기장 내부의 비밀과 영혼 분할을 직접 증명함');
assert(engine.playerKnowledge(canon, s, {limit:150}).some(x => x.id === 'b02c13s02'));

const free = engine.createState();
engine.intervene(canon, free, 'b03c20s01', {
  outcome: 'prevented', reason: '플레이어의 직접 개입으로 피터의 탈출을 막고 구금함',
  evidence: 'combat_ledger_captured_pettigrew'
});
engine.advanceTo(canon, free, 'b04c32s02');
assert.equal(free.statuses.b03c20s01, 'prevented');
assert.equal(free.statuses.b04c32s02, 'pending',
  'Wormtail absent must prevent automatic original resurrection');
assert.equal(free.world.voldemort_stage, 'disembodied');
assert(free.pending.b04c32s02);
assert.throws(() => engine.intervene(canon, free, 'b03c20s01',
  {outcome:'prevented',reason:'retroactive rewrite',evidence:'test_rewind'}), /rewind/);
engine.resolvePending(canon, free, 'b04c32s02', {
  outcome:'altered',reason:'대체 충복이 등장했으나 부활 의식은 미완료로 끝남',
  evidence:'alternate_graveyard_result',effects:{graveyard_ritual_failed:true}
});
assert.equal(free.statuses.b04c32s02, 'altered');
assert.equal(free.world.graveyard_ritual_failed, true);
assert.equal(free.world.voldemort_stage, 'disembodied');

const tower = engine.createState();
engine.intervene(canon, tower, 'b06c27s02', {
  outcome:'prevented',reason:'플레이어가 탑의 무장해제 사건에 직접 개입함',
  evidence:'combat_log_draco_disarm_prevented'
});
engine.advanceTo(canon, tower, 'b07c23s04');
assert.equal(tower.statuses.b06c27s03, 'pending');
assert.equal(tower.statuses.b07c23s04, 'pending');
assert.equal(tower.world.elder_wand_allegiance, 'albus',
  'wand ownership cannot automatically jump to Harry after broken Draco prerequisite');

const snapshot = engine.save(all);
const restored = engine.restore(canon, snapshot);
assert.equal(restored.cursor, all.cursor);
assert.deepEqual(restored.world, all.world);
assert.throws(() => engine.observe(canon, engine.createState(), 'b07c33s01', 'future peek'), /unoccurred/);
assert.throws(() => engine.intervene(canon, engine.createState(), 'b03c20s01',
  {outcome:'prevented',reason:'no evidence',evidence:''}), /evidence/);

// Verify that original school history is kept separate from explicit adult-age AU.
assert.match(meta.AU.schoolEntry, /18세/);
assert.match(meta.AU.triWizard, /5학년/);
assert(meta.invariants.some(s => s.includes('강제 이동')));
assert(meta.causalEdges.some(e => e.from === 'b06c27s02' && e.to === 'b07c23s04'));

console.log(JSON.stringify({test:'hogwarts-canon-ledger',result:'PASS',
  ...count,causalEdges:meta.causalEdges.length,hiddenSecrets:meta.secrets.length,
  checks:['198 chapters / 433 beats', 'cast keys and adult AU', 'time-driven offscreen events',
    'all canon outcomes', 'spoiler-safe knowledge', 'Pettigrew alternate consequence',
    'Elder Wand loyalty branch', 'persistence and invalid intervention guards']},null,2));
