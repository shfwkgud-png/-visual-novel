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
const study='헤르미온느와 함께 과제를 마치고 도서관을 나왔다. 말포이는 모임에 오지 않은 당신에게 불만을 표시했다.';
assert(world.recordOutcome(s,{event_id:'first_invitations',summary:study,evidence:study,complete:true,
  choice:'hermione',ties:{hermione:3,malfoy:-1}},study,{date:c.date,turn:1,actors:['hermione','malfoy']}));
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
assert.equal(world.finish(freeTalk),null,'intent alone must wait for a scene result');
const reported='교수는 트롤이 있는 복도의 위치를 전달받고 다른 교직원에게 대응을 요청했다.';
assert(world.recordOutcome(freeTalk,{event_id:'halloween_troll',summary:reported,evidence:reported,
  complete:true,choice:'freeform',ties:{}},reported,{date:'1991-10-31',turn:1}));
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
  if(!selected.includes('] skip')){
    const confirmed={
      first_quidditch:'빗자루에 걸린 방해 마법을 조사해 이상 징후를 기록으로 남겼다.',
      mirror_rumor:'도서관 기록에서 돌을 노리는 자의 접근 경로를 찾아 증거를 확보했다.',
      stone_finale:'교수들은 두 자료를 대조한 뒤 퀴렐을 조사하고 마법사의 돌을 경비했다.'
    }[ev.id];
    assert(world.recordOutcome(alt,{event_id:ev.id,summary:confirmed,evidence:confirmed,complete:true,
      choice:world.parseChoice(selected).optionId,ties:{}},confirmed,{date:ev.date,turn:eventCount}));
  }
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
assert.equal(portraits.size,258);
const outfits=new Set(Object.values(pack.characters).flatMap(card=>Object.values(card.outfits||{}).flatMap(Object.values)));
const eventCGs=new Set(Object.values(pack.eventCGs).map(entry=>entry.url));
assert.equal(outfits.size,41);
assert.equal(eventCGs.size,82);
for(const entry of Object.values(pack.eventCGs)) assert.equal(typeof entry.setting,'string');
const danceStudents='alicia angelina cho crabbe daphne fleur ginny goyle hannah hermione katie lavender luna malfoy marietta millicent padma pansy parvati penelope romilda susan'.split(' ');
assert.equal(Object.keys(pack.eventCGs).filter(key=>key.endsWith('/dance')).length,danceStudents.length);
for(const id of danceStudents){
  assert.equal(pack.eventCGs[id+'/dance'].outfit,'yule',id);
  assert.equal(pack.eventCGs[id+'/dance'].portrait,pack.characters[id].img,id);
}
assert(pack.eventCGs['hermione/dance']&&pack.eventCGs['ron/flying']);
const ron=pack.characters.ron;
assert(Object.values(ron.emoImgs).every(url=>url.endsWith('_v6.webp')));
assert.equal(pack.eventCGs['ron/flying'].portrait,ron.img);
assert.equal(pack.eventCGs['ron/flying'].url,'sd_samples/cg/hogwarts/ron/flying_v2.webp');
assert.equal(pack.eventCGs['george/flying'].portrait,pack.characters.george.img);
assert.equal(pack.eventCGs['hermione/together'].portrait,pack.characters.hermione.img);
const harry=pack.characters.harry;
assert.equal(pack.eventCGs['harry/flying'].portrait,harry.img);
assert.equal(pack.eventCGs['harry/flying'].url,'sd_samples/cg/hogwarts/harry/flying_v1.webp');
assert.equal(pack.eventCGs['harry/flying'].outfit,'quidditch');
for(const id of ['romilda','alecto']){
  const card=pack.characters[id];
  assert.equal(card.img,card.emoImgs.normal);
  assert.notEqual(card.emoImgs.smile,card.img,id);
  assert.equal(pack.eventCGs[id+'/together'].portrait,card.img,id);
  assert.equal(pack.eventCGs[id+'/together'].outfit,'default',id);
}
for (const [key, entry] of Object.entries(pack.customBgs)) {
  assert.equal(entry.portraitUrl, entry.url.replace(/\.webp$/, '_portrait.webp'), key);
}
for (const id of ['harry','ron','hermione','crabbe','goyle']) assert.equal(Object.keys(pack.characters[id].emoImgs).length,6);
for (const url of [...backgrounds,...portraitBackgrounds,...portraits,...outfits,...eventCGs]) {
  assert.match(url,/^sd_samples\/(backgrounds|characters|cg)\/hogwarts\/[a-z0-9_/]+\.webp$/);
  const bytes=fs.readFileSync(path.join(__dirname,url));
  assert.equal(bytes.toString('ascii',8,12),'WEBP',url);
}
assert(!pack.characters.fred.emoImgs.angry);
assert.equal(Object.values(pack.characters).filter(card=>card.img).length,82);
const generated=JSON.parse(fs.readFileSync(path.join(__dirname,'docs/hogwarts-occasions-assets.json'),'utf8'));
assert.equal(generated.assets.length,176);
assert.equal(new Set(generated.assets.map(a=>a.target)).size,176);
const activeGenerated=new Set(generated.assets.filter(a=>a.active).map(a=>a.target));
assert.equal(activeGenerated.size,168);
for(const [id,version,count] of [['harry','v5',6],['percy','v2',3],['snape','v3',6]]){
  const card=pack.characters[id];
  assert.equal(card.img,`sd_samples/characters/hogwarts/${id}/2d/1_neutral_${version}.webp`);
  assert.equal(new Set(Object.values(card.emoImgs)).size,count,id);
  for(const sprite of Object.values(card.emoImgs)) assert(activeGenerated.has(sprite),sprite);
}
for(const asset of generated.assets){
  const bytes=fs.readFileSync(path.join(__dirname,asset.target));
  assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.key);
  assert.equal(bytes.toString('ascii',12,16),'VP8L',asset.key+' expected lossless WebP');
  assert.equal(bytes[20],0x2f,asset.key);
  const dimensions=bytes.readUInt32LE(21);
  const width=(dimensions&0x3fff)+1,height=((dimensions>>>14)&0x3fff)+1;
  assert.equal(width,asset.width,asset.key);assert.equal(height,asset.height,asset.key);
  assert(height>width,asset.key+' must stay portrait');
}

const html=fs.readFileSync(path.join(__dirname,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/world.js?v=15'));
assert(html.includes('storypacks/hogwarts-au/canon-bridge.js?v=7'));
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
