'use strict';
/* node tests-hogwarts-time.js
 * Regression: 7-year school clock belongs to the app, not wall clock or LLM.
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
assert.match(t.context(restored),/AI 변경 불가/);

const html = fs.readFileSync(path.join(__dirname,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/time.js?v=1'));
assert(html.includes("window._startPhase = 'hogwarts_sort'"));
assert(html.includes("s.time && !_isIdol && STORY.id !== 'hogwarts'"));
assert(html.includes("STORY.id !== 'hogwarts' && typeof data.time"));
assert(html.includes("id === 'hogwarts' ? false :"));
assert(html.includes("startPhase: STORY.id === 'hogwarts'"));
console.log(JSON.stringify({test:'hogwarts-authoritative-time',result:'PASS',jumps,final:restored.date,house:restored.house}));
