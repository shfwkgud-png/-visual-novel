// ═══════════════════════════════════════════════════════════════════════════
// PANDORA 상시 회귀 테스트 — 이 세션(2026-08-18~19)에서 실제로 터진 버그 전부를 고정.
// 실행: node tests.js        (novel.html 수정 후 반드시 실행)
// 실패 = exit 1. 어떤 수정이 과거 수정을 깨면 여기서 걸린다.
// 원칙: 버그마다 "재현 → 수정 확인" 시나리오를 남긴다. 일회용 시뮬 금지.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'novel.html'), 'utf8');
const results = [];
function T(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' — ' + (e && e.message || e)]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── 함수 추출: 최상위 function 선언을 '\n}' (열 0 닫는 중괄호)까지 잘라온다
function grabFn(name) {
  const decl = 'function ' + name + '(';
  let i = SRC.indexOf('\n' + decl);
  if (i < 0) i = SRC.indexOf('\nasync ' + decl);
  assert(i >= 0, '함수 추출 실패: ' + name);
  const j = SRC.indexOf('\n}', i);
  assert(j > i, '함수 끝 추출 실패: ' + name);
  return SRC.slice(i, j + 2);
}
function runSandbox(code, sandbox) {
  const sb = Object.assign({ console, JSON, Math, String, Array, Object, RegExp, Number, Set, Map, Date }, sandbox || {});
  sb.window = sb;   // window === globalThis 흉내
  vm.createContext(sb);
  vm.runInContext(code, sb, { timeout: 5000 });
  return sb;
}

// ═══ 0. 문법: <script> 블록이 파싱 가능한가 ═══
T('문법: 스크립트 파싱', () => {
  const i = SRC.indexOf('<script>'); const j = SRC.lastIndexOf('</script>');
  assert(i >= 0 && j > i, 'script 태그 없음');
  new vm.Script(SRC.slice(i + 8, j));   // 파싱만(실행 안 함) — 문법 오류면 throw
});

