/* Hogwarts canon bridge: date-driven offscreen 7-book chronology.
   Chapter dates other than verified landmark dates are pacing estimates, not
   historical claims. Canon statuses and player knowledge remain separate.
   No AI call may independently advance the canonical world. */
(function(root,factory) {
  'use strict';
  const api=factory();
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  if(root) root.PandoraHogwartsBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const BASE='storypacks/hogwarts-au/';
  let cached=null,loading=null,loadError=null;
  const ISODAY=86400000;
  const FIRST_YEAR_CHAPTERS={
    1:'1991-08-01',2:'1991-08-08',3:'1991-08-15',4:'1991-08-22',
    5:'1991-08-29',6:'1991-09-01',7:'1991-09-01',8:'1991-09-09',
    9:'1991-09-22',10:'1991-10-31',11:'1991-11-10',12:'1991-12-25',
    13:'1992-02-12',14:'1992-04-07',15:'1992-05-18',
    16:'1992-06-07',17:'1992-06-12'
  };
  function day(date,add){return new Date(Date.parse(date+'T00:00:00Z')+add*ISODAY).toISOString().slice(0,10);}
  function spreadChapters(chapters,from,to){
    const span=Math.max(0,Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/ISODAY));
    const result={};const n=chapters.length;
    chapters.forEach((c,i)=>{result[c]=day(from,n<=1?0:Math.floor(i*span/(n-1)));});
    return result;
  }
  function schedule(ledger){
    const dates={};
    for(let b=1;b<=7;b++){
      const year=1990+b;
      const byPeriod={};
      for(const e of ledger.events.filter(e=>e.book===b))
        (byPeriod[e.period]||(byPeriod[e.period]=new Set())).add(e.chapter);
      const phaseWindow={
        summer:[year+'-07-01',year+'-08-31'],
        autumn:[year+'-09-01',year+'-11-30'],
        winter:[year+'-12-01',(year+1)+'-02-28'],
        spring:[(year+1)+'-03-01',(year+1)+'-05-31'],
        finale:[(year+1)+'-06-01',(year+1)+'-06-30']
      };
      // Book 7's final battle is May 2, 1998, not June.
      // Its preceding spring chapters must also fit before May 2: otherwise
      // the monotonic-date guard would silently push the battle to May 31.
      if(b===7) {
        phaseWindow.spring=['1998-03-01','1998-05-01'];
        phaseWindow.finale=['1998-05-02','1998-05-02'];
      }
      const cDate={};
      for(const [phase,chapters] of Object.entries(byPeriod)){
        const win=phaseWindow[phase];
        if(!win)throw Error('Unknown Hogwarts period '+phase);
        Object.assign(cDate,spreadChapters([...chapters],win[0],win[1]));
      }
      if(b===1)Object.assign(cDate,FIRST_YEAR_CHAPTERS);
      for(const e of ledger.events)if(e.book===b)dates[e.id]=cDate[e.chapter];
    }
    // The chronicle was authored in causal order; pacing dates must not run backwards.
    let previous='1900-01-01';
    for(const e of ledger.events){
      if(dates[e.id]<previous)dates[e.id]=previous;
      previous=dates[e.id];
    }
    return dates;
  }
  function compile(canonEngine,index,books,cast){
    if(!canonEngine)throw Error('Hogwarts canon engine missing');
    const ledger=canonEngine.compile(index,books,cast);
    return Object.freeze({engine:canonEngine,ledger,dates:schedule(ledger)});
  }
  async function load(fetchImpl,engine){
    if(cached)return cached;
    if(loading)return loading;
    if(typeof fetchImpl!=='function')throw Error('Browser fetch required');
    if(!engine)throw Error('Hogwarts canon engine script missing');
    const files=['canon-index.json','cast.json','books/01-stone.json',
      'books/02-chamber.json','books/03-azkaban.json','books/04-goblet.json',
      'books/05-phoenix.json','books/06-prince.json','books/07-hallows.json'];
    loading=Promise.all(files.map(async file=>{
      const response=await fetchImpl(BASE+file);
      if(!response.ok)throw Error('Hogwarts canon asset '+file+': HTTP '+response.status);
      return response.json();
    })).then(data=>{
      cached=compile(engine,data[0],data.slice(2),data[1]);
      loadError=null;return cached;
    }).catch(e=>{loading=null;loadError=String(e);throw e;});
    return loading;
  }
  function restoredOrFresh(bundle,record){
    if(record && typeof record==='object'){
      try{bundle.engine.validateState(bundle.ledger,record);return record;}catch(_){}
    }
    return bundle.engine.createState();
  }
  function applyVerifiedBranch(bundle,state,decisions){
    // The player can unlock this only by collecting independent clues then
    // choosing to notify the headmaster before the chamber confrontation.
    const seal=Array.isArray(decisions)&&decisions.some(x=>x.id==='stone_finale'&&x.choice==='preempt');
    if(!seal)return;
    const id='b01c17s01';
    const target=bundle.ledger.byId[id];
    if(!target||state.cursor>target.index||state.futureInterventions[id])return;
    bundle.engine.intervene(bundle.ledger,state,id,{
      outcome:'altered',
      reason:'플레이어의 축적된 조사 증거에 따라 교수진이 의심스러운 교수를 사건 전에 조사함',
      evidence:'world_event_choice_stone_finale_preempt',
      effects:{quirrell_exposed_early:true,stone_under_staff_guard:true}
    });
  }
  function sync(bundle,record,date,decisions){
    if(!bundle||!bundle.ledger)throw Error('Hogwarts canon bundle required');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw Error('Hogwarts date invalid');
    const state=restoredOrFresh(bundle,record);
    applyVerifiedBranch(bundle,state,decisions);
    let target=null;
    for(const e of bundle.ledger.events) {
      if(bundle.dates[e.id]<=date)target=e;
      else break;
    }
    const advanced=target?bundle.engine.advanceTo(bundle.ledger,state,target.id,{explicitWitness:false}):[];
    // A changed original confrontation cannot be silently re-run with its
    // original consequences; resolve the dependent chain via a distinct outcome.
    if(Array.isArray(decisions)&&decisions.some(x=>x.id==='stone_finale'&&x.choice==='preempt')){
      const alternatives=[
        ['b01c17s02',{quirrell_alive:false,voldemort_stage:'disembodied',stone_destroyed:true}],
        ['b01c17s03',{stone_destroyed:true}]
      ];
      for(const [id,effects] of alternatives) {
        if(state.statuses[id]==='pending')bundle.engine.resolvePending(bundle.ledger,state,id,{
          outcome:'altered',
          reason:'플레이어의 조기 조사로 원작과 다른 경로로 마법사의 돌 사건이 마무리됨',
          evidence:'world_event_choice_preempt_alternative',effects
        });
      }
    }
    return {state,advanced:advanced.map(x=>({id:x.id,outcome:x.outcome})),
      progress:bundle.engine.progress(bundle.ledger,state)};
  }
  function context(bundle,state){
    if(!bundle||!state)return '';
    const p=bundle.engine.progress(bundle.ledger,state);
    const publicFacts=bundle.engine.publicNews(bundle.ledger,state,8);
    const recent=publicFacts.map(x=>'- '+x.fact).join('\n');
    const diverged=Object.entries(state.statuses).filter(x=>x[1]!=='canonical').slice(-8);
    return '\n\n## 호그와트 사건 장부(게임 시스템 확정; NPC 미래 지식 아님)\n'
      +'- 이 세계에서 이미 지난 원작 사건 '+p.committed+'/'+p.total+'개. 발생하지 않은 미래 사건을 현재 일로 말하지 마라.\n'
      +(state.world.trio_formed===true
        ? '- 현재 관계: 해리·론·헤르미온느 세 사람의 우정이 형성됐다. 서로 도우면서도 성격과 의견이 다를 수 있다.\n'
        : '- 현재 관계: 해리와 론이 먼저 가까워졌고, 헤르미온느는 아직 두 사람과 같은 친구 무리로 굳어지기 전이다.\n')
      +'- 플레이어에게 공개된 소식만 이용해 대사와 반응을 구성하라:\n'
      +(recent||'- 아직 공개 소식 없음')+'\n'
      +(diverged.length?'- 변경된 원작 인과가 존재한다. 원래 역사대로 억지로 복원하지 마라. 변경 사건: '+diverged.map(x=>x[0]+':'+x[1]).join(', ')+'\n':'')
      +'- 비공개·GM 전용 사건은 플레이어가 목격/확인하지 않았다면 소문·대사·내레이션으로 유출시키지 마라. '
      +'정사 사건이 다른 장소에서 일어나더라도 주인공을 자동으로 현장에 이동시키지 마라.\n';
  }
  function status(){return {loaded:!!cached,error:loadError};}
  return Object.freeze({compile,load,sync,context,schedule,status,restoredOrFresh});
});