/* 아이돌 육성 시뮬 엔진 — 「무대 뒤 3분」
 * 설계: 계산은 JS(결정론), 서술은 AI. novel.html에 인라인될 모듈.
 * 단독 테스트: node idol_sim.js            (52주 밸런스 시뮬)
 *              node idol_sim.js chart      (차트 산정 단위 확인)
 */
'use strict';

// ───────────────────────── 상수 (튜닝 지점) ─────────────────────────
const IDOL_CONST = {
  START: { 자금: 8000000, 인지도: 12, 대출: 120000000, 코어팬: 300, 라이트팬: 2000, snsAccum: 0 },
  // 점수 포화 상수 — raw/(raw+K)*100 곡선. K가 클수록 올리기 어렵다.
  // ★튜닝 기준(실측): "떴다" 지점 = 코어팬 3만 / 라이트팬 50만 → 음원 85점대
  K: { 음원: 56000, 음반: 25000, sns: 3500, 투표: 8000 },
  // 주간 자연 감소 (획득량이 이걸 못 넘으면 평형에 걸려 성장 정지 — 실측으로 하향)
  DECAY: { 라이트팬활동: 0.02, 라이트팬공백: 0.05, 코어팬: 0.004 },
  전환율: 0.02,          // 라이트팬 → 코어팬 (주간, 신뢰 비례)
  음방비용: 1000000,
  컨디션경고: 30,
  멘탈경고: 30,
};

// 음방별 실제 가중치 + 인지도 게이트
const SHOWS = {
  더쇼:        { 게이트: 10, w: { 음원: .40, 음반: .10, sns: .20, 방송: .15, 투표: .15 } },
  쇼챔피언:    { 게이트: 10, w: { 음원: .50, 음반: .00, sns: .10, 방송: .20, 투표: .20 } },
  엠카운트다운:{ 게이트: 35, w: { 음원: .45, 음반: .15, sns: .15, 방송: .10, 투표: .15 } },
  음악중심:    { 게이트: 35, w: { 음원: .50, 음반: .10, sns: .15, 방송: .10, 투표: .15 } },
  뮤직뱅크:    { 게이트: 50, w: { 음원: .65, 음반: .05, sns: .00, 방송: .20, 투표: .10 } },
  인기가요:    { 게이트: 50, w: { 음원: .55, 음반: .10, sns: .30, 방송: .10, 투표: .05 } },
};

// 멤버 (담당 축 배율)
const MEMBERS = {
  seowoo: { name: '한서우', 축: 'sns',   배율: 1.9, 진정성상한: 3 },
  miyu:   { name: '미유',   축: '음원',  배율: 1.0 },
  haram:  { name: '정하람', 축: '투표',  배율: 1.5 },
  soye:   { name: '윤소예', 축: '음반',  배율: 1.7 },
  siah:   { name: '배시아', 축: '방송',  배율: 1.6 },
};

// 행동표 — [비용, 효과함수]
const ACTIONS = {
  연습:   { 비용: 300000,  desc: '보컬·댄스↑↑ / 컨디션↓' },
  콘텐츠: { 비용: 200000,  desc: 'SNS↑↑ 라이트팬↑ / 멘탈↓' },
  음방:   { 비용: 1500000, desc: '방송점수+ 인지도↑ / 컨디션↓↓' },
  행사:   { 비용: -3200000, desc: '자금↑ 코어팬↑ / 컨디션↓' },  // 음수=수입
  휴식:   { 비용: 0,       desc: '컨디션↑↑ 멘탈↑' },
  곡작업: { 비용: 100000,  desc: '곡 완성도↑ (대표 전용)' },
};

// ───────────────────────── 상태 생성 ─────────────────────────
function newIdolState(seed) {
  const s = { ...IDOL_CONST.START };
  return {
    주차: 1, phase: 'meeting', 슬롯남음: 3,
    company: { 자금: s.자금, 인지도: s.인지도, 대출: s.대출 },
    fans: { 코어: s.코어팬, 라이트: s.라이트팬 },
    snsAccum: 0,
    album: { 곡명: null, 완성도: 0, 대중성: 0, 발매주차: null, 활동주차: 0, 이번주음방: 0 },
    members: Object.fromEntries(Object.keys(MEMBERS).map(id => [id, {
      보컬: 45 + (id === 'miyu' ? 25 : 0), 댄스: 45 + (id === 'siah' ? 25 : id === 'miyu' ? 15 : 0),
      예능: 45 + (id === 'haram' ? 20 : id === 'seowoo' ? 15 : 0),
      컨디션: 85, 멘탈: 80, 신뢰: 60,
    }])),
    rng: mulberry32(seed >>> 0),
    log: [],
  };
}

