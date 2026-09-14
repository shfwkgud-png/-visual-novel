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
const asyncJobs = [];   // async 테스트(fn이 Promise 반환)는 출력 전에 전부 대기
function T(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      const slot = ['PASS', name]; results.push(slot);
      asyncJobs.push(r.catch(e => { slot[0] = 'FAIL'; slot[1] = name + ' — ' + (e && e.message || e); }));
      return;
    }
    results.push(['PASS', name]);
  }
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
  const body = grabFn('restoreAndReplayInner');
  const a = body.indexOf('summaryIndex = save.summaryIndex');
  const b = body.indexOf('trimHistory(');
  assert(a >= 0 && b >= 0, '앵커 없음');
  assert(a < b, 'trimHistory가 summaryIndex 복원보다 앞에 있음(H-9 재발)');
});
T('순서: restoreAndReplay에서 loadSnaps가 turnCount 복원 뒤', () => {
  const body = grabFn('restoreAndReplayInner');
  const a = body.indexOf('turnCount = save.turnCount');
  const b = body.indexOf('loadSnaps()');
  assert(a >= 0 && b >= 0, '앵커 없음');
  assert(a < b, 'loadSnaps가 turnCount 복원보다 앞에 있음(v338 버그 재발)');
});
T('순서: 복원 래퍼 — 저장 차단·절반 복원 방지 (v351, 책 Ch.116)', () => {
  const w = grabFn('restoreAndReplay');
  assert(w.includes('window._isRestoring = true') && /finally\s*\{[\s\S]*?_isRestoring = false/.test(w),
    '복원 중 플래그 관리 소멸');
  assert(w.includes('catch (e)') && w.includes('exitToMain'),
    '복원 실패 시 절반 상태 진행 차단 소멸');
  const a = grabFn('autoSave');
  assert(a.includes('if (window._isRestoring) return'),
    '복원 도중 autoSave 차단 소멸(덜 복원된 전역이 세이브를 덮는 사고 재발)');
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
    + grabFn('_echoNorm') + grabFn('_sameText') + grabFn('_isNarrationEcho') + grabFn('dropLogEntry') + grabFn('scrubMetaNumbers');
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

// ═══ 5-H. 배선 무결성 게이트 (v351 — 책 Ch.145·149·150: 등록↔참조 차집합) ═══
// "만들었는데 배선 누락"(라디언트 webp 사고)을 사람 기억이 아니라 기계가 잡는다.
function grabRoster(cname) {
  const m = SRC.match(new RegExp('const ' + cname + '_CHARACTERS = \\{([\\s\\S]*?)\\n\\};'));
  assert(m, cname + ' 로스터 블록 추출 실패');
  return [...m[1].matchAll(/\n\s{2}(\w+):\s*\{\s*name:/g)].map(x => x[1]);
}
const PANDORA_ROSTER_PREFIX = { murim: 'MURIM', academy: 'ACADEMY', isekai: 'ISEKAI', muhyeop: 'MUHYEOP', lovediary: 'LOVEDIARY', idol: 'IDOL', hollowinn: 'HOLLOWINN', hero: 'HERO' };
T('배선: PANDORA 전 로스터 → 초상(1_calm.webp) 실존', () => {
  const fs2 = require('fs');
  const missing = [];
  for (const [sid, pre] of Object.entries(PANDORA_ROSTER_PREFIX)) {
    for (const cid of grabRoster(pre)) {
      if (!fs2.existsSync(`sd_samples/characters/${sid}/${cid}/2d/1_calm.webp`)) missing.push(`${sid}/${cid}`);
    }
  }
  assert(missing.length === 0, '로스터에 있는데 초상 webp 없음(채팅에 이름만 뜸): ' + missing.join(', '));
});
T('배선: STORY_BG_FILES 전 키 → 배경 webp 실존 + customBgs url 실존', () => {
  const fs2 = require('fs');
  const m = SRC.match(/const STORY_BG_FILES = \{([\s\S]*?)\n\};/);
  assert(m, 'STORY_BG_FILES 추출 실패');
  const missing = [];
  for (const sm of m[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    const sid = sm[1];
    for (const k of sm[2].split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean)) {
      if (!fs2.existsSync(`sd_samples/backgrounds/${sid}/${k}.webp`)) missing.push(`${sid}/${k}`);
    }
  }
  for (const um of SRC.matchAll(/url: '(sd_samples\/[^']+\.webp)'/g)) {
    if (!fs2.existsSync(um[1])) missing.push('customBgs:' + um[1]);
  }
  assert(missing.length === 0, '배선된 배경 키의 파일 없음: ' + missing.join(', '));
});
T('배선: CG_MANIFEST 캐릭 → 로스터 존재 + (로컬 보유 시) NSFW 폴더 실존', () => {
  const fs2 = require('fs');
  const m = SRC.match(/const CG_MANIFEST = \{([\s\S]*?)\n\};/);
  assert(m, 'CG_MANIFEST 추출 실패');
  const bad = [];
  for (const sm of m[1].matchAll(/(\w+):\s*\{ full: \[([^\]]*)\](?:,\s*\n?\s*base: \[([^\]]*)\])?/g)) {
    const sid = sm[1];
    const ids = (sm[2] + ',' + (sm[3] || '')).split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean);
    const pre = PANDORA_ROSTER_PREFIX[sid];
    const roster = pre ? grabRoster(pre) : null;
    for (const cid of ids) {
      if (roster && !roster.includes(cid)) bad.push(`${sid}/${cid}(로스터에 없음)`);
      // NSFW 원본은 gitignore(로컬 전용) — 스토리 폴더가 로컬에 있을 때만 폴더 단위 검증
      if (fs2.existsSync(`sd_samples/nsfw/${sid}`) && !fs2.existsSync(`sd_samples/nsfw/${sid}/${cid}`)) bad.push(`${sid}/${cid}(NSFW 폴더 없음)`);
    }
  }
  assert(bad.length === 0, 'CG 배선 불일치: ' + bad.join(', '));
});
T('배선: 전 스토리 startChars ⊂ 해당 로스터', () => {
  const bad = [];
  for (const sm of SRC.matchAll(/id: '(\w+)',\s*\n\s*title:[\s\S]{0,4000}?startChars: \[([^\]]*)\]/g)) {
    const sid = sm[1];
    const pre = PANDORA_ROSTER_PREFIX[sid];
    const chars = sm[2].split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean);
    if (!pre) continue;   // 비PANDORA는 로스터 형식이 다양 — PANDORA만 게이트
    const roster = grabRoster(pre);
    for (const c of chars) if (!roster.includes(c)) bad.push(`${sid}:${c}`);
  }
  assert(bad.length === 0, 'startChars가 로스터에 없음(첫 장면 스프라이트 실종): ' + bad.join(', '));
});

