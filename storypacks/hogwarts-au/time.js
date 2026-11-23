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
  const periods = {새벽:0,아침:0,오전:0,정오:1,점심:1,오후:1,저녁:2,밤:3};
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
  function afternoonRecovery(save) {
    const hp=save?.gameState?.hogwarts;
    if(!valid(hp)||!hp.house||hp.slot!==0||(save.startPhase && save.startPhase!=='playing'))return null;
    const last=save.gameHistory?.at(-1);
    const before=last?._turnBefore?.state?.hogwarts;
    let previous=null;
    if(last?.role==='assistant' && save.gameHistory.at(-2)?.role==='user' &&
        valid(before) && before.house===hp.house && before.slot===1 && nextDays(before.date,1)===hp.date){
      try{
        const answer=JSON.parse(last.content);
        if(answer.state_update?.hogwarts?.time?.days===1 && !crossedMidnight(clockNarration(answer),hp.date))
          previous=before.date;
      }catch{}
    }
    return {date:hp.date,previous};
  }
  function resumeAfternoon(save) {
    const recovery=afternoonRecovery(save);
    if(!recovery)return false;
    const hp=save.gameState.hogwarts;
    if(!moveToScene(hp,hp.date,1).advanced)return false;
    save.gameState.time=display(hp);
    const old=hp.date+'/0',now=hp.date+'/1',w=hp.world;
    if(w?.seenAt?.period===old)w.seenAt.period=now;
    if(w?.conversation?.key?.startsWith(old+'/'))w.conversation.key=now+w.conversation.key.slice(old.length);
    const last=save.gameHistory?.at(-1);
    if(last?.role==='assistant'){
      try{
        const answer=JSON.parse(last.content);
        answer.time=save.gameState.time;
        if(answer.state_update?.hogwarts)delete answer.state_update.hogwarts.time;
        if(answer.state_update)delete answer.state_update.time;
        last.content=JSON.stringify(answer);
        if(last._stateExtract?.turn===save.turnCount && !['applied','superseded'].includes(last._stateExtract.status))
          hp.correctedClockTurn=save.turnCount;
      }catch{}
    }
    return true;
  }
  // Only narrator beats establish the present. NPC dialogue, choices and quoted plans do not.
  function clockNarration(data) {
    return [data.narration,...(data.dialogue||[]).filter(d=>d && !d.char_id &&
      /^(?:나레이터|나레이션|내레이션|서술자)$/.test(d.speaker)).map(d=>d.text)]
      .filter(s=>typeof s==='string').join('\n').replace(/“[^”]*”|"[^"]*"|‘[^’]*’/g,'');
  }
  function clockLines(narration) {
    return narration.split(/[.!?。！？\n]+/).map(s=>s.trim()).filter(s=>s &&
      !/내일|모레|어제|지난날|예정|계획|약속|떠올|회상|상상|기억|기다리|생각했|생각이다|기로\s*(?:했|한)|거라고|것이다|않았|않는|아니었/.test(s));
  }
  function crossedMidnight(narration,target) {
    const [,month,day]=target.split('-').map(Number);
    const datedHeading=new RegExp('^(?:'+target.slice(0,4)+'년\\s*)?'+month+'월\\s*'+day+'일(?:\\s*(?:새벽|아침|오전|점심|오후|저녁|밤))?\\s*(?:[,—]|$)');
    return clockLines(narration).some(s=>datedHeading.test(s) ||
      /(?:다음\s*날|이튿날)\s*(?:아침|새벽)?이?\s*(?:밝았|밝는다|되었|됐다|되자|되니|찾아왔)/.test(s) ||
      /^(?:다음\s*날|이튿날)\s*(?:아침|오전|오후|저녁|밤|새벽)?\s*(?:[,—]|$)/.test(s) ||
      /(?:다음\s*날|이튿날|밤을\s*새|하룻밤을?\s*(?:보내|보낸)|잠(?:을\s*청한|든)\s*(?:뒤|후)).{0,55}(?:눈을\s*(?:떴|뜬다)|일어났|깨어났|맞았다|도착했다|들어섰다|시작됐다)/.test(s) ||
      /(?:자정이\s*(?:넘었|지났)|날(?:이|은)\s*(?:밝았다|밝는다)|아침\s*해가\s*떴다)\s*$/.test(s));
  }
  function syncNarratedPeriod(state,narration,commit=false) {
    if (!state.house) return;
    const tomorrow=nextDays(state.date,1);
    const lines=clockLines(narration);
    if(crossedMidnight(narration,tomorrow)){
      // A relative next-day heading is applied only by the saved turn's single commit.
      const heading=lines.map(s=>/^(?:다음\s*날|이튿날)\s*(새벽|아침|오전|정오|점심|오후|저녁|밤)\s*(?:[,—]|$)/.exec(s)).find(Boolean);
      if(commit && heading)moveToScene(state,tomorrow,periods[heading[1]]);
      return;
    }
    // A scene heading or an actual lesson establishes the period even when the recorder omitted time.
    let slot=state.slot;
    for(const line of lines){
      const anchored=/^(?:그날\s+|오늘\s+)?(?:늦은\s+|이른\s+)?(정오|점심|오후|저녁|밤)(?:\s*[,—]|$|(?:이|가)\s*(?:되었다|됐다|되자|찾아왔다)|(?:의)?\s+(?:[가-힣]+\s+){0,3}수업(?:이|은|을)\s*(?:시작됐다|시작되었다|시작된다|한창이다|끝났다|끝난다|마쳤다|마무리됐다|마무리되었다|끝나자))/.exec(line);
      if(anchored)slot=Math.max(slot,periods[anchored[1]]);
    }
    if(slot>state.slot)moveToScene(state,state.date,slot);
  }
  function readSceneTime(state, value, passage) {
    if (!valid(state) || !state.house || typeof value !== 'string') return false;
    const date = /^(\d{4})(?:년\s*|-)(\d{1,2})(?:월\s*|-)(\d{1,2})(?:일|\b)/.exec(value.trim());
    if (!date) return false;
    const target = date[1]+'-'+date[2].padStart(2,'0')+'-'+date[3].padStart(2,'0');
    if (!parseISO(target) || target < state.date || target > END) return false;
    const days=Math.round((parseISO(target)-parseISO(state.date))/86400000);
    if(!passage || passage.days!==days || !Number.isInteger(passage.days) ||
       typeof passage.evidence!=='string' || passage.evidence.trim().length<8 ||
       typeof passage.scene!=='string' || !passage.scene.includes(passage.evidence))return false;
    // Multi-day montage requires an actual player request, not a model's date jump.
    if(days>1 && (typeof passage.request!=='string' || passage.request.trim().length<4 ||
      !String(passage.userText||'').includes(passage.request) ||
      !/(?:(?:\d+|한|두|세|네|몇|여러)\s*(?:일|주|달|개월|년|학기)|며칠|이틀|사흘|나흘|일주일|수일|수주|수개월|수년|다음\s*(?:주|달|학기|학년)|방학|시간.{0,8}(?:넘|건너|보내))/.test(passage.request)))return false;
    // An unsupported overnight timestamp is a no-op. Keep the valid lesson, choices and other state.
    if(days===1 && !crossedMidnight(passage.narration??passage.evidence,target))return true;
    const period = /(새벽|아침|오전|정오|점심|오후|저녁|밤)/.exec(value.trim().slice(date[0].length));
    const slot = period ? periods[period[1]] : state.slot;
    if (target === state.date && slot <= state.slot) return slot === state.slot;
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
      +'- 시간은 실제 대화·이동·수업·수면 등 장면에서 흐른 만큼만 자연스럽게 진행한다. 같은 수업을 마치거나 다음 교실로 이동하면 현재 날짜와 시간대를 이어간다. 당일 아침에서 오후로 넘어가면 당일 날짜와 오후를 기록한다. 실제로 밤이 지나 다음 장면이 열리면 “이튿날 아침,”처럼 서술에 새 시간대를 밝히고 time에도 같은 연월일과 시간대를 기록한다.\n'
      +'- 짧은 대화만으로 하루나 학기를 넘기지 마라. 플레이어가 수면·기다림·여행을 실행했다면 그 경과를 반영하고, 미래 약속이나 희망을 이미 일어난 일로 기록하지 마라.\n'
      +'- 시간 건너뛰기가 선택되면 그 사이의 원작 사건을 무조건 주인공이 직접 목격한 것으로 만들지 마라. 공개 소식과 개인 지식은 구분한다.\n'
      +'- 시계가 현재 학년을 결정한다. 원작의 과거와 미래 비밀은 현재 날짜에 맞춰 숨겨라.\n';
  }
  return Object.freeze({createState,valid,display,afternoonRecovery,resumeAfternoon,clockNarration,syncNarratedPeriod,readSceneTime,studyYear,phase,advance,moveToScene,chooseHouse,
    actionCode,possibleActions,context,HOUSE_OPTIONS:HOUSE_OPTIONS.slice(),END});
});
