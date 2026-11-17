'use strict';
// Full source-grounded Hogwarts chapter playback regression.
// node tests-hogwarts-chapters.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname,dir=path.join(root,'storypacks/hogwarts-au');
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const chapters=require(path.join(dir,'chapter-director.js'));
const world=require(path.join(dir,'world.js'));
const clock=require(path.join(dir,'time.js'));
const canon=require(path.join(dir,'canon-engine.js'));
const bridge=require(path.join(dir,'canon-bridge.js'));
const index=read('canon-index.json'),cast=read('cast.json');
const books=index.books.map(b=>read(b.path));
const bundle=bridge.compile(canon,index,books,cast);
const playbook=read('chapter-playbook.json');
const catalog=chapters.compile(playbook,bundle);
const curated=catalog.chapters.filter(x=>x.interactive);
assert.equal(curated.length,52);
assert.equal(new Set(curated.map(x=>x.sceneCue)).size,52);
assert(curated.every(x=>x.arrival.includes(x.sceneCue) && x.sceneCue.length>25));
assert(curated.every(x=>x.participation.options.every(p=>p.label.length>=12 &&
  !p.label.startsWith(x.title+' — '))));
assert.equal(catalog.summary.chapters,198);
assert.equal(catalog.summary.beats,433);
assert.equal(catalog.summary.interactive+catalog.summary.paired+catalog.summary.offscreen,198);
assert.equal(catalog.causalEdges.length,48);
assert.equal(new Set(catalog.chapters.map(x=>x.id)).size,198);
assert.equal(new Set(catalog.chapters.map(x=>x.arrival)).size,198);
assert.equal(catalog.chapters.reduce((n,c)=>n+c.beats.length,0),433);
for(const c of catalog.chapters) {
  assert.equal(c.beats[0].id.slice(0,6),c.id);
  assert(c.date>='1991-01-01'&&c.date<='1998-06-30');
  assert(c.actors.length>0);
  assert(c.arrival.includes(c.title));
  for(const b of c.beats){
    assert.equal(bundle.ledger.byId[b.id].fact,b.fact);
    assert.equal(bundle.ledger.byId[b.id].access,b.access);
  }
  if(c.interactive){
    assert(['public','local'].includes(c.access),c.id);
    assert(c.participation.options.length>=2);
    assert(c.background&&c.background.length>3);
  } else {
    assert(c.pairedEvent||c.exposure==='private_location'||c.exposure==='offcampus'||
      c.exposure==='gm_offscreen'||c.access==='private'||c.access==='gm',c.id);
  }
}
assert(!catalog.upcoming.some(c=>['private','gm'].includes(c.access)));
assert(!catalog.upcoming.some(c=>c.pairedEvent));
// Never teleport the first-year student back onto the train after sorting.
assert(!catalog.upcoming.some(c=>c.id==='b01c06'));
// A paired chapter is still source-linked, not a second duplicate encounter.
assert(catalog.byMajor.halloween_troll.includes('b01c10'));
assert(catalog.byMajor.battle_of_hogwarts.includes('b07c31'));
assert(chapters.decorateMajor(catalog,'prince_tower').includes('벼락 맞은 탑'));
const hidden=catalog.byId.b07c01; // enemy meeting, inaccessible GM content
assert.equal(hidden.access,'gm');
assert.equal(hidden.interactive,false);
assert.equal(chapters.unsafeBeat(hidden,hidden.beats[0].id,canon.createState(),true),null);

world.installChapterCatalog(catalog,chapters);
let date=clock.createState(),state=world.createState(),observed=[];
clock.chooseHouse(date,'그리핀도르');
let canState=null;
for(let i=0;i<200;i++){
  const ev=world.nextEvent(state,date.date,date.slot);
  if(!ev)break;
  assert(!observed.includes(ev.id),'duplicate encounter '+ev.id);
  assert(ev.date>=date.date,'calendar rewind before '+ev.id);
  const next=clock.moveToScene(date,ev.date,ev.slot);
  assert(!['clock-rewind','invalid-event-time'].includes(next.reason),ev.id+' '+next.reason);
  const scene=world.offer(state,ev);
  assert(scene && scene.choices.length>=3,'offering '+ev.id);
  const offered=world.shouldStartAmbient(state)?world.startAmbient(state):
    world.start(state,scene.choices.at(-1));
  assert(offered,'starting '+ev.id);
  assert(world.finish(state),'finishing '+ev.id);
  canState=bridge.sync(bundle,canState,date.date,state.decisions).state;
  observed.push(ev.id);
}
const separate=observed.filter(id=>/^b\d{2}c\d{2}$/.test(id));
assert.equal(separate.length,catalog.summary.interactive);
assert(observed.includes('battle_of_hogwarts'));
assert(observed.indexOf('b07c30')<observed.indexOf('battle_of_hogwarts'),
  'teacher expulsion must precede the final battle on May 2');
