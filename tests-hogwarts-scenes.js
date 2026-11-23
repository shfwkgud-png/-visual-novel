'use strict';
// Scene continuity regression. No network/API/image generation required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname,dir=path.join(root,'storypacks/hogwarts-au');
const D=require(path.join(dir,'scene-director.js'));
const W=require(path.join(dir,'world.js'));
const T=require(path.join(dir,'time.js'));
// A pre-social save takes three different paths from the same September date.
{
  const clock={...T.createState(),date:'1991-09-23',slot:1,house:'그리핀도르',world:W.createState()};
  const save=JSON.stringify(clock),cards={padma:{name:'파드마 파틸'}};
  const resume=()=>JSON.parse(save);
  const next=(hp,fast)=>W.nextEvent(hp.world,hp.date,hp.slot,null,fast,hp.house);
  const say=(hp,user,text,turn)=>W.commitSocialTurn(hp,'library',{dialogue:[{char_id:'padma',text}]},user,turn,cards);
  const solo=resume(),visit=resume(),bond=resume();
  assert.equal(next(solo,true).id,'halloween_troll');
  const chance=next(visit,false);
  assert.match(chance.id,/^school_/);
  W.offer(visit.world,chance);
  assert.equal(W.resume(JSON.parse(JSON.stringify(visit.world))).title,chance.title);
  W.startAmbient(visit.world); W.finish(visit.world);
  visit.date=chance.date;
  assert.equal(next(visit,false).id,'halloween_troll','do not require a string of filler encounters');
  say(bond,'무슨 책이야?','목요일 오후 도서관에서 나랑 같이 볼래?',1);
  assert.equal(next(bond,true).id,'halloween_troll','an unaccepted invitation is not an appointment');
  const refusal=JSON.parse(JSON.stringify(bond));
  say(refusal,'못 가.','알겠어. 다음에 보자.',2);
  assert.equal(next(refusal,true).id,'halloween_troll');
  say(bond,'좋아, 같이 보자.','좋아. 참고서는 내가 가져올게.',2);
  const appt=next(bond,true);
  assert.equal(appt.date,'1991-09-26');assert.deepEqual(appt.actors,['padma']);
  assert.equal(next(bond,false).id,appt.id);
  const cancel=JSON.parse(JSON.stringify(bond));
  say(cancel,'목요일 약속은 취소해야겠어.','알겠어. 다음에 보자.',3);
  assert.equal(next(cancel,true).id,'halloween_troll');
  const returned=resume();
  say(returned,'목요일 도서관에서 책을 돌려줄게.','좋아, 거기서 보자.',1);
  say(returned,'책을 지금 돌려줄게.','고마워. 잘 받았어.',2);
  assert.equal(next(returned,true).id,'halloween_troll');
  W.offer(bond.world,appt);const loaded=JSON.parse(JSON.stringify(bond));
  assert.equal(W.resume(loaded.world).title,appt.title);
  assert.deepEqual(W.startAmbient(loaded.world).actors,['padma']);
  assert.equal(W.finish(loaded.world).id,appt.id);
  assert.equal(next(loaded,true).id,'halloween_troll');
  const library={...clock,date:appt.date,slot:appt.slot};
  const bystanders=W.nearby(library,'library',()=>true);
  assert(bystanders.some(id=>id!=='padma'));
  assert.deepEqual(W.nearby(JSON.parse(JSON.stringify(library)),'library',()=>true),bystanders);
  assert(!W.nearby(library,'hogwarts_courtyard',()=>true).some(id=>bystanders.includes(id)));
  assert.deepEqual(W.nearby({...library,slot:3},'library',()=>true),[]);
  assert.deepEqual(W.directAddress('파드마의 책이야.',cards),[]);
  assert.deepEqual(W.directAddress('파드마, 그 책은 어때?',cards),['padma']);
  assert.equal(W.travelDestination('(안뜰에서 도서관으로 간다.)'),'library');
  assert.equal(W.travelDestination('마법약 교실로 들어간다.'),'potions');
  assert.equal(W.travelDestination('내일 도서관에 가서 만나자.'),null);
  assert.equal(JSON.stringify(clock),save);
}
const HOUSE=['그리핀도르','슬리데린','레번클로','후플푸프'];
const byHouse={
  그리핀도르:{speaker:'뚱보 여인',key:'gryffindor_common_room'},
  슬리데린:{speaker:'슬리데린 반장',key:'slytherin_common_room'},
  레번클로:{speaker:'독수리 문고리',key:'ravenclaw_common_room'},
  후플푸프:{speaker:'후플푸프 반장',key:'hufflepuff_common_room'}
};
let tests=0;
const savedAction={speaker:'퍼시 위즐리',char_id:'percy',text:D.HOUSES['그리핀도르'].arrival.answer};
assert.equal(D.normalizeDialogue({...savedAction}).speaker,'나레이터');
assert.equal(D.normalizeDialogue({...savedAction,isPlayer:true}).speaker,'퍼시 위즐리');