// 결정론 RNG(시드 고정 = 재현 가능)
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sat = (raw, K) => 100 * raw / (raw + K);   // 포화 곡선

// ───────────────────────── 주간 행동 적용 ─────────────────────────
/** sim = { action, members:[id], intensity:1~3, authenticity:0~3 } */
function applyAction(st, sim) {
  const a = ACTIONS[sim.action];
  if (!a) throw new Error('unknown action ' + sim.action);
  const R = st.rng, ints = sim.intensity || 2;
  const mem = (sim.members && sim.members.length ? sim.members : Object.keys(MEMBERS));
  const delta = { 라이트팬: 0, 코어팬: 0, 자금: -a.비용, 인지도: 0, sns: 0, note: '' };

  // 자금 체크(행사는 수입이라 통과)
  if (a.비용 > 0 && st.company.자금 < a.비용) return { ok: false, reason: '자금부족' };

  const avg = k => mem.reduce((s, id) => s + st.members[id][k], 0) / mem.length;

  switch (sim.action) {
    case '연습': {
      mem.forEach(id => { const m = st.members[id];
        m.보컬 = clamp(m.보컬 + 2 * ints * 0.6, 0, 100);
        m.댄스 = clamp(m.댄스 + 2 * ints * 0.6, 0, 100);
        m.컨디션 = clamp(m.컨디션 - 8 * ints / 2, 0, 100); });
      break;
    }
    case '콘텐츠': {
      const 진정성 = 1 + (sim.authenticity || 0) * 0.4;                    // 1.0~2.2
      const snsMul = mem.reduce((s, id) => s + (MEMBERS[id].축 === 'sns' ? MEMBERS[id].배율 : 1), 0) / mem.length;
      const 곡보정 = st.album.완성도 ? (0.6 + st.album.완성도 / 250) : 0.7;
      const roll = 0.8 + R() * 0.8;                                        // 0.8~1.6
      const 대박 = R() < 0.07 * 진정성;                                     // 바이럴 폭발
      // ★네트워크 효과: 팬이 많을수록 더 퍼진다 → 가속 곡선(역주행의 수학적 근거)
      const 확산 = 1 + Math.sqrt(st.fans.라이트) / 150;
      // ★무너진 멤버의 콘텐츠는 안 먹힌다(신뢰 0 → 획득 절반) = 갈아넣기 방지
      const 신뢰보정 = mem.reduce((s, id) => s + (0.5 + st.members[id].신뢰 / 200), 0) / mem.length;
      const gain = Math.round(380 * snsMul * 진정성 * 곡보정 * roll * 확산 * 신뢰보정
                              * (대박 ? 12 : 1) * (1 + st.company.인지도 / 40));
      delta.라이트팬 += gain;
      delta.sns += Math.round(18 * snsMul * 진정성 * roll * (대박 ? 6 : 1));
      delta.인지도 += 대박 ? 6 : 0.3;
      mem.forEach(id => { const m = st.members[id];
        m.컨디션 = clamp(m.컨디션 - 5, 0, 100);
        m.멘탈 = clamp(m.멘탈 - (sim.authenticity || 0) * 4, 0, 100);
        if ((sim.authenticity || 0) >= 3) m.신뢰 = clamp(m.신뢰 - 2, 0, 100); });
      if (대박) delta.note = '🔥바이럴';
      break;
    }
    case '음방': {
      if (!isActive(st)) return { ok: false, reason: '활동기아님' };
      const bMul = mem.reduce((s, id) => s + (MEMBERS[id].축 === '방송' ? MEMBERS[id].배율 : 1), 0) / mem.length;
      st.album.이번주음방 += 1;
      delta.라이트팬 += Math.round(st.company.인지도 * 8 * bMul);
      delta.코어팬 += Math.round(st.fans.라이트 * 0.005);
      delta.인지도 += 1.2;
      mem.forEach(id => { st.members[id].컨디션 = clamp(st.members[id].컨디션 - 15, 0, 100); });
      break;
    }
    case '행사': {
      // ★직접 만난 팬은 코어가 된다. 팬덤 루트가 성립하려면 이 획득이 유의미해야 함
      //   (인지도·신뢰가 높을수록 현장 전환이 커짐)
      const cMul = mem.reduce((s, id) => s + (MEMBERS[id].축 === '음반' ? MEMBERS[id].배율 : 1), 0) / mem.length;
      const 신뢰avg = mem.reduce((s, id) => s + st.members[id].신뢰, 0) / mem.length;
      delta.코어팬 += Math.round((60 + R() * 90) * cMul * (1 + st.company.인지도 / 55) * (0.6 + 신뢰avg / 160));
      delta.라이트팬 += Math.round((40 + R() * 60) * (1 + st.company.인지도 / 70));  // 현장 입소문
      delta.인지도 += 0.25;
      delta.자금 += Math.round(R() * 3000000);   // 추가 수입 변동
      mem.forEach(id => { st.members[id].컨디션 = clamp(st.members[id].컨디션 - 12, 0, 100); });
      break;
    }
    case '휴식': {
      mem.forEach(id => { const m = st.members[id];
        m.컨디션 = clamp(m.컨디션 + 25, 0, 100);
        m.멘탈 = clamp(m.멘탈 + 10, 0, 100); });
      break;
    }
    case '곡작업': {
      // ★실력이 곡 완성도의 천장을 올린다 → '연습 루트'가 성립하는 근거
      const q = 4 + avg('보컬') / 7 + avg('댄스') / 14 + (sim.concept === '실험' ? (R() < .5 ? 10 : -4) : 3);
      st.album.완성도 = clamp(st.album.완성도 + q, 0, 100);
      st.album.대중성 = clamp(st.album.대중성 + (sim.concept === '대중' ? 8 : sim.concept === '팬덤' ? 2 : 4), 0, 100);
      break;
    }
  }

  st.company.자금 += delta.자금;
  st.company.인지도 = clamp(st.company.인지도 + delta.인지도, 0, 100);
  st.fans.라이트 += delta.라이트팬;
  st.fans.코어 += delta.코어팬;
  st.snsAccum += delta.sns;
  st.슬롯남음 -= 1;
  return { ok: true, delta };
}

