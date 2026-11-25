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

// Identical elapsed school days must earn identical progress, however the clock arrived.
const oneJump=M.createState('1991-09-01'),daily=JSON.parse(JSON.stringify(oneJump));
oneJump.spells.lumos={xp:130,attempts:4,success:4,firstLearned:'1991-09-01'};
daily.spells.lumos={...oneJump.spells.lumos};
M.passiveSchool(oneJump,'1991-09-01','1992-04-08');
for(let d='1991-09-01';d<'1992-04-08';){
  const next=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  M.passiveSchool(daily,d,next);d=next;
}
assert.deepEqual(oneJump,daily);
assert.equal(oneJump.spells.lumos.xp,130);
const savedProgress=JSON.stringify(oneJump);
M.passiveSchool(oneJump,'1991-09-01','1992-04-08');
assert.equal(JSON.stringify(oneJump),savedProgress);
assert.deepEqual(M.curriculum(daily,'1991-12-25'),[]);
assert.deepEqual(M.curriculum(daily,'1992-07-06'),[]);
assert.deepEqual(M.curriculum(daily,'1991-09-07'),[]);
assert.notEqual(M.curriculum(daily,'1991-09-02')[0].topic,M.curriculum(daily,'1992-04-06')[0].topic);
assert.notEqual(M.curriculum(daily,'1991-09-02')[0].approach,M.curriculum(daily,'1991-09-09')[0].approach);
// September calendar and RP use the same chronological course, even on a legacy slot.
const legacy=M.createState('1991-09-01');
for(const [date,number] of [['1991-09-03',1],['1991-09-17',3],['1991-09-24',4]]){
  const agenda=M.agenda(legacy,date);
  assert.deepEqual(agenda.map(x=>x.unit.number),[number,number]);
  assert.match(M.context(legacy,{date,slot:0}),new RegExp(agenda[0].label));
}
const elementary=M.agenda(legacy,'1991-09-17'),nextLesson=M.agenda(legacy,'1991-09-24');
assert.equal(M.agenda(legacy,'1991-09-23')[0].unit.spell,'lumos');
assert(M.context(legacy,{date:'1991-09-24',slot:0}).includes(elementary[0].unit.topic));
assert.match(M.context(legacy,{date:'1996-09-03',slot:0}),/새 학년의 첫 시간이며 과목 입문을 다시 연출하지 않는다/);
// A different number or date on the same assignment is still a repeated lesson.
const electiveIds=SUBJECTS.filter(s=>s.group==='선택').map(s=>s.id);
function checkTimetable(electives){
  const student=M.createState(),topics=new Set();student.electives=electives;
  for(let t=Date.UTC(1991,8,1);t<Date.UTC(1998,4,2);t+=86400000){
    const date=new Date(t).toISOString().slice(0,10);
    for(const lesson of M.curriculum(student,date)){
      const key=lesson.subject+'|'+lesson.topic;
      assert(lesson.approach && !/undefined|null/.test(key),date+' '+key);
      assert(!topics.has(key),date+' repeats '+key);
      topics.add(key);
    }
  }
  assert.equal(topics.size,2645);
}
checkTimetable([]);
for(const a of electiveIds){
  checkTimetable([a]);
  for(const b of electiveIds.filter(id=>id!==a)){
    checkTimetable([a,b]);
    for(const c of electiveIds.filter(id=>id!==a && id!==b))checkTimetable([a,b,c]);
  }
}
assert.notEqual(elementary[0].unit.topic,nextLesson[0].unit.topic);
assert.notEqual(elementary[1].unit.topic,nextLesson[1].unit.topic);
const xpBefore=JSON.stringify(legacy);
M.agenda(legacy,'1998-03-17');M.context(legacy,{date:'1991-09-24'});
assert.equal(JSON.stringify(legacy),xpBefore,'previewing a date must not teach or record a class');
M.passiveSchool(legacy,'1991-09-01','1991-09-23');
assert.deepEqual(M.agenda(legacy,'1991-09-24'),nextLesson);
assert.equal(legacy.seenClasses,undefined,'the calendar cannot invent witnessed classes');
assert.match(M.context(legacy,{date:'1991-09-23',input:'맥고나걸 교수의 교실로 간다.'}),/변신술 3차시/);
assert.equal(M.agenda(legacy,'1991-09-26')[1].unit,undefined,'free Thursday afternoon');
assert.deepEqual(M.agenda(legacy,'1991-09-22'),[]);
M.recordClasses(legacy,[{isPlayer:true,speaker:'주인공',text:'변신술 수업을 마쳤다.'},
  {speaker:'론',text:'맥고나걸 교수님이 고양이로 변한다면?'},
  {speaker:'나레이터',text:'저녁 교탁 위에서 고양이가 졸고 있다.'}]);