assert.equal(date.date,'1998-05-02');
assert.equal(bridge.sync(bundle,canState,date.date,state.decisions).progress.committed,433);
let chaptersState=chapters.createState();
const sync=chapters.sync(catalog,chaptersState,date.date,canState,state);
assert.equal(sync.totalRecorded,198);
assert(chapters.valid(JSON.parse(JSON.stringify(chaptersState))));
assert.equal(chaptersState.chapterStatus.b07c01.status,'private_offscreen');
assert.equal(chaptersState.chapterStatus.b07c31.status,'participated');
assert(!chapters.currentContext(catalog,chaptersState,state,canState).includes('볼드모트가 루시우스의 지팡이를 빼앗고'),
  'private enemy meeting leaked into player context');

// A fresh scene can be saved while active, then reopened without losing
// the original ID/choice and without inventing an encounter.
const live=world.createState(),next=chapters.eventFor(catalog.byId.b03c07,live);
assert.equal(next.id,'b03c07');
assert.equal(next.autoStart,true);
assert(world.offer(live,next));
const active=world.startAmbient(live);
assert.equal(active.id,'b03c07');
world.noteAction(live,'네빌에게 지금 무엇이 두려운지 묻는다');
const restored=JSON.parse(JSON.stringify(live));
assert.equal(world.resume(restored).mode,'active');
assert.equal(world.finish(restored).id,'b03c07');
assert.equal(restored.finished.b03c07.choice,'freeform');
assert.equal(restored.finished.b03c07.actions.length,1);
assert.equal(world.finish(restored),null);

// Source facts remain hidden unless visible under access, direct presence and
// completed canon status; no local/private/GM discovery by clicking "next".
const sc=canon.createState();
const publicId='b01c10s01';
sc.statuses[publicId]='canonical';
const pub=catalog.byId.b01c10;
assert(chapters.unsafeBeat(pub,publicId,sc,false));
const local=catalog.byId.b02c07; // local-access bloodline incident
sc.statuses[local.beats[0].id]='canonical';
assert.equal(chapters.unsafeBeat(local,local.beats[0].id,sc,false),null);
assert(chapters.unsafeBeat(local,local.beats[0].id,sc,true));
const privateBeat=catalog.byId.b06c27.beats[0];
sc.statuses[privateBeat.id]='canonical';
assert.equal(chapters.unsafeBeat(catalog.byId.b06c27,privateBeat.id,sc,true),null);
const halloweenWorld=world.createState();
halloweenWorld.finished.halloween_troll={choice:'teachers',date:'1991-10-31'};
const halloweenCanon=bridge.sync(bundle,null,'1991-10-31',[]).state;
const revealed=chapters.outcomeSequence(catalog,'halloween_troll',halloweenWorld,halloweenCanon);
assert(revealed.some(x=>x.beatId==='b01c10s01'));
assert(revealed.every(x=>x.access==='public'||x.access==='local'));
const blockedWorld=world.createState();
blockedWorld.finished.b07c01={choice:'observe',date:'1997-09-01'};
assert.deepEqual(chapters.outcomeSequence(catalog,'b07c01',blockedWorld,halloweenCanon),[]);
const pending=canon.createState();pending.statuses[local.beats[0].id]='pending';
assert.match(chapters.unsafeBeat(local,local.beats[0].id,pending,true).narration,/원래 결말은 확정되지 않았다/);

// The existing earned alternate ending still changes the actual 433-beat history.
const altered=bridge.sync(bundle,null,'1992-06-26',[{id:'stone_finale',choice:'preempt'}]);
assert.equal(altered.state.statuses.b01c17s01,'altered');
assert.equal(altered.state.statuses.b01c17s02,'altered');
assert(!chapters.ending(catalog,'b06c27',restored,altered.state));
const html=fs.readFileSync(path.join(root,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/chapter-director.js?v=4'));
assert(html.includes('storypacks/hogwarts-au/world.js?v=11'));
assert(html.includes('PandoraHogwartsWorld.installChapterCatalog'));
assert(html.includes('PandoraHogwartsChapters.currentContext'));
assert(html.includes('PandoraHogwartsChapters.ending('));
assert(html.includes('hw.nextEvent(world,clock.date,clock.slot)'));
new Function(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
console.log(JSON.stringify({test:'hogwarts-all-chapters',result:'PASS',
  chapters:catalog.summary.chapters,beats:catalog.summary.beats,causalEdges:48,
  interactive:catalog.summary.interactive,linked:catalog.summary.paired,
  offscreen:catalog.summary.offscreen,playableEncounters:observed.length,
  sevenYearCompletion:date.date}));