// ═══ 1. iOS 호환: lookbehind 정규식 리터럴 금지 (Safari<16.4 전체 파싱 실패) ═══
T('iOS: lookbehind 정규식 0건', () => {
  const hits = SRC.match(/\/[^\n\/]*\(\?<[=!][^\n]*?\//g) || [];
  assert(hits.length === 0, 'lookbehind 발견: ' + hits.join(' | ').slice(0, 120));
});

// ═══ 2. 순서 버그(3연발 유형): 복원 함수가 복원 전 전역을 읽지 않는가 ═══
T('순서: restoreAndReplay에서 trimHistory가 summaryIndex 복원 뒤', () => {
  const body = grabFn('restoreAndReplay');
  const a = body.indexOf('summaryIndex = save.summaryIndex');
  const b = body.indexOf('trimHistory(');
  assert(a >= 0 && b >= 0, '앵커 없음');
  assert(a < b, 'trimHistory가 summaryIndex 복원보다 앞에 있음(H-9 재발)');
});
T('순서: restoreAndReplay에서 loadSnaps가 turnCount 복원 뒤', () => {
  const body = grabFn('restoreAndReplay');
  const a = body.indexOf('turnCount = save.turnCount');
  const b = body.indexOf('loadSnaps()');
  assert(a >= 0 && b >= 0, '앵커 없음');
  assert(a < b, 'loadSnaps가 turnCount 복원보다 앞에 있음(v338 버그 재발)');
});
T('순서: loadSnaps 동작 — 복원 후 보존/잔재 정리', () => {
  const code = grabFn('loadSnaps');
  const store = JSON.stringify([{ turn: 45 }, { turn: 46 }, { turn: 47 }]);
  // 정상 이어하기(turnCount 복원 후)
  let sb = runSandbox(code + '\nloadSnaps();', {
    turnSnaps: [], turnCount: 48, SNAP_MAX: 30,
    bulkGet: () => store, snapKeyFor: () => 'k', STORY: { id: 't' },
  });
  assert(sb.turnSnaps.length === 3, '정상 이어하기에서 스냅샷 소실(' + sb.turnSnaps.length + ')');
  // 진짜 새 판 잔재(turn 5 < newest 47)는 정리돼야
  sb = runSandbox(code + '\nloadSnaps();', {
    turnSnaps: [], turnCount: 5, SNAP_MAX: 30,
    bulkGet: () => store, snapKeyFor: () => 'k', STORY: { id: 't' },
  });
  assert(sb.turnSnaps.length === 0, '새 판 잔재가 정리되지 않음');
});

// ═══ 3. 대사 파이프라인: 수신기록·중복·에코·보류분 (v305~v311, P0-2) ═══
function pipelineSandbox(extra) {
  const code = grabFn('resolveSpeakerName') + grabFn('resetTurnLineKeys') + grabFn('enqueueLine')
    + grabFn('_echoNorm') + grabFn('_sameText') + grabFn('_isNarrationEcho') + grabFn('dropLogEntry');
  return runSandbox(code + (extra || ''), {
    CHARACTERS: { a403: { name: '릴리아' }, a412: { name: '모니카' } },
    gameState: { metChars: {} }, replaying: false, playerName: '카일',
    currentBgFile: 'bg.webp', shownSprites: [],
    dialogueQueue: [], dialogueLog: [], _turnLineKeys: new Set(),
  });
}
const SHOW_ONE = `
function showOne() {
  const d = dialogueQueue.shift(); if (!d) return false;
  if (!String(d.text || '').trim()) { dropLogEntry(d); return showOne(); }
  if (!d.isPlayerLine && playerName && String(d.speaker || '').trim() === playerName &&
      _echoNorm(d.text) && _echoNorm(d.text) === _echoNorm(window._genText)) { dropLogEntry(d); return showOne(); }
  const k = String(d.speaker || '') + '|' + _echoNorm(d.text);
  if (k === window._lastShownKey) { dropLogEntry(d); return showOne(); }
  window._lastShownKey = k;
  if (d._log) { d._log.pending = false; }
  shown.push((d.speaker || '?') + ':' + d.text);
  return true;
}`;
T('파이프라인: 수신 즉시 기록 + 통째 재투입 차단 + 화면=기록', () => {
  const sb = pipelineSandbox(SHOW_ONE + `
    var shown = [];
    resetTurnLineKeys();
    const A = { speaker: 'a403', char_id: 'a403', text: '조용히 깃펜을 내려놓으며 미소를 짓는다' };
    const B = { speaker: 'a412', char_id: 'a412', text: '뒤에서 손부채를 접어 테이블을 두드린다' };
    [A, B].forEach(x => enqueueLine({ ...x }));
    window.__afterRecv = { q: dialogueQueue.length, log: dialogueLog.length };
    while (showOne());
    [A, B].forEach(x => enqueueLine({ ...x }));   // 완료 보정이 통째 재투입
    while (showOne());
    window.__final = { shown: shown.length, log: dialogueLog.length, speakers: dialogueLog.map(e => e.speaker).join(',') };
  `);
  assert(sb.__afterRecv.log === 2, '수신 시점 기록 안 됨(' + sb.__afterRecv.log + ')');
  assert(sb.__final.shown === 2 && sb.__final.log === 2, '재투입 차단 실패 화면' + sb.__final.shown + '/기록' + sb.__final.log);
  assert(sb.__final.speakers === '릴리아,모니카', '화자 id→이름 교정 실패: ' + sb.__final.speakers);
});
T('파이프라인: 유저 에코(구두점 변형)가 큐 입구에서 차단', () => {
  const sb = pipelineSandbox(`
    window._genText = '거참 남일에 관심들많네 신경끄쇼';
    resetTurnLineKeys();
    enqueueLine({ speaker: '카일', char_id: null, text: '거참 남일에 관심들 많네, 신경 끄쇼.' });
  `);
  assert(sb.dialogueQueue.length === 0 && sb.dialogueLog.length === 0,
    '에코가 통과함 큐' + sb.dialogueQueue.length + '/기록' + sb.dialogueLog.length);
});
T('파이프라인: 기록모드 보류분(_log 보유)은 재투입 차단 면제 (P0-2)', () => {
  const sb = pipelineSandbox(SHOW_ONE + `
    var shown = [];
    resetTurnLineKeys();
    enqueueLine({ speaker: 'a403', char_id: 'a403', text: '보류됐다가 돌아온 대사입니다' });
    const pending = dialogueQueue.slice(); dialogueQueue = [];   // historyMode 보류
    pending.forEach(enqueueLine);                                 // exitHistory 재투입
    while (showOne());
    window.__r = { shown: shown.length, log: dialogueLog.length };
  `);
  assert(sb.__r.shown === 1, '보류분이 화면에서 증발(' + sb.__r.shown + ')');
  assert(sb.__r.log === 1, '보류분 기록 중복(' + sb.__r.log + ')');
});
T('파이프라인: 나레이션 복제 — 문장단위 차단 + char_id 보존 (M-6)', () => {
  const code = grabFn('_echoNorm') + grabFn('_sameText') + grabFn('_isNarrationEcho');
  const sb = runSandbox(code + `
    const N = '카일은 목검을 대충 쥔 채 어깨를 툭 털어냈다. 주변의 비웃음 따위는 신경도 쓰이지 않았다.';
    window.__a = _isNarrationEcho('카일은 목검을 대충 쥔 채 어깨를 툭 털어냈다', N, false);
    window.__b = _isNarrationEcho('카일은 목검을 대충 쥔 채 어깨를 툭 털어냈다', N, true);
    window.__c = _isNarrationEcho('전혀 다른 대사를 하는 인물', N, false);
  `);
  assert(sb.__a === true, '문장단위 복제 미차단');
  assert(sb.__b === false, 'char_id 있는 정당 대사를 삼킴');
  assert(sb.__c === false, '무관한 대사 오차단');
});
T('파이프라인: pending 스포일러 상한 (H-6)', () => {
  const code = grabFn('lastNonPendingIndex');
  const sb = runSandbox(code + 'window.__i = lastNonPendingIndex();', {
    dialogueLog: [{ pending: false }, { pending: false }, { pending: true }],
  });
  assert(sb.__i === 1, '미표시 대사(pending)가 상한에 포함됨: ' + sb.__i);
});

// ═══ 4. 이벤트 스케줄 (v316, P0-1, P0-3, P2-9, M-1) ═══
function eventSandbox() {
  const code = grabFn('eventDueTurn') + grabFn('dueEventNow');
  // 실제 ACADEMY_EVENTS의 cond를 소스에서 그대로 추출
  const i = SRC.indexOf('const ACADEMY_EVENTS = ['); const j = SRC.indexOf('\n];', i);
  const evs = [];
  const re = /t:\s*'([^']+)',\s*cond:\s*'([^']*)'/g; let m;
  while ((m = re.exec(SRC.slice(i, j)))) evs.push({ t: m[1], cond: m[2] });
  assert(evs.length >= 8, 'ACADEMY_EVENTS 추출 실패: ' + evs.length);
  const cm = SRC.match(/const TURNS_PER_MONTH = (\d+)/); const gm = SRC.match(/const EVENT_MIN_GAP = (\d+)/);
  return runSandbox(code, {
    STORY: { events: evs }, gameState: { firedEvents: [], firedEventTurns: {} },
    turnCount: 0, TURNS_PER_MONTH: parseInt(cm[1], 10), EVENT_MIN_GAP: parseInt(gm[1], 10),
  });
}
T('이벤트: 순차 발동 순서(입학식→반배정→서열전→…→개전 체인)', () => {
  const sb = eventSandbox();
  vm.runInContext(`
    window.__fired = [];
    for (let t = 1; t <= 110; t++) {
      turnCount = t;
      const d = dueEventNow();
      if (d) {
        gameState.firedEvents.push(d.t);
        gameState.firedEventTurns[d.t] = t;
        gameState._lastEventTurn = t;
        window.__fired.push(t + ':' + d.t.split(' ')[0].split('—')[0]);
      }
    }
  `, sb);
  const got = sb.__fired.join(' / ');
  assert(sb.__fired.length === 9, '발동 개수 ' + sb.__fired.length + ' (9여야): ' + got);
  assert(got.includes('47:개전') || got.includes('개전'), '개전(체인)이 발동 안 함: ' + got);
  const 개전턴 = parseInt((sb.__fired.find(x => x.includes('개전')) || '0:').split(':')[0], 10);
  const 학원제턴 = parseInt((sb.__fired.find(x => x.includes('학원제')) || '0:').split(':')[0], 10);
  assert(개전턴 === 학원제턴 + 2, '개전 체인이 학원제+2가 아님: ' + 학원제턴 + '→' + 개전턴);
});
T('이벤트: API 재시도 시 같은 사건 유지 + 조립부는 tries 안 늘림 (P0-1+결함A)', () => {
  const sb = eventSandbox();
  vm.runInContext(`
    turnCount = 15;
    // 조립(buildStatePrompt의 대기 표시 로직과 동일 계약)
    function assemble() {
      const d = dueEventNow();
      if (d) {
        const _prev = window._pendingEvent;
        window._pendingEvent = (_prev && _prev.t === d.t) ? _prev : { t: d.t, tries: 0 };
      }
      return d ? d.t : null;
    }
    window.__a1 = assemble(); assemble(); assemble();   // 재시도 3회
    window.__tries = window._pendingEvent.tries;
    window.__a2 = assemble();                            // 재조립에도 같은 사건
  `, sb);
  assert(sb.__a1 && sb.__a1.includes('서열전'), '15턴 서열전 미도래: ' + sb.__a1);
  assert(sb.__tries === 0, '조립부에서 tries 증가(결함A 재발): ' + sb.__tries);
  assert(sb.__a2 === sb.__a1, '재시도에서 사건 소실(P0-1 재발)');
});
T('이벤트: 조립부가 firedEvents를 직접 커밋하지 않는다 (P0-1 정적)', () => {
  const i = SRC.indexOf('## ★지금 일어날 사건');
  assert(i > 0, '사건 주입 블록 없음');
  const seg = SRC.slice(i, i + 1200);
  assert(!seg.includes('firedEvents.push'), '조립부에 커밋이 되살아남(P0-1 재발)');
  assert(seg.includes('_pendingEvent'), '대기 표시 없음');
});
T('이벤트: 시작 클러스터(due<=2)는 간격 면제 (M-1)', () => {
  const sb = eventSandbox();
  vm.runInContext(`
    turnCount = 1;
    const d1 = dueEventNow();
    gameState.firedEvents.push(d1.t); gameState.firedEventTurns[d1.t] = 1; gameState._lastEventTurn = 1;
    turnCount = 2;
    const d2 = dueEventNow();
    window.__r = [d1 && d1.t, d2 && d2.t];
  `, sb);
  assert(sb.__r[0] && sb.__r[0].includes('입학식'), '1턴 입학식 아님: ' + sb.__r[0]);
  assert(sb.__r[1] && sb.__r[1].includes('반 배정'), '반 배정이 간격게이트에 막힘(M-1 재발): ' + sb.__r[1]);
});

// ═══ 5. combat 상태머신 + 백스톱 (v330) ═══
T('combat: 판정 턴 입력창 강제 + 8턴 백스톱 + 종료 복귀', () => {
  // showChoices 앞부분의 combat 게이트와 동일 계약을 검증
  const i = SRC.indexOf('function showChoices(choices) {');
  const seg = SRC.slice(i, i + 1400);
  assert(seg.includes('gameState.combat'), 'combat 게이트 소멸');
  assert(seg.includes('> 8'), '8턴 백스톱 소멸');
  assert(seg.includes('enterInputMode(); return;'), '입력창 강제 소멸');
  // 수신부: _combatStart 기록
  assert(SRC.includes("if (s.combat && !gameState.combat) gameState._combatStart = turnCount;"), '_combatStart 기록 소멸');
});

// ═══ 5-B. 언어적 대치(청문회 등)에서 선택지 실종 방지 (v341) ═══
T('combat: 언어적 대치는 판정 예외 + event 전환 시 굳은 combat 해제', () => {
  // ① 프롬프트: 청문회·심문·설전 같은 언어적 대치는 combat이 아니라 choices 필수임을 명시
  assert(SRC.includes('말과 입장으로 겨루는 대치는 combat이 아니다'),
    '언어적 대치 예외(choices 필수) 규정 소멸 — 청문회에서 선택지 실종 재발');
  assert(/청문회·심문·재판·설전·협상 등 말·입장으로 겨루는 대치는 여기에 해당하지 않는다/.test(SRC),
    'combat 필드 스펙의 언어적 대치 제외 소멸');
  // ② 엔진 안전망: event(청문회 등)로 장면 전환 시, 모델이 combat 미언급이면 굳은 전투 해제
  const i = SRC.indexOf('gameState.event = s.event;');
  assert(i > 0, 'event 처리부 소멸');
  const seg = SRC.slice(i, i + 500);
  assert(seg.includes('_evChanged') && seg.includes('gameState.combat = false'),
    'event 전환 시 굳은 combat 자동해제 소멸 — 이전 전투 combat이 청문회로 굳음 재발');
});

// ═══ 6. 시간 장치 폐지 (v337) — 재도입 감지 ═══
T('시간: 앱이 시간을 쓰는 코드 0건 (v337 폐지 유지)', () => {
  assert(!/function advanceTimeSlotIfStale/.test(SRC), '강제 진행 함수 부활');
  assert(!/function timeFlowNudge/.test(SRC), '넛지 함수 부활');
  assert(!/function tickTimeSlot/.test(SRC), '카운터 부활');
  // gameState.time 대입은 "모델 값 받아 적기"와 초기화만 허용 —
  // 앱이 계산해 쓰는 패턴("일차 ' + ")이 없어야 한다
  assert(!SRC.includes("gameState.time = day + '일차 '"), '앱이 시간을 계산해 씀(강제 진행 부활)');
});

// ═══ 7. 새로하기 리셋 완전성 (v335) ═══
T('새로하기: 전역 누수 8종 리셋 존재', () => {
  const i = SRC.indexOf('function startGame(isContinue)');
  const j = SRC.indexOf('if (isContinue)', i);
  const seg = SRC.slice(i, j);
  ['_pendingEvent = null', '_timeSkipNote = null', '_genFailed = false',
   '_lastChoices = null', '_fbGenTurn = null', '_replayFill = false',
   'histDropped = 0', 'dlogDropped = 0',
  ].forEach(k => assert(seg.includes(k), '새로하기 리셋 누락: ' + k));
});

// ═══ 8. metChars 장면 인물 보호 (결함C) ═══
T('metChars: 현재 장면 인물은 친밀도 낮아도 전체 상세', () => {
  const i = SRC.indexOf('const META_FULL_CAP');
  const seg = SRC.slice(i, i + 900);
  assert(seg.includes('_lastPresentIds'), '장면 인물 보호 소멸(결함C 재발)');
  assert(seg.includes('Math.max(META_FULL_CAP, _present.length)'), '대형 장면 보호 소멸');
});

// ═══ 9. 폴백 선택지: 장면 생성형 (v334) ═══
T('폴백: 정적 템플릿이 1차 경로로 부활하지 않음', () => {
  assert(SRC.includes('function genFallbackChoices'), '생성형 폴백 소멸');
  assert(!SRC.includes('의 반응을 살핀다`, `'), '정적 템플릿이 1차 경로로 부활');
});

// ═══ 10. 아이돌 오배송 (CRITICAL) ═══
T('오배송: MOD_IDOL은 idol에만, 스키마에 sim 전용 문구 없음', () => {
  assert(SRC.includes("if (_sidNow === 'idol') worldPrompt += ENGINE_MOD_IDOL;"), 'MOD_IDOL 조건 소멸');
  const i = SRC.indexOf('const ENGINE_RULES_PROMPT');
  const j = SRC.indexOf('`;', SRC.indexOf('`', i) + 1);
  const rules = SRC.slice(i, j);
  assert(!rules.includes('무대 뒤 3분'), '아이돌 전용 문구가 공통 규칙에 잔존');
});

// ═══ 11. 요약 게이트 (P2-8) ═══
T('요약: SUMMARY_KEEP 분리 유지(자기참조 재발 방지)', () => {
  assert(/const SUMMARY_KEEP = \d+/.test(SRC), 'SUMMARY_KEEP 소멸');
  const i = SRC.indexOf('async function summarizeIfNeeded');
  const seg = SRC.slice(i, i + 800);
  assert(seg.includes('SUMMARY_INTERVAL + SUMMARY_KEEP'), '요약 가드가 창 크기 참조로 회귀(P2-8 재발)');
  // 실행 코드에서만 검사(설명 주석 제외) — 대입/조건식 형태의 실제 호출 패턴
  assert(!/=\s*recentWindowCount\(\)/.test(seg.replace(/\/\/[^\n]*/g, '')), '요약 가드가 recentWindowCount를 다시 씀');
});

// ═══ 12. chronicle 수신 (P2-7) ═══
T('chronicle: processResponse가 data.chronicle을 읽는다', () => {
  assert(SRC.includes('Array.isArray(data.chronicle)'), 'chronicle 수신 소멸(P2-7 재발)');
});

// ═══ 결과 출력 ═══
const fails = results.filter(r => r[0] === 'FAIL');
for (const [st, name] of results) console.log((st === 'PASS' ? '  ✓ ' : '  ✗ ') + name);
console.log('\n' + (results.length - fails.length) + '/' + results.length + ' 통과' + (fails.length ? ' — ★실패 ' + fails.length + '건' : ''));
process.exit(fails.length ? 1 : 0);
