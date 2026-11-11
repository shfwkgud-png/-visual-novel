/* PANDORA: deterministic checks around model-proposed state changes.
 * No requests, DOM access, or semantic model calls. A failed review is a pending
 * turn, not a silently corrected scene. Caller owns rollback and user recovery.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PandoraConsistency = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = 1, MAX_EVENTS = 64, MAX_TRANSACTIONS = 8;
  const KINDS = new Set(['purchase', 'sale', 'payment', 'reward', 'gift', 'refund', 'loss', 'other']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => typeof value === 'string' ? value.trim() : '';
  const space = value => text(value).replace(/\s+/gu, ' ');
  const normalize = value => space(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const containsQuote = (source, quote) => !!quote && space(source).includes(space(quote));
  const issue = (code, message) => ({ code, message });
  const sceneText = data => [text(data && data.narration), ...((data && Array.isArray(data.dialogue))
    ? data.dialogue.filter(object).map(d => `${text(d.speaker)}: ${text(d.text)}`) : [])].filter(Boolean).join('\n');
  // A provider changing 'purchase' to 'payment' does not create a new event.
  const keyOf = receipt => JSON.stringify([normalize(receipt.item), normalize(receipt.counterparty), receipt.delta]);

  function readLedger(state) {
    const raw = state && state.settledEvents;
    if (raw === undefined || raw === null) return { version: VERSION, next: 1, receipts: [], invalid: false };
    const valid = object(raw) && raw.version === VERSION && Number.isSafeInteger(raw.next) && raw.next > 0
      && Array.isArray(raw.receipts) && raw.receipts.length <= MAX_EVENTS
      && raw.receipts.every(r => object(r) && typeof r.id === 'string' && r.id.length <= 80
        && KINDS.has(r.kind) && typeof r.item === 'string' && typeof r.counterparty === 'string'
        && Number.isFinite(r.delta) && r.delta !== 0 && Number.isSafeInteger(r.turn));
    if (!valid) return { version: VERSION, next: 1, receipts: [], invalid: true };
    if (new Set(raw.receipts.map(r => r.id)).size !== raw.receipts.length)
      return { version: VERSION, next: 1, receipts: [], invalid: true };
    return { version: VERSION, next: raw.next, receipts: copy(raw.receipts), invalid: false };
  }
  function ledgerToken(ledger) {
    return JSON.stringify([ledger.invalid, ledger.next, ledger.receipts.map(r => [r.id, keyOf(r)])]);
  }
  function legacyTurns(history) {
    const result = [];
    const all = Array.isArray(history) ? history : [];
    for (let i = Math.max(0, all.length - 32); i < all.length; i++) {
      const entry = all[i];
      if (!entry || entry.role !== 'assistant' || (entry._stateExtract && entry._stateExtract.status !== 'applied')) continue;
      let data;
      try { data = JSON.parse(entry.content); } catch { continue; }
      const delta = data && data.state_update && data.state_update.gold;
      if (!Number.isFinite(delta) || delta === 0) continue;
      const prose = sceneText(data);
      if (!prose) continue;
      result.push({ id: 'history:' + i, delta, prose: prose.slice(0, 16000),
        facts: Array.isArray(data.chronicle) ? data.chronicle.filter(v => typeof v === 'string').slice(0, 8).join('\n') : '' });
    }
    return result;
  }
  function createContext(options) {
    const input = object(options) ? options : {}, state = object(input.state) ? input.state : {};
    const ledger = readLedger(state);
    return { version: VERSION, turn: Number.isSafeInteger(input.turn) ? input.turn : 0,
      storyId: text(input.storyId), userText: text(input.userText), balance: Number.isFinite(state.gold) ? state.gold : null,
      location: text(state.location), time: text(state.time), ledger,
      contextToken: ledgerToken(ledger), legacy: legacyTurns(input.history),
      facts: Array.isArray(state.chronicle) ? state.chronicle.filter(v => typeof v === 'string').slice(-8).map(v => v.slice(0, 200)) : [],
      priorScenes: (Array.isArray(input.history) ? input.history : []).slice(-12).filter(h => h && h.role === 'assistant'
        && (!h._stateExtract || h._stateExtract.status === 'applied')).map(h => {
          try { return sceneText(JSON.parse(h.content)).slice(0, 16000); } catch { return ''; }
        }).filter(Boolean) };
  }
  function contextPrompt(context) {
    if (!context || context.version !== VERSION || !object(context.ledger)
        || !Array.isArray(context.ledger.receipts) || !Array.isArray(context.facts)) return '';
    const rows = context.ledger.receipts.slice(-12).map(r => `${r.id}: ${r.kind} | ${r.item} | ${r.counterparty || '상대 미상'} | ${r.delta > 0 ? '+' : ''}${r.delta}G | ${text(r.evidence).slice(0, 140)}`);
    return `\n[이번 행동과 이미 끝난 사건]\n이번 플레이어 입력: ${context.userText || '(자동 진행)'}\n현재 위치: ${context.location || '미정'} · 시각: ${context.time || '미정'}\n아래 기록은 이미 끝나 현재 상태에 반영된 일이다. 회상·요약·약속은 새 사건이 아니다. 이번 입력부터 이어가며 이전 구매·지급·첫 만남을 다시 시작하지 않는다. 실제 새 반복 행동은 이전 일과 구별되는 이번 행동과 결과를 서술한다.\n${rows.length ? '[앱이 확정한 거래 ID]\n' + rows.join('\n') : '[이전 확정 사실]\n' + (context.facts.join('\n') || '없음')}\n`;
  }
  function responseContract() {
    return '\n거래 근거: state_update.gold가 0이 아니면 최상위 transactions 배열에 모든 실제 거래를 적는다. 각 항목의 구조 예시는 {"kind":"purchase","item":"대상 물건·보상 사유","counterparty":"상대 이름","delta":-3,"evidence":"이번 장면에서 금액과 실제 주고받은 행동을 함께 보여주는 정확한 짧은 인용","action_evidence":"이번 플레이어 입력의 실제 새 거래 요청 부분을 그대로 인용. 없으면 빈 문자열","repeat_of":"같은 대상·상대·금액의 이전 거래 ID. 없으면 빈 문자열"}다. kind는 purchase, sale, payment, reward, gift, refund, loss, other 중 하나만 선택한다. delta는 예시값을 복사하지 말고 실제 부호 있는 변화량을 적으며 그 합은 gold와 같아야 한다. 회상·가정·가격 안내만으로 거래를 만들지 않는다. 같은 거래를 새로 하는 경우 기존 item/counterparty 표기를 유지하고 이번 새 행동 근거를 인용한다. NPC가 자발적으로 주는 추가 보상은 이번 별도 지급 근거를 장면에 명시한다. 새 거래가 없으면 transactions:[]이고 gold:0이다. 거래 ID는 앱이 발급하므로 새 ID를 지어내지 않는다.';
  }

  // These narrow language checks validate a quoted piece of evidence. They do
  // not infer or manufacture a balance from the prose, nor classify all actions.
  function nonActual(value) {
    return /회상|떠올|기억(?:하|했|한|난|을)|상상|가정|생각만|생각해|생각했|만약|말만|척만|농담|거짓말|취소|다고\s*치자|(?:구매|결제|지불|지급|수령|지출)하면|(?:구매했|구입했|결제했|지불했|지급했|건넸|받았|줬|샀)(?:다면|으면)|(?:지불|지급|구매|결제|수령|건네|받을).{0,6}예정|(?:살|사면|받으면|주면|낸다면|산다면).{0,12}(?:까|텐데|겠|좋|어떨)|(?:구매|결제|지급|지출|거래)(?:는|은|을|를)?\s*(?:없|안\s*하|하지\s*않)|(?:사|쓰|내|받|주|건네)지\s*않|안\s*(?:사겠다|살|산다|구매|구입|결제|지불|지급)|\b(?:remember(?:ed|ing)?|recalled?|imagined?|imagine|hypothetical|would|could|might|if|did not|do not|does not|don't|won't|wouldn't|not buying|not paying|not giving|pretend|joke|think|thinking|consider)\b/i.test(value);
  }
  function completedTransfer(value) {
    return /구매(?:했|한|한다|하였|하며)|구입(?:했|한|한다)|샀|산다|사들였|결제(?:했|한|한다)|지불|지급|지출|건넸|건넨|건네|건넵|내밀|내민|받았|받는다|받아|입금|출금|차감|획득|잃었|갚았|갚는다|주었다|줬|준다|쥐어\s*주|쥐여\s*주|챙겼|정산|\b(?:bought|buys|paid|pays|handed|hands|gave|gives|received|receives|earned|collected|lost|refunded|deducted)\b/i.test(value);
  }
  function freshPlayerAction(value) {
    const v = text(value);
    if (!v || nonActual(v)) return false;
    if (/겠(?:지|다며)|예정|할까|살까|할지|사면|(?:샀|구매했|구입했|지불했|지급했|받았|줬|건넸).{0,12}(?:말|얘기|이야기|알려|설명)/.test(v)) return false;
    return /(?:(?:구매|구입|결제|지불|지급|지출|환불|판매)(?:한다|하자|해|하겠|할게|합니다|하세요|하라)|받아|건네|돌려|갚|판다|산다|사겠|사자|사줘|사\s*주|살게|살래|사러|사도록|돈.{0,8}내|값.{0,8}내|하나\s*더|한\s*(?:장|개|권|병|잔)\s*더|추가로.{0,12}(?:줘|주세|주세요))|\b(?:buy|purchase|pay|sell|give|accept|collect|refund|take another|one more)\b/i.test(v);
  }
  function quoteNeighborhood(source, quote) {
    const full = space(source), part = space(quote), index = full.indexOf(part);
    if (index < 0 || !part) return '';
    const before = full.slice(0, index), after = full.slice(index + part.length);
    const cuts = [...before.matchAll(/[.!?,;]|그리고|하지만|그다음|그다음에|이번에는|이번엔|한 뒤|한뒤|하고 나서/gu)];
    const start = cuts.length ? cuts[cuts.length - 1].index + cuts[cuts.length - 1][0].length : 0;
    const tail = after.search(/[.!?,;]/u);
    return full.slice(start, tail < 0 ? undefined : index + part.length + tail);
  }
  function verifiedFreshAction(source, quote) {
    if (!containsQuote(source, quote) || !freshPlayerAction(quote)) return false;
    const neighborhood = quoteNeighborhood(source, quote);
    if (nonActual(neighborhood) || /할까|살까|줄까|낼까|받을까|건넬까|갚을까|팔까|할지|살지|줄지|낼지|받을지|건넬지|갚을지|팔지|사면|구매할\s*예정/.test(neighborhood)) return false;
    return true;
  }
  function explicitlyNoSpending(value) {
    return /(?:새로운\s*|새\s*|추가\s*)?(?:구매|거래|결제|지출)(?:는|은|을|를|가)?\s*(?:없(?:다|어|이|음|고|습니다)|하지\s*않|안\s*(?:한|해|하)|금지)|(?:돈|골드|동전)(?:은|는|을|를)?\s*(?:쓰지|내지|지불하지|건네지)\s*않|아무(?:것도|것)\s*사지\s*않|\b(?:no|without) (?:new |additional )?(?:purchases?|transactions?|payments?|spending)\b/i.test(value);
  }
  function newIncomingOccurrence(value) {
    return !nonActual(value) && /추가|별도|이번에는|두\s*번째|새로운|다른\s*(?:일|업무)|보너스|\b(?:another|additional|bonus|second|new)\b/i.test(value) && completedTransfer(value);
  }
  function moneyAmounts(value) {
    const names = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
      열한: 11, 열두: 12, 열세: 13, 열네: 14, 열다섯: 15, 열여섯: 16, 열일곱: 17, 열여덟: 18, 열아홉: 19, 스무: 20 };
    const unit = '(?:골드|은화|금화|은전|동전|코인|크레드|크레딧|달러|크라운|실버|닢|냥|원|엔|G\\b|gold\\b|coins?\\b|credits?\\b|dollars?\\b)';
    const number = '(?:\\d[\\d,]*(?:\\.\\d+)?(?:천|만|억)?|열여덟|열일곱|열아홉|열여섯|열다섯|열한|열두|열세|열네|다섯|여섯|일곱|여덟|아홉|스무|한|두|세|네|열)';
    const result = [];
    const regex = new RegExp('(' + number + ')\\s*' + unit + '|[$€¥]\\s*(' + number + ')|'
      + unit + '\\s*(' + number + ')(?:\\s*(?:개|닢))?(?=\\s|[을를은는이가,.!?]|$)', 'gi');
    for (const match of String(value || '').matchAll(regex)) {
      const raw = (match[1] || match[2] || match[3]).replace(/,/g, '');
      let amount = names[raw];
      if (amount === undefined) {
        const scale = /천$/.test(raw) ? 1000 : /만$/.test(raw) ? 10000 : /억$/.test(raw) ? 100000000 : 1;
        amount = Number(raw.replace(/[천만억]$/, '')) * scale;
      }
      if (Number.isFinite(amount)) result.push(amount);
    }
    return result;
  }
  function legacyMatches(context, receipt) {
    const item = normalize(receipt.item), party = normalize(receipt.counterparty), evidence = normalize(receipt.evidence);
    return context.legacy.filter(prior => {
      if (prior.delta !== receipt.delta) return false;
      const prose = normalize(prior.prose), facts = normalize(prior.facts);
      // Amount alone is never evidence of duplicate identity. Old saves have no
      // receipts; require the completed delta AND matching scene/fact evidence.
      if (evidence.length >= 14 && prose.includes(evidence)) return true;
      return item.length >= 2 && party.length >= 2 && prose.includes(item) && prose.includes(party)
        && facts.includes(item) && facts.includes(party) && moneyAmounts(prior.prose).includes(Math.abs(receipt.delta));
    });
  }
  function diagnoseScene(context, mainData) {
    const current = normalize(sceneText(mainData)), warnings = [];
    if (current.length >= 180 && context && Array.isArray(context.priorScenes)
        && context.priorScenes.some(prior => normalize(prior) === current))
      warnings.push(issue('repeated_scene', '이전 장면과 같은 본문이 반복되었습니다. 새 행동이 진행됐는지 확인이 필요합니다.'));
    return warnings;
  }
  function reviewTurn(context, mainData, stateData) {
    const result = { ok: false, issues: [], warnings: [], receipts: [], contextToken: context && context.contextToken,
      turn: context && context.turn, version: VERSION };
    const fail = (code, message) => result.issues.push(issue(code, message));
    if (!context || context.version !== VERSION || !object(context.ledger) || !Array.isArray(context.ledger.receipts)
        || !Array.isArray(context.legacy) || !Number.isSafeInteger(context.turn)
        || !object(stateData) || !object(stateData.state_update)) {
      fail('invalid_turn', '검증할 턴이나 상태 응답이 올바르지 않습니다.'); return result;
    }
    result.warnings = diagnoseScene(context, mainData);
    const proposed = stateData.state_update;
    const delta = own(proposed, 'gold') ? proposed.gold : 0;
    if (!Number.isFinite(delta)) { fail('invalid_gold', '소지금 변화는 유한한 숫자여야 합니다.'); return result; }
    const transactions = stateData.transactions === undefined ? [] : stateData.transactions;
    if (!Array.isArray(transactions) || transactions.length > MAX_TRANSACTIONS) {
      fail('invalid_transactions', '거래 근거 형식이 올바르지 않습니다.'); return result;
    }
    if (delta !== 0 && !transactions.length) {
      fail('missing_transaction_evidence', '소지금 변화에 실제 거래 근거가 없습니다. 상태를 보존했습니다.'); return result;
    }
    if (transactions.length && context.ledger.invalid) {
      fail('invalid_saved_ledger', '저장된 거래 기록을 검증할 수 없어 새 소지금 반영을 보류했습니다.'); return result;
    }
    const prose = sceneText(mainData), seenThisTurn = new Set();
    let total = 0;
    for (let i = 0; i < transactions.length; i++) {
      const raw = transactions[i];
      if (!object(raw) || !KINDS.has(raw.kind) || !Number.isFinite(raw.delta) || raw.delta === 0
          || !text(raw.item) || text(raw.item).length > 120 || text(raw.counterparty).length > 120
          || !text(raw.evidence) || text(raw.evidence).length > 1200 || text(raw.action_evidence).length > 600
          || text(raw.repeat_of).length > 80) {
        fail('invalid_transaction', '거래 종류·대상·금액·인용 근거가 올바르지 않습니다.'); continue;
      }
      const receipt = { kind: raw.kind, item: text(raw.item), counterparty: text(raw.counterparty), delta: raw.delta,
        evidence: text(raw.evidence), action_evidence: text(raw.action_evidence), repeat_of: text(raw.repeat_of),
        id: `e${Math.max(0, context.turn).toString(36)}-${(context.ledger.next + i).toString(36)}`, turn: context.turn };
      total += receipt.delta;
      if (!containsQuote(prose, receipt.evidence)) fail('unquoted_scene_evidence', '거래 근거가 이번 장면의 실제 문장과 일치하지 않습니다.');
      else if (nonActual(receipt.evidence) || nonActual(quoteNeighborhood(prose, receipt.evidence)) || !completedTransfer(receipt.evidence))
        fail('uncompleted_transaction', '회상·가정·가격 안내는 새 거래로 반영할 수 없습니다.');
      if (!moneyAmounts(receipt.evidence).includes(Math.abs(receipt.delta)))
        fail('unverified_amount', '장면에 명시된 거래 금액과 소지금 변화가 일치하지 않습니다.');
      if (receipt.action_evidence && !containsQuote(context.userText, receipt.action_evidence))
        fail('unquoted_action_evidence', '새 거래 요청의 근거가 이번 입력과 일치하지 않습니다.');
      if (receipt.delta < 0 && explicitlyNoSpending(context.userText))
        fail('spending_against_action', '이번 입력은 새 지출을 하지 않는 행동이므로 소지금 차감을 보류했습니다.');
      const signature = keyOf(receipt);
      // Two distinct, explicitly quoted transfers within one scene are permitted.
      const inTurn = signature + '\n' + normalize(receipt.evidence);
      if (seenThisTurn.has(inTurn)) fail('duplicate_in_turn', '동일한 거래 근거가 한 장면에 두 번 포함되었습니다.');
      seenThisTurn.add(inTurn);
      const matches = context.ledger.receipts.filter(r => keyOf(r) === signature);
      const older = legacyMatches(context, receipt);
      if (receipt.repeat_of) {
        const known = context.ledger.receipts.find(r => r.id === receipt.repeat_of);
        const old = older.find(r => r.id === receipt.repeat_of);
        if ((!known || keyOf(known) !== signature) && !old)
          fail('invalid_previous_event', '참조한 이전 거래 ID가 해당 거래의 확정 기록과 일치하지 않습니다.');
      }
      if (matches.length || older.length || receipt.repeat_of) {
        const fresh = verifiedFreshAction(context.userText, receipt.action_evidence);
        const incoming = receipt.delta > 0 && newIncomingOccurrence(receipt.evidence);
        if (!fresh && !incoming)
          fail('repeated_settled_event', '이미 반영된 거래와 겹치지만 이번에 새로 거래했다는 근거가 없습니다. 상태를 보존했습니다.');
      }
      result.receipts.push(receipt);
    }
    if (Math.abs(total - delta) > 1e-9) fail('transaction_total_mismatch', '거래별 변화의 합계가 소지금 변화와 일치하지 않습니다.');
    result.ok = result.issues.length === 0;
    return result;
  }
  function commit(state, review) {
    if (!object(state) || !review || !review.ok || review.version !== VERSION) throw new Error('Unreviewed state change');
    if (!review.receipts.length) return false;
    const ledger = readLedger(state);
    if (ledgerToken(ledger) !== review.contextToken) throw new Error('Settled events changed while this turn was pending');
    const ids = new Set(ledger.receipts.map(r => r.id));
    if (review.receipts.some(r => ids.has(r.id))) throw new Error('Transaction receipt was already committed');
    // Full evidence stays in the saved turn; the journal needs identity and a
    // short human-readable reminder. Identity checks never use this truncation.
    const receipts = copy(review.receipts).map(r => ({ ...r,
      evidence: Array.from(r.evidence).slice(0, 200).join(''),
      action_evidence: Array.from(r.action_evidence).slice(0, 200).join('') }));
    state.settledEvents = { version: VERSION, next: ledger.next + receipts.length,
      receipts: [...ledger.receipts, ...receipts].slice(-MAX_EVENTS) };
    return true;
  }
  return Object.freeze({ VERSION, MAX_EVENTS, createContext, contextPrompt, responseContract,
    reviewTurn, commit, diagnoseScene });
});
