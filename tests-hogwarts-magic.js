'use strict';
// node tests-hogwarts-magic.js — SFW magic education, exams, legality, no API.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const M=require('./storypacks/hogwarts-au/magic.js');
const SPELLS=M.SPELLS,SUBJECTS=M.SUBJECTS;
assert.equal(SPELLS.length,51);
assert.equal(SUBJECTS.length,14);
assert.equal(new Set(SPELLS.map(x=>x.id)).size,51);
assert.equal(new Set(SUBJECTS.map(x=>x.id)).size,14);
const core=SUBJECTS.filter(x=>x.group==='필수').map(x=>x.name);
assert.equal(core.length,7);
assert(SUBJECTS.some(x=>x.id==='flying'&&x.year===1));
assert.equal(SUBJECTS.filter(x=>x.group==='선택').length,5);
assert.deepEqual(SPELLS.filter(x=>x.law==='unforgivable').map(x=>x.incantation).sort(),
  ['Avada Kedavra','Crucio','Imperio']);
assert.equal(M.schoolYear('1991-09-01'),1);
assert.equal(M.schoolYear('1992-06-30'),1);
assert.equal(M.schoolYear('1992-09-01'),2);
assert.equal(M.schoolYear('1998-05-02'),7);
let state=M.createState(),ctx={date:'1991-09-03',location:'마법 주문학 교실'};
assert(M.valid(state));
assert.equal(M.lesson(state,'lumos',{date:'1991-09-01'}).ok,false,'no classes on first night');
assert.equal(M.cast(state,'lumos',ctx).ok,false,'cannot cast unlearned magic');
assert.equal(M.lesson(state,'accio',ctx).ok,false,'advanced charm gated by year');
assert.equal(M.lesson(state,'crucio',ctx).ok,false,'forbidden curse gated');
let tries=0;
while((state.spells.lumos?.xp||0)<M.LESSON_THRESHOLD&&tries++<3)
  assert(M.lesson(state,'lumos',ctx).ok);
assert(state.spells.lumos.xp>=M.LESSON_THRESHOLD);
assert.equal(M.cast(state,'lumos',ctx).ok,true);
assert.equal(M.cast(state,'avada_kedavra',ctx).ok,false);
assert.equal(M.lesson(state,'lumos',ctx).ok,true,'third session');
assert.equal(M.lesson(state,'lumos',ctx).ok,false,'fourth practice blocked in same day');
const book=M.page(state,1,0);
assert(book.spells.length===8);
assert(M.practiceChoices(state,1,ctx,0).choices.length<=8);
assert.equal(M.parseCommand('▶ 마법 도감 [2] — 다음쪽').page,2);
assert.equal(M.parseCommand('▶ 마법 수업 [1] — 다음쪽').page,1);
assert.equal(M.parseCommand('▶ 마법 연습 [lumos] — 지팡이 빛').id,'lumos');
assert.equal(M.parseFreeCast('아바다 케다브라가 뭐야?'),null);
assert.equal(M.parseFreeCast('지팡이를 들어 루모스를 시전한다').id,'lumos');
assert.equal(M.parseFreeCast('익스펙토 패트로눔을 어떻게 배워?'),null);
assert.equal(M.lesson(state,'forgetfulness_potion',{date:'1991-09-04',location:'기숙사'}).ok,false,
  'potions require supervised rooms');
assert.equal(M.lesson(state,'forgetfulness_potion',{date:'1991-09-04',location:'마법약 교실'}).ok,true);

assert.equal(M.elective(state,'divination',{date:'1992-05-01'}).ok,false);
assert.equal(M.elective(state,'divination',{date:'1993-05-01'}).ok,true);
assert.equal(M.elective(state,'ancient_runes',{date:'1993-05-01'}).ok,true);
assert.equal(state.electives.length,2);
assert.equal(M.lesson(state,'riddikulus',{date:'1992-10-01'}).ok,false);
assert.equal(M.lesson(state,'riddikulus',{date:'1993-10-01'}).ok,true);
assert.equal(M.lesson(state,'expecto_patronum',{date:'1993-10-02'}).ok,false,
  'Lupin guidance needed');
assert.equal(M.lesson(state,'expecto_patronum',{date:'1993-10-02',
  flags:{dementor:'study'}}).ok,true);

