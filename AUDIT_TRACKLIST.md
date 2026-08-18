# 통합 감사 보고서 처리 목록 (PANDORA_통합_감사_보고서_1.md 기준)
상태: [ ]미착수 [~]확인중 [x]완료 [!]보류(사유 명시)
총 44개 (원문 불릿 직접 카운트: P0-P2 9 + CRITICAL 1 + HIGH 9 + MEDIUM 17 + LOW 8).
※ MEDIUM의 "이벤트체인null"·"저장실패침묵" 2건은 원문 스스로 P2-9·HIGH IndexedDB 항목과 동일 결함이라 표시함 — 목록에서 빼지 않고 별도 줄로 유지, 해당 항목 수정 시 함께 [x] 처리.

## 3장 — 우선순위 조치
- [x] P0-1 이벤트 커밋 시점 이동 — 재검증: catch(11690)는 _pendingEvent 안건드림, dueEventNow가 매번 최우선 확인이라 재시도 전경로에서 자동 보존됨(코드 대조 완료)
- [x] P0-2 기록모드 보류분 화면증발 — v308(재투입차단해제)+v322(streamed분기 historyMode가드 추가)로 완결
- [x] P0-3 사건 반영 확인 신호(state_update.event 매칭) — v323: 확인 안되면 최대3턴 재주입 후 포기
- [x] P1-4 time 리셋 값비교 — v320 값비교 + v322 _slotMoved 동시소멸로 완결
- [x] P1-5 time 정규화+화이트리스트 — 코드 확인: '새벽:아침' 등 별칭 6종 실제 반영됨(11854)
- [~] P1-6 choices 규칙 단일화+PRIMING_SHOTS — 문구단일화·예시교체는 v321 완료. state_update.combat 구조화는 미착수(아래 별도)
- [x] P2-7 chronicle 수신 — v321 완료(코드 확인)
- [x] P2-8 요약 트리거 자기참조 — v321 SUMMARY_KEEP 분리 완료. trimHistory는 summaryIndex 정상화(P0-1 순서결함 수정)로 부수효과도 해소
- [ ] P2-9 2부 전환 결정론화 — 미착수 (체인 처리, 세이브 마이그레이션, 시간축 스케일 불일치 포함)

## 4장 — CRITICAL 추가
- [x] ENGINE_MOD_CG 아카데미 오배송 — v324: 실측 10,240자 중 9,072자(아이돌전용)를 ENGINE_MOD_IDOL로 분리, idol에만 주입. (도중 백틱 누락으로 문법파괴 1회 발생 → node --check가 즉시 잡아 수정)

## 4장 — HIGH 추가
- [x] _slotMoved sticky(턴 경계 아닌 누적) — v322: time 실제갱신시 consumeSlotMove도 같이 호출
- [x] 친밀도 사다리 3중 주입 충돌 — v325: 상태머신 경계 45→40으로 통일, 규칙문도 41~70/71+로 정렬
- [x] 대필금지 vs 독백허용 충돌 — v325: 관찰·회상·원작지식 인출은 허용 예외 명시
- [x] v317 능동성 vs 무명원칙 충돌 — v325: 무명 원칙 있는 세계관은 NPC끼리 용무로 충족 명시
- [x] restoreSnap 되감기 dialogueLog 중복기록 — v325: replaying 플래그로 감싸 재기록 방지
- [x] 기록모드가 미재생 대사 스포일러 — v325: pending플래그+lastNonPendingIndex로 상한 도입, 시뮬검증
- [x] storySummary maxOutputTokens 부족+잘림 미검증 커밋 — v325: 600→1400, finishReason==MAX_TOKENS면 커밋안함
- [x] IndexedDB fire-and-forget — v325: onerror 핸들러로 쿼터초과 등 실패 관측 가능화
- [x] 슬롯 불러오기 순서결함(summaryIndex 늦은 대입) — v322: 트림을 summaryIndex 복원 뒤로 이동

## 4장 — MEDIUM 추가
- [ ] 반배정 이벤트 중복/영구폐기 — 미착수
- [ ] 요일·일과 미주입 — 미착수
- [ ] 정적/동적 이벤트 트리 공존 모순 — 미착수
- [ ] 스키마 헤더 없음 — 미착수
- [ ] 중복 규칙 5종 통합 — 미착수
- [ ] 정적규칙 총량 축소(MOD_CG 제거로 대부분 해결) — CRITICAL 항목과 연동
- [ ] _isNarrationEcho가 정당 대사 삼킴 — 미착수
- [ ] showDialogue 덮어쓰기 시 dropLogEntry 누락 — 미착수
- [ ] _turnLineKeys 임계 화자이름 길이 의존 — 미착수
- [ ] _lastShownKey 리셋 안 됨(턴/세이브 경계) — 미착수
- [ ] 연대기 추출 마지막 4000자만 — 미착수
- [ ] 연대기 60저장/30주입 절단 — 미착수
- [ ] metChars 무제한 주입 — 미착수
- [ ] 스냅샷 60개 gameState 통째복사 고용량 — 미착수
- [ ] knows 필드 죽어있음 — 미착수
- [ ] 이벤트체인 null(선행사건 매인 조건 후보에서 빠짐) — 원문표기상 P2-9와 동일결함, P2-9 처리시 동시 [x]
- [ ] 저장실패 침묵(IndexedDB와 동일 뿌리) — HIGH 항목과 연동, 해당 항목 처리시 동시 [x]

## 4장 — LOW 추가
- [ ] 일차/개월 환산 스케일 불일치 — P2-9와 연동
- [ ] _timeSkipNote가 장면상태 무시 — 미착수
- [ ] background 예시가 무협 전용 키 — 미착수
- [ ] "변화없으면 넣지말것" vs 강제채움 지시 충돌(choices·cg) — 미착수
- [ ] 스트리밍 중 배경(lastBg) 미정정 — 미착수
- [ ] iOS Safari 16.4 미만 lookbehind 정규식 파싱실패(잠재 CRITICAL) — 미착수
- [ ] director/day 죽은 필드 — 미착수
- [ ] 첫 요약 라벨링 이슈 — P2-8 해결시 자동 해소