const meetingCast = ['crabbe','goyle'];
for (const ambient of [false,true]) {
  for (const choice of ['malfoy','hermione','alone']) {
    const state=W.createState();
    const event=W.EVENTS.find(e=>e.id==='first_invitations');
    W.offer(state,event);
    if(ambient) W.startAmbient(state);
    const input={eventId:event.id,optionId:choice};
    const opened=ambient?W.interrupt(state,input):W.start(state,input);
    const expected=choice==='malfoy'?meetingCast:[];
    assert.deepEqual(opened.openingCast || [],expected);
    assert.deepEqual(W.openingCastForInput({role:'user',content:opened.instruction}) || [],expected);
  }
}
assert.equal(W.openingCastForInput({role:'user',content:'다른 곳에서 크래브와 고일 이야기를 들었다.'}),undefined);
for(const [surname,id] of [['크래브','crabbe'],['고일','goyle']]) {
  assert.equal(D.normalizeDialogue({speaker:surname,char_id:null,text:'여기야.'}).char_id,id);
  assert.deepEqual(D.mentionedCompanions(surname+'에게 인사한다.'),[id]);
}
const interrupted=D.createState();D.startArrival(interrupted,'그리핀도르','윤서');
D.take(interrupted);interrupted.paused=true;
const pausedSave=JSON.parse(JSON.stringify(interrupted));
assert(D.interrupt(pausedSave));
assert.equal(D.hasPending(pausedSave),false);
assert.equal(pausedSave.arrivalCompleted,false);
assert.equal(pausedSave.visited.arrival_speech,undefined);
assert.equal(pausedSave.interrupted.length,5);
assert.match(D.describe(pausedSave),/이미 일어난 일로 간주하지 않는다/);
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
  assert.equal(beats[4].dialogue.at(-1).speaker,'나레이터','entrance actions are narration');
  assert.equal(beats[4].dialogue.at(-1).char_id,null);
  assert.equal(beats[5].background,byHouse[house].key);
  assert.equal(state.arrivalCompleted,true);
  assert.equal(D.hasPending(state),false);
  assert.equal(state.phase,'idle');
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
  const news=D.createState();news.arrivalCompleted=true;news.lastLocation='library';
  const publicEvent={id:'notice_'+house,title:'학기 소식',background:'corridor',date:'1991-10-31',year:1};
  D.stageEvent(news,{date:'1991-09-01',slot:1},publicEvent,house,{agency:{}});
  assert.equal(D.injectNews(news,[{id:'secret',access:'gm',fact:'never leak'},
    {id:'public',access:'public',fact:'학교에서 공개된 발표가 있었다.'}]),1);
  assert(D.take(news).beat.narration.includes('공개된 발표'));
  tests+=20;
}
// Branch aftermath is a contextual continuation, not the same boilerplate
// regardless of who the user chose to spend the evening with.
for(const branch of ['malfoy','hermione','alone']){
  const beat=D.outcomeBeat({id:'first_invitations',offscreen:'다른 모임이 진행됐다.'},
    {finished:{first_invitations:{choice:branch}}});
  assert(beat && beat.narration && beat.narration.length>25);
  if(branch!=='alone')assert(beat.dialogue.length===1);
  tests++;
}
const factQueue=D.createState();
assert(D.stageCanonResults(factQueue,[
  {id:'canon_b01c10s01',narration:'교내에 트롤이 나타나 혼란이 일어났다.'},
  {id:'canon_b01c10s02',narration:'학생들은 각각 위험에 대응했다.'}
]));
assert.equal(D.take(factQueue).beat.id,'canon_b01c10s01');
assert.equal(D.take(factQueue).beat.id,'canon_b01c10s02');
assert.equal(factQueue.phase,'idle');
assert(!D.hasPending(factQueue));
tests+=5;
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
const reported='맥고나걸은 전달받은 위치를 확인한 뒤 교수들과 함께 복도를 봉쇄했다.';
assert(W.recordOutcome(st,{event_id:'halloween_troll',summary:reported,evidence:reported,
  complete:true,choice:'teachers',ties:{}},reported,{date:troll.date,turn:1}));
assert.equal(W.finish(st).id,'halloween_troll');
assert.equal(st.finished.halloween_troll.choice,'teachers');
tests+=8;
// A personal invitation remains an actual choice, not an automatic obligation.
st=W.createState();
const invite=W.EVENTS.find(x=>x.id==='first_invitations');
const personal=W.offer(st,invite);
assert.equal(W.startAmbient(st).id,'first_invitations');
assert.equal(st.active.choice,'observe');
assert.equal(st.agency.first_circle,undefined);
assert(W.interrupt(st,personal.choices.find(x=>x.includes('hermione'))));
const studied='헤르미온느와 함께 자료를 찾아 과제를 완성했다. 그녀는 도움에 감사를 표했다.';
assert(W.recordOutcome(st,{event_id:invite.id,summary:studied,evidence:studied,
  complete:true,choice:'hermione',ties:{hermione:3}},studied,{date:invite.date,turn:1,actors:['hermione']}));
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
assert(html.includes('storypacks/hogwarts-au/scene-director.js?v=9'));
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