assert.equal(legacy.seenClasses,undefined);
const witnessed=[{char_id:'mcgonagall',speaker:'맥고나걸',text:'성냥을 바늘로 바꾸어 보세요.'}];
M.recordClasses(legacy,witnessed);M.recordClasses(legacy,witnessed);
assert.deepEqual(legacy.seenClasses,{transfiguration:true});
assert.match(M.context(legacy,{date:'1991-09-03'}),/실제 장면 기록에 이미 나온 수업: 변신술/);
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
assert(html.includes('storypacks/hogwarts-au/profile.js?v=1'));
assert(html.includes('storypacks/hogwarts-au/magic.js?v=5'));
assert(html.includes('handleHogwartsFreeStudy(text)'));
assert(html.includes('PandoraHogwartsProfile.configure('));
assert(html.includes('PandoraHogwartsMagic.createState'));
assert(html.includes('PandoraHogwartsMagic.passiveSchool('));
assert(html.includes('handleHogwartsMagicCommand(text)'));
assert(html.includes('handleHogwartsFreeCast(text)'));
assert(html.includes("STORY.id!=='hogwarts' && s.player.skills"));
assert(html.includes('PandoraHogwartsMagic.context('));

const P=require('./storypacks/hogwarts-au/profile.js');
const custom='나는 호그와트 역사상 가장 뛰어난 마법적 재능을 가진 천재다. 처음 보는 주문도 빠르게 익히며, 특히 어둠의 마법에 천부적인 소질이 있다. 하지만 이 능력을 남들에게 숨기고 평범한 학생처럼 살아가고 싶다.';
const gifted=M.createState('1991-09-01');
const profile=P.configure(gifted,custom,{spells:M.SPELLS,worldMode:'canon_centered'});
assert.equal(profile.aptitude.general,100,'historical prodigy should have maximal potential');
assert.equal(profile.aptitude.learning,100);
assert.equal(profile.aptitude.dark,100);
assert.equal(profile.concealAbilities,true,'wants to conceal talent');
assert.equal(profile.worldMode,'canon_centered');
assert.equal(gifted.spells.crucio,undefined,'potential is not forbidden spell knowledge');
assert.equal(gifted.spells.accio,undefined,'potential is not a pre-learned charm');
assert.equal(M.cast(gifted,'lumos',{date:'1991-09-03'}).ok,false,'genius cannot cast an unlearned spell');
assert.equal(M.lesson(gifted,'accio',{date:'1991-09-03',location:'마법 주문학 교실'}).ok,false,
 'school syllabus still respects class age');
assert.equal(M.lesson(gifted,'accio',{date:'1991-09-03',location:'호그와트 대연회장',selfStudy:true}).ok,false,
 'no independent source of knowledge means no study');
const study={date:'1991-09-03',location:'호그와트 도서관',selfStudy:true,studyMethod:'book'};
const giftedLesson=M.lesson(gifted,'accio',study);
assert(giftedLesson.ok,'prodigy can research advanced magic instead of waiting for class');
assert(giftedLesson.gain>20,'prodigy gains faster than ordinary class');
assert(P.parseFreeStudy('도서관에서 아씨오를 독학한다',M.findIncantation).id==='accio');
assert.equal(P.parseFreeStudy('아씨오 주문을 어떻게 배워?',M.findIncantation),null);
assert.equal(M.lesson(gifted,'crucio',{date:'1991-09-04',location:'금서 도서관',
  selfStudy:true,studyMethod:'book',darkStudy:true}).ok,false,'dark aptitude alone cannot unlock cursed texts');
assert.equal(M.seekDarkAccess(gifted,{date:'1991-09-04',location:'금서 도서관'}).ok,true,
 'early forbidden research should not have an arbitrary fifth-year lock');
assert.equal(gifted.infractions.at(-1).discovered,false,'secret book research not automatically reported');
assert.equal(P.recordObserved(gifted,'stupefy',{date:'1991-09-04'}),false,
 'mere player intention cannot forge a witnessed lesson');
assert.equal(P.recordObserved(gifted,'stupefy',{date:'1991-09-04',verifiedSceneEvidence:'actual scene record'}),true);
assert.equal(M.lesson(gifted,'stupefy',{date:'1991-09-05',location:'복도',selfStudy:true,
  studyMethod:'observation'}).ok,true,'observed spell can be studied away from class');