// ═══ 5-G. 분리 응답 파이프라인 (v350 — 속도 수술) ═══
T('분리: splitPipeOn 스위치·idol 제외 (실행 검증)', () => {
  const code = grabFn('splitPipeOn');
  const mk = (cfg, sid) => runSandbox(code + '\n', {
    localStorage: { getItem: () => JSON.stringify(cfg) },
    STORY: { id: sid },
  }).splitPipeOn();
  assert(mk({}, 'hero') === true, '기본값이 ON이 아님');
  assert(mk({ splitPipe: false }, 'hero') === false, 'vn_cfg.splitPipe=false 스위치가 안 먹음(롤백 불가)');
  assert(mk({}, 'idol') === false, 'idol(sim 결합)이 분리 대상에서 제외되지 않음');
});
T('분리: 사건 커밋 함수 — 확인 시 커밋·미확인 시 tries+1 (실행 검증)', () => {
  const code = grabFn('commitPendingEventFrom');
  const sb = runSandbox(code + '\n', {
    gameState: { firedEvents: [], firedEventTurns: {} },
    turnCount: 7,
  });
  sb.window._pendingEvent = { t: '개전 선포', tries: 0 };
  sb.commitPendingEventFrom({ state_update: { event: '개전 선포' } });
  assert(sb.gameState.firedEvents.includes('개전 선포'), 'event 확인 커밋 실패');
  assert(sb.gameState.firedEventTurns['개전 선포'] === 7, '발동 턴 기록 실패');
  assert(sb.window._pendingEvent === null, '커밋 후 pending 미해제');
  sb.window._pendingEvent = { t: '학원제', tries: 0 };
  sb.commitPendingEventFrom({ state_update: {} });
  assert(sb.window._pendingEvent.tries === 1, '미확인 시 tries+1 실패');
});
T('분리: stateOnly 경로가 렌더를 건드리지 않음 + 배선 존재', () => {
  const pr = grabFn('processResponse');
  // stateOnly 가드: 초입 화면 처리와 렌더 경로를 모두 우회하는지(위치 검사)
  const gEnter = pr.indexOf('if (!stateOnly) {');
  const gExit = pr.indexOf('if (stateOnly) {');
  const stateBlock = pr.indexOf('if (data.state_update) {');
  const renderBlock = pr.indexOf('if (streamed) {');
  assert(gEnter >= 0 && gExit > 0, 'stateOnly 가드 소멸');
  assert(gEnter < stateBlock && stateBlock < gExit && gExit < renderBlock,
    'stateOnly 가드 순서 붕괴(화면가드→state공유→렌더전 탈출이어야)');
  // combat 최상위 승격
  assert(pr.includes("typeof data.combat === 'boolean'"), '본편 combat 최상위 처리 소멸(판정 게이트 지연)');
  // 후행 발사·병합·대기 배선
  assert(SRC.includes('fireStateExtract(userMessageForExtract()'), '후행 추출 발사 소멸');
  assert(SRC.includes('h.content = JSON.stringify(merged)'), 'gameHistory 병합 저장 소멸(복원 호환 붕괴)');
  assert(SRC.includes('window._splitExtractPending, new Promise'), '다음 턴 전 후행 대기 소멸(옛 상태로 프롬프트)');
  assert(SRC.includes('window._splitExtractPending && window._pendingChoices == null'), '소비 지점 폴백 억제 소멸(선택지 이중 생성)');
  // 후행이 본편 소유 필드를 침범하지 못함
  assert(SRC.includes('delete sx.state_update.combat'), '후행 combat 차단 소멸(판정 게이트 경합)');
});
T('분리: fireStateExtract — 추출→적용→병합→선택지 (실행 검증)', async () => {
  const code = grabFn('userMessageForExtract') + '\n' + grabFn('commitPendingEventFrom') + '\n' + grabFn('fireStateExtract');
  const calls = { proc: null, choices: 'NOT_CALLED', saved: 0 };
  const hist = [
    { role: 'user', content: '(그녀에게 다가간다)' },
    { role: 'assistant', content: JSON.stringify({ narration: '그녀가 웃었다', dialogue: [{ speaker: '나비', char_id: 'v716', text: '왔네?' }] }) },
  ];
  const sb = runSandbox(code + '\n', {
    turnCount: 3, gameHistory: hist,
    gameState: { rep: 1, gold: 10, metChars: { v716: { intimacy: 20 } }, firedEvents: [], firedEventTurns: {} },
    CHARACTERS: { v716: { name: '나비' } },
    RPG_STORIES: new Set(['hero']), STORY: { id: 'hero' },
    dialogueQueue: [], historyMode: false,
    sendBtn: { disabled: false },
    document: { getElementById: () => null },
    llmSmall: async () => JSON.stringify({
      state_update: { chars: { v716: { intimacy: 24 } }, combat: true },
      choices: ['말을 건다', '떠본다'], chronicle: ['나비가 주인공을 기억한다'],
    }),
    processResponse: (d, a, s, so) => { calls.proc = { d, so }; },
    showChoices: c => { calls.choices = c; },
    autoSave: () => { calls.saved++; },
    setTimeout: (f, ms) => f(),
  });
  await sb.fireStateExtract('(그녀에게 다가간다)', JSON.parse(hist[1].content), ['v716'], 1);
  assert(calls.proc && calls.proc.so === true, 'stateOnly 적용 호출 안 됨');
  assert(calls.proc.d.state_update.chars.v716.intimacy === 24, '추출 상태 미전달');
  assert(!('combat' in calls.proc.d.state_update), '후행 combat이 삭제되지 않음');
  const merged = JSON.parse(hist[1].content);
  assert(merged.state_update && merged.choices && merged.chronicle, 'gameHistory 병합 실패: ' + hist[1].content.slice(0, 80));
  assert(Array.isArray(calls.choices) && calls.choices.length === 2, '선택지 표시 안 됨: ' + JSON.stringify(calls.choices));
  assert(calls.saved >= 1, '후행 적용 후 autoSave 안 됨');
  assert(sb.window._splitExtractPending === null, 'pending 미해제');
});

