/* Hogwarts school magic and law — first-class game state, not LLM-invented skills.
 * Canon basis: 7 compulsory classes + first-year Flying; 3rd-year electives,
 * 5th-year O.W.L. and 7th-year N.E.W.T.; 3 Unforgivable Curses; Hogwarts
 * anti-Apparition wards. Year-by-year spell placement (except where directly
 * evidenced) and XP / success odds are explicit PANDORA GAME DESIGN rules.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.PandoraHogwartsMagic=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PROFILE=(typeof globalThis!=='undefined'&&globalThis.PandoraHogwartsProfile)||
    (typeof require==='function'?require('./profile.js'):null);
  const SUBJECTS=[
    ['charms','마법 주문학',1,'플리트윅','필수'],
    ['transfiguration','변신술',1,'맥고나걸','필수'],
    ['potions','마법약',1,'스네이프·슬러그혼','필수'],
    ['defense','어둠의 마법 방어술',1,'매년 담당 교수 변경','필수'],
    ['herbology','약초학',1,'스프라우트','필수'],
    ['astronomy','천문학',1,'시니스트라','필수'],
    ['history','마법의 역사',1,'빈스','필수'],
    ['flying','비행',1,'후치','1학년 필수'],
    ['care_beasts','마법 생물 돌보기',3,'해그리드·그럽플랭크','선택'],
    ['divination','점술',3,'트릴로니','선택'],
    ['ancient_runes','고대 룬 문자',3,'배블링','선택'],
    ['arithmancy','산술점',3,'벡터','선택'],
    ['muggle_studies','머글 연구',3,'버비지','선택'],
    ['alchemy','연금술',6,'특별 개설','상급 선택']
  ].map(x=>({id:x[0],name:x[1],year:x[2],teacher:x[3],group:x[4]}));
  const SUBJECT_BY_ID=Object.fromEntries(SUBJECTS.map(x=>[x.id,x]));
  // Spell: id, name, incantation, subject, minSchoolYear, difficulty,
  // class (ordinary/caution/restricted/dark/unforgivable), kind,
  // special requirement, effect. Not every magical practice is a wand spell.
  const DATA=[
    ['lumos','지팡이 빛','Lumos','charms',1,1,'ordinary','spell',null,'지팡이 끝에서 빛이 난다'],
    ['nox','불빛 끄기','Nox','charms',1,1,'ordinary','spell','lumos','지팡이 빛을 끈다'],
    ['wingardium_leviosa','공중부양','Wingardium Leviosa','charms',1,1,'ordinary','spell',null,'가벼운 물체를 띄운다'],
    ['alohomora','잠금 해제','Alohomora','charms',1,2,'caution','spell',null,'일반적인 잠금장치를 연다. 강한 보호 마법은 못 푼다'],
    ['reparo','수리 마법','Reparo','charms',1,1,'ordinary','spell',null,'부서진 비마법성 물건을 수리한다'],
    ['incendio','불꽃 생성','Incendio','charms',1,2,'caution','spell',null,'조절 가능한 작은 불꽃을 만든다'],
    ['petrificus_totalus','전신결박','Petrificus Totalus','defense',1,2,'caution','spell',null,'상대 몸을 잠시 굳게 한다. 타인에게 사용 시 징계 위험'],
    ['locomotor_mortis','다리묶기','Locomotor Mortis','defense',1,2,'caution','spell',null,'다리를 움직이지 못하도록 만든다'],
    ['match_to_needle','성냥을 바늘로 변형','Match-to-needle','transfiguration',1,2,'ordinary','exercise',null,'성냥을 바늘로 바꾸는 첫 실습'],
    ['boil_cure','종기 치료 마법약','Cure for Boils','potions',1,2,'ordinary','potion',null,'기초 마법약 제조'],
    ['forgetfulness_potion','망각 마법약','Forgetfulness Potion','potions',1,2,'caution','potion',null,'기억에 영향을 줄 수 있는 실습 조제'],
    ['basic_broom','빗자루 비행','Broom Control','flying',1,2,'ordinary','technique',null,'빗자루를 안전하게 조종한다'],
    ['finite_incantatem','마법 종료','Finite Incantatem','charms',2,2,'ordinary','spell',null,'해제 가능한 마법을 중단한다'],
    ['expelliarmus','무장해제','Expelliarmus','defense',2,2,'caution','spell',null,'상대의 지팡이나 무기를 떨어뜨린다'],
    ['rictusempra','간지럼 주문','Rictusempra','defense',2,2,'caution','spell',null,'상대를 간지럽혀 집중을 흐트러뜨린다'],
    ['tarantallegra','춤추는 다리','Tarantallegra','defense',2,2,'caution','spell',null,'상대의 다리를 잠시 제멋대로 움직이게 한다'],
    ['serpensortia','뱀 소환','Serpensortia','transfiguration',2,3,'restricted','spell',null,'뱀을 소환한다. 안전한 통제 없이는 실습 금지'],
    ['mandrake_care','맨드레이크 안전관리','Mandrake Care','herbology',2,2,'ordinary','technique',null,'보호장비를 사용해 맨드레이크를 관리한다'],
    ['riddikulus','보가트 대응','Riddikulus','defense',3,2,'ordinary','spell',null,'보가트가 우스운 모습으로 바뀌도록 상상하고 주문을 건다'],
    ['expecto_patronum','패트로누스','Expecto Patronum','defense',3,5,'caution','spell','lupin_mentor','강한 긍정적 기억을 통해 디멘터를 물리치는 수호령을 만든다'],
    ['immobulus','정지 주문','Immobulus','charms',3,3,'ordinary','spell',null,'움직이는 작은 대상의 행동을 일시 정지시킨다'],
    ['ferula','응급 부목','Ferula','charms',3,3,'caution','spell',null,'간단한 부목과 붕대를 만든다. 전문 치료 대체 불가'],
    ['shrinking_solution','축소 마법약','Shrinking Solution','potions',3,3,'ordinary','potion',null,'대상의 크기나 나이를 줄이는 약물'],
    ['hippogriff_approach','히포그리프 예법','Hippogriff Etiquette','care_beasts',3,3,'caution','technique',null,'존중과 인사를 통해 접근하는 생물 안전 예절'],
    ['polyjuice_potion','폴리주스 마법약','Polyjuice Potion','potions',3,5,'restricted','potion',null,'일시적으로 다른 사람의 외모를 취한다. 재료·시간·동의 문제 발생'],
    ['accio','소환 주문','Accio','charms',4,3,'ordinary','spell','wingardium_leviosa','멀리 있는 물건을 불러온다. 강력한 보호 장벽은 무시 못함'],
    ['protego','방어막','Protego','defense',4,3,'ordinary','spell','expelliarmus','일반적인 주문 공격을 방어한다. 살인 저주를 막지는 못함'],
    ['stupefy','기절 주문','Stupefy','defense',4,3,'caution','spell','expelliarmus','대상을 잠시 기절시키는 공격 주문'],
    ['impedimenta','방해 마법','Impedimenta','defense',4,3,'caution','spell',null,'돌진하는 대상의 움직임을 지연한다'],
    ['reducto','파괴 마법','Reducto','charms',4,4,'caution','spell','incendio','물체를 부술 수 있다. 사람에게 사용하면 위험'],
    ['diffindo','절단 마법','Diffindo','charms',4,3,'caution','spell',null,'물건을 절단한다. 신체를 다치게 할 위험 있음'],
    ['gillyweed','아가미풀 관리','Gillyweed Handling','herbology',4,3,'caution','technique',null,'수중 활동을 돕는 아가미풀 사용법'],
    ['dragon_safety','드래곤 안전','Dragon Safety','care_beasts',4,4,'caution','technique',null,'위험 마법 생물에 접근하지 않고 관찰·보호한다'],
    ['silencio','침묵 주문','Silencio','charms',5,3,'ordinary','spell',null,'대상이나 생물의 소리를 잠시 막는다'],
    ['confundo','혼동 주문','Confundo','charms',5,4,'restricted','spell',null,'생각을 혼란스럽게 만든다. 타인의 의사 침해 소지'],
    ['evanesco','소멸 변신술','Evanesco','transfiguration',5,4,'ordinary','spell','match_to_needle','사물을 소멸시키는 고급 변신술'],
    ['colloportus','문 봉쇄','Colloportus','charms',5,3,'caution','spell','alohomora','문을 마법으로 봉쇄한다'],
    ['episkey','경미한 부상 치유','Episkey','charms',6,3,'caution','spell','ferula','경미한 부상을 치료한다. 심각한 부상은 치료사 필요'],
    ['aguamenti','물 생성','Aguamenti','charms',6,3,'ordinary','spell',null,'지팡이 끝에서 물을 만든다'],
    ['levicorpus','역매달기','Levicorpus','charms',6,4,'restricted','spell',null,'상대를 공중에 거꾸로 매단다. 비동의 사용 금지'],
    ['sectumsempra','섹튬셈프라','Sectumsempra','defense',6,5,'dark','spell','dark_access','절단상을 입히는 위험한 어둠의 저주. 정규 수업 아님'],
    ['felix_felicis','행운의 마법약','Felix Felicis','potions',6,5,'restricted','potion',null,'제조가 위험하고 일정 경기·시험에서 사용 금지'],
    ['amortentia','강력한 사랑의 묘약','Amortentia','potions',6,5,'restricted','potion',null,'타인의 의사와 감정에 영향을 줌. 타인에게 몰래 투여 금지'],
    ['veritaserum','진실 마법약','Veritaserum','potions',6,5,'restricted','potion',null,'진실을 말하도록 압박하는 희귀 마법약. 감독 없는 투여 금지'],
    ['obliviate','기억 수정','Obliviate','charms',7,5,'restricted','spell',null,'타인의 기억에 영향을 주며 오남용 시 중대한 책임'],
    ['apparition','순간이동','Apparition','charms',6,5,'restricted','technique','apparition_licence','시험과 면허 필요. 호그와트 경내는 일반적으로 불가'],
    ['animagus','애니마구스 변신','Animagus Transformation','transfiguration',7,5,'restricted','technique','animagus_registration','고도의 자율 변신. 법적 등록 필요'],
    ['fiendfyre','악마의 화염','Fiendfyre','defense',7,5,'dark','spell','dark_access','극히 통제하기 어려운 불 마법. 학교 사용 금지'],
    ['imperio','임페리우스 저주','Imperio','defense',5,5,'unforgivable','spell','dark_access','상대 의지를 조종하는 용서받지 못할 저주'],
    ['crucio','크루시아투스 저주','Crucio','defense',5,5,'unforgivable','spell','dark_access','극심한 고통을 주는 용서받지 못할 저주'],
    ['avada_kedavra','살인 저주','Avada Kedavra','defense',5,5,'unforgivable','spell','dark_access','생명을 빼앗는 용서받지 못할 저주']
  ];
  const SPELLS=DATA.map(a=>Object.freeze({id:a[0],name:a[1],incantation:a[2],
    subject:a[3],year:a[4],difficulty:a[5],law:a[6],form:a[7],prerequisite:a[8],
    effect:a[9]}));
  const SPELL_BY_ID=Object.fromEntries(SPELLS.map(s=>[s.id,s]));
  const ALIASES={
    wingardium_leviosa:['윙가르디움 레비오사','윙가디움 레비오사'],
    expelliarmus:['엑스펠리아르무스','엑스펠리암스'],
    alohomora:['알로호모라'],accio:['아씨오','아키오'],protego:['프로테고'],
    stupefy:['스투페파이','스튜페파이'],riddikulus:['리디큘러스'],
    expecto_patronum:['익스펙토 패트로눔','익스펙토 패트로눔'],
    incendio:['인센디오'],lumos:['루모스'],nox:['녹스'],reparo:['레파로'],
    crucio:['크루시오'],imperio:['임페리오'],avada_kedavra:['아바다 케다브라'],
    sectumsempra:['섹튬셈프라'],silencio:['실렌시오'],aguamenti:['아구아멘티']
  };
  const COURSE_ORDER=['charms','transfiguration','defense','potions','herbology',
    'flying','care_beasts','divination','ancient_runes','arithmancy','muggle_studies','alchemy'];
  const RANKS=['미습득','입문','기초','숙련','상급','정통'];
  const LESSON_THRESHOLD=40;
  function rank(xp){return xp<LESSON_THRESHOLD?RANKS[0]:xp<80?RANKS[1]:
    xp<140?RANKS[2]:xp<220?RANKS[3]:xp<300?RANKS[4]:RANKS[5];}
  function valid(s){return !!(s&&s.schemaVersion===1&&s.spells&&typeof s.spells==='object'&&
    s.subjectXP&&typeof s.subjectXP==='object'&&Array.isArray(s.electives)&&
    Array.isArray(s.infractions)&&s.practice&&typeof s.practice==='object');}
  function createState(date){
    return {schemaVersion:1,spells:{},subjectXP:{},electives:[],infractions:[],
      darkAccess:false,practice:{date:date||'1991-09-01',sessions:0,castCount:0,fatigue:0},
      lastDate:date||'1991-09-01',exams:{},research:[],licences:{},castHistory:[],lastCast:null,
       profile:PROFILE?PROFILE.infer(''):null};
  }
  function need(s){if(!valid(s))throw Error('Hogwarts magic state invalid');
    if(PROFILE)PROFILE.ensure(s);}
  function schoolYear(date){const y=Number(String(date).slice(0,4)),m=Number(String(date).slice(5,7));
    return Math.max(1,Math.min(7,(m>=9?y-1990:y-1991)||1));}
  function isTerm(date){let m=Number(String(date).slice(5,7));return m>=9||m<=6;}
  function hash(s){let n=2166136261;for(let i=0;i<s.length;i++)n=Math.imul(n^s.charCodeAt(i),16777619)>>>0;return n>>>0;}
  function resetDay(s,date){if(s.practice.date!==date){s.practice.date=date;s.practice.sessions=0;s.practice.fatigue=Math.max(0,s.practice.fatigue-22);}}
  function record(s,id){return s.spells[id]||(s.spells[id]={xp:0,attempts:0,success:0,firstLearned:null});}
  function isElective(subj){return SUBJECT_BY_ID[subj]?.group==='선택';}
  function courseAllowed(s,spell,ctx){
    const year=schoolYear(ctx.date);if(year<spell.year)return '현재 학년에서는 아직 배우지 않는 내용이다.';
    if(isElective(spell.subject)&&!s.electives.includes(spell.subject))
      return '해당 과목을 선택하지 않았다. 2학년 말에 선택과목을 신청할 수 있다.';
    if(spell.law==='dark'||spell.law==='unforgivable'){
      if(!s.darkAccess)return '정규 교과 과정에 없다. 위험한 금서 연구 경로도 열리지 않았다.';
      if(year<5)return '현재 학년에는 위험성이 지나치게 크다.';
    }
    if(spell.prerequisite&&SPELL_BY_ID[spell.prerequisite]&&
       (s.spells[spell.prerequisite]?.xp||0)<LESSON_THRESHOLD)
      return '선행 주문 '+SPELL_BY_ID[spell.prerequisite].name+'을(를) 먼저 익혀야 한다.';
    if(spell.prerequisite==='lupin_mentor'&&ctx.flags?.dementor!=='study')
      return '루핀의 직접 지도나 동등한 특별 훈련이 필요하다.';
    // Licensing gates actual public use, not supervised preparation for its test.
    if(year>=6&&s.exams.OWL_1996&&s.exams.OWL_1996[spell.subject] &&
       !['O','E'].includes(s.exams.OWL_1996[spell.subject]))
      return '이 과목의 O.W.L. 성적이 N.E.W.T. 과정 기준에 미치지 못한다.';
    return null;
  }
  function lesson(s,id,ctx){
    need(s);ctx=ctx||{};const spell=SPELL_BY_ID[id];
    if(!spell)return {ok:false,reason:'등록되지 않은 주문이나 실습이다.'};
    const date=String(ctx.date||s.lastDate);resetDay(s,date);
    if(date==='1991-09-01'&&!ctx.selfStudy)return {ok:false,id,reason:'기숙사 배정 첫날 밤이다. 정규 수업은 다음 일정부터 시작된다.'};
    const why=ctx.selfStudy&&PROFILE
      ?PROFILE.researchGate(s,spell,{...ctx,date,spellById:SPELL_BY_ID,lessonThreshold:LESSON_THRESHOLD},schoolYear)
      :courseAllowed(s,spell,{...ctx,date});
    if(why)return {ok:false,id,reason:why};
    if(s.practice.sessions>=3)return {ok:false,id,reason:'오늘의 집중 실습은 이미 세 차례 마쳤다. 다음 날에 다시 연습할 수 있다.'};
    if(spell.form==='potion'&&!/(마법약|potions|교실|실습실|연구실|지하)/i.test(String(ctx.location||''))&&!ctx.supervised)
      return {ok:false,id,reason:'마법약은 안전한 실습실과 재료·감독이 필요하다. 다른 장소에서 즉석 제조할 수 없다.'};
    if((spell.law==='dark'||spell.law==='unforgivable')&&!ctx.darkStudy)
      return {ok:false,id,reason:'위험한 저주 연구는 일반 수업에서 진행할 수 없다.'};
    const p=record(s,id),attempt=p.attempts+1;
    let gain=Math.max(6,24-spell.difficulty*3)+hash(date+id+'practice'+attempt)%13;
    gain=Math.max(4,gain-Math.floor(s.practice.fatigue/20));
    if(PROFILE)gain=Math.max(4,Math.round(gain*PROFILE.studyMultiplier(s,spell)));
    const first=p.xp<LESSON_THRESHOLD;
    p.xp=Math.min(360,p.xp+gain);
    p.attempts++;
    p.success+=Number(p.xp>=LESSON_THRESHOLD);
    if(first&&p.xp>=LESSON_THRESHOLD)p.firstLearned=date;
    s.subjectXP[spell.subject]=(s.subjectXP[spell.subject]||0)+gain;
    s.practice.sessions++;s.practice.fatigue=Math.min(100,s.practice.fatigue+7+spell.difficulty);
    const danger=spell.law==='unforgivable'||spell.law==='dark';
    if(danger)s.infractions.push({date,id,kind:'forbidden_research',severity:'high',
      note:'금지된 분야의 연구는 발각 시 징계와 마법부 조사 위험',discovered:false,witnesses:[]});
    return {ok:true,id,name:spell.name,gain,xp:p.xp,rank:rank(p.xp),
      learned:p.xp>=LESSON_THRESHOLD,firstLearned:first&&p.xp>=LESSON_THRESHOLD,
      fatigue:s.practice.fatigue,danger};
  }
  const timetable=[
    ['charms','potions'],['transfiguration','herbology'],['history','defense'],
    ['potions','charms'],['rotation','astronomy']
  ];
  // Opening practicals are individual lessons. Later units pair a concrete subject with
  // a different practical each meeting; the calendar describes school, not personal XP.
  const opening={
    charms:['지팡이 빛 켜기','빛의 밝기와 거리 조절','불빛 끄기와 잔광 확인','두 가지 신호를 빛으로 주고받기','종이 너머로 빛의 세기 맞추기','거리별로 지팡이 불빛을 일정하게 유지하기','상대 신호에 맞춰 빛을 끄고 되살리기','지도 위 한 지점만 비추기'],
    potions:['약재 저울의 영점 맞추기','쐐기풀과 뱀니 손질','가마를 불에서 내릴 시점','호저 가시 투입 순서','종기 치료제의 색으로 온도 판별','엉긴 시료의 제조 기록 대조','식힌 종기 치료제에서 침전물 걸러내기','완성된 치료제를 두 병에 나눠 보관하기','시험 시료의 점도와 색 대조하기'],
    transfiguration:['성냥 끝을 금속으로 바꾸기','나뭇결을 없애고 바늘 몸통 다듬기','바늘귀를 내고 실을 통과시키기','휘어진 바늘을 원래 성냥으로 복원하기'],
    herbology:['온실 표본에 이름표 달기','같은 모종의 양지·그늘 생장 비교','뿌리를 다치지 않게 모종 옮겨심기','옮겨 심은 모종의 새잎과 수분 기록'],
    defense:['위험 징후를 발견하고 거리 두기','교실 배치도에 대피 경로 표시','소리로 접근 방향 가려내기','짝에게 퇴로 신호 보내기'],
    history:['두 연표에서 같은 사건 찾기','고블린 봉기의 지명 대조','목격담과 후대 기록 구별','서로 다른 증언으로 사건 순서 복원'],
    astronomy:['북쪽 하늘의 기준별 찾기','별자리 두 점을 성도에 옮기기','같은 별의 방위 변화 재기','달빛에 가려진 별의 위치 추정'],
    flying:['빗자루 부르기와 안전한 착지','낮은 고도에서 정지하기','표지 깃발을 돌아 감속하기','바람 방향에 맞춰 착륙 지점 고르기']
  };
  // First year: three units in each term, in calendar order.
  const courses={
    charms:['지팡이 끝의 빛','빛 신호와 소등','깃털을 목표점에 내려놓기','깃펜을 두 책상 사이로 옮기기','연습 자물쇠의 걸쇠 풀기','금이 간 찻잔 이어 붙이기','무게가 다른 소포 띄우기','릴레이 신호등을 순서대로 끄기','깨진 지도 조각 복원'],
    transfiguration:['목재와 금속','바늘의 무게중심','원형 복원','단추의 구멍과 테두리','서로 다른 금속','변형의 지속 시간','손잡이와 이음매','부분 변형','복원 전후의 질량'],
    potions:['마른 약재 계량','종기 치료제','달인 액의 농도','약재의 보관 조건','교반과 온도','침전물 분리','망각 마법약','중화 시료','실패한 배합'],
    herbology:['온실 표본','빛과 배수','뿌리와 새순','휴면 구근','삽목과 분갈이','발아 온도','꽃가루 수집','토양 회복','약초 수확'],
    defense:['위험의 흔적','보호 거리','경로 차단','시야 확보','기습 징후','보호물 선택','짝 대피','현장 대응','구조 신호'],
    history:['고블린 봉기','마법사 의회','초기 마법 학교','비밀 유지 법령','조약과 관할권','시대별 지도','당대의 편지','공문서의 공백','지역별 구전'],
    astronomy:['북쪽 하늘','달의 위상','자정의 성도','겨울 별자리','행성의 위치','관측 시각','달의 궤도','망원경의 오차','연속 관측 기록'],
    flying:['공중 정지','선회 반경','안전 착지','측풍','고도 유지','장애물 통과','대형 비행','긴급 감속','비행 경로 설계']
  };
  // Each row is a school year, each entry a term project. Core subjects start
  // here in year two, electives in year three. These are Pandora's assignments.
  const projects={
    charms:[
      '끝나지 않는 회전 팽이','나란히 놓인 종의 울림 끊기','상자에 겹쳐 건 주문 해제',
      '흔들리는 추를 잠시 멈추기','넘어진 모형의 부목 고정','움직이는 모형 구조',
      '가려진 물건 소환','서가에서 지정한 책만 소환','움직이는 수레에서 소포 회수',
      '소리 나는 새장에 침묵 걸기','합창 인형의 한 목소리만 잠재우기','메아리 속 목소리 복원',
      '마른 대야에 물줄기 만들기','기울어진 수로의 물높이 조절','온실 급수 장치 복구',
      '낡은 성문에 겹친 마법 판독','두 방에 걸친 주문 간섭','대피 안내등 연결 복구'],
    transfiguration:[
      '놋단추를 나무 패로 바꾸기','찻숟가락의 손잡이만 변형','짝 없는 체스 말 복원',
      '주전자 주둥이의 형태 변환','점토 모형에 경첩 만들기','서로 다른 두 재질의 연결부',
      '받침접시를 작은 그릇으로','갈라진 아치 모형의 하중','내용물을 보존하는 용기 변형',
      '가려진 물체의 원형 판별','겹친 부분 변형 분리','미지 시료 변형과 복원 실기',
      '속이 빈 도구의 내부 구조','연속 변형에서 사라진 세부 복구','복합 재질 시계의 정밀 복원',
      '무대 모형의 가역적 변형 설계','손상된 교구 원형 감정','임시 다리 모형의 검증과 해제'],
    potions:[
      '서로 다른 농도의 회복 시료','가라앉은 결정과 부유물','병마개 재질에 따른 보관 실험',
      '축소 마법약과 대조 시료','크기 변화의 지속 시간','잘못 표기된 축소약 시료 감정',
      '교반 속도별 색 변화','냉각 중 다시 생기는 결정','두 가마 사이의 배치 편차',
      '원료를 모르는 시험 시료','열에 민감한 약재의 대체 배합','익명 시료의 품질 판정',
      '해독제 반응표 판독','혼합 시료의 길항 작용','해독제 배합안 비교',
      '장기 보관 시료의 변질','대체 약재의 효능 대조','병동용 약제의 검수 기록'],
    herbology:[
      '맨드레이크의 어린 뿌리','맨드레이크의 생장 신호','성숙한 맨드레이크 수확 기록',
      '자극에 잎을 접는 덩굴','덩굴손의 지지대 선택','같은 덩굴의 삽목 활착률',
      '발광 이끼의 빛 주기','온실 그늘의 경쟁 식생','이끼 군락의 이식 후 회복',
      '온실 병반 표본집','토양에서 온 병징과 잎 손상','감염 구획의 회복 판정',
      '독성이 다른 근연종','약용 부위의 수확 시점','교차 수분한 약초의 형질',
      '서리 피해를 입은 온실','희귀 구근의 계통 보존','폐쇄 온실의 식생 복구'],
    defense:[
      '무장해제 연습용 지팡이','결투 규칙과 중단 신호','교실 모의 결투의 심판 기록',
      '보가트의 모방과 식별','보가트 앞에서 짝 교대','형태가 바뀐 보가트 대응',
      '방패 주문의 보호 범위','모의 기습과 엄폐','짝을 엄호하며 이동',
      '연속 주문의 방어 순서','좁은 공간에서의 보호막','실기 시험의 구조 상황',
      '무언 방패의 집중 유지','복도 양끝의 방어 신호','방어 주문 간섭 해결',
      '학교 안의 피난 경로','발각된 은신처의 구조 계획','보호 마법이 끊긴 구역의 대피'],
    history:[
      '중세 마법 시장 장부','길드 인장과 거래 기록','길드 규약의 개정 과정',
      '마법 생물 보호 청원','마법사 의회의 회의록','보호 협정의 서로 다른 사본',
      '국제 대회 창설 기록','경기 규칙을 둘러싼 분쟁','대회 중단을 다룬 당시 기사',
      '비밀 유지 법령의 초안','지역별 법령 집행 기록','법령 개정 논쟁의 사료 비평',
      '전시 신문의 검열 흔적','같은 사건을 쓴 두 일기','삭제된 기사로 연표 보완',
      '사라진 학교 명부','구술 증언의 교차 검증','호그와트 사건 자료집 편찬'],
    astronomy:[
      '금성의 위상','화성의 역행','두 행성의 공전 모형',
      '달 표면의 그림자','식이 일어나는 기하 조건','월식 예측표',
      '혜성의 이동 궤적','성단의 겉보기 밝기','장기 노출 성도 비교',
      '기준별로 망원경 교정','남북 관측지의 시차','미지의 관측 기록 판독',
      '쌍성의 광도 곡선','가려지는 별의 주기','망원경 간 측정 편차',
      '관측소의 빈 기록 복원','서로 다른 성도의 좌표 환산','장기 천문 관측 보고서'],
    care_beasts:[
      '히포그리프의 인사 신호','플로버웜 사육 기록','날개 달린 동물의 방사 구역',
      '니플러의 먹이 탐색','보우트러클의 보금자리','숲 가장자리 종별 흔적',
      '세스트럴 무리의 이동','야행성 동물의 먹이 주기','발견한 발자국의 종 판별',
      '부상 동물의 임시 우리','회복 개체의 군집 복귀','보호 구역의 이동 통로',
      '교란된 서식지 조사','동물 이동로의 보호선','방사 이후의 개체 추적'],
    divination:[
      '찻잎 잔의 상징','수정구 관찰 일지','꿈 기록의 반복 무늬',
      '행성 배열과 전통 해석','손금 도해의 판본 차이','서로 모순되는 징조',
      '예측과 우연의 일치','발생하지 않은 예측 기록','실기 해석의 근거 제시',
      '후대에 편집된 예언집','상징의 지역별 차이','관찰자에 따른 해석 편차',
      '예언 기록의 출처','같은 예언의 두 전승','판단을 유보할 사례집'],
    ancient_runes:[
      '기초 룬 자모 목판','석문의 읽는 방향','간단한 묘비명',
      '물건에 새긴 소유 표식','복합 자형의 경계','여행자의 봉헌문',
      '풍화된 비문의 결락','시대별 철자 변동','같은 구절의 병행 번역',
      '필사본의 약자','겹쳐 쓴 룬 문장','서로 다른 필사 계통',
      '무명 비문의 연대','복원안의 경쟁 해석','주석을 갖춘 비문 판본'],
    arithmancy:[
      '이름의 수치표','반복 수열의 규칙','기초 예측표의 검산',
      '다른 기수의 수표','맞물리는 마법 주기','대칭 배열의 빈칸',
      '결측값이 있는 배열','두 예측식의 오차','미지 수열의 복원',
      '조건이 여러 개인 수식','오차가 쌓이는 모형','계수 변화의 민감도',
      '충돌하는 수치 예측','실측값에 맞춘 보정','독립 예측 모형의 검증'],
    muggle_studies:[
      '머글 가정의 조명','버스 노선도 읽기','우편물이 배달되는 경로',
      '기차역의 신호','전화 교환의 원리','정전 때 도시의 생활',
      '병원의 접수와 진료','지역 신문의 취재 과정','머글 학교의 하루',
      '도시 상수도의 흐름','박물관의 전시 설명','지역 사회의 의사 결정',
      '두 사회의 재난 안내','머글 문화에 대한 오해','양쪽 독자를 위한 안내문']
  };
  const stages={
    charms:['주문이 닿는 범위','대상을 바꾼 실험','주문의 정밀 제어'],
    transfiguration:['원본의 구조','변형할 부분의 경계','원형 복원의 정밀도'],
    potions:['대조 시료','배합 조건의 영향','완성 시료의 품질'],
    herbology:['표본의 특징','환경에 따른 생장','다음 생장 단계의 징후'],
    defense:['상황 판별','짝과 대응','조건을 바꾼 모의 실기'],
    history:['기록의 작성 배경','상반된 증언','사료에 근거한 결론'],
    astronomy:['기준 관측','연속 관측','예측과 실제의 편차'],
    care_beasts:['행동 식별','돌봄 조건','보호 조치의 영향'],
    divination:['관찰 원본','두 해석의 차이','예측과 관찰 결과'],
    ancient_runes:['자형 판독','이문 대조','근거를 밝힌 번역'],
    arithmancy:['규칙 도출','조건 변화','독립 검산'],
    muggle_studies:['이용자의 경험','작동 과정','현지 사례 비교']
  };
  const practicals={
    charms:['기준 동작 익히기','손목 각도 비교','유지 시간 재기','실패한 주문 교정','거리 바꾸기','짝의 동작 관찰','힘의 크기 조절','두 목표 번갈아 연습','좁은 공간에 적용','중단 신호 맞추기','오류 원인 설명','혼자 재현하기'],
    transfiguration:['재질 비교','형태를 정밀하게 맞추기','유지 시간 측정','흔적 없이 복원','원본과 무게 대조','남은 재질 흔적 찾기','짝의 시료에서 오차 찾기','새 시료로 교정 결과 검증'],
    potions:['재료 손질','가열 순서 비교','이상 시료 판별','배합 오차 수정','대조 시료 조제','온도 곡선 기록','거르는 시점 정하기','보관 용기 선택','점도 검사','응고 원인 대조','제조 기록 검산','한 병 분량 환산'],
    herbology:['표본 구별','재배 조건 바꾸기','대조군 관찰','생육 기록 해석','이상 징후 감별','다음 관찰 조건 정하기','표본 간 편차 측정','온실 일지로 예상 결과 검증'],
    defense:['징후 식별','대응 순서 연습','짝과 역할 교대','퇴로 확보','시야가 가려진 경우 대응','모의 상황 평가','뒤처진 짝에게 신호 전달','대응 기록에서 놓친 위험 찾기'],
    history:['원자료 읽기','기록의 출처 비교','엇갈린 증언 검토','근거를 들어 해석','누락된 관점 찾기','새 자료로 연표 수정'],
    astronomy:['성도에 표시','망원경 관측','위치 변화 계산','측정 오차 보정','다른 관측지와 대조','다음 위치 예측'],
    flying:['지상에서 동작 점검','낮은 고도에서 실습','조건을 바꿔 조종','안전하게 복귀','착지 오차 줄이기','짝과 간격 맞추기']
  };
  function schoolDay(date){
    const d=new Date(date+'T00:00:00Z'), weekday=d.getUTCDay(), md=date.slice(5);
    if(!Number.isFinite(+d)||md==='09-01'||date>='1998-05-02'||!isTerm(date)||weekday<1||weekday>5||md>='12-21'||md<='01-05')return null;
    const year=schoolYear(date), start=Date.UTC(1990+year,8,1);
    return {weekday,year,week:Math.floor((+d-start)/604800000),
      term:md>='09-01' ? 0 : md<'04-01' ? 1 : 2};
  }
  const schoolPlans=new Map();
  function schoolPlan(s,year){
    const electives=year>=3?s.electives.filter(id=>isElective(id)):[];
    const key=electives.join(',');
    const cached=schoolPlans.get(year);
    if(cached?.key===key)return cached;
    const days=new Map(),bySubject={},termCounts={};
    const start=1990+year;
    for(let t=Date.UTC(start,8,2);t<Date.UTC(start+1,6,1);t+=86400000){
      const date=new Date(t).toISOString().slice(0,10),day=schoolDay(date);
      if(!day)continue;
      const meetings=[];
      for(const [slot,period] of timetable[day.weekday-1].entries()){
        // Alternate Thursday afternoons are free for clubs, errands and appointments.
        if(day.weekday===4 && slot===1 && day.week%2===1)continue;
        const pool=electives.length?electives:['defense','transfiguration','herbology'];
        const subject=period!=='rotation'?period:year===1?'flying':pool[day.week%pool.length];
        const subjectDates=bySubject[subject]||=[];
        const termKey=subject+day.term,termIndex=termCounts[termKey]||0;
        const meeting={date,subject,slot,year,term:day.term,week:day.week,number:subjectDates.length+1,termIndex};
        meetings.push(meeting);subjectDates.push(meeting);termCounts[termKey]=termIndex+1;
      }
      days.set(date,meetings);
    }
    const plan={key,days,bySubject,termCounts};
    schoolPlans.set(year,plan);return plan;
  }
  function unitFor(s,plan,meeting){
    const {slot,subject,year,week,term,termIndex,number}=meeting;
    const grade=s.exams?.OWL_1996?.[subject];
    if(year>=6 && grade && !['O','E'].includes(grade))return null;
    const spells=SPELLS.filter(x=>x.subject===subject&&x.year===year&&['ordinary','caution'].includes(x.law));
    let spell=spells[Math.min(spells.length-1,Math.floor(week*spells.length/41))];
    const steps=practicals[subject]||['자료 판독','조건 비교','사례 해석','독립 과제','자료의 빈틈 찾기','결과 검증'];
    const count=plan.termCounts[subject+term],unit=Math.floor(termIndex*3/count);
    const step=termIndex-Math.ceil(unit*count/3);
    const project=year>1 && projects[subject][(year-Math.max(2,SUBJECT_BY_ID[subject].year))*3+term];
    let focus=year===1?courses[subject][term*3+unit]:project+' · '+stages[subject][unit];
    if(year===1 && subject==='charms'){
      let id;
      if(number<=opening.charms.length)id=(number===3||number===7)?'nox':'lumos';
      else if(meeting.date<'1991-10-31')id=unit===0?'lumos':'nox';
      else if(term===0)id='wingardium_leviosa';
      else id=(term===1?['wingardium_leviosa','alohomora','reparo']:['wingardium_leviosa','nox','reparo'])[unit];
      spell=SPELL_BY_ID[id];
      if(term===0 && unit===1 && id==='wingardium_leviosa')focus='공중부양으로 깃털 띄우기';
    }
    const task=steps[step];
    const introductory=year===1 && opening[subject]?.[number-1];
    const topic=introductory || focus+' — '+task;
    return {slot,subject,name:SUBJECT_BY_ID[subject].name,number,topic,approach:task,spell:spell?.id};
  }
  function curriculum(s,date){
    const plan=schoolPlan(s,schoolYear(date));
    return (plan.days.get(date)||[]).map(meeting=>unitFor(s,plan,meeting)).filter(Boolean);
  }
  function lessonLabel(unit){return unit.name+' '+unit.number+'차시 · '+unit.topic;}
  function agenda(s,date){
    if(!schoolDay(date))return [];
    const lessons=curriculum(s,date);
    return [0,1].map(slot=>{
      const unit=lessons.find(u=>u.slot===slot);
      return {slot,unit,label:unit?lessonLabel(unit):'자유활동 · 정해진 수업 없음'};
    });
  }
  const teachers={mcgonagall:'transfiguration',flitwick:'charms',snape:'potions',sprout:'herbology',
    binns:'history',sinistra:'astronomy',hooch:'flying'};
  const teacherNames={맥고나걸:'transfiguration',플리트윅:'charms',스프라우트:'herbology',
    빈스:'history',시니스트라:'astronomy',후치:'flying'};
  function recordClasses(s,lines){
    if(!valid(s)||!Array.isArray(lines))return;
    for(const line of lines){
      if(!line||line.isPlayer||line.isPlayerLine||line.pending||typeof line.text!=='string')continue;
      const text=String(line.text);
      const name=String(line.speaker||'');
      const transfig=/(?:성냥|바늘|변신술|고양이)/.test(text);
      const teacher=teachers[line.char_id]||teacherNames[Object.keys(teacherNames).find(n=>name.includes(n))];
      const narrated=!name||/^(?:나레이터|나레이션|내레이션|서술)$/.test(name);
      const classAction=/(?:교재를 펼|지팡이를 들어 보|과제를 제출|따라\s*해|실습을 (?:시작|마|끝)|교탁을 두드|수업을 (?:시작|마|끝)|수업은 여기까지|다음 수업에 봅|바꿔 보|바꾸어 보)/.test(text);
      let subject=classAction?teacher:null;
      if(subject==='potions'&&(/방어술/.test(text)||!/(?:마법약|약재|가마|조제|배합)/.test(text)))subject=null;
      if(narrated && /변신술\s*(?:첫\s*)?수업(?:이|을)\s*(?:시작했|시작되었|시작됐|마쳤|마치고|끝났|끝나자)/.test(text))subject='transfiguration';
      if((teacher==='transfiguration'||(narrated&&/맥고나걸/.test(text)))&&transfig&&
         /(?:성냥.{0,24}바늘|고양이.{0,60}(?:사람|교수|맥고나걸|본모습)(?:의 모습)?(?:으로|로)\s*(?:변했|변신했|돌아왔|바뀌)|고양이.{0,20}맥고나걸.{0,12}(?:변했|돌아왔))/.test(text) &&
         !/(?:라면|한다면|할까|할지도|다음 시간에|다음 수업에|예정|소문|[?？])/.test(text))subject='transfiguration';
      if(subject){s.seenClasses||={};s.seenClasses[subject]=true;}
    }
  }
  function restoreClasses(s,log,history){
    if(!valid(s))return;
    recordClasses(s,log);
    for(const turn of history||[]){
      if(turn?.role!=='assistant'||typeof turn.content!=='string')continue;
      let scene;
      try{scene=JSON.parse(turn.content);}catch{continue;}
      if(Array.isArray(scene?.dialogue))
        recordClasses(s,[{text:scene.narration},...scene.dialogue]);
    }
  }
  function schoolContext(s,ctx){
    const date=ctx.date||s.lastDate,year=schoolYear(date),plan=schoolPlan(s,year);
    const schedule=agenda(s,date);
    const lines=[schedule.map(u=>(u.slot?'오후':'아침')+' '+u.label).join(' / ')||'정규 수업 없음'];
    const seen=SUBJECTS.filter(x=>s.seenClasses?.[x.id]).map(x=>x.name);
    if(seen.length)lines.push('실제 장면 기록에 이미 나온 수업: '+seen.join(', ')+'. 그 수업의 첫 만남·첫 시범을 다시 열지 않는다.');
    const current=schedule.find(u=>u.slot===ctx.slot);
    if(current)lines.push('현재 시간표: '+current.label+'.');
    if(current?.unit){
      const u=current.unit;
      const priorPlan=u.number>1?plan:(year>1?schoolPlan(s,year-1):null);
      const prior=u.number>1?plan.bySubject[u.subject][u.number-2]:priorPlan?.bySubject[u.subject]?.at(-1);
      const previous=prior&&unitFor(s,priorPlan,prior);
      if(previous)lines.push('이 과목의 직전 정규 차시('+prior.date+') 과제: '+previous.topic+'. 이번 수업이 장면에 나오면 오늘 과제의 대상과 결과를 다룬다. 지난 과제는 필요한 배경으로만 언급한다.'+(u.number===1?' 새 학년의 첫 시간이며 과목 입문을 다시 연출하지 않는다.':''));
    }
    const trans=plan.bySubject.transfiguration||[];
    const first=trans[0];
    const introPassed=year>1 || (first && date>first.date) || s.seenClasses?.transfiguration;
    if(introPassed){
      lines.push('변신술 입문 차시는 이미 지났다. 맥고나걸은 후속 수업을 사람 모습으로 진행하며, 교탁의 고양이가 교수로 변하는 첫 시범과 자기소개를 다시 시작하지 않는다.');
      if(!schedule.some(u=>u.unit?.subject==='transfiguration') && /맥고나걸|변신술/.test((ctx.location||'')+' '+(ctx.input||''))){
        const prior=trans.filter(m=>m.date<=date).at(-1);
        const unit=prior&&unitFor(s,plan,prior);
        if(unit)lines.push('시간표 밖에서 이어지는 변신술은 '+prior.date+'의 '+lessonLabel(unit)+' 과제나 질문으로 연결한다.');
      }
    }
    lines.push('차시는 학교 전체의 진도다. 건너뛴 날에 주인공이 직접 출석하거나 시범을 목격했다고 단정하지 않는다. 같은 차시는 이어서, 2차시부터는 후속 실습으로 다룬다. 진행 중인 사건·약속·사용자 행동이 먼저다. 시간표는 배경이다. 직전 장면이 수업이거나 사용자가 수업을 선택할 때만 교실 장면을 진행한다. 별일 없는 수업은 짧게 넘기고 공강에는 다른 수업을 자동으로 시작하지 않는다.');
    return lines.join('\n- ');
  }
  function passiveSchool(s,from,to){
    need(s);
    const previous=from>s.lastDate?from:s.lastDate;
    if(to<=previous||!/^\d{4}-\d{2}-\d{2}$/.test(to))return [];
    const start=Date.parse(previous+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
    if(!Number.isFinite(start)||!Number.isFinite(end))return [];
    const earned=[];
    for(let t=start;t<end;t+=86400000){
      const date=new Date(t).toISOString().slice(0,10);
      for(const unit of curriculum(s,date)){
        const xp=s.subjectXP[unit.subject]||0;
        if(xp<125)s.subjectXP[unit.subject]=Math.min(125,xp+1);
        const spell=SPELL_BY_ID[unit.spell];
        if(!spell||spell.year>4||spell.law!=='ordinary'||spell.difficulty>2||spell.form==='potion'||courseAllowed(s,spell,{date}))continue;
        const p=record(s,spell.id),old=p.xp;
        if(old<72)p.xp=Math.min(72,old+6);
        if(old<LESSON_THRESHOLD&&p.xp>=LESSON_THRESHOLD){p.firstLearned=date;earned.push(spell.name);}
      }
      const nextDay=new Date(t+86400000).toISOString().slice(0,10);
      if(nextDay==='1996-06-01')s.exams.OWL_1996=examGrade(s,5);
      if(nextDay==='1998-06-01')s.exams.NEWT_1998=examGrade(s,7);
      resetDay(s,nextDay);
    }
    s.lastDate=to;
    return earned;
  }
  function examGrade(s,level){
    const grades={};const g=['T','D','P','A','E','O'];
    for(const subj of SUBJECTS){
      if(subj.year>level||subj.group==='선택'&&!s.electives.includes(subj.id))continue;
      if(subj.group==='상급 선택')continue;
      const v=s.subjectXP[subj.id]||0;
      let i=v>=175?5:v>=125?4:v>=80?3:v>=35?2:1;
      if(level===7&&i>4&&v<220)i=4;
      grades[subj.id]=g[i];
    }
    return grades;
  }
  function elective(s,id,ctx){
    need(s);const subject=SUBJECT_BY_ID[id],year=schoolYear(ctx?.date||s.lastDate);
    if(!subject||subject.group!=='선택')return {ok:false,reason:'선택과목이 아니다.'};
    if(year<2)return {ok:false,reason:'선택과목은 2학년 말에 신청한다.'};
    if(s.electives.includes(id))return {ok:true,chosen:s.electives.slice(),reason:'이미 신청한 과목이다.'};
    if(s.electives.length>=3)return {ok:false,reason:'이번 버전에서는 최대 세 과목까지 신청할 수 있다.'};
    s.electives.push(id);return {ok:true,chosen:s.electives.slice(),subject:subject.name};
  }
  function seekDarkAccess(s,ctx){
    need(s);const year=schoolYear(ctx?.date||s.lastDate);
    // Physical access can be attempted at any age; talent is not knowledge.
    if(s.darkAccess)return {ok:true,reason:'금서 연구 경로가 이미 열려 있다.'};
    if(!/도서관|금서|비밀|금지 구역|어둠의 마법/.test(String(ctx?.location||'')))
      return {ok:false,reason:'비밀 자료를 연구하려면 도서관의 제한 구역이나 허가된 연구 장소에 있어야 한다.'};
    s.darkAccess=true;s.infractions.push({date:ctx?.date||s.lastDate,
      id:'restricted_library',kind:'restricted_access',severity:'medium',
      note:'허가되지 않은 자료에 접근한 비밀 행동',discovered:false,witnesses:[]});
    return {ok:true,reason:'위험한 금서 자료에 접근했다. 이것은 저주를 배웠거나 시전에 성공했다는 뜻이 아니며, 학교에 알려지면 처벌받을 수 있다.'};
  }
  function certify(s,which,ctx){
    need(s);ctx=ctx||{};
    const date=ctx.date||s.lastDate,year=schoolYear(date);
    const out=which==='apparition'?'순간이동 면허':'애니마구스 등록';
    if(!['apparition','animagus'].includes(which))
      return {ok:false,reason:'알 수 없는 자격 시험이다.'};
    if(which==='apparition'&&year<6)return {ok:false,reason:'순간이동 교육은 상급 학년에 진행한다.'};
    if(which==='animagus'&&year<7)return {ok:false,reason:'애니마구스 변신은 장기 수련과 등록이 필요하다.'};
    if((s.spells[which]?.xp||0)<80)
      return {ok:false,reason:out+'에 응시하기에는 연습 경험이 충분하지 않다. 관련 실습을 먼저 반복해야 한다.'};
    if(which==='apparition'&&!/호그스미드|마법부|시험장|학교 밖/.test(String(ctx.location||'')))
      return {ok:false,reason:'호그와트 경내의 일반적인 순간이동 방지 마법 때문에 면허 시험은 별도 지정 장소에서 치러야 한다.'};
    if(s.licences[which])return {ok:true,reason:out+'이(가) 이미 승인되어 있다.'};
    const count=(s.practice.castCount||0)+1;
    const roll=1+hash(date+which+'exam'+count)%100;
    const threshold=Math.min(92,55+Math.floor((s.spells[which]?.xp||0)/7));
    s.practice.castCount=count;
    const passed=roll<=threshold;
    if(passed)s.licences[which]=true;
    return {ok:passed,reason:out+' 시험 '+(passed?'합격':'불합격')+
      ' (판정 '+roll+' / 성공 기준 '+threshold+'). '+(passed?'등록 기록이 남았다.':'추가 연습 후 재응시할 수 있다.')};
  }
  function cast(s,id,ctx){
    need(s);ctx=ctx||{};const spell=SPELL_BY_ID[id];const date=ctx.date||s.lastDate;
    if(!spell)return {ok:false,reason:'주문 이름을 확인할 수 없다.'};
    resetDay(s,date);
    const p=s.spells[id];if(!p||p.xp<LESSON_THRESHOLD)return {ok:false,id,
      reason:spell.name+'은(는) 아직 시전 가능한 수준으로 배운 적이 없다. 먼저 수업이나 연구로 습득해야 한다.'};
    if(spell.form==='potion')return {ok:false,id,
      reason:spell.name+'은(는) 주문이 아니라 마법약이다. 재료와 실습실에서 제조해야 한다.'};
    const year=schoolYear(date);
    if(spell.year>year&&(!PROFILE||PROFILE.ensure(s).aptitude.learning<90))
      return {ok:false,id,reason:'현재 학년의 지식과 숙련도로 안정적으로 다룰 수 없는 기술이다.'};
    if(spell.id==='apparition'){
      if(ctx.inHogwarts!==false)return {ok:false,id,reason:'호그와트 경내에서는 일반적으로 순간이동이 불가능하다.'};
    }
    // Licence and Animagus registration determine legality, not innate ability.
    const counter=++s.practice.castCount;
    const roll=1+hash(date+'cast'+id+counter+String(ctx.target||''))%100;
    const mastery=Math.min(35,Math.floor(p.xp/8));
    const talent=PROFILE?PROFILE.talentBonus(s,spell):0;
    const threshold=Math.max(7,Math.min(talent?99:94,43+mastery+talent+(ctx.supervised?10:0)-
      (spell.difficulty*7)-Math.floor(s.practice.fatigue/8)-
      (ctx.duelDifficulty||0)));
    const success=roll<=threshold;
    s.practice.fatigue=Math.min(100,s.practice.fatigue+Math.ceil(spell.difficulty*1.8));
    const violation=spell.law==='unforgivable'?'unforgivable':
      spell.law==='dark'?'dark_curse':
      spell.id==='apparition'&&!s.licences?.apparition?'unlicensed_apparition':
      spell.id==='animagus'&&!s.licences?.animagus?'unregistered_animagus':
      spell.law==='restricted'&&!ctx.permission?'restricted_use':
      spell.law==='caution'&&ctx.againstPerson&&!ctx.duelAuthorized?'unsafe_cast':null;
    // Casting can be illegal without being observed. A private offence is not a
    // reported crime; each present NPC learns only what they actually witness.
    const observers=PROFILE?PROFILE.registerWitnesses(s,spell,{...ctx,date,castIndex:counter},
      {success,violation}):[];
    if(violation)s.infractions.push({date,id,kind:violation,
      severity:spell.law==='unforgivable'?'critical':spell.law==='dark'?'high':'medium',
      target:ctx.target||null,note:spell.effect,discovered:observers.length>0,witnesses:observers});
    const result={ok:true,id,name:spell.name,roll,threshold,success,
      violation,exposed:observers.length>0,witnesses:observers,spellEffect:spell.effect,rank:rank(p.xp),
      consequence:success?'주문은 발동했다. 실제 대상에 대한 결과는 현장·보호막·거리·상대 저항을 별도로 판정한다.':
        '발동에 실패하거나 불완전한 효과만 나타났다. 자동으로 피해가 발생하지 않는다.'};
    s.castHistory.push({date,id,success,violation,roll,witnesses:observers});
    s.castHistory=s.castHistory.slice(-50);
    return result;
  }
  function page(s,year,part){
    need(s);part=Math.max(0,Math.floor(Number(part)||0));
    let content=SPELLS.filter(x=>x.year<=year&&x.law!=='dark'&&x.law!=='unforgivable');
    const pages=Math.max(1,Math.ceil(content.length/8));
    part=Math.min(part,pages-1);
    return {page:part,pages,spells:content.slice(part*8,(part+1)*8).map(x=>({
      id:x.id,name:x.name,subject:SUBJECT_BY_ID[x.subject].name,
      rank:rank(s.spells[x.id]?.xp||0),law:x.law}))};
  }
  function availableTraining(s,year,ctx){
    need(s);
    return SPELLS.filter(x=>x.year<=year&&((x.law!=='dark'&&x.law!=='unforgivable')||s.darkAccess)&&
      !courseAllowed(s,x,ctx||{date:s.lastDate}));
  }
  function practiceChoices(s,year,ctx,part){
    const list=availableTraining(s,year,ctx);
    const page=Math.max(0,Math.floor(Number(part)||0));
    const pages=Math.max(1,Math.ceil(list.length/8));
    return {page:Math.min(page,pages-1),pages,choices:list.slice(Math.min(page,pages-1)*8,(Math.min(page,pages-1)+1)*8)
      .map(x=>'▶ 마법 연습 ['+x.id+'] — '+x.name)};
  }
  function findIncantation(input){
    const value=String(input||'').toLowerCase().replace(/\s+/g,' ').trim();
    for(const spell of SPELLS){
      const words=[spell.incantation,spell.name,...(ALIASES[spell.id]||[])];
      if(words.some(x=>x.length>=3&&value.includes(x.toLowerCase())))return spell;
    }
    return null;
  }
  function parseCommand(text){
    const input=String(text||'').trim();
    if(/^▶\s*마법 도감/.test(input))return {kind:'book',page:Number(input.match(/\[(\d+)\]/)?.[1]||0)};
    if(/^▶\s*마법 수업/.test(input))return {kind:'lessons',page:Number(input.match(/\[(\d+)\]/)?.[1]||0)};
    if(/^▶\s*마법 연습/.test(input)){const m=/\[([a-z0-9_]+)\]/.exec(input);return {kind:'study',id:m?.[1]};}
    if(/^▶\s*마법 시전/.test(input)){const m=/\[([a-z0-9_]+)\]/.exec(input);return {kind:'cast',id:m?.[1]};}
    if(/^▶\s*선택과목/.test(input)){const m=/\[([a-z0-9_]+)\]/.exec(input);return {kind:'elective',id:m?.[1]};}
    if(/^▶\s*금서 열람/.test(input))return {kind:'dark'};
    if(/^▶\s*마법 자격시험/.test(input)){const m=/\[([a-z0-9_]+)\]/.exec(input);return {kind:'certify',id:m?.[1]};}
    if(/^▶\s*마법 메뉴 닫기/.test(input))return {kind:'close'};
    return null;
  }
  function parseFreeCast(text){
    const s=String(text||'').trim();
    if(!s||/\?$|어떻게|무엇|뭐야|뜻|배우|설명|알려|궁금/.test(s))return null;
    if(!/시전|주문을|마법을|날린다|쏜다|외친다|사용한다|지팡이로|마법약을 제조/.test(s))return null;
    const sp=findIncantation(s);return sp?{kind:'free_cast',id:sp.id}:null;
  }
  function context(s,ctx){
    need(s);ctx=ctx||{};const year=schoolYear(ctx.date||s.lastDate);
    const learned=SPELLS.filter(x=>(s.spells[x.id]?.xp||0)>=LESSON_THRESHOLD);
    const list=learned.map(x=>x.name+'('+rank(s.spells[x.id].xp)+')').join(', ');
    const selected=s.electives.map(id=>SUBJECT_BY_ID[id]?.name).filter(Boolean).join(', ');
    return '\n\n## ★호그와트 전용 마법학(이 상태만이 주문 습득·시전의 확정 근거)\n'
      +'- 학년 '+year+'. 실제로 배운 주문/실습: '+(list||'아직 없음')+'.\n'
      +'- 오늘의 정규 진도: '+schoolContext(s,ctx)+'\n'
      +'- 이미 끝난 실습은 한 문장으로 넘긴다. 종이 울리면 지난 수업을 다시 열지 말고 학생들이 자신의 용무로 흩어지게 한다. 선택지는 현재 인물과 장소에서 가능한 행동을 주며 다음 수업을 의무화하지 않는다.\n'
      +'- 선택과목: '+(selected||'미정')+'. 실습 피로도 '+s.practice.fatigue+'/100.\n'
      +'- 금서 접근: '+(s.darkAccess?'접근 기록 있음(저주 사용 허가 아님)':'없음')+'. 내부 위험행위 '+s.infractions.length+'건, 실제 목격된 위반 '+s.infractions.filter(x=>x.discovered).length+'건. 목격되지 않은 위반은 자동 신고되지 않는다.\n'
      +'- 최근 앱 확정 시전: '+(s.lastCast ? s.lastCast.name+' / '+(s.lastCast.success?'발동':'실패')+' / '+(s.lastCast.violation||'규정 위반 없음') : '없음')+'. 타인에 대한 실제 결과는 장면과 방어·증거 판정을 따른다.\n'
      +'- 수업은 기본 학습 경로이지 필수가 아니다. 독학·목격된 시전·스승·입학 전 지식으로도 배운다. 천재는 학년보다 빨리 익혀도 모르는 주문을 대사만으로 얻지 못한다.\n'
      +'- [주문 시전 결과]는 앱의 확정 판정을 따른다. 플레이어가 스스로 성공을 선언해도 불법 주문·알지 못하는 주문·학교 경내 순간이동 등 불변 조건을 넘길 수 없다.\n'
      +'- 용서받지 못할 저주 세 가지: Imperio, Crucio, Avada Kedavra. 일반 마법법에서 불법이며 사용은 아즈카반 종신형 위험. 정권 장악기에는 집행이 왜곡될 수 있으나 학교 내부 대인 공격은 타인과의 관계·법적 후과를 남긴다.\n'
      +'- 변신술, 주문학, 마법약, 방어술, 약초학, 천문학, 마법 역사 일곱 필수 과목과 1학년 비행, 3학년 선택과목, 5학년 O.W.L., 7학년 N.E.W.T.를 따른다.\n'
      +'- 비마법 스킬은 일반 RPG 엔진에서 취급할 수 있으나 주문 목록과 숙련도는 AI가 state_update.player.skills/abilities로 독단적으로 고쳐 쓰지 못한다.\n'
      +(PROFILE?PROFILE.context(s):'');
  }
  return Object.freeze({SUBJECTS,SPELLS,SPELL_BY_ID,ALIASES,createState,valid,schoolYear,rank,courseAllowed,
    lesson,curriculum,agenda,recordClasses,restoreClasses,passiveSchool,examGrade,elective,seekDarkAccess,certify,cast,page,availableTraining,practiceChoices,
    findIncantation,parseCommand,parseFreeCast,context,LESSON_THRESHOLD});
});
