/* Hogwarts AU 1991-1998 canon event scheduler for PANDORA.
   An isolated module; it does not alter PANDORA's live game engine until explicitly wired.
   Event texts are original concise factual records, not novel passages. */
(function(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PandoraHogwartsCanon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const ACCESS = new Set(['public', 'local', 'private', 'gm']);
  const DAYPHASE = ['summer', 'autumn', 'winter', 'spring', 'finale'];
  const keyOf = (book, chapter, step) =>
    'b' + String(book).padStart(2, '0') +
    'c' + String(chapter).padStart(2, '0') +
    's' + String(step).padStart(2, '0');
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function assert(cond, msg) { if (!cond) throw new Error('HP_CANON: ' + msg); }
  function isRecord(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function compile(index, books, cast) {
    assert(isRecord(index) && index.schemaVersion === 1, 'index version mismatch');
    assert(Array.isArray(books) && books.length === 7, 'all seven books are required');
    assert(isRecord(cast) && Array.isArray(cast.actors), 'cast registry required');
    const people = new Set(cast.actors.map(a => a.id));
    const seen = new Set(), events = [], byId = {};
    let chapterCount = 0;
    const windows = Array.isArray(index.seasonOrder) ? index.seasonOrder : DAYPHASE;
    for (let i = 0; i < 7; i++) {
      const b = books[i];
      assert(b.book === i + 1 && b.schemaVersion === 1, 'missing/incorrect book ' + (i + 1));
      assert(Array.isArray(b.chapters) && b.chapters.length === index.books[i].chapters,
        'chapter count mismatch book ' + b.book);
      let prevPeriod = -1;
      for (let j = 0; j < b.chapters.length; j++) {
        const ch = b.chapters[j];
        assert(ch.chapter === j + 1, 'missing book ' + b.book + ' chapter ' + (j + 1));
        assert(Array.isArray(ch.beats) && ch.beats.length, 'empty chapter ' + b.book + '/' + ch.chapter);
        assert(Array.isArray(ch.actors) && ch.actors.every(id => people.has(id)),
          'unknown character in book ' + b.book + '/' + ch.chapter);
        const pi = windows.indexOf(ch.period);
        assert(pi >= prevPeriod && pi >= 0, 'non-monotonic period in book ' + b.book + '/' + ch.chapter);
        prevPeriod = pi; chapterCount++;
        for (let k = 0; k < ch.beats.length; k++) {
          const beat = ch.beats[k];
          assert(beat.step === k + 1 && typeof beat.fact === 'string' && beat.fact.trim().length > 7,
            'incomplete beat in ' + b.book + '/' + ch.chapter);
          const access = beat.access || ch.access;
          assert(ACCESS.has(access), 'invalid access at ' + b.book + '/' + ch.chapter);
          const id = keyOf(b.book, ch.chapter, beat.step);
          assert(!seen.has(id), 'duplicate event ' + id);
          seen.add(id);
          const rec = {
            id, index: events.length, book: b.book, chapter: ch.chapter, beat: beat.step,
            chapterTitle: ch.title, period: ch.period, setting: ch.setting,
            actors: ch.actors.slice(), access, fact: beat.fact, chapterSource: b.source,
            effects: k === ch.beats.length - 1 ? clone(ch.effects || {}) : {}
          };
          assert(isRecord(rec.effects), 'effects must be a record: ' + id);
          rec.preceding = k > 0 ? [keyOf(b.book, ch.chapter, beat.step - 1)] : [];
          byId[id] = rec; events.push(rec);
        }
      }
    }
    assert(chapterCount === index.expected.chapters, 'total chapter count mismatch');
    assert(events.length === index.expected.beats, 'total event count mismatch');
    assert(Array.isArray(index.causalEdges), 'causal dependencies missing');
    const gatedBy = {};
    for (const e of index.causalEdges) {
      assert(own(byId, e.from) && own(byId, e.to), 'invalid causal edge ' + e.from + ' > ' + e.to);
      assert(byId[e.from].index < byId[e.to].index, 'backwards causal edge ' + e.from);
      if (!gatedBy[e.to]) gatedBy[e.to] = [];
      gatedBy[e.to].push({ from: e.from, why: e.why });
    }
    return Object.freeze({
      index: clone(index), cast: clone(cast), books: books.map(b => ({title:b.bookTitle,span:b.span,chapters:b.chapters.length})),
      events: Object.freeze(events), byId: Object.freeze(byId), gatedBy: Object.freeze(gatedBy)
    });
  }

  function createState() {
    return {
      schemaVersion: 1, cursor: 0, world: {
        voldemort_alive: true, harry_alive: true,
        voldemort_stage: 'disembodied', wizard_war_stage: 'underground',
        elder_wand_allegiance: 'albus'
      },
      statuses: {}, witnessed: {}, verifiedClues: {},
      futureInterventions: {}, pending: {}, journal: [], playerPlace: null
    };
  }

  function validateState(ledger, state) {
    assert(state && state.schemaVersion === 1, 'state schema mismatch');
    assert(Number.isInteger(state.cursor) && state.cursor >= 0 && state.cursor <= ledger.events.length,
      'invalid cursor');
    for (const field of ['world','statuses','witnessed','verifiedClues','futureInterventions','pending'])
      assert(isRecord(state[field]), 'missing state.' + field);
  }

  // The engine is driven by explicit passage of in-world time, never by LLM turns.
  // One scheduled canonical beat is committed on each step. A causally blocked beat
  // becomes PENDING; it is not silently rewritten to the novel's original outcome.
  function advanceOne(ledger, state, opts) {
    validateState(ledger, state);
    const event = ledger.events[state.cursor];
    if (!event) return null;
    opts = opts || {};
    let result = 'canonical', reason = '';
    const intervention = state.futureInterventions[event.id];
    const deps = (ledger.gatedBy[event.id] || []).map(x => x.from).concat(event.preceding);
    const denied = deps.filter(id => state.statuses[id] !== 'canonical');
    if (intervention) {
      result = intervention.outcome; reason = intervention.reason;
    } else if (denied.length) {
      result = 'pending'; reason = '선행 사건의 세계선 분기: ' + denied.join(',');
    }
    state.statuses[event.id] = result;
    if (result === 'canonical') {
      Object.assign(state.world, event.effects);
      const loc = opts.playerPlace || state.playerPlace;
      if (opts.explicitWitness === true && loc && loc === event.setting && event.access !== 'gm')
        state.witnessed[event.id] = '직접 현장 목격';
    } else if (result === 'altered' || result === 'prevented') {
      Object.assign(state.world, intervention.effects);
    } else if (result === 'pending') {
      state.pending[event.id] = reason;
    }
    state.journal.push({ id: event.id, outcome: result, reason });
    state.cursor++;
    return { id: event.id, outcome: result, reason };
  }

  function advanceTo(ledger, state, targetId, opts) {
    validateState(ledger, state);
    const event = ledger.byId[targetId];
    assert(event, 'unknown target ' + targetId);
    assert(event.index >= state.cursor - 1, 'rewinding requires a saved world snapshot');
    const result = [];
    while (state.cursor <= event.index) {
      const one = advanceOne(ledger, state, opts);
      if (!one) break;
      result.push(one);
    }
    return result;
  }

  // Interventions must come from the actual gameplay engine's validated actions.
  // Provide an evidence token; a mere prompt claiming to be a prophecy is insufficient.
  function intervene(ledger, state, id, options) {
    validateState(ledger, state);
    const e = ledger.byId[id];
    assert(e, 'unknown intervention ' + id);
    assert(e.index >= state.cursor, 'cannot change committed history without rewind/branch');
    assert(options && ['altered', 'prevented'].includes(options.outcome), 'outcome must be altered/prevented');
    assert(typeof options.reason === 'string' && options.reason.trim().length >= 8, 'reason required');
    assert(typeof options.evidence === 'string' && options.evidence.trim().length >= 6, 'validated evidence required');
    assert(options.outcome !== 'altered' || isRecord(options.effects), 'altered outcome needs explicit world effects');
    state.futureInterventions[id] = { outcome:options.outcome, reason:options.reason,
      evidence:options.evidence, effects:clone(options.effects || {}) };
    return true;
  }

  // For pending branches: the world must supply an alternate causal resolution,
  // not just auto-impose the original event despite a broken prerequisite.
  function resolvePending(ledger, state, id, resolution) {
    validateState(ledger, state);
    assert(state.statuses[id] === 'pending', 'event is not waiting for a branch resolution');
    assert(resolution && ['altered','prevented'].includes(resolution.outcome), 'explicit non-canonical outcome required');
    assert(typeof resolution.reason === 'string' && resolution.reason.trim().length >= 8, 'resolution reason missing');
    assert(typeof resolution.evidence === 'string' && resolution.evidence.trim().length >= 6, 'evidence missing');
    assert(resolution.outcome !== 'altered' || isRecord(resolution.effects), 'changed branch effects missing');
    state.statuses[id] = resolution.outcome;
    Object.assign(state.world, resolution.effects || {});
    delete state.pending[id];
    state.journal.push({ id, outcome:resolution.outcome, reason:resolution.reason, resolution:true });
    return true;
  }

  function observe(ledger, state, id, evidence) {
    validateState(ledger, state);
    assert(state.statuses[id] === 'canonical' || state.statuses[id] === 'altered',
      'cannot know unoccurred or unresolved event');
    assert(typeof evidence === 'string' && evidence.trim().length >= 5, 'observation evidence required');
    state.witnessed[id] = evidence;
    return true;
  }

  function playerKnowledge(ledger, state, opts) {
    validateState(ledger, state);
    opts = opts || {};
    const limit = Math.min(Math.max(opts.limit || 24, 1), 150);
    const known = [];
    for (const e of ledger.events.slice(0, state.cursor)) {
      const status = state.statuses[e.id];
      if (!['canonical','altered'].includes(status)) continue;
      const personallyKnown = own(state.witnessed, e.id);
      if (e.access !== 'public' && !personallyKnown) continue;
      if (e.access === 'gm' && !personallyKnown) continue;
      const changed=status==='altered' && [...state.journal].reverse().find(x=>x.id===e.id);
      known.push({ id:e.id, chapter:e.chapter, book:e.book, fact:changed ? changed.reason : e.fact,
        source:personallyKnown ? state.witnessed[e.id] : '공개된 사건' });
    }
    return known.slice(-limit);
  }

  function publicNews(ledger, state, limit) {
    return playerKnowledge(ledger, state, { limit:limit || 30 })
      .filter(x => x.source === '공개된 사건');
  }

  function progress(ledger, state) {
    validateState(ledger, state);
    const c = { total:ledger.events.length, committed:state.cursor, canonical:0, altered:0, prevented:0, pending:0 };
    for (const val of Object.values(state.statuses)) if (own(c,val)) c[val]++;
    return c;
  }

  function save(state) { return JSON.stringify(state); }
  function restore(ledger, serialised) {
    const state = JSON.parse(serialised);
    validateState(ledger, state);
    return state;
  }

  return Object.freeze({ keyOf, compile, createState, validateState, advanceOne, advanceTo,
    intervene, resolvePending, observe, playerKnowledge, publicNews, progress, save, restore });
});