// ═══ 5-F. 세이브 데이터 버전·마이그레이션 (v349 — 책 Ch.119·223) ═══
T('세이브버전: 도장·레거시 승격·미래 거부·체인·백업 (실행 검증)', () => {
  // build()에 도장이 찍히는가
  assert(SRC.includes('dataVersion: SAVE_DATA_VERSION'), 'autoSave build()에 dataVersion 도장 소멸');
  // migrateSave 실행 검증 — SAVE_DATA_VERSION=3, 체인 1→2→3을 주입해 시뮬레이션
  const code = grabFn('migrateSave');
  const stored = {};
  const sb = runSandbox(code + '\n', {
    SAVE_DATA_VERSION: 3,
    SAVE_MIGRATIONS: {
      1: s => Object.assign({}, s, { fieldA: 'added', dataVersion: 2 }),
      2: s => Object.assign({}, s, { fieldB: 'added', dataVersion: 3 }),
    },
    saveKeyFor: id => 'vn_save_' + id,
    bulkGet: k => stored[k] || null,
    bulkSetSilent: (k, v) => { stored[k] = v; return true; },
    showStatToast: () => {},
  });
  // ① 레거시(도장 없음)=v1 간주 → 체인 통과 → v3 승격 + 필드 추가
  const legacy = { gameHistory: [1, 2], turnCount: 5 };
  const m1 = sb.migrateSave(legacy, 'hero');
  assert(m1 && m1.dataVersion === 3, '레거시 승격 실패: ' + JSON.stringify(m1 && m1.dataVersion));
  assert(m1.fieldA === 'added' && m1.fieldB === 'added', '마이그레이션 체인 미적용');
  assert(m1.turnCount === 5, '기존 필드 소실');
  // ② 변환 전 원본 백업이 남았는가
  assert(stored['vn_save_hero_premig_v1'], '마이그레이션 전 원본 백업 없음(원본 파괴 위험)');
  assert(JSON.parse(stored['vn_save_hero_premig_v1']).turnCount === 5, '백업 내용 불일치');
  // ③ 미래 버전 거부(구버전 앱이 신버전 세이브를 읽는 멀티기기 사고)
  const future = { dataVersion: 99, gameHistory: [] };
  assert(sb.migrateSave(future, 'hero') === null, '미래 버전 세이브를 거부하지 않음');
  // ④ 현재 버전은 무변환 통과
  const cur = { dataVersion: 3, turnCount: 9 };
  assert(sb.migrateSave(cur, 'hero') === cur, '현재 버전 세이브가 그대로 통과하지 않음');
  // ⑤ 변환기 실패 시 null(절반 변환 금지) — 1→2 변환기가 throw
  const sb2 = runSandbox(code + '\n', {
    SAVE_DATA_VERSION: 2,
    SAVE_MIGRATIONS: { 1: () => { throw new Error('boom'); } },
    saveKeyFor: id => 'k' + id, bulkGet: () => null, bulkSetSilent: () => true,
    showStatToast: () => {}, console: { error: () => {} },
  });
  assert(sb2.migrateSave({ turnCount: 1 }, 'x') === null, '변환 실패가 절반 상태로 통과됨');
});

