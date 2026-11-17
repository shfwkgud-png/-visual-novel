/* Player-authored Hogwarts character facts: separate potential, knowledge and reputation.
 * Deterministic interpretation keeps the LLM's narration from fabricating mechanical
 * skills or turning a player's private talent into NPC knowledge. No external API.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.PandoraHogwartsProfile=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function infer(raw){
    const text=String(raw||'').trim().slice(0,1800);
    const historic=/(호그와트.{0,12}역사상|역사상.{0,24}(최고|가장|천재|뛰어난)|세상에서\s*가장\s*강|최강의\s*마법사|압도적.{0,12}먼치킨|전설급\s*천재)/i.test(text);
    const genius=historic||/(천재|먼치킨|비범한\s*재능|천부적\s*재능|압도적인\s*재능|빠르게\s*익히|한번\s*보고\s*익히)/i.test(text);
    const dark=/(어둠의\s*마법|흑마법|금기\s*마법|저주).{0,24}(천부|특화|소질|재능|능숙)|(?:천부|특화|소질|재능).{0,24}(어둠의\s*마법|흑마법|금기\s*마법|저주)/i.test(text);
    const conceal=/(숨기|숨긴|숨김|숨겼|감추|감춘|감춤|은폐|평범한\s*(학생|사람)처럼|정체를\s*드러내지|실력을\s*드러내지)/i.test(text);
    const allMastered=/(이미|처음부터|입학\s*전부터).{0,32}(모든|대부분|전체).{0,12}(주문|마법).{0,22}(숙달|통달|익혔|배웠|사용할\s*수)|(?:모든|전체).{0,12}(주문|마법).{0,24}(이미|입학\s*전부터).{0,12}(숙달|통달|익혔|배웠)/i.test(text);
    const base=historic?100:genius?92:50;
    return {schemaVersion:1,description:text,configured:!!text,worldMode:'canon_centered',
      aptitude:{general:base,learning:historic?100:genius?96:50,
        control:base,dark:dark?100:genius?62:50,innovation:historic?98:genius?90:50},
      concealAbilities:conceal,allMasteredAtStart:!!allMastered,alreadyKnown:[],
      observed:{},knownBy:{},initialKnowledgeApplied:false};
  }
  function ensure(magic){
    if(!magic||typeof magic!=='object')throw Error('Hogwarts profile requires magic state');
    if(!magic.profile||magic.profile.schemaVersion!==1||!magic.profile.aptitude)
      magic.profile=infer('');
    const p=magic.profile;
    if(!p.knownBy||typeof p.knownBy!=='object')p.knownBy={};
    if(!p.observed||typeof p.observed!=='object')p.observed={};
    return p;
  }
  function configure(magic,raw,opts){
    const prev=ensure(magic),next=infer(raw);
    next.knownBy=prev.knownBy;next.observed=prev.observed;
    next.initialKnowledgeApplied=!!prev.initialKnowledgeApplied;
    next.worldMode=opts?.worldMode==='free'?'free':'canon_centered';
    const catalogue=Array.isArray(opts?.spells)?opts.spells:[];
    // Backstory knowledge must be explicit. "I'm a prodigy" is not a spellbook.
    if(/(이미|입학\s*전부터|과거에).{0,90}(배웠|익혔|숙달|시전할\s*수)/.test(next.description))
      next.alreadyKnown=catalogue.filter(sp=>[sp.name,sp.incantation].some(w=>
        String(w||'').length>=3&&next.description.toLowerCase().includes(w.toLowerCase()))).map(sp=>sp.id);
    magic.profile=next;
    if(!next.initialKnowledgeApplied){
      const candidates=next.allMasteredAtStart?catalogue:catalogue.filter(s=>next.alreadyKnown.includes(s.id));
      for(const spell of candidates){
        const rec=magic.spells[spell.id]||(magic.spells[spell.id]=
          {xp:0,attempts:0,success:0,firstLearned:null});
        const words=[spell.name,spell.incantation].filter(Boolean).map(w=>String(w).toLowerCase());
        const lower=next.description.toLowerCase();
        const at=words.map(w=>lower.indexOf(w)).find(i=>i>=0);
        const near=at>=0?lower.slice(Math.max(0,at-20),at+42):'';
        const mastered=next.allMasteredAtStart||/(숙달|통달|완벽하게\s*구사|자유자재로\s*시전)/.test(near);
        rec.xp=Math.max(rec.xp,mastered?320:90);
        if(!rec.firstLearned)rec.firstLearned='before_admission';
      }
      if(candidates.length)next.initialKnowledgeApplied=true;
    }
    return next;
  }
  function parseSetup(input,fallbackName){
    const raw=String(input||'').trim();
    const match=raw.match(/^([^/\n]{1,30})\s*\/\s*(\d{1,3})\s*살?\s*(?:\/\s*(남|여)(?:자|성)?)?\s*\/\s*([\s\S]{1,1800})$/);
    if(match)return {name:match[1].trim(),description:match[2]+'살 '+(match[3]?match[3]+'성, ':'')+match[4].trim()};
    if(raw.length<3||raw.length>1800)return null;
    const named=raw.match(/(?:내\s*이름은|이름\s*[:：]\s*)([가-힣a-zA-Z0-9_ ]{1,24})/);
    const age=raw.match(/(\d{2,3})\s*살/);
    return {name:(named?named[1].trim().replace(/[,.。].*$/,''):fallbackName)||'신입생',
      description:(age?age[1]+'살, ':'성인 학생, ')+raw};
  }
  function researchGate(magic,spell,ctx,schoolYear){
    const p=ensure(magic),year=schoolYear(ctx.date);
    if((spell.law==='dark'||spell.law==='unforgivable')&&!magic.darkAccess)
      return '천재적 소질만으로 금기마법의 지식이 생기지는 않는다. 실제 자료나 스승이 필요하다.';
    if(spell.year>year&&p.aptitude.learning<85)
      return '독학으로 학년 이상의 마법을 이해하기에는 아직 지식이 부족하다.';
    if(ctx.studyMethod==='observation'){
      if(!p.observed[spell.id])return '실제로 목격한 시전 기록이 없다. 플레이어의 관찰 선언만으로 배우지는 않는다.';
    } else if(!ctx.hasBook&&!/도서관|서고|서재|연구실|금서|비밀\s*자료|제한\s*구역/.test(String(ctx.location||''))){
      return '독학에는 실제 자료를 소지하거나 도서관·연구실로 이동해야 한다.';
    }
    if(spell.prerequisite==='lupin_mentor'&&ctx.flags?.dementor!=='study'&&!ctx.specialTraining)
      return '패트로누스는 루핀의 지도에 준하는 특별 훈련이 필요하다.';
    if(spell.prerequisite&&ctx.spellById?.[spell.prerequisite]&&
       (magic.spells[spell.prerequisite]?.xp||0)<ctx.lessonThreshold&&p.aptitude.learning<95)
      return '선행 주문을 먼저 배우거나 그 원리를 이해해야 한다.';
    return null;
  }
  function parseFreeStudy(input,findSpell){
    const s=String(input||'').trim();
    if(!s||/^▶/.test(s)||/\?|어떻게|방법|뜻|설명|알려|궁금/.test(s)||
       !/(독학|연구|연습|익히|배우|훈련|책을\s*읽|시전법을\s*파악|관찰해\s*익히)/.test(s))return null;
    const sp=findSpell(s);
    return sp?{kind:'free_study',id:sp.id,
      studyMethod:/(관찰|시범|지켜보|따라\s*해)/.test(s)?'observation':'book'}:null;
  }
  function recordObserved(magic,spellId,ctx){
    const p=ensure(magic);
    if(!ctx?.verifiedSceneEvidence||!spellId)return false;
    p.observed[spellId]={date:ctx.date||magic.lastDate,evidence:String(ctx.verifiedSceneEvidence).slice(0,120)};
    return true;
  }
  function talentBonus(magic,spell){
    const a=ensure(magic).aptitude;
    return Math.floor(Math.max(0,a.general-50)/2)+Math.floor(Math.max(0,a.control-50)/2)+
      ((spell.law==='dark'||spell.law==='unforgivable')?Math.floor(Math.max(0,a.dark-50)/6):0);
  }
  function studyMultiplier(magic,spell){
    const a=ensure(magic).aptitude;
    const focus=spell.law==='dark'||spell.law==='unforgivable'?a.dark:a.learning;
    return 1+Math.max(0,focus-50)/65;
  }
  function registerWitnesses(magic,spell,ctx,result){
    const p=ensure(magic);
    const list=Array.isArray(ctx.witnesses)?[...new Set(ctx.witnesses)]
      .filter(x=>typeof x==='string'&&/^[a-z0-9_]{1,45}$/.test(x)).slice(0,20):[];
    const hash=str=>{let n=2166136261;for(const c of str)n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return n>>>0;};
    const stealth=Math.max(6,55-Math.floor(talentBonus(magic,spell)/2));
    const witnessed=list.filter(id=>!ctx.concealAttempt||
      hash((ctx.date||magic.lastDate)+spell.id+id+String(ctx.castIndex||0))%100<stealth);
    for(const id of witnessed){
      const entry=p.knownBy[id]||(p.knownBy[id]={suspicion:0,observations:[],lastSeen:null});
      entry.suspicion=Math.min(100,(entry.suspicion||0)+(spell.difficulty>=4?28:3)+(result.success?12:0));
      entry.observations.push({date:ctx.date||magic.lastDate,spellId:spell.id,
        success:!!result.success,violation:result.violation||null});
      entry.observations=entry.observations.slice(-20);
      entry.lastSeen=ctx.date||magic.lastDate;
    }
    return witnessed;
  }
  function context(magic){
    const p=ensure(magic),a=p.aptitude;
    const known=Object.entries(p.knownBy).filter(([,v])=>v?.observations?.length)
      .map(([id,v])=>id+'(의심 '+v.suspicion+'/100, 목격 '+v.observations.length+'회)');
    return '\n- 플레이어 원설정: '+(p.description||'특별한 설정 없음')+
      '. 마법 잠재력 '+a.general+'/100, 빠른 습득 '+a.learning+'/100, 제어 '+a.control+
      '/100, 어둠의 마법 적성 '+a.dark+'/100. 재능은 주문 지식이나 숙련을 자동 부여하지 않는다.'+
      '\n- 재능 은폐 희망: '+(p.concealAbilities?'있음(하지만 플레이어가 직접 공개하면 우선)':'지정 안 됨')+
      '. NPC에게 비밀 재능을 전지적으로 알리지 않는다.'+
      '\n- NPC별 실제 목격: '+(known.join(', ')||'없음')+
      '. NPC는 직접 본 사실·전해 들은 소식만 안다. 목격되지 않은 금기 행동을 마법부에 자동 통지하지 않는다.'+
      '\n- 원작 사건은 기본대로 발생하되, 플레이어가 실제로 인과를 바꾸면 강제로 복구하지 않는다.';
  }
  return Object.freeze({infer,ensure,configure,parseSetup,researchGate,parseFreeStudy,
    recordObserved,talentBonus,studyMultiplier,registerWitnesses,context});
});