const isActive = st => st.album.발매주차 !== null && st.album.활동주차 > 0 && st.album.활동주차 <= 4;

/** 컴백 발매 — 좋은 곡은 그 자체로 인지도를 만든다(음원차트 진입 효과).
 *  ★이게 있어야 SNS 안 해도 인지도가 올라 음방 게이트를 넘는다 = 실력 루트 성립 */
function releaseAlbum(st) {
  st.album.발매주차 = st.주차; st.album.활동주차 = 1;
  const 곡력 = (st.album.완성도 / 100) * (st.album.대중성 / 100);
  st.company.인지도 = clamp(st.company.인지도 + 4 + 곡력 * 14, 0, 100);
  return 곡력;
}

/** 차트 결과 반영 — 순위 자체가 인지도를 만든다(1위=전국구).
 *  ★모든 루트가 "성적 → 인지도 → 더 큰 무대"의 선순환을 탈 수 있게 하는 장치 */
function applyChartResult(st, rank) {
  const gain = rank === 1 ? 9 : rank <= 3 ? 5.5 : rank <= 10 ? 2 : 0.5;
  st.company.인지도 = clamp(st.company.인지도 + gain, 0, 100);
  if (rank <= 3) st.fans.라이트 += Math.round(st.fans.라이트 * 0.06 + 800);  // 순위권 노출 유입
  return gain;
}

// ───────────────────────── 주간 마감 ─────────────────────────
function endWeek(st) {
  const active = isActive(st);
  // 자연 감소
  st.fans.라이트 = Math.round(st.fans.라이트 * (1 - (active ? IDOL_CONST.DECAY.라이트팬활동 : IDOL_CONST.DECAY.라이트팬공백)));
  st.fans.코어 = Math.round(st.fans.코어 * (1 - IDOL_CONST.DECAY.코어팬));
  // 전환(신뢰 비례)
  const 신뢰avg = Object.values(st.members).reduce((s, m) => s + m.신뢰, 0) / 5;
  st.fans.코어 += Math.round(st.fans.라이트 * IDOL_CONST.전환율 * (신뢰avg / 100));
  st.snsAccum = Math.round(st.snsAccum * 0.94);   // SNS 열기도 식는다
  // 활동주차 진행
  if (st.album.발매주차 !== null && st.album.활동주차 < 5) st.album.활동주차 += 1;
  st.album.이번주음방 = 0;
  st.주차 += 1; st.슬롯남음 = 3;
}

