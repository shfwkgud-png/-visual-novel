'use strict';
/* Offline living-world integration & regression test.
   node tests-hogwarts-world.js
   Tests deterministic story choices, calendar, NPC memory and 433 canon beats. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(__dirname,'storypacks','hogwarts-au');
const clock=require(path.join(dir,'time.js'));
const world=require(path.join(dir,'world.js'));
const engine=require(path.join(dir,'canon-engine.js'));
const bridge=require(path.join(dir,'canon-bridge.js'));
const read=(p)=>JSON.parse(fs.readFileSync(path.join(dir,p),'utf8'));
const meta=read('canon-index.json'),cast=read('cast.json');
const bundle=bridge.compile(engine,meta,meta.books.map(b=>read(b.path)),cast);

assert.equal(bundle.ledger.events.length,433);
assert.equal(bundle.dates.b01c07s01,'1991-09-01');
assert.equal(bundle.dates.b01c10s01,'1991-10-31');
assert.equal(bundle.dates.b02c08s01,'1992-10-31');
assert.equal(bundle.dates.b04c32s01,'1995-06-24');
assert.equal(bundle.dates.b06c27s01,'1997-06-12');
assert.equal(bundle.dates.b06c29s01,'1997-06-13');
assert(bundle.dates.b06c29s01 > bundle.dates.b06c27s01);
assert.equal(bundle.dates[bundle.ledger.events.at(-1).id],'1998-05-02');
assert.equal(bridge.sync(bundle,null,'1991-09-01',[]).progress.committed,15);
const beforeTroll=bridge.sync(bundle,null,'1991-10-30',[]).state;
assert.match(bridge.context(bundle,beforeTroll),/친구 무리로 굳어지기 전/);
const afterTroll=bridge.sync(bundle,beforeTroll,'1991-10-31',[]).state;
assert.match(bridge.context(bundle,afterTroll),/세 사람의 우정이 형성됐다/);

let c=clock.createState(),s=world.createState();
assert.equal(clock.advance(c,'친구에게 말한다').advanced,false);
assert.equal(clock.advance(c,'▶ 다음 일정').advanced,false);
assert.equal(clock.chooseHouse(c,'🐍 슬리데린').ok,true);
assert.equal(clock.chooseHouse(c,'🦁 그리핀도르').ok,false);
assert.equal(world.nextEvent(s,c.date).id,'first_invitations');
let e=world.nextEvent(s,c.date),p=world.offer(s,e);
assert.equal(p.choices.length,4);
assert.equal(p.choices.filter(x=>x.includes('malfoy')).length,1);
assert.equal(world.resume(JSON.parse(JSON.stringify(s))).mode,'offer');
let shifted=clock.moveToScene(c,e.date,e.slot);
assert(shifted.advanced);
assert.equal(c.date,'1991-09-03');
assert.equal(clock.moveToScene(c,'1991-09-02',0).advanced,false);
assert.equal(clock.advance(c,'너와 더 오래 이야기하고 싶어').advanced,false);
assert.equal(c.date,'1991-09-03');
let scene=world.start(s,p.choices.find(x=>x.includes('hermione')));
assert.ok(['crabbe','goyle'].every(id=>scene.actors.includes(id)));
assert.equal(scene.id,'first_invitations');
assert.equal(world.resume(JSON.parse(JSON.stringify(s))).mode,'active');
assert(!world.finish(s).offscreen.includes('헤르미온느는 혼자'));
assert.equal(s.ties.hermione,3);
assert.equal(s.ties.malfoy,-1);
assert.equal(s.agency.first_circle,'hermione');
assert.equal(world.finish(s),null);
const winter=world.EVENTS.find(x=>x.id==='winter_choice');
assert(world.offer(s,winter).intro.includes('학기 초 모임에 오지'));
assert.equal(world.ending(s),null);
assert.equal(world.isNext('▶ 다음 장면 — 다음 사건·일상으로 진행'),true);
assert.equal(world.isFinish('▶ 장면 마치기 — 결과를 확정하고 이어가기'),true);
assert.equal(world.isNext('▶ 다음 장면을 자세히 설명한다'),false);
assert.equal(world.nextEvent(world.createState(),'1992-06-27').year,1,'summer routine remains in the first school year');
assert.equal(world.nextEvent(world.createState(),'1993-01-01').year,2,'winter routine remains in the second school year');
const freeTalk=world.createState();
world.offer(freeTalk,world.EVENTS.find(x=>x.id==='halloween_troll'));
world.startAmbient(freeTalk);
assert.equal(world.noteAction(freeTalk,'교수에게 트롤의 위치를 알린다'),true);
assert.match(world.context(freeTalk),/성공 확정 아님/);
world.finish(freeTalk);
assert.equal(freeTalk.decisions[0].choice,'freeform');
assert.deepEqual(freeTalk.decisions[0].actions,['교수에게 트롤의 위치를 알린다']);


// Earned, non-automatic alternate finale: clues from two distinct earlier events.
let alt=world.createState(),ac=clock.createState();
clock.chooseHouse(ac,'🦅 레번클로');
let eventCount=0;
while (eventCount++<30) {
  let ev=world.nextEvent(alt,ac.date);
  if(!ev||ev.year>1)break;
  const offer=world.offer(alt,ev);
  assert(offer);
  clock.moveToScene(ac,ev.date,ev.slot);
  let selected=offer.choices.find(x=>{
    if(ev.id==='first_quidditch')return x.includes('investigate');
    if(ev.id==='mirror_rumor')return x.includes('records');
    if(ev.id==='stone_finale')return x.includes('preempt');
    return x.includes('skip');
  });
  assert(selected,'Missing eligible choice: '+ev.id);
  assert(world.start(alt,selected),'Could not select '+ev.id);
  assert(world.finish(alt),'Could not finish '+ev.id);
}
assert(alt.decisions.some(x=>x.id==='stone_finale'&&x.choice==='preempt'));
const branch=bridge.sync(bundle,null,'1992-06-26',alt.decisions);
assert.equal(branch.state.statuses.b01c17s01,'altered');
assert.equal(branch.state.statuses.b01c17s02,'altered');
assert.equal(branch.state.world.stone_destroyed,true);
assert.equal(branch.progress.pending,0);

const unknown=world.createState();
const originalFinale=world.offer(unknown,world.EVENTS.find(x=>x.id==='stone_finale'));
assert(!originalFinale.choices.some(x=>x.includes('preempt')));
assert.equal(world.start(unknown,'▶ 선택 [stone_finale] preempt — unearned'),null);

// Run a complete 7-school-year episode flow entirely offline.
c=clock.createState();clock.chooseHouse(c,'🐍 슬리데린');s=world.createState();
let count=0,seen=new Set(),canonState=null,year1=0;
while(count++<130) {
  const ev=world.nextEvent(s,c.date);
  if(!ev)break;
  assert(!seen.has(ev.id),'Duplicate event '+ev.id);
  seen.add(ev.id);
  const move=clock.moveToScene(c,ev.date,ev.slot);
  assert.notEqual(move.reason,'clock-rewind');
  assert.notEqual(move.reason,'invalid-event-time');
  assert(clock.valid(c));
  const offered=world.offer(s,ev);
  assert(offered&&offered.choices.length>=3);
  const chosen=world.start(s,offered.choices.at(-1)); // do not participate
  assert(chosen);
  assert(world.finish(s));
  if(ev.year===1)year1++;
  const snap=JSON.parse(JSON.stringify({c,s}));
  assert(clock.valid(snap.c)&&world.valid(snap.s));
  // Background canon is committed after player decision; never witnessed offscreen.
  const res=bridge.sync(bundle,canonState,c.date,s.decisions);
  canonState=res.state;
  assert(!Object.keys(canonState.witnessed).length);
}
assert(year1>=11,'Missing year-one core events');
assert(seen.has('battle_of_hogwarts'));
assert.equal(c.date,'1998-05-02');
assert.equal(world.nextEvent(s,c.date),null);
assert.equal(bridge.sync(bundle,canonState,c.date,s.decisions).progress.committed,433);
assert.equal(engine.playerKnowledge(bundle.ledger,canonState).some(x=>x.fact.includes('퀴렐이 볼드모트의 숙주')),false);
assert.equal(world.ending(s).title,'호그와트 이후의 삶'); // skipped battle, fallback route

// Built-in story must remain SFW-only and include reachable endings.
const storyScript=fs.readFileSync(path.join(dir,'story.js'),'utf8');
const window={};
new Function('window',fs.readFileSync(path.join(dir,'art.js'),'utf8'))(window);
new Function('window',storyScript)(window);
const pack=window.PANDORA_HOGWARTS_STORY;
assert(pack);
assert.equal(pack.id,'hogwarts');
assert.equal(pack.maxSprites,2);
assert.equal(pack.endings.length,5);
for (const id of ['malfoy','crabbe','goyle']) {
  assert.equal(pack.characters[id].gender,'여성');
  assert.equal(cast.actors.find(actor=>actor.id===id).auGender,'female');
}
assert.match(pack.worldLore,/말포이는 경쟁 구도 속에서도 해리에게 사적인 호감/);
assert.match(pack.worldLore,/서로 신뢰와 마음을 확인해 나가면 연애로 이어질 수 있다/);
assert.match(pack.worldLore,/여성 말포이는 해리를 명성과 기숙사 경쟁의 맞수로 대하고, 론에게는 위즐리 가문의 형편과 가치관을 빌미로 비꼬며, 헤르미온느에게는 머글 태생이라는 혈통 편견/);
assert.match(pack.characters.ron.personality,/친구 곁에 서는 용기/);
assert(!('cgManifest' in pack));
const backgrounds=new Set(Object.values(pack.customBgs).map(entry=>entry.url));
const portraitBackgrounds=new Set(Object.values(pack.customBgs).map(entry=>entry.portraitUrl));
const portraits=new Set(Object.values(pack.characters).flatMap(card=>Object.values(card.emoImgs||{})));
assert.equal(backgrounds.size,92);
assert.equal(portraitBackgrounds.size,92);
assert.equal(portraits.size,234);
for (const [key, entry] of Object.entries(pack.customBgs)) {
  assert.equal(entry.portraitUrl, entry.url.replace(/\.webp$/, '_portrait.webp'), key);
}
for (const id of ['harry','ron','crabbe','goyle']) assert.equal(Object.keys(pack.characters[id].emoImgs).length,6);
for (const url of [...backgrounds,...portraitBackgrounds,...portraits]) {
  assert.match(url,/^sd_samples\/(backgrounds|characters)\/hogwarts\/[a-z0-9_/]+\.webp$/);
  const bytes=fs.readFileSync(path.join(__dirname,url));
  assert.equal(bytes.toString('ascii',8,12),'WEBP',url);
}
assert(!pack.characters.fred.emoImgs.angry);
assert.equal(Object.values(pack.characters).filter(card=>card.img).length,70);

const html=fs.readFileSync(path.join(__dirname,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/world.js?v=13'));
assert(html.includes('storypacks/hogwarts-au/canon-bridge.js?v=5'));
assert(html.includes('moveToScene(clock,upcoming.date,upcoming.slot)'));
assert(html.includes('gameState.hogwarts.world = PandoraHogwartsWorld.createState()'));
assert(html.includes('await syncHogwartsCanon()'));
assert(html.includes('World') && html.includes('7년의 여정을 돌아보고 결말'));
const start=html.indexOf('<script>'),end=html.lastIndexOf('</script>');
assert(start>=0&&end>start);
new Function(html.slice(start+8,end));
console.log(JSON.stringify({test:'hogwarts-living-world',result:'PASS',events:seen.size,
  firstYearEvents:year1,canonBeats:canonState.cursor,year7:c.date,
  alternateCanonBranch:branch.progress.altered,endingCount:pack.endings.length}));
