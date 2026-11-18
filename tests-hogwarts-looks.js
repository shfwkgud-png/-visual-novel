'use strict';
const assert=require('assert/strict');
const L=require('./storypacks/hogwarts-au/looks.js');
const p='sd_samples/characters/hogwarts/';
const q='sd_samples/cg/hogwarts/';
const chars={
  hermione:{img:p+'hermione/2d/1_neutral_v2.webp',emoImgs:{angry:p+'hermione/2d/3_anger_v2.webp'},
    outfits:{yule:{normal:p+'hermione/outfits/yule/1_neutral_v1.webp'}}},
  harry:{img:p+'harry/2d/1_neutral_v2.webp',
    outfits:{quidditch:{normal:p+'harry/outfits/quidditch/1_neutral_v1.webp'}}},
  ron:{img:p+'ron/2d/1_neutral.webp',
    outfits:{quidditch:{normal:p+'ron/outfits/quidditch/1_neutral_v1.webp'}}},
  empty:null
};
const scenes={
  'hermione/together':{actor:'hermione',portrait:chars.hermione.img,outfit:'default',kind:'romance',url:q+'hermione/together_v1.webp'},
  'hermione/dance':{actor:'hermione',portrait:chars.hermione.img,outfit:'yule',kind:'romance',setting:'winter ballroom',url:q+'hermione/dance_v1.webp'},
  'harry/flying':{actor:'harry',portrait:chars.harry.img,outfit:'quidditch',kind:'flying',url:q+'harry/flying_v1.webp'}
};
const before={version:1,background:'library',outfits:{},cg:null};
const ball=L.scene(before,{},'ballroom',chars,scenes,[]);
assert.equal(ball.outfits.hermione,'yule');
assert.deepEqual(before,{version:1,background:'library',outfits:{},cg:null});
assert.equal(L.sprite(chars.hermione,'angry',ball.outfits.hermione),chars.hermione.outfits.yule.normal);
assert.equal(L.sprite(chars.hermione,'angry','default'),chars.hermione.emoImgs.angry);
const explicitDefault=L.scene(ball,{visuals:{outfits:{hermione:'default'}}},'ballroom',chars,scenes,[]);
assert.equal(L.scene(explicitDefault,{},'ballroom',chars,scenes,[]).outfits.hermione,'default');
assert.deepEqual(L.scene(ball,{},'classroom',chars,scenes,[]).outfits,{});
assert.equal(L.scene(ball,{visuals:{outfits:{hermione:'yule'}}},'library',chars,scenes,[]).outfits.hermione,'yule');
const spectators=L.scene(before,{},'quidditch',chars,scenes,['harry','ron']);
assert.deepEqual(spectators.outfits,{},'a pitch backdrop never dresses spectators as players');
const flight={cg:'harry/flying',dialogue:[{char_id:'harry'}],visuals:{outfits:{harry:'quidditch'},action:'flying'}};
assert.equal(L.scene(before,flight,'quidditch',chars,scenes,[]).cg,'harry/flying');
assert.equal(L.scene(before,{...flight,visuals:{outfits:{harry:'quidditch'}}},'quidditch',chars,scenes,[]).cg,null);
assert.equal(L.scene(before,{...flight,dialogue:[]},'quidditch',chars,scenes,[]).cg,null);
const date={cg:'hermione/together',dialogue:[{char_id:'hermione'}],visuals:{cgPartner:'player',cgConsent:'mutual'}};
const dateScene=L.scene(before,date,'library',chars,scenes,[]);
assert.equal(dateScene.cg,'hermione/together');
assert.equal(L.scene(before,{...date,visuals:{cgPartner:'krum',cgConsent:'mutual'}},'library',chars,scenes,[]).cg,null);
assert.equal(L.scene(before,{...date,visuals:{cgPartner:'player'},affection:{hermione:100}},'library',chars,scenes,[]).cg,null);
assert.equal(L.scene(before,{...date,dialogue:[]},'library',chars,scenes,[]).cg,null);
assert.equal(L.scene(before,{...date,cg:{key:'hermione/together'}},'library',chars,scenes,[]).cg,null);
assert.equal(L.scene(before,{...date,cg:'unknown/together'},'library',chars,scenes,[]).cg,null);
const dance={...date,cg:'hermione/dance'};
const danceScene=L.scene(before,dance,'ballroom',chars,scenes,[]);
assert.equal(danceScene.cg,'hermione/dance');
assert.equal(L.scene(before,dance,'library',chars,scenes,[]).cg,null,'a gown CG cannot cover a uniform scene');
const changed=L.line(danceScene,{char_id:'hermione',outfit:'default'},chars,scenes);
assert.equal(changed.outfits.hermione,'default');
assert.equal(changed.cg,null);
assert.equal(danceScene.cg,'hermione/dance','line changes do not mutate recorded snapshots');
assert.deepEqual(L.line(JSON.parse(JSON.stringify(danceScene)),{},chars,scenes),danceScene);
const custom={...chars,hermione:{...chars.hermione,img:'https://example.invalid/my-own-face.webp'}};
assert.equal(L.scene(before,date,'library',custom,scenes,[]).cg,null,'custom faces do not receive a different built-in CG face');
assert.equal(L.url('hermione/together',scenes),q+'hermione/together_v1.webp');
for(const url of ['../secret.webp','https://example.invalid/picture.webp',q+'../secret.webp',q+'hermione/a.webp?token=secret'])
  assert.equal(L.url('bad',{bad:{url}}),null);
assert.deepEqual(L.snapshot(JSON.parse('{"__proto__":"yule","hermione":"not-an-outfit","unknown":"yule","harry":"quidditch"}'),chars),{harry:'quidditch'});
assert.deepEqual(L.snapshot([],chars),{});
assert.deepEqual(L.scene(undefined,{},null,chars,scenes,[]).outfits,{});
assert.equal(L.prompt({}, {}, {}),'');
const prompt=L.prompt(chars,scenes,ball);
assert(prompt.includes('hermione/dance'));
assert(prompt.includes('winter ballroom'));
assert(prompt.includes('cgPartner="player"'));
assert(prompt.includes('관중을 경기복으로 갈아입히지'));
assert(!L.prompt(custom,scenes,before).includes('hermione/together('));
console.log('PASS Hogwarts looks: wardrobe fallback, spectators, player-only mutual CG, appearance consistency, history snapshots and legacy defaults');