// ───────────────────────── 차트 점수 ─────────────────────────
/** 결집도 = 팬덤의 밀도. 코어 비중이 높을수록 투표에서 무섭다.
 *  ★팬덤 루트(행사·팬접점)의 보상 장치 — 숫자는 적어도 뭉치면 이긴다 */
function rallyOf(st) {
  const c = st.fans.코어, l = st.fans.라이트 / 3;
  return clamp(50 + 50 * (c / (c + l + 1)), 40, 100);
}

function axisScores(st, 결집도) {
  if (결집도 == null) 결집도 = rallyOf(st);
  // ★곡파워 = 팬 수와 무관한 기본 화력. 좋은 곡은 무명이어도 차트에 꽂힌다(역주행 명곡).
  //   이게 있어야 'SNS 외길'이 아니라 실력·곡 루트가 성립한다.
  const 실력 = Object.values(st.members).reduce((s, m) => s + (m.보컬 + m.댄스) / 2, 0) / 5;
  const 곡파워 = (st.album.완성도 / 100) * (st.album.대중성 / 100) * (실력 / 100) * 420000;
  const 음원raw = (st.fans.라이트 * 0.7 + st.fans.코어 * 4 + 곡파워)
                  * (st.album.완성도 / 100) * (0.4 + st.album.대중성 / 167);
  return {
    음원: sat(음원raw, IDOL_CONST.K.음원),
    음반: sat(st.fans.코어 * 2.5, IDOL_CONST.K.음반),
    sns: sat(st.snsAccum, IDOL_CONST.K.sns),
    방송: Math.min(100, st.album.이번주음방 * 25),
    투표: sat(st.fans.코어 * (결집도 / 100), IDOL_CONST.K.투표),
  };
}
function showScore(axes, show) {
  const w = SHOWS[show].w;
  return Object.keys(w).reduce((s, k) => s + axes[k] * w[k], 0);
}
const canEnter = (st, show) => st.company.인지도 >= SHOWS[show].게이트;

// ───────────────────────── 라이벌 ─────────────────────────
const RIVALS = [
  { id: 'luminous',   name: '루미나스',  강점: '음원', base: { 음원: 92, 음반: 70, sns: 55, 방송: 80, 투표: 72 }, 주기: 14, 시작: 3 },
  { id: 'veronica',   name: '베로니카',  강점: '팬덤', base: { 음원: 62, 음반: 95, sns: 50, 방송: 75, 투표: 96 }, 주기: 12, 시작: 8 },
  { id: 'halflight',  name: '하프라이트', 강점: '거울', base: { 음원: 30, 음반: 28, sns: 34, 방송: 40, 투표: 30 }, 주기: 11, 시작: 5 },
];
const rivalActive = (r, week) => ((week - r.시작) % r.주기 + r.주기) % r.주기 < 4;

function autoTeams(rng, week) {
  const out = [];
  // [최소팀, 최대팀, 최소점, 최대점, 티어] — 점수는 0~100 스케일(플레이어 총점과 동일 축)
  // ★S티어는 '분기 1~2회'라 확률 8%로만 등장(매주 벽이 서면 게임이 안 됨)
  const tiers = [[0, 0, 82, 98, 'S'], [0, 2, 55, 78, 'A'], [3, 6, 25, 52, 'B'], [4, 8, 6, 25, 'C']];
  const 음절1 = '루노베시아엘하미레', 음절2 = '나아엘온이라시', 음절3 = ['스', '즈', '', '아', '틴'];
  tiers.forEach(([lo, hi, smin, smax, t]) => {
    let n = lo + Math.floor(rng() * (hi - lo + 1));
    if (t === 'S') n = rng() < 0.08 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const nm = 음절1[Math.floor(rng() * 음절1.length)] + 음절2[Math.floor(rng() * 음절2.length)] + 음절3[Math.floor(rng() * 음절3.length)];
      out.push({ name: nm, tier: t, score: smin + rng() * (smax - smin) });
    }
  });
  return out;
}

/** 그 주 특정 음방의 순위표 */
function chartWeek(st, show, 결집도) {
  const rows = [];
  if (canEnter(st, show)) rows.push({ name: '엔코어', me: true, score: showScore(axisScores(st, 결집도), show) });
  RIVALS.forEach(r => { if (rivalActive(r, st.주차)) rows.push({ name: r.name, score: showScore(r.base, show) }); });
  autoTeams(st.rng, st.주차).forEach(t => rows.push({ name: t.name, score: t.score }));
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}

