'use strict';
// Regression for earned 3rd/6th-year branches and causal continuity through year 7.
// Offline, no API, asset or provider credentials required.
// node tests-hogwarts-branches.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'storypacks','hogwarts-au');
const requireLocal=f=>require(path.join(base,f));
const read=f=>JSON.parse(fs.readFileSync(path.join(base,f),'utf8'));
const W=requireLocal('world.js'),B=requireLocal('canon-bridge.js');
const E=requireLocal('canon-engine.js'),C=requireLocal('chapter-director.js');
const index=read('canon-index.json'),cast=read('cast.json'),books=index.books.map(b=>read(b.path));
const bundle=B.compile(E,index,books,cast);
const catalog=C.compile(read('chapter-playbook.json'),bundle);
W.installChapterCatalog(catalog,C);
const options=(eventId,state)=>W.offer(state,W.EVENTS.find(e=>e.id===eventId)).choices;
function earned(eventId,agency,ties,optionId){
  const st=W.createState();st.agency={...agency};st.ties={...ties};
  const choices=options(eventId,st);
  const chosen=choices.find(x=>x.includes('] '+optionId+' — '));
  assert(chosen,'eligible option not shown: '+eventId+'/'+optionId);
  assert(W.startAmbient(st));
  const action=W.interrupt(st,chosen);
  assert.equal(action.choice,optionId);
  assert(W.finish(st));
  return st.decisions.slice();
}
function notEarned(eventId,agency,optionId){
  const st=W.createState();st.agency={...agency};
  assert(!options(eventId,st).some(x=>x.includes('] '+optionId+' — ')));
  assert(W.startAmbient(st));
  assert.equal(W.interrupt(st,'▶ 선택 ['+eventId+'] '+optionId+' — forged'),null);
}
function runBranch(decisions,date,changed,flags){
  const state=B.sync(bundle,null,date,decisions).state;
  for(const [id,status] of Object.entries(changed))
    assert.equal(state.statuses[id],status,id+' wrong causal outcome');
  for(const [k,v] of Object.entries(flags))
    assert.equal(state.world[k],v,'world flag '+k);
  const before=state.journal.length;
  assert.deepEqual(B.sync(bundle,state,date,decisions).state.journal.length,before,'duplicate commit');
  const chapterState=C.createState();
  C.sync(catalog,chapterState,date,state,W.createState());
  assert(C.valid(JSON.parse(JSON.stringify(chapterState))));
  assert.equal(chapterState.chapterStatus.b07c01?.status,
    date>='1997-07-01'?'private_offscreen':undefined);
  return state;
}
notEarned('pettigrew_crossroads',{dementor:'study'},'capture');
const p=earned('pettigrew_crossroads',{
  dementor:'study',chapter_b03c08:'inquire',chapter_b03c13:'engage'
},{},'capture');
assert.equal(p[0].choice,'capture');
let pstate=runBranch(p,'1995-06-24',{
  b03c20s01:'prevented',b04c32s02:'altered'
},{pettigrew_captured:true,graveyard_ritual_failed:true,voldemort_stage:'disembodied'});
assert.notEqual(pstate.statuses.b04c33s01,'canonical','Death Eater original summons cannot return by default');

notEarned('prince_tower',{prince:'investigate',chapter_b06c12:'inquire'},'seal_cabinet');
const sealed=earned('prince_tower',{
  prince:'investigate',chapter_b06c12:'inquire',chapter_b06c18:'inquire'
},{},'seal_cabinet');
assert.equal(catalog.causalEdges.length,55);
let sstate=runBranch(sealed,'1998-05-02',{
  b06c27s01:'prevented',b06c27s03:'prevented'
},{cabinet_entry_blocked:true,albus_survived_tower:true});
assert.equal(sstate.statuses.b07c01s01,'canonical','unrelated book 7 enemy meeting should still occur');
assert.equal(sstate.statuses.b06c29s01,'pending','no lament if Dumbledore survived');
assert.equal(sstate.statuses.b06c30s01,'pending','no funeral if Dumbledore survived');
assert(C.blockedByHistory(catalog.byId.b06c29,sstate));
assert(C.blockedByHistory(catalog.byId.b06c30,sstate));
const alternateWorld=W.createState();
alternateWorld.agency.tower='sealed_cabinet';
alternateWorld.finished.prince_tower={choice:'seal_cabinet',date:'1997-06-12'};
const altEvent=W.nextEvent(alternateWorld,'1997-06-12',3,sstate);
assert.equal(altEvent.id,'tower_survival_morning');
const altOffer=W.offer(alternateWorld,altEvent);
assert(W.start(alternateWorld,altOffer.choices[0]));
assert(W.finish(alternateWorld));
const later=W.nextEvent(alternateWorld,'1997-06-13',1,sstate);
assert(!['b06c29','b06c30','tower_survival_morning'].includes(later?.id),
  'the original funeral must not return as a fallback scene');

notEarned('prince_tower',{prince:'approached',chapter_b06c12:'engage'},'guard_wand');
const guarded=earned('prince_tower',{
  prince:'approached',chapter_b06c12:'engage'
},{malfoy:5},'guard_wand');
let gstate=runBranch(guarded,'1998-05-02',{
  b06c27s02:'prevented',b07c23s04:'prevented'
},{draco_disarm_prevented:true,elder_wand_allegiance:'albus'});
assert.notEqual(gstate.statuses.b07c36s04,'canonical',
  'final victory cannot use Harry inheriting the wand when Draco never owned it');

let original=B.sync(bundle,null,'1998-05-02',[]).state;
assert.equal(E.progress(bundle.ledger,original).canonical,433);
assert.equal(original.world.voldemort_alive,false);
const yearEnd=W.createState();
yearEnd.finished.battle_of_hogwarts={choice:'defend'};yearEnd.agency.finale='defend';
assert.equal(W.ending(yearEnd,original).title,'호그와트의 수호자');
yearEnd.agency.pettigrew='captured';
assert.equal(W.ending(yearEnd,pstate).title,'바뀐 세계의 다음 장');
assert(!W.ending(yearEnd,pstate).narration.includes('전쟁이 끝났다'));
assert.equal(W.ending(yearEnd,original).title,'바뀐 세계의 다음 장',
  'alternative history cannot be erased by a disconnected downstream fact');

// Chronicle remains confidential, even after the world changes.
for(const state of [pstate,sstate,gstate]){
  const privateMeeting=catalog.byId.b07c01;
  assert.equal(C.unsafeBeat(privateMeeting,privateMeeting.beats[0].id,state,true),null);
  assert.equal(C.outcomeSequence(catalog,'b07c01',
      {finished:{b07c01:{choice:'observe'}}},state).length,0);
}
console.log(JSON.stringify({
  test:'hogwarts-causal-branches',result:'PASS',chapters:catalog.summary.chapters,
  normalCanon:E.progress(bundle.ledger,original).canonical,
  pettigrew:pstate.statuses.b03c20s01,cabinet:sstate.statuses.b06c27s01,
  wand:gstate.statuses.b06c27s02,allDecisions:[p[0].choice,sealed[0].choice,guarded[0].choice]
}));
