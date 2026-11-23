'use strict';
/* node tests-hogwarts-time.js
 * Regression: saved dates follow roleplay and explicit travel with no clock rewind.
 * No model API, network request, or asset dependency. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const t = require('./storypacks/hogwarts-au/time.js');

const state = t.createState();
assert.equal(state.date, '1991-09-01');
assert.equal(t.studyYear(state.date), 1);
assert.match(t.display(state), /1991년 9월 1일 저녁.*1학년/);
assert.equal(t.advance(state, '내일 만나자. 다음 주 일정은?').advanced, false);
assert.equal(t.advance(state, '▶ 다음 일정').advanced, false); // sorting first
assert.equal(t.chooseHouse(state,'🎩 분류모자에게 맡긴다','tester','지식 탐구').house,'레번클로');
assert.equal(t.chooseHouse(state,'🐍 슬리데린').ok,false); // irreversible
assert.equal(t.advance(state,'▶ 다음 일정 — 수업·식사').advanced,true);
assert.equal(state.slot,3);
assert.equal(t.advance(state,'▶ 다음 일정').advanced,true);
assert.equal(state.date,'1991-09-02');
assert.equal(state.slot,0);
assert.equal(t.advance(state,'▶ 다음 학기').advanced,true);
assert.equal(state.date,'1991-12-01');
assert.equal(t.advance(state,'▶ 다음 학기').advanced,true);
assert.equal(state.date,'1992-03-01');
assert.equal(t.advance(state,'▶ 다음 학기').advanced,true);
assert.equal(state.date,'1992-06-01');
assert.equal(t.advance(state,'▶ 다음 학기').advanced,true);
assert.equal(state.date,'1992-09-01');
assert.equal(t.studyYear(state.date),2);
assert.equal(t.advance(state,'안녕, 오늘 날씨 어때?').advanced,false);
assert.equal(state.date,'1992-09-01');

let jumps = 0;
while (state.date < '1998-06-29' && jumps < 1000) {
  const res = t.advance(state, '▶ 다음 주');
  if (!res.advanced) break;
  jumps++;
}
assert.equal(t.studyYear(state.date),7);
assert(state.date <= t.END);
assert(jumps > 250 && jumps < 400);
const saved = JSON.stringify(state);
const restored = JSON.parse(saved);
assert(t.valid(restored));
assert.equal(t.display(restored),t.display(state));
assert.equal(t.advance(restored,'▶ 다음 학년').advanced,false);
assert.match(t.context(restored),/장면에서 흐른 만큼만/);
const within=t.createState();
t.chooseHouse(within,'🦁 그리핀도르');
assert.equal(t.moveToScene(within,'1991-09-03',2).advanced,true);
assert.equal(within.date,'1991-09-03');
assert.equal(t.moveToScene(within,'1991-09-02',2).advanced,false);
assert.equal(t.moveToScene(within,'1991-09-03',1).advanced,false);
const slept='기숙사 침대에서 잠든 뒤 다음 날 아침에 눈을 떴다.';
const passage=(days,evidence=slept,extra={})=>({days,evidence,scene:evidence,...extra});
const afterClass={...within,date:'1991-09-04',slot:1};
const dismissal='플리트윅이 교재를 덮고 다음 수업에 보자고 인사했다.';
const goodbye='다음 수업에 뵙죠!';
for(const narration of [dismissal,'교수는 이튿날 아침에 만나기로 했다고 전했다.',
  '플리트윅이 “다음 날 아침이 밝았다.”라는 예문을 읽었다.']){
  const shown=t.clockNarration({narration,dialogue:[{speaker:'플리트윅',text:goodbye}]});
  assert(t.readSceneTime(afterClass,'1991-09-05 아침',passage(1,goodbye,{narration:shown})));
  assert.equal(afterClass.date,'1991-09-04');
  assert.equal(afterClass.slot,1);
}
const lateClock={...afterClass,slot:0};
const lesson=t.clockNarration({dialogue:[{speaker:'나레이터',text:'오후 마법 수업이 끝났다.'}]});
t.syncNarratedPeriod(lateClock,lesson);
assert.match(t.display(lateClock),/9월 4일 오후/);
const once=lateClock.transitions;
t.syncNarratedPeriod(lateClock,lesson);
assert.equal(lateClock.transitions,once);
for(const text of ['저녁 수업이 시작됐던 기억이 떠올랐다.','저녁이 되자 만나기로 했다.']){
  t.syncNarratedPeriod(lateClock,text);
  assert.equal(lateClock.slot,1);
}
const arrival='이튿날 아침, 학생들이 교실에 들어섰다.';
const midnight={...afterClass,date:'1991-09-30',slot:3};
t.syncNarratedPeriod(midnight,arrival);
assert.equal(midnight.date,'1991-09-30');
t.syncNarratedPeriod(midnight,arrival,true);
assert.match(t.display(midnight),/10월 1일 아침/);
assert(t.readSceneTime(afterClass,'1991-09-05 아침',passage(1,arrival,{narration:arrival})));
assert.match(t.display(afterClass),/9월 5일 아침/);
assert.equal(t.readSceneTime(within,'1991년 9월 4일 아침',passage(1)),true);
assert.equal(within.date,'1991-09-04');
assert.equal(within.slot,0);
for (const invalid of ['내일 아침','1991년 9월 3일 밤','1992년 2월 30일 밤','1999-09-01 아침']) {
  assert.equal(t.readSceneTime(within,invalid,passage(1)),false,invalid);
}
assert.equal(within.date,'1991-09-04');
const evening='수업과 과제를 마칠 무렵 창밖의 해가 지고 저녁이 되었다.';
assert.equal(t.readSceneTime(within,'1991-09-04 저녁',passage(0,evening)),true);
const recordedEvening=JSON.stringify(within);
assert.equal(t.readSceneTime(within,'1991년 9월 4일 저녁',passage(0,evening)),true);
assert.equal(JSON.stringify(within),recordedEvening,'reporting the current period is a no-op');
assert.equal(t.readSceneTime(within,'1991-09-04 저녁',passage(0,evening,{scene:slept})),false);
assert.equal(t.readSceneTime(within,'1991-09-04 오후',passage(0,evening)),false);
assert.equal(within.slot,2);
assert.equal(t.readSceneTime(within,'1995-09-01 아침'),false,'a date alone cannot skip four years');
assert.equal(t.readSceneTime(within,'1992-09-01 아침',passage(363,evening)),false,'multi-day jumps need the player request');
assert.equal(t.readSceneTime(within,'1992-09-01 아침',passage(363,evening,
  {request:'오늘은 무슨 수업이지',userText:'오늘은 무슨 수업이지'})),false,'small talk is not a time skip');
const year='남은 학기의 수업과 시험, 여름 방학을 보내고 다음 학년의 입학식 아침을 맞았다.';
assert.equal(t.readSceneTime(within,'1992-09-01 아침',passage(363,year,
  {request:'다음 학년까지 수업을 들으며 지낸다',userText:'다음 학년까지 수업을 들으며 지낸다'})),true);
assert.equal(t.studyYear(within.date),2);
for(const request of ['이틀간 쉬면서 지낸다','며칠 동안 수업을 들으며 지낸다']){
  const ordinary=t.createState();t.chooseHouse(ordinary,'그리핀도르');
  const elapsed='이틀 동안 충분히 쉬고 수업을 들은 뒤 셋째 날 아침을 맞았다.';
  assert(t.readSceneTime(ordinary,'1991-09-03 아침',passage(2,elapsed,{request,userText:request})),request);
}

const html = fs.readFileSync(path.join(__dirname,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/time.js?v=4'));
assert(html.includes("window._startPhase = 'hogwarts_sort'"));
assert(html.includes("s.time && !_isIdol && STORY.id !== 'hogwarts'"));
assert(html.includes("STORY.id !== 'hogwarts' && typeof data.time"));
assert(html.includes("id === 'hogwarts' ? false :"));
assert(html.includes("startPhase: STORY.id === 'hogwarts'"));
console.log(JSON.stringify({test:'hogwarts-authoritative-time',result:'PASS',jumps,final:restored.date,house:restored.house}));
