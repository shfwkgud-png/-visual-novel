'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const W=require('./storypacks/hogwarts-au/world.js');
const B=require('./storypacks/hogwarts-au/canon-bridge.js');
const E=require('./storypacks/hogwarts-au/canon-engine.js');
const read=p=>JSON.parse(fs.readFileSync('storypacks/hogwarts-au/'+p,'utf8'));
const index=read('canon-index.json');
const bundle=B.compile(E,index,index.books.map(x=>read(x.path)),read('cast.json'));
const offer=(st,id)=>W.offer(st,W.EVENTS.find(x=>x.id===id));
const captureScene='루핀은 결박된 페티그루의 지팡이를 회수했다. 도주를 막은 일행은 목격 증거와 함께 그를 마법부 경비대에 인계했다.';
function record(st,result,scene,turn=1,date='1994-06-15'){
  const canon=B.readSceneChanges(bundle,result.canon,scene);
  return W.recordOutcome(st,{...result,canon},scene,{turn,date,actors:['lupin','harry','hermione','malfoy']});
}
const worlds=[];
for(const input of ['button','typed']){
  const st=W.createState();
  st.agency={dementor:'study',chapter_b03c08:'inquire',chapter_b03c13:'engage'};
  const p=offer(st,'pettigrew_crossroads');
  const command=p.choices.find(x=>x.includes('] capture —'));
  W.startAmbient(st);
  if(input==='button')W.interrupt(st,command);
  else W.noteAction(st,command.split(' — ')[1]);
  assert(record(st,{event_id:'pettigrew_crossroads',summary:'페티그루를 구금하여 마법부에 인계했다.',
    evidence:captureScene,complete:true,choice:input==='button'?'capture':'freeform',ties:{lupin:2,harry:2},
    canon:input==='button'?[]:[{id:'b03c20s01',outcome:'prevented',summary:'페티그루가 구금되어 원작 탈출이 발생하지 않았다.',
      evidence:captureScene,effects:{pettigrew_captured:true}}]},captureScene));
  assert(W.finish(st));
  assert.equal(st.agency.pettigrew,'captured');
  const restored=JSON.parse(JSON.stringify(st));
  const state=B.sync(bundle,null,'1995-06-24',restored.decisions).state;
  assert.equal(state.statuses.b03c20s01,'prevented',input);
  assert.equal(state.statuses.b04c32s02,'altered',input);
  assert.equal(state.world.pettigrew_captured,true,input);
  assert.equal(state.world.graveyard_ritual_failed,true,input);
  assert.equal(st.ties.lupin,2,'one relation update');
  worlds.push(state.world);
}
assert.deepEqual(worlds[0],worlds[1],'same actual result must produce the same world');

// A changed plan must not award the original study date or its relationship bonus.
const changed=W.createState(),p=offer(changed,'first_invitations');
W.start(changed,p.choices.find(x=>x.includes('] hermione —')));
W.noteAction(changed,'약속을 취소하고 말포이의 초대를 택한다.');
assert.equal(W.finish(changed),null,'an unanswered attempt is not a confirmed result');
const switched='헤르미온느는 취소를 듣고 책을 덮었다. 말포이는 빈 의자를 내주며 모임에 온 당신을 맞았다.';
const result={event_id:'first_invitations',summary:'도서관 약속을 취소하고 말포이 모임에 참석했다.',
  evidence:switched,complete:true,choice:'malfoy',ties:{hermione:-1,malfoy:2},canon:[]};
assert(record(changed,result,switched,1,'1991-09-03'));
assert(record(changed,result,switched,1,'1991-09-03'),'duplicate receipt is harmless');
assert.deepEqual(changed.ties,{hermione:-1,malfoy:2});
assert(W.finish(changed));
assert.equal(changed.agency.first_circle,'malfoy');
assert(!W.finish(changed),'cannot finalize twice');

// Intent, invented evidence, wrong scene IDs and invalid state are rejected.
const attempted=W.createState();offer(attempted,'pettigrew_crossroads');W.startAmbient(attempted);
W.noteAction(attempted,'페티그루를 잡는다');
const failed='페티그루가 손을 뿌리쳤다. 루핀은 놓친 쥐가 어둠 속으로 사라지는 것을 지켜봤다.';
assert(!record(attempted,{...result,event_id:'pettigrew_crossroads',evidence:captureScene},failed));
assert.equal(attempted.active.needsResult,true);
assert(!record(attempted,{...result,event_id:'first_invitations',evidence:failed},failed));
assert.throws(()=>B.readSceneChanges(bundle,[{id:'made_up',outcome:'prevented',summary:failed,evidence:failed}],failed));
assert.throws(()=>B.readSceneChanges(bundle,[{id:'b03c20s01',outcome:'altered',summary:failed,evidence:failed,effects:{pettigrew_captured:'yes'}}],failed));
assert(record(attempted,{event_id:'pettigrew_crossroads',summary:'페티그루를 잡으려 했지만 도주를 막지 못했다.',
  evidence:failed,complete:true,choice:'freeform',ties:{},canon:[]},failed));
W.noteAction(attempted,'페티그루를 잡는다');
assert.equal(W.finish(attempted),null,'repeating an action still needs its own actual result');
assert(record(attempted,{event_id:'pettigrew_crossroads',summary:'다시 시도했지만 페티그루는 이미 도주했다.',
  evidence:failed,complete:true,choice:'freeform',ties:{},canon:[]},failed,2));
W.finish(attempted);
assert.equal(B.sync(bundle,null,'1995-06-24',attempted.decisions).state.statuses.b03c20s01,'canonical');

// An unscripted, non-menu intervention uses the same engine, not an added preset.
const free=W.createState();
const scene='교수들은 현장에서 확보한 증거로 트롤을 문밖에서 봉쇄했다. 누구도 여자 화장실에 갇히지 않았다.';
assert(record(free,{event_id:null,summary:'교수들이 트롤을 사전에 봉쇄했다.',evidence:scene,complete:false,
  choice:'freeform',ties:{},canon:[{id:'b01c10s01',outcome:'prevented',summary:'트롤이 봉쇄되어 원래의 화장실 습격이 불발됐다.',evidence:scene,effects:{}}]},scene,2,'1991-10-31'));
const custom=B.sync(bundle,null,'1991-11-01',free.decisions).state;
assert.equal(custom.statuses.b01c10s01,'prevented');
assert.equal(custom.statuses.b01c07s01,'canonical','unrelated past remains intact');
const changedNews=W.createState();
const news='교수들이 트롤을 대피 통로에서 막아 학생들이 안전하게 연회장에 남았다.';
assert(record(changedNews,{event_id:null,summary:news,evidence:news,complete:false,choice:'freeform',ties:{},
  canon:[{id:'b01c10s01',outcome:'altered',summary:news,evidence:news,effects:{trio_formed:false}}]},news,3,'1991-10-31'));
const newsState=B.sync(bundle,null,'1991-10-31',changedNews.decisions).state;
assert.equal(E.publicNews(bundle.ledger,newsState,150).find(x=>x.id==='b01c10s01').fact,news,
  'altered news must describe the actual scene, not its original canon sentence');
const original=B.sync(bundle,null,'1995-06-24',[]).state;
assert.throws(()=>B.readSceneChanges(bundle,[{id:'b03c20s01',outcome:'prevented',summary:captureScene,evidence:captureScene}],captureScene,original),'committed history requires a saved branch');
console.log('PASS Hogwarts actual scene outcomes: click/text parity, changed plans, failure, evidence, persistence and custom intervention');