// ═══ 5-E. 전수감사 수정 묶음 (v346) ═══
T('감사: 로스터 중복 키 0건(김나연 lv106 복구) + 전 스토리 startBg 실존', () => {
  // ① 같은 CHARACTERS 블록 안에서 키 중복 = 뒤 키가 이겨 인물이 통째로 소멸(김나연 lv107 사고)
  const blocks = SRC.match(/const [A-Z]+_CHARACTERS = \{[\s\S]*?\n\};/g) || [];
  assert(blocks.length >= 15, 'CHARACTERS 블록 추출 실패');
  for (const b of blocks) {
    const keys = [...b.matchAll(/\n  ([a-z]+\d+|[a-z_]+):\s*\{ name:/g)].map(m => m[1]);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert(dup.length === 0, '로스터 키 중복(인물 소멸): ' + dup.join(','));
  }
  assert(/lv106: \{ name: '김나연'/.test(SRC), '김나연 lv106 소멸(중복 키 사고 재발)');
  // ② startBg가 실제 파일로 존재해야 함(alley 404 사고 재발 방지). 스토리 블록만 매칭(id 바로 뒤 title)
  //   + customBgs 재사용 큐레이션(hollowinn 등)은 블록 안 키 정의로 해석.
  const fs2 = require('fs');
  const sbs = [...SRC.matchAll(/id: '(\w+)',\s*\n\s*title:/g)];
  assert(sbs.length >= 15, '스토리 블록 추출 실패(' + sbs.length + ')');
  const missing = [];
  for (const m of sbs) {
    const sid = m[1];
    const block = SRC.slice(m.index, m.index + 4000);
    const sb = block.match(/startBg: '([\w]+)'/);
    if (!sb) continue;
    const key = sb[1];
    if (new RegExp(`customBgs:[\\s\\S]{0,1500}\\b${key}:`).test(block)) continue;   // customBgs로 배선됨
    const cand = [`sd_samples/backgrounds/${sid}/${key}.webp`, `sd_samples/backgrounds/${sid}/${key}.png`, `background/${key}.webp`];
    if (!cand.some(p => fs2.existsSync(p))) missing.push(`${sid}:${key}`);
  }
  assert(missing.length === 0, 'startBg 파일 없음(첫 화면 404): ' + missing.join(', '));
});
T('감사: PANDORA pose 리맵 + injuries 교체 + CG규칙 게이트 + 성장 토스트', () => {
  assert(/PANDORA_STORIES\.has\(STORY\.id\)\) \{\s*\n\s*pose = 'upper'/.test(SRC),
    'PANDORA pose→upper 리맵 소멸(스프라이트 실종 재발)');
  assert(SRC.includes('p.injuries = _next'), 'injuries 전체교체(회복 경로) 소멸 — 부상 영구화 재발');
  assert(/CG_MANIFEST\[_sidNow\]\)\) worldPrompt \+= ENGINE_MOD_CG/.test(SRC),
    'CG규칙 매니페스트 게이트 소멸 — 에셋 없는 스토리에 cg 지시 재발');
  assert(SRC.includes('📊 ${_statChg'), '스탯 변화 토스트 소멸');
  assert(SRC.includes('진행 중 이벤트: ${gameState.event}'), 'event 재주입 소멸 — 모델이 이벤트 잊음 재발');
  assert(SRC.includes('⚔ 판정 중 — 어떻게 움직일지 직접 입력'), '판정 입력모드 신호 소멸');
  // v347: iOS PWA 스냅샷 복원으로 열흘간 v291 플레이 사고 — 복귀 시 ETag 비교로 새 버전 감지
  assert(SRC.includes('function checkAppUpdate'), '자동 버전 감지 소멸 — 구버전 고착 재발');
  assert(/visibilitychange.*checkAppUpdate|checkAppUpdate, 1200/.test(SRC), '복귀 시 버전 체크 소멸');
  // v348: refreshApp이 히스토리에 구버전을 쌓아 엣지 스와이프로 v291 부활하던 함정
  assert(/function refreshApp\(\) \{[\s\S]{0,400}location\.replace\(/.test(SRC), 'refreshApp replace 소멸 — 히스토리에 구버전 쌓임 재발');
  assert(SRC.includes("addEventListener('pageshow'"), 'bfcache 부활 방어(pageshow) 소멸 — 스와이프로 구버전 부활 재발');
});

// ═══ 5-D. 판정 턴 주사위 가시화 (v346) ═══
T('판정: combat 턴 주사위를 앱이 직접 표시(산문 의존 금지)', () => {
  // 유저 신고(2026-08-22): "주사위 결과도 안 뜨고 다 실패했다고만 뜸" — 표기가 모델 산문에만
  // 의존하면 누락된다. handlePlayerInput이 combat 턴에 값을 즉시 굴려 토스트로 보여줘야 한다.
  const i = SRC.indexOf('async function handlePlayerInput');
  const seg = SRC.slice(i, i + 26000);
  assert(seg.includes('window._fateRoll = null'), '주사위 재굴림 소멸');
  assert(/if \(gameState && gameState\.combat\) \{[\s\S]{0,200}_fateRoll = 1 \+ Math\.floor/.test(seg),
    'combat 턴 즉시 굴림 소멸 — 주사위 안 보임 재발');
  assert(seg.includes('운명 주사위 ${window._fateRoll}/100'), '주사위 토스트 표시 소멸');
});

// ═══ 5-I. 반 배정이 전황판을 열어버리는 오개전 (v354) ═══
// 흑룡반=제국계라 모델이 1일차 반 선택을 faction에 기록 → "faction 첫 기록=개전" 규칙이 2부를 열었다.
T('개전: 반 선택은 진영이 아니다 + 개전 판정은 선언 기반', () => {
  const c1 = (SRC.match(/const ACADEMY_CLASS_RE = [^\n]+/) || [])[0];
  const c2 = (SRC.match(/const WAR_OPEN_RE = [^\n]+/) || [])[0];
  assert(c1 && c2, '개전 게이트 상수 소멸');
  const sb = runSandbox(c1 + '\n' + c2 + '\n' + grabFn('routeFactionValue') + grabFn('warDeclared'));
  // ① 반 이름은 진영이 아니라 소속 단위로 라우팅
  for (const v of ['흑룡반', '은사자반 · 아를렌 왕국', '금매반(연합계)']) {
    const r = sb.routeFactionValue('academy', v);
    assert(r && r.kind === 'class', '반 선택이 진영으로 샜다: ' + v);
  }
  // ② 정식 진영은 그대로 통과
  const r2 = sb.routeFactionValue('academy', '그란텀 제국');
  assert(r2 && r2.kind === 'faction' && r2.value === '그란텀 제국', '정식 진영 라우팅 깨짐');
  // ③ 아카데미 전용 규칙 — 타 스토리에서는 '~반'도 진영일 수 있다
  assert(sb.routeFactionValue('murim', '흑룡반').kind === 'faction', '아카데미 전용 규칙이 타 스토리 오염');
  // ④ 개전 판정: 진영 기록만으로는 절대 true가 아니다(이 버그의 핵심)
  assert(sb.warDeclared({ flags: {}, event: '반 배정' }, { faction: '그란텀 제국' }) === false,
    '반 배정 턴에 개전 판정 — 전황판 오개전 재발');
  assert(sb.warDeclared({ flags: {}, event: null }, { event: '개전 — 진영 선택' }) === true, '개전 이벤트 미인식');
  assert(sb.warDeclared({ flags: {}, event: '개전 — 진영 선택' }, {}) === true, '진행 중 개전 이벤트 미인식');
  assert(sb.warDeclared({ flags: { '개전': true }, event: null }, {}) === true, '개전 플래그 영구화 미인식');
  assert(sb.warDeclared({ flags: {}, event: null }, { war: { action: '진격' } }) === true, '전황 지시 백업 경로 소멸');
});
T('개전: 엔진 게이트가 개전선언+진영 둘 다 요구 + 프롬프트도 반↔진영 분리', () => {
  const i = SRC.indexOf("전황판은 '개전 선언 + 진영 확정'");
  assert(i > 0, '개전 게이트 주석/로직 소멸');
  const seg = SRC.slice(i, i + 700);
  assert(/warDeclared\(gameState, s\)/.test(seg), 'warDeclared 게이트 미사용');
  assert(/flags\['개전'\] && gameState\.faction/.test(seg), 'initWar 조건이 진영 기록만으로 되돌아감');
  assert(SRC.includes('1부의 반 배정(흑룡반·은사자반·금매반)은 절대 faction이 아니다'), '반→faction 금지 프롬프트 소멸');
  assert(/조직 내부의 소속 단위는 faction이 아니라 flags에 기록하라/.test(SRC), 'faction 필드 스펙의 소속단위 제외 소멸');
});

T('개전: 오개전 세이브 복구 마이그레이션 v1→v2 (실행 검증)', () => {
  const m = SRC.match(/const SAVE_MIGRATIONS = \{[\s\S]*?\n\};/);
  assert(m, 'SAVE_MIGRATIONS 블록 추출 실패');
  const sb = runSandbox(m[0].replace('const SAVE_MIGRATIONS', 'var SAVE_MIGRATIONS'));
  const mig = sb.SAVE_MIGRATIONS && sb.SAVE_MIGRATIONS[1];
  assert(typeof mig === 'function', 'v1→v2 변환기 없음');
  // ① 1일차 오개전 세이브 — 잘못 열린 전황판을 접고 반 이름을 제자리로
  const bad = mig({ turnCount: 3, gameState: { war: { month: 1 }, faction: '흑룡반 · 그란텀 제국', flags: {} } });
  assert(!bad.gameState.war, '오개전 전황판이 그대로 남음');
  assert(bad.gameState.flags['반'] === '흑룡반' && !bad.gameState.faction, '반 이름이 진영 칸에 그대로');
  assert(bad.dataVersion === 2, '버전 도장 안 찍힘');
  // ② 진짜 개전 세이브 — 진행을 절대 지우지 않는다
  const good = mig({ turnCount: 120, gameState: { war: { month: 4 }, faction: '그란텀 제국', flags: {} } });
  assert(good.gameState.war && good.gameState.war.month === 4, '정상 개전 진행이 삭제됨(치명)');
  assert(good.gameState.flags['개전'] === true, '정상 개전 세이브에 개전 도장 미기록');
  assert(good.gameState.faction === '그란텀 제국', '정상 진영 소실');
  // ③ 전황과 무관한 세이브는 무해 통과
  const plain = mig({ turnCount: 2, gameState: { flags: {} } });
  assert(!plain.gameState.war && plain.dataVersion === 2, '무관 세이브 손상');
});

// ═══ 5-J. 날짜 역행 + 호감도 수치 누출 (v355) ═══
// 분리 파이프라인 이후 time은 현재 일차를 모르는 추출 모델이 써서 '1일차'로 되돌아갔고,
// 매 턴 주입되는 관계 수치 메모를 모델이 "호감도 12의 반응으로"처럼 산문에 받아썼다.
function timeSandbox() {
  const c = (SRC.match(/const TIME_SLOTS = [^\n]+/) || [])[0];
  assert(c, 'TIME_SLOTS 소멸');
  return runSandbox(c + '\n' + grabFn('timeSlotIndex') + grabFn('mergeTimeValue') + grabFn('scrubMetaNumbers') + grabFn('scrubMetaData'));
}
T('날짜: 일차·시간대는 앞으로만 간다 (실행 검증)', () => {
  const sb = timeSandbox();
  const m = (c, n, sid) => sb.mergeTimeValue(c, n, sid || 'academy');
  assert(m('5일차 오후', '1일차 저녁') === '5일차 오후', '일차 역행 허용 — 1일차 왔다갔다 재발');
  assert(m('5일차 저녁', '5일차 오전') === '5일차 저녁', '같은 날 시간대 역행 허용');
  assert(m('5일차 밤', '6일차 아침') === '6일차 아침', '다음 날 진행 거부');
  assert(m('5일차 오전', '5일차 오후') === '5일차 오후', '같은 날 진행 거부');
  assert(m('5일차 오전', '저녁') === '5일차 저녁', '시간대만 온 값을 현재 일차에 못 붙임');
  assert(m('5일차 밤', '오후') === '5일차 밤', '시간대만 온 역행값 허용');
  assert(m('5일차 오후', '') === '5일차 오후' && m('5일차 오후', null) === '5일차 오후', '빈 값이 시간을 지움');
  assert(m('', '1일차 새벽') === '1일차 새벽', '기준 없을 때 받아 적기 실패');
  assert(m('3일차 밤', '1일차 아침', 'timeloop') === '1일차 아침', '타임루프는 되돌아가는 게 정상인데 막음');
});
T('호감도: 산문 속 수치 메타만 지우고 일반 문장은 보존 (실행 검증)', () => {
  const sb = timeSandbox();
  const s = sb.scrubMetaNumbers;
  assert(s('호감도 12의 반응으로 세라핀이 고개를 돌렸다.') === '세라핀이 고개를 돌렸다.', '"호감도 N의 반응으로" 미제거: ' + s('호감도 12의 반응으로 세라핀이 고개를 돌렸다.'));
  assert(s('이졸데는 차갑게 답했다(호감도 10).') === '이졸데는 차갑게 답했다.', '괄호 메타 미제거: ' + s('이졸데는 차갑게 답했다(호감도 10).'));
  assert(s('[친밀도 +5] 루카스가 웃었다.') === '루카스가 웃었다.', '대괄호 증감 메타 미제거');
  assert(!/호감도|친밀도/.test(s('카산드라(호감도 35에 따른 반응)는 안경을 고쳐 썼다.')), '반응 괄호 메타 잔존');
  assert(s('그녀는 창밖을 봤다.') === '그녀는 창밖을 봤다.', '무관 문장 훼손');
  assert(s('호감도 같은 건 숫자로 못 재.') === '호감도 같은 건 숫자로 못 재.', '숫자 없는 일반 단어까지 지움(오탐)');
  const d = sb.scrubMetaData({ narration: '호감도 20의 반응으로 조용해졌다.', dialogue: [{ text: '(친밀도 30) 뭐야.' }], choices: ['말을 건다 (호감도 +3)', 7] });
  assert(d.narration === '조용해졌다.' && d.dialogue[0].text === '뭐야.' && d.choices[0] === '말을 건다' && d.choices[1] === 7,
    '응답 객체 정제 실패: ' + JSON.stringify(d));
});
T('날짜·호감도: 배선 — 추출기에 현재 시각 전달 + 쓰기/기록/화면/선택지 전 경로 정제', () => {
  const fx = grabFn('fireStateExtract');
  assert(fx.includes('[현재 시각] ${gameState.time'), '추출 모델에 현재 일차 미전달 — 일차 추측 재발');
  assert(/일차는 절대 되돌리지 마라/.test(fx), '추출 스키마의 역행 금지 문구 소멸');
  assert(fx.includes('scrubMetaData(sx)'), '추출 결과(선택지) 정제 소멸');
  assert(SRC.includes('gameState.time = mergeTimeValue(gameState.time, s.time, STORY.id)'), 'time이 가드 없이 덮어쓰기로 회귀');
  assert(!/if \(s\.time && !_isIdol\) gameState\.time = s\.time;/.test(SRC), '구 무검사 time 덮어쓰기 부활');
  assert(/scrubMetaData\(parsed\); \} catch \{\}\n\s*gameHistory\.push\(\{ role: 'assistant', content: JSON\.stringify\(parsed\) \}\)/.test(SRC), '기록 저장 전 정제 소멸 — 모델이 자기 기록을 따라 씀');
  assert(/d\.text = scrubMetaNumbers\(d\.text\)/.test(grabFn('enqueueLine')), '스트리밍 줄 정제 소멸');
  assert(/scrubMetaNumbers\(c\)/.test(grabFn('showChoices')), '선택지 정제 소멸');
  assert(SRC.includes('게임 수치·메타 노출 절대 금지'), '엔진 공통 메타 노출 금지 규칙 소멸');
  assert(SRC.includes('GM 내부 메모 — 아래 숫자·단계는 산문·대사·선택지에 절대 쓰지 마라'), '관계 수치 주입부의 비공개 표시 소멸');
});
T('날짜·호감도: 오염 세이브 복구 마이그레이션 v2→v3 (실행 검증)', () => {
  const m = SRC.match(/const SAVE_MIGRATIONS = \{[\s\S]*?\n\};/);
  assert(m, 'SAVE_MIGRATIONS 블록 추출 실패');
  const c = (SRC.match(/const TIME_SLOTS = [^\n]+/) || [])[0];
  const sb = runSandbox(c + '\n' + grabFn('timeSlotIndex') + grabFn('mergeTimeValue') + grabFn('scrubMetaNumbers') + grabFn('scrubMetaData')
    + m[0].replace('const SAVE_MIGRATIONS', 'var SAVE_MIGRATIONS'));
  const mig = sb.SAVE_MIGRATIONS[2];
  assert(typeof mig === 'function', 'v2→v3 변환기 없음');
  const A = (time, narr) => ({ role: 'assistant', content: JSON.stringify({ narration: narr || '', state_update: time ? { time } : null }) });
  const save = { dataVersion: 2, turnCount: 40, gameState: { time: '1일차 저녁', flags: {} }, gameHistory: [
    A('3일차 아침'), { role: 'user', content: '호감도 올리기' }, A('4일차 오후'), A('1일차 저녁', '호감도 12의 반응으로 세라핀이 웃었다.'), A(null), A('4일차 밤'),
  ] };
  const out = mig(save, 'academy');
  assert(out.dataVersion === 3, '버전 도장 안 찍힘');
  assert(out.gameState.time === '4일차 밤', '역행으로 망가진 날짜 미복구: ' + out.gameState.time);
  assert(!out.gameHistory[3].content.includes('호감도 12'), '기록 속 수치 메타 미정제');
  assert(out.gameHistory[1].content === '호감도 올리기', '유저 입력까지 건드림');
  const loop = mig({ dataVersion: 2, gameState: { time: '1일차 아침' }, gameHistory: [A('3일차 밤')] }, 'timeloop');
  assert(loop.gameState.time === '1일차 아침', '타임루프 세이브 날짜를 강제로 밀어버림');
});

// ═══ 5-K. 악역의생존법 BGM — 시간대 매칭 + 랜덤 이어재생 (v356) ═══
T('BGM: academy 곡 등록 + 시간대/감정 매칭 + 끝나면 다른 곡 랜덤 (실행 검증)', () => {
  assert(/academy: \{ day:5, dusk:3, night:6, emotional:2 \}/.test(SRC), 'academy BGM 트랙 수 등록 소멸(R2 16곡)');
  const i = SRC.indexOf('  function catFor(mood) {');
  assert(i > 0, 'catFor 소멸');
  const body = SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
  const env = { STORY: { id: 'academy' }, gameState: { time: '' } };
  const sb = runSandbox('var MOOD_MAP = { calm:"daily" }; var sid = () => STORY.id;\n' + body, env);
  const cat = (sidv, time, mood) => { sb.STORY.id = sidv; sb.gameState.time = time; return sb.catFor(mood); };
  assert(cat('academy', '3일차 오전', 'calm') === 'day', '낮 매칭 실패');
  assert(cat('academy', '3일차 저녁', 'tension') === 'dusk', '황혼 매칭 실패');
  assert(cat('academy', '3일차 밤', 'calm') === 'night' && cat('academy', '4일차 새벽', 'none') === 'night', '밤 매칭 실패');
  assert(cat('academy', '3일차 밤', 'romance') === 'emotional' && cat('academy', '3일차 오후', 'sad') === 'emotional', '감정 장면 서정곡 매칭 실패');
  assert(cat('lovediary', '3일차 밤', 'calm') === 'daily', '타 스토리 무드 매핑 오염');
  const amb = SRC.slice(SRC.indexOf('const Ambient = (() => {'), SRC.indexOf('// ===== SCREEN FX'));
  assert(/addEventListener\('ended'/.test(amb) && /playTrack\(cat, n, key\)/.test(amb),
    '곡 종료 시 랜덤 이어재생 소멸(한 곡 무한반복으로 회귀)');
  // 유저 지정: 웬만하면 The Architect's Lullaby가 자주 — 실제 추첨 분포로 검증
  const j = amb.indexOf('  function pickTrackKey(');
  const pk = amb.slice(j, amb.indexOf('\n  }\n', j) + 4);
  const fav = (amb.match(/const FAVOR = [^\n]+/) || [])[0];
  assert(pk && fav, '선호곡 추첨 코드 소멸');
  const sb2 = runSandbox('var TRACKS = { academy: { day:5, dusk:3, night:6, emotional:2 } }; var sid = () => "academy";\n' + fav + '\n' + pk);
  let lull = 0, last = '', repeat = 0;
  for (let k = 0; k < 4000; k++) {
    const key = sb2.pickTrackKey('day', 5, last);
    if (key.startsWith('emotional_')) lull++;
    if (key === last) repeat++;
    last = key;
  }
  assert(lull / 4000 > 0.45, "Architect's Lullaby 비율이 낮음(자주 나오게 지정): " + (lull / 40).toFixed(1) + '%');
  assert(repeat === 0, '같은 곡 연속 재생 ' + repeat + '회');
});

// ═══ 5-C. cg 씬키 오선택 방지 — 실측 의미 사전 71키 전수 커버 + s_ 접촉금지 (v343) ═══
T('cg: 씬키별 실측 의미 사전이 71키 전부 커버 + cgBlock 주입 + s_ 접촉금지', () => {
  // 씬키 의미 사전(실측 기반)이 존재하고, 유효 씬키 71개를 하나도 빠짐없이 정의해야 한다.
  //   누락된 키는 cgBlock에서 "이름만" 노출돼 모델이 오선택(커플 밀착에 솔로 s_sit_spread) 재발.
  const m = SRC.match(/const CG_SCENE_MEANINGS = \{([\s\S]*?)\n\};/);
  assert(m, 'CG_SCENE_MEANINGS 상수 소멸');
  const dict = m[1];
  const keys = [];
  ['CG_SCENES_BASE', 'CG_SCENES_EXTRA'].forEach(n => {
    const mm = SRC.match(new RegExp('const ' + n + ' = \\[([^\\]]*)\\];'));
    mm[1].split(',').forEach(x => { const k = x.trim().replace(/['"]/g, ''); if (k) keys.push(k); });
  });
  assert(keys.length === 71, '유효 씬키 수 변화(' + keys.length + ') — 사전 커버 재점검 필요');
  const missing = keys.filter(k => !new RegExp('\\b' + k + '\\s*:').test(dict));
  assert(missing.length === 0, '씬키 의미 누락(이름 노출→오선택 재발): ' + missing.join(', '));
  // cgBlock이 이름이 아니라 의미 사전을 주입하는가
  assert(SRC.includes('CG_SCENE_MEANINGS[k]'), 'cgBlock이 씬키 의미를 주입하지 않음(이름만 노출)');
  // s_ 접촉금지 규칙 유지
  assert(/파트너와 몸이 닿는 장면엔 s_ 절대 금지/.test(SRC),
    's_ 접촉금지 규정 소멸 — 커플 밀착에 솔로 씬키 재발');
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

// ═══ 결과 출력 (async 테스트 완료 대기 후) ═══
Promise.all(asyncJobs).then(() => {
  const fails = results.filter(r => r[0] === 'FAIL');
  for (const [st, name] of results) console.log((st === 'PASS' ? '  ✓ ' : '  ✗ ') + name);
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' 통과' + (fails.length ? ' — ★실패 ' + fails.length + '건' : ''));
  process.exit(fails.length ? 1 : 0);
});
