/* Hogwarts scene outfits and first-person event illustrations. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(root) root.PandoraHogwartsLooks=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const own=(obj,key)=>!!obj&&Object.prototype.hasOwnProperty.call(obj,key);
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const idOK=id=>typeof id==='string'&&/^[a-z][a-z0-9_]*$/.test(id);
  const outfitOK=(card,key)=>key==='default'||(['yule','quidditch'].includes(key)&&own(card?.outfits,key));
  const spritePath=url=>typeof url==='string'&&/^sd_samples\/characters\/hogwarts\/[a-z0-9_/]+\.webp$/.test(url);
  const cgPath=(url,key)=>typeof url==='string'&&(
    /^sd_samples\/cg\/hogwarts\/[a-z0-9_/]+\.webp$/.test(url)||
    (/^[a-z][a-z0-9_]*\/(deepthroat|facial)$/.test(key)&&url===`r2:nsfw_hogwarts_${key.replace('/','_')}`)
  );

  function snapshot(outfits,characters){
    const result={};
    for(const [id,key] of Object.entries(object(outfits)))
      if(idOK(id)&&own(characters,id)&&outfitOK(characters[id],key)) result[id]=key;
    return result;
  }
  function sprite(card,emotion,outfit){
    if(!card) return null;
    if(outfit!=='default'&&outfitOK(card,outfit)){
      const images=object(card.outfits[outfit]);
      const url=images[emotion]||images.normal;
      if(spritePath(url)) return url;
    }
    return card.emoImgs?.[emotion]||card.img||null;
  }
  function url(key,scenes,characters){
    const entry=typeof key==='string'&&own(scenes,key)?scenes[key]:null;
    return entry&&cgPath(entry.url,key)&&(!characters||sameFace(entry,characters))?entry.url:null;
  }
  function sameFace(entry,characters){
    return idOK(entry?.actor)&&own(characters,entry.actor)&&characters[entry.actor]?.img===entry.portrait;
  }
  function acceptCG(data,state,characters,scenes,activeIds){
    const key=typeof data?.cg==='string'?data.cg:null;
    if(!key||!url(key,scenes)) return null;
    const entry=scenes[key],visuals=object(data.visuals);
    if(!sameFace(entry,characters)) return null;
    const present=new Set(Array.isArray(activeIds)?activeIds:[]);
    for(const line of Array.isArray(data.dialogue)?data.dialogue:[]) if(idOK(line?.char_id)) present.add(line.char_id);
    if(!present.has(entry.actor)) return null;
    const outfit=state.outfits[entry.actor]||'default';
    if(entry.outfit!==outfit) return null;
    if(entry.kind==='romance'){
      if(visuals.cgPartner!=='player'||visuals.cgConsent!=='mutual') return null;
    }else if(entry.kind==='adult'){
      if(visuals.action!=='adult'||visuals.cgPartner!=='player'||visuals.cgConsent!=='mutual') return null;
      if(entry.moment&&visuals.cgMoment!==entry.moment) return null;
    }else if(entry.kind==='flying'){
      if(visuals.action!=='flying'||outfit!=='quidditch') return null;
    }else return null;
    return key;
  }
  function scene(previous,data,background,characters,scenes,activeIds){
    const prior=object(previous),bg=typeof background==='string'?background:prior.background||null;
    const changed=bg!==prior.background;
    const outfits=changed?{}:snapshot(prior.outfits,characters);
    if(changed&&bg==='ballroom')
      for(const id of Object.keys(characters||{})) if(own(characters[id]?.outfits,'yule')) outfits[id]='yule';
    for(const [id,key] of Object.entries(snapshot(object(data?.visuals).outfits,characters))) outfits[id]=key;
    const next={version:1,background:bg,outfits,cg:null};
    next.cg=acceptCG(data||{},next,characters,scenes,activeIds);
    return next;
  }
  function line(previous,dialogue,characters,scenes){
    const prior=object(previous),outfits=snapshot(prior.outfits,characters);
    const id=dialogue?.char_id,key=dialogue?.outfit;
    if(idOK(id)&&own(characters,id)&&outfitOK(characters[id],key)) outfits[id]=key;
    const next={version:1,background:prior.background||null,outfits,cg:url(prior.cg,scenes)?prior.cg:null};
    if(next.cg){
      const entry=scenes[next.cg];
      if(!sameFace(entry,characters)||entry.outfit!==(outfits[entry.actor]||'default')) next.cg=null;
    }
    return next;
  }
  function prompt(characters,scenes,state){
    const looks=Object.entries(characters||{}).filter(([,c])=>c?.outfits)
      .map(([id,c])=>id+'='+Object.keys(c.outfits).filter(k=>outfitOK(c,k)).join('/'));
    const available=Object.entries(scenes||{}).filter(([key,e])=>url(key,scenes)&&sameFace(e,characters));
    const pictures=available.filter(([,e])=>e.kind!=='adult')
      .map(([key,e])=>key+'('+e.kind+','+e.outfit+(e.setting?'; '+e.setting:'')+')');
    const adultIds=[...new Set(available.filter(([key,e])=>e.kind==='adult'&&/\/(deepthroat|facial)$/.test(key)).map(([,e])=>e.actor))];
    const localAdultIds=[...new Set(available.filter(([,e])=>e.kind==='adult'&&e.moment).map(([,e])=>e.actor))];
    if(!looks.length&&!pictures.length&&!adultIds.length&&!localAdultIds.length) return '';
    return '\n\n## 호그와트 장면 의상·유저 시점 삽화\n'
      +'현장 인물이 하는 말은 dialogue에 화자별로 쓴다. 크래브=crabbe, 고일=goyle. 플레이어가 말을 건 상대는 자기 말투로 직접 답한다. 말없이 모습을 보이는 행동은 dialogue에 {"speaker":"나레이터","char_id":null,"onstage":["인물ID"],"text":"눈앞의 행동"} 형식으로 넣는다. onstage에는 이 순간 화면에 보일 한두 인물만 적는다. 다른 장소의 일이나 대화 중 언급한 사람은 빼고, 같은 행동을 narration에 중복하지 않는다.\n'
      +'실제 현재 장면에 맞는 그림만 고른다. 의상은 dialogue 항목의 outfit에 default/yule/quidditch를 넣고, 복장이 바뀌는 응답에는 visuals.outfits에도 char_id별로 적는다. yule=무도회 예복, quidditch=참가 선수의 경기복이다. 관중을 경기복으로 갈아입히지 않는다. 없는 의상·CG 키는 만들지 않는다.\n'
      +'의상 목록: '+looks.join(' · ')+'\n'
      +'CG 목록: '+pictures.join(' · ')+'\n'
      +(adultIds.length?'성인용 CG: '+adultIds.map(id=>id+'/deepthroat, '+id+'/facial').join(' · ')+'\n':'')
      +(localAdultIds.length?'추가 성인용 CG 대상: '+localAdultIds.join(', ')+' (각 인물의 /hair_tie, /cheek_pull, /resting, /hairline)\n':'')
      +'cg는 위의 정확한 키 또는 null이다. 함께 춤·데이트·손잡기 같은 친밀한 순간이 유저와 실제로 성립한 때에만 romance 그림을 쓴다. visuals.cgPartner="player", visuals.cgConsent="mutual"를 함께 적는다. NPC끼리의 동행·춤에는 유저 시점 CG를 쓰지 않는다. 호감 점수만으로 관계·동의를 확정하지 않는다. 기존 배우자·파트너·가족 관계를 임의로 지우지 않으며, 실제 RP에서 달라진 관계가 있다면 그 경위를 따른다. 현장에 없거나 이미 죽은 인물을 삽화 때문에 등장시키지 않는다.\n'
      +(adultIds.length||localAdultIds.length?'성인용 CG는 이 성인 AU에서 상호 동의한 플레이어와 해당 인물의 실제 성인 장면에서만 쓴다. visuals.action="adult", visuals.cgPartner="player", visuals.cgConsent="mutual"를 함께 적는다. /deepthroat와 /facial은 해당 행위가 실제로 진행될 때만 고른다. 해당하지 않는 장면에서는 cg=null이다.\n':'')
      +(localAdultIds.length?'추가 컷의 정확한 순서: /hair_tie=상대가 머리를 묶는 순간(visuals.cgMoment="before_deep"), /cheek_pull=머리를 묶은 뒤, 헤어라인 전 볼을 살짝 당기고 입을 보여주는 순간(visuals.cgMoment="after_hair_tie"), /hairline=딥 진행 중 플레이어가 상대의 머리카락을 누르는 순간(visuals.cgMoment="during_deep"). /resting=방 안에서 플레이어와 둘이 함께 있는 베드 장면 직전(visuals.cgMoment="before_bed")은 별개다. 이 순간이 실제 서사에 없으면 해당 CG를 쓰지 않는다. 이 네 컷 외에는 cgMoment를 쓰지 않는다.\n':'')
      +'비행 CG는 실제 빗자루 탑승 장면에서만, 해당 인물의 quidditch 의상과 visuals.action="flying"을 함께 쓴다. 삽화의 복장과 현재 복장을 일치시킨다. 장면이 끝나면 cg=null. visuals는 표시 메타데이터이므로 NPC가 말로 설명하지 않는다.\n'
      +'현재 착장: '+JSON.stringify(snapshot(state?.outfits,characters));
  }
  return {snapshot,sprite,url,acceptCG,scene,line,prompt};
});