for(const date of ['1991-09-06','1991-09-07','1991-09-08','1991-09-09']){
  if((gifted.spells.crucio?.xp||0)>=M.LESSON_THRESHOLD)break;
  for(let j=0;j<3;j++){
    if((gifted.spells.crucio?.xp||0)>=M.LESSON_THRESHOLD)break;
    const result=M.lesson(gifted,'crucio',{date,location:'금서 도서관',selfStudy:true,
      studyMethod:'book',darkStudy:true});
    assert(result.ok,'unlicensed private research is possible after knowledge access');
  }
}
assert((gifted.spells.crucio?.xp||0)>=M.LESSON_THRESHOLD,'genius can learn early without ordinary courses');
const secret=M.cast(gifted,'crucio',{date:'1991-09-10',target:'무인 훈련용 모형',
  witnesses:[],concealAttempt:true});
assert(secret.ok);
assert.equal(secret.violation,'unforgivable');
assert.equal(secret.exposed,false,'no witness means no automatic exposure');
assert.equal(gifted.infractions.at(-1).discovered,false);
assert.deepEqual(Object.keys(gifted.profile.knownBy),[],'NPC cannot infer private actions without evidence');
const publicCast=M.cast(gifted,'crucio',{date:'1991-09-10',target:'훈련용 모형',witnesses:['snape']});
assert(publicCast.ok);
assert.equal(publicCast.exposed,true);
assert.equal(gifted.profile.knownBy.snape.observations.length,1);
assert.equal(gifted.profile.knownBy.harry,undefined);
assert.equal(gifted.infractions.at(-1).discovered,true);
assert.equal(gifted.infractions.at(-1).witnesses[0],'snape');
const savedGifted=JSON.parse(JSON.stringify(gifted));
assert(M.valid(savedGifted));
assert.equal(P.ensure(savedGifted).knownBy.snape.observations.length,1,'witness records survive saves');
const oldSave=M.createState('1991-09-03');
delete oldSave.profile;
oldSave.spells.lumos={xp:75,attempts:2,success:1,firstLearned:'1991-09-02'};
const migrated=P.ensure(oldSave);
assert.equal(migrated.aptitude.general,50);
assert.equal(oldSave.spells.lumos.xp,75,'profile migration preserves old spell progress');
const baseline=M.createState('1991-09-03');
assert.equal(P.ensure(baseline).aptitude.general,50);
assert.equal(M.lesson(baseline,'accio',study).ok,false,
 'ordinary student cannot bypass the syllabus via gifted self-study');
const explicit=M.createState('1991-09-03');
P.configure(explicit,'나는 입학 전부터 모든 주문과 마법을 이미 숙달했다',{spells:M.SPELLS});
assert((explicit.spells.avada_kedavra?.xp||0)>=320,
 'explicit already mastered magic is a different character background than latent talent');
const oneKnown=M.createState('1991-09-03');
P.configure(oneKnown,'나는 입학 전부터 루모스를 숙달했다',{spells:M.SPELLS});
assert((oneKnown.spells.lumos?.xp||0)>=300,'explicitly mastered spell must have full mastery');
assert.equal(oneKnown.spells.crucio,undefined,'a single mastered spell does not unlock dark curses');
assert.equal(P.infer('실력을 숨긴다').concealAbilities,true,'natural Korean concealment declension recognized');
assert.equal(M.cast(explicit,'apparition',{date:'1991-09-03',inHogwarts:true}).ok,false,
 'even an overpowered character cannot override Hogwarts anti-Apparition wards');
assert.match(M.context(gifted,{date:'1991-09-10'}),/NPC별 실제 목격/);
const parsed=P.parseSetup('나는 천재이며 이 힘을 숨긴다','신입생');
assert(parsed?.description.includes('천재'));
assert.equal(P.parseSetup('조아라/19/여/나는 어둠의 마법 천재','신입생').name,'조아라');

new Function(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
console.log(JSON.stringify({test:'hogwarts-magic',result:'PASS',subjects:SUBJECTS.length,spells:SPELLS.length,
  forbiddenCurses:3,grimoirePages:M.page(state,1,0).pages,
  courseStage:state.spells.lumos.xp,courseRegistration:before.exams.OWL_1996.charms,
  darkResearchSessions:n,licenceBlockedAtHogwarts:true}));
