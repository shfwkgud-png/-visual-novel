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
  const cgPath=url=>typeof url==='string'&&/^sd_samples\/cg\/hogwarts\/[a-z0-9_/]+\.webp$/.test(url);

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
    return entry&&cgPath(entry.url)&&(!characters||sameFace(entry,characters))?entry.url:null;
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
    const pictures=Object.entries(scenes||{}).filter(([key,e])=>url(key,scenes)&&sameFace(e,characters))
      .map(([key,e])=>key+'('+e.kind+','+e.outfit+(e.setting?'; '+e.setting:'')+')');
    if(!looks.length&&!pictures.length) return '';
    return '\n\n## 호그와트 장면 의상·유저 시점 삽화\n'
      +'실제 현재 장면에 맞는 그림만 고른다. 의상은 dialogue 항목의 outfit에 default/yule/quidditch를 넣고, 복장이 바뀌는 응답에는 visuals.outfits에도 char_id별로 적는다. yule=무도회 예복, quidditch=참가 선수의 경기복이다. 관중을 경기복으로 갈아입히지 않는다. 없는 의상·CG 키는 만들지 않는다.\n'
      +'의상 목록: '+looks.join(' · ')+'\n'
      +'CG 목록: '+pictures.join(' · ')+'\n'
      +'cg는 위의 정확한 키 또는 null이다. 함께 춤·데이트·손잡기 같은 친밀한 순간이 유저와 실제로 성립한 때에만 romance 그림을 쓴다. visuals.cgPartner="player", visuals.cgConsent="mutual"를 함께 적는다. NPC끼리의 동행·춤에는 유저 시점 CG를 쓰지 않는다. 호감 점수만으로 관계·동의를 확정하지 않는다. 기존 배우자·파트너·가족 관계를 임의로 지우지 않으며, 실제 RP에서 달라진 관계가 있다면 그 경위를 따른다. 현장에 없거나 이미 죽은 인물을 삽화 때문에 등장시키지 않는다.\n'
      +'비행 CG는 실제 빗자루 탑승 장면에서만, 해당 인물의 quidditch 의상과 visuals.action="flying"을 함께 쓴다. 삽화의 복장과 현재 복장을 일치시킨다. 장면이 끝나면 cg=null. visuals는 표시 메타데이터이므로 NPC가 말로 설명하지 않는다.\n'
      +'현재 착장: '+JSON.stringify(snapshot(state?.outfits,characters));
  }
  return {snapshot,sprite,url,acceptCG,scene,line,prompt};
});
