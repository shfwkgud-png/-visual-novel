'use strict';
// Prompt delivery and saved-editor compatibility, not a claim about model output quality.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const window={};
new Function('window',fs.readFileSync('storypacks/hogwarts-au/art.js','utf8'))(window);
new Function('window',fs.readFileSync('storypacks/hogwarts-au/story.js','utf8'))(window);
const story=window.PANDORA_HOGWARTS_STORY;
const src=fs.readFileSync('novel.html','utf8');
const grab=name=>{
  const start=src.indexOf('\nfunction '+name+'(');
  assert(start>=0,name);
  return src.slice(start,src.indexOf('\n}',start)+2);
};
const copy=x=>JSON.parse(JSON.stringify(x));
for(const [id,c] of Object.entries(story.characters)){
  assert.equal(typeof c.speech,'string',id+' needs its own voice cue');
  assert(c.speech.length>10,id+' voice is empty');
  assert(c.personality.includes(c.speech),id+' full card lost the voice');
  assert(!c.personality.startsWith('등장 시점, 역사적 소속'),id+' still uses the generic-only card');
}
const c=story.characters;
assert.match(story.worldLore,/나레이션과 대사에서 둘의 체격이나 주먹 크기를 과장하지 않는다/);
assert.match(story.worldLore,/지난 대화의 과장된 비유는 두 사람의 외형 설정으로 이어 쓰지 않는다/);
assert.match(c.crabbe.personality,/상대 말을 끊고 바로 되묻/);
assert.match(c.goyle.personality,/상대와 출구를 번갈아 살피/);
assert.match(c.hermione.speech,/또래.*반말.*교수.*존댓말/);
assert.match(c.hermione.personality,/서툰 다정함/);
assert.match(c.hermione.personality,/생각을 읽듯 모욕하지 않는다/);
assert.match(c.harry.speech,/짧고 솔직/);
assert.match(c.ron.speech,/농담/);
assert.match(c.snape.speech,/낮고 절제/);
assert.match(c.umbridge.speech,/상냥.*존댓말.*협박/);
assert.notEqual(c.fred.speech,c.george.speech,'twins retain individual rhythm');
assert.equal(c.deen.speech,c.dean.speech);
assert.equal(c.moaning_myrtle.speech,c.myrtle.speech);
assert.equal(c.wormtail.speech,c.pettigrew.speech);
for(const id of ['daphne','theodore','sinistra','vector'])
  assert.match(c[id].personality,/발화 자료가 적/,'do not invent canon for '+id);
for(const id of ['buckbeak','hedwig','fawkes','dementors'])
  assert.match(c[id].speech,/말.*하지|말 대신|울음|언어 대사/,'nonhuman speech '+id);
assert.match(story.worldLore,/현재 인물 카드.*과거에 잘못 생성된 어조보다 우선/);
assert.match(story.worldLore,/이미 일어난 사건과 약속·관계 변화는 보존/);

const sb={CHARACTERS:c,gameState:{metChars:{}},turnCount:0,playerName:'검증자'};
vm.createContext(sb);vm.runInContext(grab('getCharPrompt'),sb);
const first=['harry','ron','neville','luna','ginny','malfoy'];
const crowded=sb.getCharPrompt([...first,'hermione'],first);
assert(crowded.includes('헤르미온느 그레인저(hermione) — 말투: '+c.hermione.speech),
  'the seventh speaker needs a voice even outside the six full-card cap');
assert(!crowded.includes('서툰 다정함'),'brief card must stay brief');
const full=sb.getCharPrompt(['hermione','snape','ron'],['hermione']);
for(const id of ['hermione','snape','ron'])assert(full.includes(c[id].speech));
sb.CHARACTERS=Object.fromEntries([...first,'other'].map(id=>[id,{name:id,role:'동료',personality:'기존 설정'}]));
assert(sb.getCharPrompt([...first,'other'],first).includes('other(other)'));
assert(!sb.getCharPrompt([...first,'other'],first).includes('말투:'),'other stories keep their previous brief format');

function mergedCard(mine,base){
  const local={hogwarts:{...copy(story),characters:{hermione:copy(mine)},charBase:{hermione:copy(base)}}};
  const before=JSON.stringify(local);
  const env={BUILTIN_STORIES:{hogwarts:story},getLocalStories:()=>local,LEGACY_CHAR_NAMES:new Set()};
  vm.createContext(env);vm.runInContext(grab('allStories'),env);
  const result=env.allStories().hogwarts.characters.hermione;
  assert.equal(JSON.stringify(local),before,'migration is a read projection, not a save overwrite');
  return result;
}
const old={...copy(c.hermione),personality:'이전 기본 성격'};delete old.speech;
const imageEdited={...old,img:'user-owned-picture.png'};
const upgraded=mergedCard(imageEdited,old);
assert.equal(upgraded.img,imageEdited.img);
assert.equal(upgraded.personality,c.hermione.personality);
assert.equal(upgraded.speech,c.hermione.speech);
const authored={...imageEdited,personality:'이 회차는 사용자가 직접 지정한 말투와 성격을 따른다.'};
assert.equal(mergedCard(authored,old).personality,authored.personality,'explicit user character direction wins');
const newlyAuthored={...copy(c.hermione),personality:'이 회차의 헤르미온느는 친한 동급생에게 짧고 다정한 반말을 쓴다.'};
const authoredNow=mergedCard(newlyAuthored,c.hermione);
assert.equal(authoredNow.speech,newlyAuthored.personality,'a copied default voice must not override an edited persona in a brief card');
sb.CHARACTERS={...c,hermione:authoredNow};
assert(sb.getCharPrompt([...first,'hermione'],first).includes('말투: '+newlyAuthored.personality));
const explicit={...copy(c.hermione),speech:'유저가 지정한 별도 화법'};
assert.equal(mergedCard(explicit,c.hermione).speech,explicit.speech);
const removed={...copy(c.hermione),img:'user-owned-picture.png'};delete removed.speech;
assert.equal(mergedCard(removed,c.hermione).speech,undefined,'do not restore a deliberately removed field');
const oldLook={...copy(c.hermione),img:'old-default.webp',emoImgs:{normal:'old-default.webp'}};
delete oldLook.outfits;
const editedVoice={...copy(oldLook),personality:'사용자가 직접 쓴 성격은 그대로 둔다.'};
const newLook=mergedCard(editedVoice,oldLook);
assert.equal(newLook.personality,editedVoice.personality);
assert.equal(newLook.img,c.hermione.img);
assert.deepEqual(newLook.outfits,c.hermione.outfits,'untouched appearance receives the new wardrobe');
const customLook={...copy(editedVoice),outfits:{yule:{normal:'my-party-picture.webp'}}};
assert.deepEqual(mergedCard(customLook,oldLook).outfits,customLook.outfits,'a user wardrobe is never replaced');
assert.equal(mergedCard({...editedVoice,img:'my-face.webp'},oldLook).img,'my-face.webp');
console.log('PASS Hogwarts voices: 153 entries, individual rhythm, sparse-canon guards, crowd delivery and user-edit preservation');
