'use strict';
// Scene continuity regression. No network/API/image generation required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname,dir=path.join(root,'storypacks/hogwarts-au');
const D=require(path.join(dir,'scene-director.js'));
const W=require(path.join(dir,'world.js'));
const T=require(path.join(dir,'time.js'));
const HOUSE=['그리핀도르','슬리데린','레번클로','후플푸프'];
const byHouse={
  그리핀도르:{speaker:'뚱보 여인',key:'gryffindor_common_room'},
  슬리데린:{speaker:'슬리데린 반장',key:'slytherin_common_room'},
  레번클로:{speaker:'독수리 문고리',key:'ravenclaw_common_room'},
  후플푸프:{speaker:'후플푸프 반장',key:'hufflepuff_common_room'}
};
let tests=0;
for(const house of HOUSE){
  const state=D.createState();
  assert.equal(D.startArrival(state,house,'윤서'),true);
  assert.equal(D.startArrival(state,house,'윤서'),false);
  let beats=[];
  while(D.hasPending(state)){
    const next=D.take(state);
    assert.equal(next.mode,'beat');
    beats.push(next.beat);
  }
  assert.equal(beats.length,6);
  assert.deepEqual(beats.map(x=>x.id),[
    'arrival_sorting_reaction','arrival_speech','arrival_feast','arrival_prefect',
    'arrival_entrance','arrival_common_room']);
  assert.equal(beats[0].background,'great_hall');
  assert.equal(beats[1].dialogue[0].char_id,'albus');
  assert.match(beats[1].dialogue[0].text,/환영/);
  assert.equal(beats[3].slot,3);
  assert(beats[4].dialogue.some(x=>x.speaker===byHouse[house].speaker));
  assert.equal(beats[5].background,byHouse[house].key);
  assert.equal(state.arrivalCompleted,true);
  assert.equal(D.hasPending(state),false);
  assert.equal(D.startArrival(state,house,'윤서'),false);
  assert.equal(D.resolveBackground('common_room',house),byHouse[house].key);
  assert.equal(D.resolveBackground('dormitory',house),byHouse[house].key.replace('_common_room','_dormitory'));
  assert(D.parseManualTravel('기숙사로 돌아간다',house));
  assert.equal(D.parseManualTravel('말포이가 기숙사에 갔어?',house),null);
  const comeback=D.createState();
  comeback.arrivalCompleted=true;
  comeback.lastLocation='library';
  assert.equal(D.startRoomReturn(comeback,house),true);
  const saved=JSON.parse(JSON.stringify(comeback));
  assert(D.valid(saved));
  let returnBeats=[];
  while(D.hasPending(saved))returnBeats.push(D.take(saved).beat);
  assert.equal(returnBeats.length,3);
  assert.equal(returnBeats[0].background,'corridor');
  assert(returnBeats[1].dialogue.some(x=>x.speaker===byHouse[house].speaker));
  assert.equal(returnBeats[2].background,byHouse[house].key);
  assert.equal(saved.lastLocation,byHouse[house].key);
  assert.equal(D.startRoomReturn(saved,house),false);
  tests+=17;
}
// A live public incident occurs without an explicit "make this happen" choice.
let st=W.createState();
const troll=W.EVENTS.find(x=>x.id==='halloween_troll');
const offer=W.offer(st,troll);
assert.equal(offer.choices.length,4);
const scene=W.startAmbient(st);
assert.equal(scene.id,'halloween_troll');
assert.equal(st.active.choice,'observe');
const options=W.activeChoices(st);
assert(options.length>=2);
assert(options.some(s=>s.includes('rescue')));
const action=W.interrupt(st,options.find(x=>x.includes('teachers')));
assert.equal(action.choice,'teachers');
assert.equal(W.interrupt(st,options[0]),null);
assert.equal(W.finish(st).id,'halloween_troll');
assert.equal(st.finished.halloween_troll.choice,'teachers');
tests+=8;
// A personal invitation remains an actual choice, not an automatic obligation.
st=W.createState();
const invite=W.EVENTS.find(x=>x.id==='first_invitations');
const personal=W.offer(st,invite);
assert.equal(W.startAmbient(st),null);
assert.equal(st.active,null);
assert.equal(st.pending.id,'first_invitations');
assert(W.start(st,personal.choices.find(x=>x.includes('hermione'))));
assert(W.finish(st));
assert.equal(st.ties.hermione,3);
tests+=5;
// Across all seven books, each scheduled event receives a physical arrival
// before its actual choice or automatic incident; no plot is skipped on staging.
const yrs=new Set(W.EVENTS.map(x=>x.year));assert.equal(yrs.size,7);
const bgs=new Set();
for(const event of W.EVENTS){
  const state=D.createState();state.arrivalCompleted=true;state.lastLocation='library';
  const old={date:'1991-09-01',slot:2};
  assert.equal(D.stageEvent(state,old,event,'그리핀도르',{agency:{}}),true,event.id);
  assert(D.hasPending(state));
  const restored=JSON.parse(JSON.stringify(state));
  assert(D.valid(restored));
  const sequence=[];
  while(D.hasPending(restored))sequence.push(D.take(restored));
  assert(sequence.some(x=>x.mode==='beat'),event.id);
  assert.equal(sequence.at(-1).mode,'event',event.id);
  assert.equal(sequence.at(-1).eventId,event.id);
  assert.equal(D.hasPending(restored),false);
  for(const x of sequence.filter(x=>x.mode==='beat'))bgs.add(x.beat.background);
  tests+=7;
}
st=D.createState();st.lastLocation='library';
const dorm={id:'room_murmurs',title:'기숙사 이야기',background:'common_room',
  date:'1993-03-03',year:2};
D.stageEvent(st,{date:'1993-03-01',slot:1},dorm,'레번클로',{agency:{}});
let scenes=[];
while(D.hasPending(st))scenes.push(D.take(st));
assert(scenes.some(x=>x.mode==='beat'&&x.beat.background==='ravenclaw_common_room'));
tests++;
// The time engine alone moves the time; automatic beats must not require any
// LLM clock update or force a day-change during a single conversation.
const clock=T.createState();
T.chooseHouse(clock,'그리핀도르');
assert.equal(T.advance(clock,'말을 건다').advanced,false);
assert.equal(clock.date,'1991-09-01');
const steps=D.arrival('그리핀도르','윤서');
for(const beat of steps)if(beat.slot===3)T.moveToScene(clock,clock.date,beat.slot);
assert.equal(clock.date,'1991-09-01');
assert.equal(clock.slot,3);
tests+=3;
// All patches are guarded under STORY.id === hogwarts.
const html=fs.readFileSync(path.join(root,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/scene-director.js?v=2'));
assert(html.includes('PandoraHogwartsScenes.startArrival('));
assert(html.includes('runHogwartsAutomaticScene()'));
assert(html.includes('PandoraHogwartsScenes.startRoomReturn('));
assert(html.includes('PandoraHogwartsScenes.resolveBackground('));
assert(html.includes("STORY.id==='hogwarts'"));
new Function(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
tests+=7;
console.log(JSON.stringify({test:'hogwarts-scenes',result:'PASS',assertions:tests,
  houseVariants:HOUSE.length,scheduledEvents:W.EVENTS.length,yearCount:yrs.size,
  transitionBackgrounds:bgs.size}));
