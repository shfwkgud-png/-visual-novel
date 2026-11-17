/* 198-chapter / 433-beat playable Hogwarts chronicle.
 * Canon JSON is source truth; this module enforces access, chronology,
 * natural encounter conditions and serialized branch memories.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.PandoraHogwartsChapters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const BASE='storypacks/hogwarts-au/chapter-playbook.json?v=3';
  const SCHOOL=['hogwarts','great_hall','quidditch_pitch','hagrids_hut','forbidden_forest',
    'hogwarts_grounds','hogsmeade','chamber_of_secrets','shrieking_shack',
    'astronomy_tower','room_requirement','hogwarts_express'];
  let installed=null,pending=null;
  function assert(check,msg){if(!check)throw Error('HOGWARTS_CHAPTERS: '+msg);}
  function entryFor(list,id){return list.byId[id]||null;}
  function compile(raw,bundle){
    assert(raw&&raw.schemaVersion===1&&Array.isArray(raw.entries),'playbook version');
    assert(bundle&&bundle.ledger&&bundle.dates,'canonical ledger required');
    assert(raw.entries.length===198,'all 198 chapters required');
    const byId={},byMajor={},beats=new Set(),bookCount={};
    for(const p of raw.entries){
      assert(/^b\d{2}c\d{2}$/.test(p.id)&&!byId[p.id],'duplicate chapter '+p.id);
      assert(p.book>=1&&p.book<=7&&Number.isInteger(p.chapter),'chapter reference');
      assert(Array.isArray(p.beats)&&p.beats.length,'empty chapter '+p.id);
      const date=bundle.dates[p.beats[0].id];
      assert(date===p.date,'chronology drift '+p.id);
      const matching=bundle.ledger.events.filter(x=>x.book===p.book&&x.chapter===p.chapter);
      assert(matching.length===p.beats.length,'beat count '+p.id);
      for(let i=0;i<p.beats.length;i++){
        const src=matching[i],step=p.beats[i];
        assert(src.id===step.id && src.fact===step.fact && src.access===step.access,'fact drift '+step.id);
        assert(!beats.has(step.id),'duplicate beat '+step.id);
        beats.add(step.id);
      }
      assert(!p.interactive || (SCHOOL.includes(p.setting) && ['public','local'].includes(p.access)),
        'private or offsite scene exposed '+p.id);
      if(p.pairedEvent)(byMajor[p.pairedEvent]||(byMajor[p.pairedEvent]=[])).push(p.id);
      bookCount[p.book]=(bookCount[p.book]||0)+1;
      byId[p.id]=p;
    }
    assert(beats.size===433,'all 433 facts required');
    for(let b=1;b<=7;b++)assert(bookCount[b]===bundle.ledger.books[b-1].chapters,'book '+b);
    const upcoming=raw.entries.filter(x=>x.interactive).sort((a,b)=>
      a.date.localeCompare(b.date)||a.slot-b.slot||a.book-b.book||a.chapter-b.chapter);
    const chapterList=raw.entries.slice().sort((a,b)=>a.book-b.book||a.chapter-b.chapter);
    return Object.freeze({raw,byId,byMajor,upcoming,chapters:chapterList,
      causalEdges:raw.causalEdges,beatsbyId:Object.fromEntries(raw.entries.flatMap(p=>p.beats.map(b=>[b.id,b]))),
      summary:{chapters:198,beats:433,interactive:upcoming.length,paired:Object.values(byMajor).flat().length,
        offscreen:raw.entries.length-upcoming.length-Object.values(byMajor).flat().length}});
  }
  async function load(fetchImpl,bundle){
    if(installed && installed.bundle===bundle)return installed.catalog;
    if(pending)return pending;
    assert(typeof fetchImpl==='function','fetch required');
    pending=(async()=>{
      const resp=await fetchImpl(BASE);
      if(!resp||!resp.ok)throw Error('Cannot load chapter-playbook.json HTTP '+resp?.status);
      const catalog=compile(await resp.json(),bundle);
      installed={bundle,catalog};return catalog;
    })();
    try{return await pending;}finally{pending=null;}
  }
  function getLoaded(){return installed?.catalog||null;}
  function eventFor(chapter,st) {
    assert(chapter&&chapter.interactive&&!chapter.pairedEvent,'chapter is not an onstage encounter');
    const actor=chapter.entryActor,options=chapter.participation.options.map((p,i)=>({
      id:p.id,label:p.label,intent:p.intent,
      delta:{},flags:{['chapter_'+chapter.id]:p.id},
      offscreen:'같은 장의 다른 인물들은 별도 일정으로 움직인다. '+p.consequence
    }));
    const prior=chapter.continuity.previous && st.finished[chapter.continuity.previous];
    const history=prior?
      (prior.choice==='skip'?' 지난번 소동을 당신이 지켜보지 않았다는 사실을 아는 사람도 있다.':' 앞선 일에서 당신이 보였던 태도를 기억하는 학생이 있다.') : '';
    return {id:chapter.id,year:chapter.book,date:chapter.date,slot:chapter.slot,
      title:chapter.title,background:chapter.background,actors:chapter.actors,
      kind:'chapter',autoStart:true,chapterId:chapter.id,
      intro:(chapter.sceneCue || chapter.arrival)+history,
      options,
      chapterFacts:chapter.beats.filter(b=>['public','local'].includes(b.access)).map(b=>({id:b.id,access:b.access})),
      endingPrompt:'당사자가 무엇을 실제로 확인했는지와 시도만 한 행동을 구분한다.'};
  }
  function nextPlayable(catalog,st,date,major){
    if(!catalog||!st||!st.finished)return null;
    const ceiling=major?.date||null;
    const paired=catalog.byMajor?.[major?.id]||[];
    const pairedChapters=paired.map(id=>catalog.byId[id]).filter(Boolean);
    const firstMajorChapter=pairedChapters.length?
      pairedChapters.reduce((min,p)=>p.book*100+p.chapter<min.book*100+min.chapter?p:min):null;
    for(const c of catalog.upcoming){
      if(c.date<date)continue;
      if(ceiling && c.date>ceiling)break;
      if(ceiling && c.date===ceiling){
        // Same-day chapters must retain book order before the flagship
        // (e.g. expulsion of Snape before the Battle of Hogwarts).
        if(!firstMajorChapter ||
          c.book*100+c.chapter>=firstMajorChapter.book*100+firstMajorChapter.chapter)break;
      }
      if(st.finished[c.id]||st.pending?.id===c.id||st.active?.id===c.id)continue;
      return eventFor(c,st);
    }
    return null;
  }
  function linkedMajor(catalog,majorId){return catalog?.byMajor[majorId]?.map(id=>catalog.byId[id])||[];}
  function decorateMajor(catalog,majorId){
    const chapters=linkedMajor(catalog,majorId);
    if(!chapters.length)return '';
    // Public/local only, not offstage GM knowledge. Act opening remains the
    // beginning; it must not prematurely narrate the canonical outcome.
    return '\n[사건과 연결된 원작 장] '+
      chapters.map(c=>c.title+'('+(c.book)+'권 '+c.chapter+'장)').join(', ')+'. '+
      '이 장의 사건은 아직 장면 안에서 진행 중이다. 원작에서 실제로 일어날 세부 결과를 첫 대사에 전부 설명하거나 결말을 미리 확정하지 마라. '+
      '현재 목격한 단서와 인물의 입장에 맞게 진행하며, 플레이어가 선택한 개입 경로와 인과가 충돌하면 원작의 자동 복원은 금지된다.';
  }
  function createState(){
    return {schemaVersion:1,chapterStatus:{},recent:[],lastSyncDate:null,majorUsed:{}};
  }
  function valid(s){return !!(s&&s.schemaVersion===1&&s.chapterStatus&&typeof s.chapterStatus==='object'&&
    Array.isArray(s.recent));}
  function sync(catalog,state,date,canonState,worldState){
    assert(valid(state),'invalid chapter state');
    assert(catalog&&canonState&&typeof date==='string','missing canon data');
    const marked=[];
    for(const c of catalog.chapters){
      if(c.date>date)continue;
      const prior=state.chapterStatus[c.id];
      const outcomes=c.beats.map(x=>canonState.statuses[x.id]||'unresolved');
      if(outcomes.some(x=>x==='unresolved'))continue;
      const interaction=worldState?.finished?.[c.id]||
        (c.pairedEvent&&worldState?.finished?.[c.pairedEvent]);
      const status=outcomes.some(x=>x==='pending')?'causally_unresolved':
        outcomes.some(x=>x==='altered'||x==='prevented')?'altered':
        interaction?'participated':c.access==='gm'||c.access==='private'?'private_offscreen':'offscreen';
      const entry={date:c.date,status,exposure:c.exposure,
        choice:interaction?.choice||null,beats:c.beats.map(x=>x.id)};
      if(prior&&prior.status===entry.status&&prior.choice===entry.choice)continue;
      state.chapterStatus[c.id]=entry;marked.push(c.id);
      if(prior)state.recent=state.recent.filter(x=>x.id!==c.id);
      if(['public','local'].includes(c.access)){
        state.recent.push({id:c.id,title:c.title,status,
          publicBeatIds:c.visibleBeats.slice(),choice:entry.choice});
      }
    }
    state.recent=state.recent.slice(-36);
    state.lastSyncDate=date;
    return {marked,newlyRecorded:marked.length,totalRecorded:Object.keys(state.chapterStatus).length};
  }
  function unsafeBeat(chapter,beatId,canonState,directPresence){
    const b=chapter.beats.find(x=>x.id===beatId);
    if(!b||!canonState)return null;
    // Even altered/pending events stay private if the player did not have
    // legitimate access. No meta hint about a secret GM event may leak.
    if(b.access==='gm'||b.access==='private')return null;
    if(b.access==='local'&&!directPresence)return null;
    const status=canonState.statuses[beatId];
    if(status==='pending')return {id:beatId,narration:'상황이 예상과 다르게 흘렀고, 현장에선 아직 결말을 확정하지 못했다.',status};
    if(status==='altered'||status==='prevented')return {id:beatId,narration:'사건은 예상과 다르게 전개되었고, 관련 인물들이 다음 행동을 준비하기 시작했다.',status};
    if(status!=='canonical')return null;
    return {id:beatId,narration:b.fact,status};
  }
  function ending(catalog,id,worldState,canonState){
    const c=catalog?.byId?.[id];if(!c||!worldState?.finished?.[id]||!canonState)return null;
    const record=worldState.finished[id],selection=record.choice;
    const option=c.participation.options.find(x=>x.id===selection);
    const direct=selection!=='skip';
    const texts=[];
    for(const b of c.beats){const allowed=unsafeBeat(c,b.id,canonState,direct);if(allowed)texts.push(allowed.narration);}
    const results=texts.length?texts.join(' '):'정확한 사정은 아직 알려지지 않았다. 자리에 없었던 사람들에 대해서는 누구도 섣불리 단정하지 않는다.';
    const result=option?.consequence||(selection==='freeform'?'당신이 실제로 시도한 행동은 기록에 남는다.':'플레이어의 참여 여부와 무관하게 다른 인물의 시간은 흐른다.');
    return {
      narration:'「'+c.title+'」의 일이 지나간 뒤, 학생들은 저마다 보고 들은 일을 이야기했다. '+results+'\n\n'+(selection==='skip'?'당신은 그 현장을 떠났고, 다른 인물들은 각자의 시간 속에서 움직였다.':'당신이 한 행동을 기억하는 사람들이 남았다.'),
      dialogue:[],background:null,resetSprites:false
    };
  }
  // Chronological, one-beat-at-a-time presentation AFTER the scene resolves.
  // This is a visible result, not a new player choice. Original facts only
  // display if canonical, public (or witnessed locally); private/GM never leak.
  function outcomeSequence(catalog,eventId,world,canonState){
    if(!catalog||!canonState||!world?.finished?.[eventId])return [];
    const own=catalog.byId[eventId]?[catalog.byId[eventId]]:[];
    const linked=catalog.byMajor[eventId]?.map(id=>catalog.byId[id])||[];
    const chapters=own.concat(linked).filter(Boolean);
    if(!chapters.length)return [];
    const direct=world.finished[eventId].choice!=='skip';
    const sequence=[];
    for(const chapter of chapters)for(const beat of chapter.beats) {
      const visible=unsafeBeat(chapter,beat.id,canonState,direct);
      if(!visible)continue;
      const changed=visible.status!=='canonical';
      const headline=changed?'예상과 달라진 소식':chapter.title;
      sequence.push({
        id:'canon_'+beat.id,chapterId:chapter.id,beatId:beat.id,
        background:chapter.background,
        narration:(sequence.length?'한편, ':'')+headline+'. '+visible.narration,
        access:beat.access,status:visible.status
      });
    }
    return sequence;
  }
  function currentContext(catalog,state,world,canonState){
    if(!catalog||!valid(state))return '';
    const played=Object.entries(world?.finished||{}).filter(([id])=>/^b\d{2}c\d{2}$/.test(id)).slice(-7);
    const recent=state.recent.slice(-5).flatMap(x=>{
      const ch=catalog.byId[x.id];if(!ch||x.status==='causally_unresolved')return [];
      const publicFacts=ch.beats.filter(b=>b.access==='public'&&canonState?.statuses[b.id]==='canonical');
      return publicFacts.length?['- '+ch.title+': '+publicFacts.map(b=>b.fact).join(' ')]:[];
    }).join('\n');
    return '\n\n## 198장 개별 장면 기록\n'
      +'- 시간표를 통과한 장: '+Object.keys(state.chapterStatus).length+'/198. '
      +'그중 플레이어가 직접 참여한 장: '+played.length+'(최근 기록 기준).\n'
      +'- 장마다 등장 장소와 직접 목격/비공개/GM 정보를 분리한다. 다른 장소의 비밀 장면을 주인공에게 보여 주거나 기억시키지 마라.\n'
      +'- 최근 공개 사실(확인된 것만):\n'+(recent||'- 아직 없음')+'\n'
      +'- 인과관계가 끊긴 사건은 원작 결말을 강제로 복구하지 마라. 원인을 공개적으로 알 수 없는 경우 새 전개를 사실처럼 선포하지 말고 조사와 후속 행동으로 해결하라.\n';
  }
  return Object.freeze({compile,load,getLoaded,eventFor,nextPlayable,linkedMajor,decorateMajor,
    createState,valid,sync,unsafeBeat,ending,outcomeSequence,currentContext});
});