const before=M.createState('1991-09-03');
let from='1991-09-03',schedule=['1991-11-03','1992-02-01','1992-06-01',
  '1992-09-03','1993-05-31','1993-09-02','1994-06-01','1994-09-02',
  '1995-06-01','1995-09-02','1996-06-02'];
for(const next of schedule){M.passiveSchool(before,from,next);from=next;}
assert((before.spells.wingardium_leviosa?.xp||0)>=M.LESSON_THRESHOLD,
  'normal school attendance teaches first year fundamentals');
assert(before.exams.OWL_1996,'fifth-year O.W.L. must be recorded');
assert(before.exams.OWL_1996.charms,'Charms must be examined');
assert.equal(before.exams.NEWT_1998,undefined,'no invented seventh-year exam before finale');
const saved=JSON.parse(JSON.stringify(before));assert(M.valid(saved));
assert.equal(M.passiveSchool(saved,'1996-06-02','1995-09-01').length,0);
assert.equal(saved.lastDate,'1996-06-02','stale clock may not rewind');

const forbidden=M.createState('1995-09-01');
assert.equal(M.seekDarkAccess(forbidden,{date:'1995-09-02',location:'호그와트 복도'}).ok,false);
assert.equal(M.seekDarkAccess(forbidden,{date:'1995-09-02',location:'금서 도서관'}).ok,true);
assert.equal(forbidden.darkAccess,true);
const training=M.availableTraining(forbidden,5,{date:'1995-09-03',location:'금서 도서관'});
assert(training.some(x=>x.id==='imperio'));
assert.equal(M.lesson(forbidden,'crucio',{date:'1995-09-03',location:'금서 도서관'}).ok,false,
 'dark curses not studied as ordinary schoolwork');
let n=0;
for(const date of ['1995-09-03','1995-09-04','1995-09-05','1995-09-06']){
  for(let k=0;k<3;k++){if((forbidden.spells.crucio?.xp||0)>=40)break;
    const res=M.lesson(forbidden,'crucio',{date,location:'금서 도서관',darkStudy:true});
    assert(res.ok);n++;}
}
assert(forbidden.spells.crucio.xp>=40);
const curse=M.cast(forbidden,'crucio',{date:'1995-09-07',againstPerson:true,target:'가상 적'});
assert(curse.ok);
assert.equal(curse.violation,'unforgivable');
assert(forbidden.infractions.some(x=>x.kind==='unforgivable'&&x.severity==='critical'));
assert.match(M.context(forbidden,{date:'1995-09-07'}),/용서받지 못할/);

const licence=M.createState('1996-09-03');
assert.equal(M.lesson(licence,'apparition',{date:'1996-09-03'}).ok,true);
licence.spells.apparition.xp=140;licence.licences.apparition=true;
assert.equal(M.cast(licence,'apparition',{date:'1996-09-07',inHogwarts:true}).ok,false,
  'Hogwarts wards must reject all ordinary Apparition');
assert.equal(M.cast(licence,'apparition',{date:'1996-09-07',inHogwarts:false}).ok,true);
assert(M.certify(licence,'apparition',{date:'1996-09-07',location:'마법약 교실'}).ok===false);
const html=fs.readFileSync(path.join(__dirname,'novel.html'),'utf8');
assert(html.includes('storypacks/hogwarts-au/magic.js?v=3'));
assert(html.includes('PandoraHogwartsMagic.createState'));
assert(html.includes('PandoraHogwartsMagic.passiveSchool('));
assert(html.includes('handleHogwartsMagicCommand(text)'));
assert(html.includes('handleHogwartsFreeCast(text)'));
assert(html.includes("STORY.id!=='hogwarts' && s.player.skills"));
assert(html.includes('PandoraHogwartsMagic.context('));
new Function(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
console.log(JSON.stringify({test:'hogwarts-magic',result:'PASS',subjects:SUBJECTS.length,spells:SPELLS.length,
  forbiddenCurses:3,grimoirePages:M.page(state,1,0).pages,
  courseStage:state.spells.lumos.xp,courseRegistration:before.exams.OWL_1996.charms,
  darkResearchSessions:n,licenceBlockedAtHogwarts:true}));