// ───────────────────────── 테스트 ─────────────────────────
if (require.main === module) {
  const mode = process.argv[2] || 'sim';
  const st = newIdolState(20260725);

  if (mode === 'chart') {
    // 성장시킨 뒤 방송별 순위 비교
    st.fans = { 코어: 9000, 라이트: 140000 }; st.snsAccum = 5200;
    st.company.인지도 = 55; st.album = { 완성도: 78, 대중성: 70, 발매주차: 1, 활동주차: 2, 이번주음방: 3 };
    const ax = axisScores(st);
    console.log('축 점수:', Object.fromEntries(Object.entries(ax).map(([k, v]) => [k, v.toFixed(1)])));
    Object.keys(SHOWS).forEach(s => {
      const rows = chartWeek(st, s);
      const me = rows.find(r => r.me);
      console.log(`${s.padEnd(7)} 게이트${String(SHOWS[s].게이트).padStart(3)} | 우리 ${me ? me.score.toFixed(1) + '점 → ' + me.rank + '위' : '출연불가'} | 1위 ${rows[0].name}(${rows[0].score.toFixed(1)})`);
    });
    return;
  }

  // 52주 밸런스 시뮬 — 단순 전략(곡작업→콘텐츠 위주, 활동기엔 음방, 자금 없으면 행사)
  console.log('주차 | 자금(만) 인지도 | 코어팬  라이트팬 | 완성도 | 이벤트');
  for (let w = 1; w <= 52; w++) {
    // 컴백 판단: 곡 완성도 70+ & 공백기면 발매
    if (st.album.완성도 >= 70 && !isActive(st) && (st.album.발매주차 === null || st.주차 - st.album.발매주차 > 8)) {
      st.album.발매주차 = st.주차; st.album.활동주차 = 1;
      console.log(`  ★ ${st.주차}주 컴백! (완성도 ${st.album.완성도.toFixed(0)} 대중성 ${st.album.대중성.toFixed(0)})`);
    }
    while (st.슬롯남음 > 0) {
      // ★SNS 루트 전략(설계 의도): 콘텐츠를 축으로, 자금·컨디션은 최소만 방어
      let act;
      const 위험 = Object.values(st.members).some(m => m.컨디션 < 30 || m.멘탈 < 30);
      if (위험) act = { action: '휴식' };
      else if (st.company.자금 < 1500000) act = { action: '행사', members: ['soye'] };
      else if (isActive(st) && st.album.이번주음방 < 1) act = { action: '음방', members: ['siah'] };
      else if (st.album.완성도 < 72 && !isActive(st) && st.슬롯남음 === 3) act = { action: '곡작업', concept: '대중' };
      else act = { action: '콘텐츠', members: ['seowoo'], authenticity: 2 };
      const r = applyAction(st, act);
      if (!r.ok) { st.슬롯남음 -= 1; continue; }
      if (r.delta.note) console.log(`     ${st.주차}주 ${act.action} ${r.delta.note} 라이트팬 +${r.delta.라이트팬.toLocaleString()}`);
    }
    if (isActive(st) && st.album.이번주음방 > 0) {
      const best = Object.keys(SHOWS).filter(s => canEnter(st, s))
        .map(s => ({ s, rows: chartWeek(st, s) })).map(o => ({ ...o, me: o.rows.find(r => r.me) }))
        .sort((a, b) => a.me.rank - b.me.rank)[0];
      if (best) console.log(`  📺 ${st.주차}주 ${best.s}: ${best.me.rank}위 (${best.me.score.toFixed(1)}점) / 1위 ${best.rows[0].name}`);
    }
    if (w % 4 === 0) {
      console.log(`${String(st.주차).padStart(3)}  | ${String(Math.round(st.company.자금 / 10000)).padStart(7)} ${String(st.company.인지도.toFixed(0)).padStart(5)} | ${String(st.fans.코어).padStart(6)} ${String(st.fans.라이트).padStart(9)} | ${String(st.album.완성도.toFixed(0)).padStart(5)}`);
    }
    endWeek(st);
    if (st.album.활동주차 > 4) { st.album.발매주차 = null; st.album.활동주차 = 0; st.album.완성도 = 0; st.album.대중성 = 0; }
  }
}

if (typeof module !== 'undefined') module.exports = { rallyOf, newIdolState, applyAction, endWeek, releaseAlbum, applyChartResult, axisScores, showScore, chartWeek, canEnter, SHOWS, MEMBERS, ACTIONS, RIVALS, IDOL_CONST };
