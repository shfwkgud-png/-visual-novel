/* Hogwarts calendar mirrors dates established by roleplay and explicit scene travel. */
(function(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PandoraHogwartsTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const START = '1991-09-01', END = '1998-06-30';
  const SLOTS = ['아침','오후','저녁','밤'];
  const HOUSE_OPTIONS = [
    '🦁 그리핀도르 — 용기와 결단',
    '🐍 슬리데린 — 야망과 기지',
    '🦅 레번클로 — 지성과 탐구',
    '🦡 후플푸프 — 성실과 신뢰',
    '🎩 분류모자에게 맡긴다'
  ];
  const houseLabels = ['그리핀도르','슬리데린','레번클로','후플푸프'];
  const books = [
    '마법사의 돌', '비밀의 방', '아즈카반의 죄수', '불의 잔',
    '불사조 기사단', '혼혈 왕자', '죽음의 성물'
  ];
  const phases = {autumn:'가을 학기',winter:'겨울 학기',spring:'봄 학기',
    finale:'학년말',summer:'여름방학'};
  function createState() {
    return {schemaVersion:1,date:START,slot:2,house:null,transitions:0};
  }
  function parseISO(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = new Date(Date.UTC(y,mo-1,d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo-1 || t.getUTCDate() !== d) return null;
    return t;
  }
  function iso(t) {
    return t.toISOString().slice(0,10);
  }
  function nextDays(date, n) {
    const t = parseISO(date);
    if (!t) return date;
    t.setUTCDate(t.getUTCDate()+n);
    return iso(t);
  }
  function studyYear(date) {
    const t = parseISO(date) || parseISO(START);
    const y = t.getUTCFullYear(), m = t.getUTCMonth()+1;
    return Math.max(1, Math.min(7, m >= 9 ? y-1990 : y-1991));
  }
  function phase(date) {
    const m = (parseISO(date) || parseISO(START)).getUTCMonth()+1;
    return m >= 9 && m <= 11 ? 'autumn' : (m === 12 || m <= 2) ? 'winter'
      : m >= 3 && m <= 5 ? 'spring' : m === 6 ? 'finale' : 'summer';
  }
  function valid(state) {
    return !!(state && state.schemaVersion === 1 && parseISO(state.date) &&
      state.date >= START && state.date <= END && Number.isInteger(state.slot) &&
      state.slot >= 0 && state.slot < SLOTS.length &&
      (state.house == null || houseLabels.includes(state.house)));
  }
  function display(state) {
    if (!valid(state)) state = createState();
    const t = parseISO(state.date);
    return t.getUTCFullYear()+'년 '+(t.getUTCMonth()+1)+'월 '+t.getUTCDate()+
      '일 '+SLOTS[state.slot]+' · '+studyYear(state.date)+'학년'+
      (state.house ? ' · '+state.house : ' · 기숙사 미배정');
  }
  function readSceneTime(state, value) {
    if (!valid(state) || !state.house || typeof value !== 'string') return false;
    const date = /^(\d{4})(?:년\s*|-)(\d{1,2})(?:월\s*|-)(\d{1,2})(?:일|\b)/.exec(value.trim());
    if (!date) return false;
    const target = date[1]+'-'+date[2].padStart(2,'0')+'-'+date[3].padStart(2,'0');
    if (!parseISO(target) || target < state.date || target > END) return false;
    const period = /(새벽|아침|오전|정오|점심|오후|저녁|밤)/.exec(value.slice(date[0].length));
    const slots = {새벽:0,아침:0,오전:0,정오:1,점심:1,오후:1,저녁:2,밤:3};
    const slot = period ? slots[period[1]] : state.slot;
    if (target === state.date && slot <= state.slot) return false;
    state.date = target;
    state.slot = slot;
    state.transitions = (state.transitions || 0) + 1;
    return true;
  }
  function goToNextTerm(date) {
    const t = parseISO(date), y=t.getUTCFullYear(), m=t.getUTCMonth()+1;
    if (m >= 9 && m <= 11) return y+'-12-01';
    if (m === 12 || m <= 2) return (m === 12 ? y+1 : y)+'-03-01';
    if (m >= 3 && m <= 5) return y+'-06-01';
    return (m >= 6 && m <= 8 ? y : y+1)+'-09-01';
  }
  function actionCode(text) {
    const input=String(text || '').trim();
    if (!/^▶\s*/.test(input)) return null;
    if (/^▶\s*다음 일정/.test(input)) return 'next_slot';
    if (/^▶\s*다음 날/.test(input)) return 'next_day';
    if (/^▶\s*다음 주/.test(input)) return 'next_week';
    if (/^▶\s*다음 학기/.test(input)) return 'next_term';
    if (/^▶\s*다음 학년/.test(input)) return 'next_year';
    return null;
  }
  function advance(state, input) {
    if (!valid(state)) throw new Error('호그와트 시간 상태가 올바르지 않습니다.');
    const action = actionCode(input);
    if (!action) return {advanced:false,action:null,reason:'no-explicit-action'};
    if (!state.house) return {advanced:false,action,reason:'sorting-pending'};
    let nextDate=state.date, nextSlot=state.slot;
    if (action === 'next_slot') {
      if (nextSlot < 3) nextSlot++;
      else {nextDate=nextDays(state.date,1);nextSlot=0;}
    } else if (action === 'next_day') {
      nextDate=nextDays(state.date,1);nextSlot=0;
    } else if (action === 'next_week') {
      nextDate=nextDays(state.date,7);nextSlot=0;
    } else if (action === 'next_term') {
      nextDate=goToNextTerm(state.date);nextSlot=0;
    } else if (action === 'next_year') {
      const t=parseISO(state.date),y=t.getUTCFullYear(),m=t.getUTCMonth()+1;
      nextDate=(m >= 9 ? y+1 : y)+'-09-01';nextSlot=0;
    }
    if (nextDate > END) return {advanced:false,action,reason:'seven-years-finished'};
    if (nextDate < state.date || (nextDate === state.date && nextSlot <= state.slot))
      return {advanced:false,action,reason:'non-increasing'};
    const before={date:state.date,slot:state.slot,year:studyYear(state.date)};
    state.date=nextDate;
    state.slot=nextSlot;
    state.transitions=(state.transitions || 0)+1;
    return {advanced:true,action,before,after:{date:state.date,slot:state.slot,
      year:studyYear(state.date)},display:display(state)};
  }
  // Only the existing living-world scheduler calls this after the player
  // explicitly requests the next SCENE. Dates never move during dialogue.
  function moveToScene(state, date, slot) {
    if (!valid(state)) throw new Error('호그와트 시간 상태가 올바르지 않습니다.');
    if (!state.house) return {advanced:false,reason:'sorting-pending'};
    const d=String(date||''), targetSlot=Number(slot);
    if (!parseISO(d) || d<state.date || d>END ||
        !Number.isInteger(targetSlot) || targetSlot<0 || targetSlot>=SLOTS.length)
      return {advanced:false,reason:'invalid-event-time'};
    if(d===state.date && targetSlot<state.slot) return {advanced:false,reason:'clock-rewind'};
    if(d===state.date && targetSlot===state.slot) return {advanced:false,reason:'same-scene-time'};
    const old={date:state.date,slot:state.slot};
    state.date=d;state.slot=targetSlot;state.transitions=(state.transitions||0)+1;
    return {advanced:true,before:old,after:{date:d,slot:targetSlot},display:display(state)};
  }
  function chooseHouse(state, choice, name, description) {
    if (!valid(state)) throw new Error('호그와트 시간 상태가 올바르지 않습니다.');
    if (state.house) return {ok:false,house:state.house,reason:'already-assigned'};
    const input=String(choice || '').trim();
    let found=houseLabels.find(x=>input.includes(x));
    if (!found && /분류모자/.test(input)) {
      const d=String(description || '');
      const weights=[
        (d.match(/용기|정의|도전|보호|의리|담대/g)||[]).length,
        (d.match(/야망|성공|권력|승리|계략|전략|기지/g)||[]).length,
        (d.match(/탐구|지식|연구|독서|지혜|분석|호기심/g)||[]).length,
        (d.match(/성실|친절|인내|공정|근면|협력|우정/g)||[]).length
      ];
      if (Math.max(...weights)>0) found=houseLabels[weights.indexOf(Math.max(...weights))];
      else {
        let h=2166136261;
        for(const c of String(name||'신입생')+d) h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
        found=houseLabels[h%4];
      }
    }
    if (!found) return {ok:false,reason:'invalid-choice'};
    state.house=found;
    return {ok:true,house:found};
  }
  function possibleActions(state) {
    if (!valid(state) || !state.house || state.date >= END) return [];
    const out=['▶ 다음 일정 — 수업·식사·휴식 등 다음 시간대로'];
    if (state.slot===3) out.push('▶ 다음 날 — 아침으로');
    const t=parseISO(state.date),m=t.getUTCMonth()+1,d=t.getUTCDate();
    if ([2,5,8,11].includes(m) && d>=20) out.push('▶ 다음 학기 — 남은 기간을 건너뛴다');
    return out;
  }
  function context(state) {
    if (!valid(state)) state=createState();
    const yr=studyYear(state.date),period=phase(state.date);
    const t=parseISO(state.date);
    const weekday=['일','월','화','수','목','금','토'][t.getUTCDay()];
    return '\n\n## 호그와트 현재 날짜·학년\n'
      +'- 현재: '+display(state)+' ('+weekday+'요일), '+phases[period]+'\n'
      +'- 적용할 원작 시기: 제'+yr+'권 '+books[yr-1]+' (이 학년도 바깥의 사건을 현재 진행형으로 만들지 마라).\n'
      +'- 시간은 실제 대화·이동·수업·수면 등 장면에서 흐른 만큼만 자연스럽게 진행한다. 날짜가 바뀌면 time에 "1991년 9월 2일 아침"처럼 연월일과 시간대를 기록한다.\n'
      +'- 짧은 대화만으로 하루나 학기를 넘기지 마라. 플레이어가 수면·기다림·여행을 실행했다면 그 경과를 반영하고, 미래 약속이나 희망을 이미 일어난 일로 기록하지 마라.\n'
      +'- 시간 건너뛰기가 선택되면 그 사이의 원작 사건을 무조건 주인공이 직접 목격한 것으로 만들지 마라. 공개 소식과 개인 지식은 구분한다.\n'
      +'- 시계가 현재 학년을 결정한다. 원작의 과거와 미래 비밀은 현재 날짜에 맞춰 숨겨라.\n';
  }
  return Object.freeze({createState,valid,display,readSceneTime,studyYear,phase,advance,moveToScene,chooseHouse,
    actionCode,possibleActions,context,HOUSE_OPTIONS:HOUSE_OPTIONS.slice(),END});
});
