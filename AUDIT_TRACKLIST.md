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
- [x] P2-9 2부 전환 결정론화 — v327: eventDueTurn이 {due,chain} 반환, 체인은 간격게이트도 면제. 순차플레이 시뮬로 9개 이벤트 전부 정상 순서(45→47→49→60→90턴) 확인. 세이브 마이그레이션(밀린사건 8턴당첫만)은 EVENT_MIN_GAP으로 이미 자연히 처리됨

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
- [x] 반배정 이벤트 중복/영구폐기 — v326: due<=2 시작이벤트는 EVENT_MIN_GAP 면제
- [x] 요일·일과 미주입 — v326: 1일차=월요일 앙커로 요일 계산+담당교수 주입(academy 전용)
- [x] 정적/동적 이벤트 트리 공존 모순 — v326: "지금 일어날 사건" 블록이 우선함을 명시
- [x] 스키마 헤더 없음 — v326: "## ★출력 형식(JSON)" 헤더 추가
- [~] 중복 규칙 5종 통합 — CG씬키 이중포함(1,200자)만 제거(v326). 세계능동성·복선·완급리듬·비밀단계·이름창작금지 잔여 4종은 각각 2~4곳 산재, 안전한 통합에 시간 소요 커서 이번 라운드 보류(재발 원칙 문서화로 대체)
- [x] 정적규칙 총량 축소 — CRITICAL(MOD_CG분리, -9072자)+CG씬키중복제거로 실질 해결
- [x] _isNarrationEcho가 정당 대사 삼킴 — v326: char_id 있으면 필터 미적용
- [x] showDialogue 덮어쓰기 시 dropLogEntry 누락 — v326: 큐 폐기시 dropLogEntry, pendingDialogues는 concat
- [x] _turnLineKeys 임계 화자이름 길이 의존 — v326: 본문길이(_echoNorm)만으로 판정
- [x] _lastShownKey 리셋 안 됨(턴/세이브 경계) — v326: 턴시작 2곳+세이브로드 시 리셋 추가
- [x] 연대기 추출 마지막 4000자만 — v326: newContent 전체 사용
- [x] 연대기 60저장/30주입 절단 — v326: 주입도 60으로 통일
- [x] metChars 무제한 주입 — v326: 친밀도 상위 12명만 전체상세, 나머지 로직상 압축(META_FULL_CAP)
- [x] 스냅샷 60개 gameState 통째복사 고용량 — v326: SNAP_MAX 60→30
- [x] knows 필드 죽어있음 — v326: s.chars 병합에 knows 추가, 세이브로드 삭제 중단, 스키마 명시
- [x] 이벤트체인 null(선행사건 매인 조건 후보에서 빠짐) — P2-9(v327)에서 체인 해소로 처리됨
- [x] 저장실패 침묵(IndexedDB와 동일 뿌리) — HIGH IndexedDB onerror(v325)+P2-8 trimHistory 정상화로 처리됨

## 4장 — LOW 추가
- [x] 일차/개월 환산 스케일 불일치 — v316(TURNS_PER_MONTH)+v318(넛지 방식)로 이미 해결: 사건은 턴 기준, 시간표시는 모델재량+넛지, 강제동기화 안함이 의도된 설계
- [x] _timeSkipNote가 장면상태 무시 — v327: 직전장면이 안끝났으면 먼저 마무리 후 반영하라고 조건부 지시
- [x] background 예시가 무협 전용 키 — v327: bgKeys 자체에서 예시 3개 동적 추출
- [x] "변화없으면 넣지말것" vs 강제채움 지시 충돌(choices·cg) — v327: state_update 개별값 한정 명시, choices·cg는 예외
- [x] 스트리밍 중 배경(lastBg) 미정정 — v327: setBg()에서 currentBgFile과 함께 lastBg도 동기화
- [x] iOS Safari 16.4 미만 lookbehind 정규식 파싱실패(잠재 CRITICAL) — v327: 구분자 삽입 방식으로 대체, 0건 확인+동작 재검증 5/5
- [x] director/day 죽은 필드 — 확인 결과 director는 이미 세이브로드 시 null 처리 1줄뿐(무해), day 필드는 현재 코드에 존재하지 않음(보고서 작성 시점 이후 이미 정리된 것으로 판단)
- [x] 첫 요약 라벨링 이슈 — P2-8(v321) 해결로 트리거가 60~70턴→12턴대로 당겨져 실질 해소
