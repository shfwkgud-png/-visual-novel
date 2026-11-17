/* Hogwarts living-world scene director.
   A scene stays open for as many dialogue turns as the player wants.
   NPC appointments, the world's calendar, and mutually exclusive encounters
   advance ONLY at explicit scene boundaries. All state is serializable. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PandoraHogwartsWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KIND = { plot:'정사 사건', person:'개인 사건', life:'학교 생활', aftermath:'선택의 후폭풍', chapter:'원작 장별 생활 사건' };
  let CHAPTER_CATALOG=null,CHAPTER_HELPER=null;
  function installChapterCatalog(catalog,helper) {
    if (!catalog||!catalog.byId||!helper||typeof helper.nextPlayable!=='function')throw Error('Hogwarts chapter catalog is not ready');
    CHAPTER_CATALOG=catalog;CHAPTER_HELPER=helper;
    return catalog.summary;
  }
  const EVENT_CHOICE = /^▶\s*선택\s*\[([a-z0-9_-]+)\]\s*([a-z0-9_-]+)\b/i;
  // JavaScript \b only recognizes ASCII word characters: after Korean text it
  // does NOT match a space. These controls were falling through into AI chat.
  const SCENE_NEXT = /^▶\s*다음 장면(?=\s|$)/;
  const SCENE_FINISH = /^▶\s*장면 마치기(?=\s|$)/;
  // Fixed design anchors are intentionally broad except for unambiguous canon dates
  // (e.g. Halloween). Other dates are scenario pacing, NOT asserted novel canon.
  const EVENTS = [
    { id:'first_invitations', year:1, date:'1991-09-03', slot:2, kind:'person',
      title:'같은 저녁, 다른 두 통의 초대', background:'corridor', actors:['malfoy','crabbe','goyle','hermione'],
      intro:'입학식이 끝난 지 이틀째. 헤르미온느는 함께 도서관에서 과제를 조사하자고 한다. 거의 동시에 여성 말포이는 슬리데린 학생들의 비공식 모임에 당신을 초대한다. 두 약속은 같은 저녁이다. 누군가의 하루는 당신이 없어도 계속된다.',
      options:[
        {id:'malfoy',label:'말포이의 모임에 간다',intent:'말포이의 사교 모임에 참석한다. 말포이는 쉽게 마음을 열지 않으며 혈통과 가문에 대한 날 선 질문을 한다.',delta:{malfoy:3,hermione:-1},flags:{first_circle:'malfoy'},offscreen:'헤르미온느는 혼자 과제를 조사했고, 도와주지 않은 일을 기억한다.'},
        {id:'hermione',label:'헤르미온느와 도서관에서 공부한다',intent:'도서관에서 헤르미온느를 돕는다. 그녀는 실제 실력과 태도를 보고 판단하며 호의적으로 미리 굴지 않는다.',delta:{malfoy:-1,hermione:3},flags:{first_circle:'hermione'},offscreen:'말포이는 크래브와 고일과 함께 모임을 열었고, 당신의 불참을 기억한다.'},
        {id:'alone',label:'두 약속 모두 거절하고 혼자 탐색한다',intent:'성의 비밀 통로를 혼자 탐색한다. 발견이나 위험은 현재 능력에 맞게 제한한다.',delta:{malfoy:-1,hermione:-1},flags:{first_circle:'independent'},offscreen:'말포이는 자신의 모임을 진행하고, 헤르미온느는 혼자 과제를 마쳤다.'}
      ]},
    { id:'snape_class',year:1,date:'1991-09-09',slot:1,kind:'life',
      title:'스네이프의 첫 질문',background:'potions',actors:['snape','neville','hermione'],
      intro:'지하 마법약 교실. 첫 실습이 한창인데 네빌의 솥에서 위험한 연기가 치솟는다. 스네이프의 시선이 당신에게 닿는다. 수업에서 한 선택이 앞으로 누가 당신을 믿는지 바꾼다.',
      options:[
        {id:'protect',label:'네빌을 돕고 책임을 함께 진다',intent:'네빌의 실수를 막고 스네이프의 질책도 감수한다.',delta:{neville:3,snape:-1},flags:{snape_class:'protect'},offscreen:'네빌은 도움을 잊지 않고, 스네이프는 당신이 규칙보다 친구를 택한 사실을 기억한다.'},
        {id:'challenge',label:'스네이프의 방식에 공개적으로 이의를 제기한다',intent:'근거를 들어 교수에게 반박한다. 무모함에는 불이익이 따라야 한다.',delta:{snape:-2,hermione:1},flags:{snape_class:'challenge'},offscreen:'교실에 당신의 행동에 관한 소문이 퍼진다.'},
        {id:'focus',label:'수업을 수습하고 조용히 실력을 증명한다',intent:'위험을 안전하게 수습하는 데 집중하되 다른 사람의 공은 빼앗지 않는다.',delta:{snape:1,neville:0},flags:{snape_class:'focus'},offscreen:'네빌은 다른 이의 도움으로 실습을 마친다.'}
      ]},
    { id:'midnight_corridor',year:1,date:'1991-09-22',slot:3,kind:'aftermath',
      title:'밤의 결투 약속',background:'corridor',actors:['malfoy','harry','ron'],
      intro:'해리와 말포이가 밤늦게 결투를 약속했다는 소문이 돈다. 약속을 곧이곧대로 믿는 학생도, 함정을 의심하는 학생도 있다. 필치는 야간 순찰을 시작했다.',
      options:[
        {id:'warn',label:'해리에게 함정일 수 있다고 경고한다',intent:'해리에게 의심을 전하고 선택은 그에게 맡긴다.',delta:{harry:2,malfoy:-1},flags:{night_duel:'warned'},offscreen:'말포이는 계획이 엇나간 원인을 찾기 시작한다.'},
        {id:'follow',label:'멀리서 사건을 관찰한다',intent:'눈에 띄지 않게 뒤따라간다. 관찰 범위 밖의 비밀은 알 수 없다.',delta:{malfoy:0,harry:0},flags:{night_duel:'observed'},offscreen:'다른 학생들은 저마다 결투 소문에 반응한다.'},
        {id:'avoid',label:'이 일에 개입하지 않고 기숙사로 돌아간다',intent:'위험한 야간 이동을 피하고 방으로 돌아간다.',delta:{},flags:{night_duel:'ignored'},offscreen:'결투 약속과 복도 소동은 당신 없이 진행된다.'}
      ]},
    { id:'halloween_troll',year:1,date:'1991-10-31',slot:2,kind:'plot',
      title:'핼러윈, 트롤 침입',background:'great_hall',actors:['harry','ron','hermione','quirrell','mcgonagall'],
      intro:'핼러윈 만찬 도중 퀴렐이 들어와 트롤 침입을 알린다. 교수들은 학생들을 통제하려 하지만, 헤르미온느가 어디에 있는지 아는 사람은 거의 없다. 당신에게는 제한된 시간과 정보만 있다.',
      options:[
        {id:'rescue',label:'헤르미온느가 있을 법한 곳으로 달려간다',intent:'교수의 통제를 벗어나 헤르미온느를 찾는다. 트롤과의 대면에는 실제 실패·부상 위험이 있고 다른 이들이 동시에 행동한다.',delta:{hermione:3,harry:1,ron:1},flags:{troll_intervention:'rescue_attempt'},offscreen:'해리와 론도 헤르미온느를 찾으려 움직인다. 누가 먼저 도착하는지는 그날 실제 장면에서 결정한다.'},
        {id:'teachers',label:'교수에게 위치 정보를 알리고 구조를 돕는다',intent:'안전한 구조 협조를 택한다. 교수들의 행동을 내 의지로 조종하지 않는다.',delta:{mcgonagall:2,hermione:1},flags:{troll_intervention:'informed_staff'},offscreen:'해리와 론은 자신들의 판단으로 움직인다. 당신이 못 본 구출 과정은 직접 목격한 것으로 기록하지 않는다.'},
        {id:'safe',label:'기숙사 학생들을 먼저 안전하게 이동시킨다',intent:'근처 학생들의 피난과 수습에 집중한다.',delta:{neville:1},flags:{troll_intervention:'evacuation'},offscreen:'다른 장소의 트롤 사건과 해리 일행의 선택은 당신 없이 계속된다.'}
      ]},
    { id:'first_quidditch',year:1,date:'1991-11-10',slot:1,kind:'plot',
      title:'첫 퀴디치 경기',background:'quidditch',actors:['harry','ron','hermione','snape'],
      intro:'관중석이 흔들리는 첫 퀴디치 경기. 해리의 빗자루가 비정상적으로 날뛰기 시작하고, 누군가 교수석을 노려본다. 지금 당신이 아는 건 눈앞의 광경뿐이다.',
      options:[
        {id:'investigate',label:'교수석의 이상 징후를 조사한다',intent:'자기 자리에서 관찰하고 현재 목격한 것만 추론한다. 범인의 정체를 전지적으로 알아내지 마라.',delta:{hermione:1},flags:{broom_response:'investigated'},offscreen:'경기의 진상은 관계자 각자의 지식에 따라 비밀로 남는다.'},
        {id:'help',label:'관중에게 위험을 알리고 도움을 청한다',intent:'관중의 안전과 도움을 우선한다.',delta:{harry:1},flags:{broom_response:'alerted'},offscreen:'현장의 교수들은 독립적으로 행동한다.'},
        {id:'watch',label:'침착하게 경기의 흐름을 지켜본다',intent:'우선 주변에서 무엇이 벌어지는지 확인한다.',delta:{},flags:{broom_response:'watched'},offscreen:'사건은 당신의 직접 개입 없이 진행된다.'}
      ]},
    { id:'winter_choice',year:1,date:'1991-12-24',slot:2,kind:'person',
      title:'크리스마스 이브의 빈 자리',background:'dormitory',actors:['malfoy','hermione','hagrid'],
      intro:'방학을 앞둔 호그와트. 어떤 학생은 집으로 돌아가고, 어떤 학생은 성에 남는다. 당신에게도 서로 다른 사람들과 보낼 시간이 있지만 모두를 만날 수는 없다.',
      options:[
        {id:'malfoy',label:'말포이의 겨울 모임에 참석한다',intent:'말포이의 가족 기대와 사교 관계에 관한 긴장감을 본다. 관계가 좋지 않다면 초대가 냉담하거나 조건부일 수 있다.',delta:{malfoy:2},flags:{winter:'malfoy'},offscreen:'헤르미온느는 별도의 공부 계획을 진행하고 해그리드는 자신의 일과를 이어간다.'},
        {id:'study',label:'도서관에서 공부와 조사를 이어간다',intent:'스스로 공부하고 헤르미온느와 함께할 가능성을 살핀다. 친분은 현재 관계값을 따르게 한다.',delta:{hermione:2},flags:{winter:'study'},offscreen:'말포이의 모임은 다른 학생들과 진행된다.'},
        {id:'hagrid',label:'해그리드의 오두막을 방문한다',intent:'해그리드와 차를 마시며 학교 생활에 관한 이야기를 듣는다. 위험한 비밀은 쉽게 말하지 않는다.',delta:{hagrid:2},flags:{winter:'hagrid'},offscreen:'기숙사 모임과 도서관 일정은 독립적으로 끝난다.'}
      ]},
    { id:'mirror_rumor',year:1,date:'1992-02-12',slot:2,kind:'life',
      title:'사라진 학생과 금지된 복도',background:'library',actors:['hermione','harry','filch'],
      intro:'금지된 복도 근처에서 이상한 흔적이 발견된다. 도서관의 기록 몇 장도 사라졌다. 그 소문을 말하는 학생마다 본 것이 다르다.',
      options:[
        {id:'records',label:'도서관에서 정식 자료부터 조사한다',intent:'확인 가능한 자료만 조사한다. 초자연적 비밀은 자동으로 알아내지 못한다.',delta:{hermione:1},flags:{clue_path:'records'},offscreen:'해리는 자신이 겪은 일을 모든 사람에게 공개하지 않는다.'},
        {id:'corridor',label:'복도에서 위험을 감수하고 직접 단서를 찾는다',intent:'순찰에 걸리거나 빈손으로 돌아갈 수 있는 조사를 한다.',delta:{filch:-1},flags:{clue_path:'corridor'},offscreen:'기숙사에 조사가 소문으로 돌 수 있다.'},
        {id:'leave',label:'소문을 기록해 두고 학업을 우선한다',intent:'미확인 소문으로 무리하지 않는다.',delta:{},flags:{clue_path:'recorded'},offscreen:'조사는 다른 학생들이 계속한다.'}
      ]},
    { id:'spring_duel',year:1,date:'1992-04-03',slot:1,kind:'person',
      title:'누가 내 편인가',background:'dueling',actors:['malfoy','harry','neville'],
      intro:'결투 연습에서 말포이와 다른 학생들의 말싸움이 커진다. 1학년 내내 쌓아 온 관계가 이제 편을 가르는 이유가 된다. 누구도 당신을 자동으로 자기 편이라 여기지 않는다.',
      options:[
        {id:'mediate',label:'논쟁의 원인을 묻고 중재한다',intent:'상대의 말을 듣고 사실을 구분하려 한다. 무조건 모두와 친해지지는 않는다.',delta:{harry:1,malfoy:1},flags:{spring_duel:'mediated'},offscreen:'당신이 양쪽 편에 서지 않은 이유를 학생들마다 다르게 해석한다.'},
        {id:'defend',label:'친구로 선택한 사람을 공개적으로 지지한다',intent:'기존에 쌓인 관계를 기준으로 실제 가까운 쪽을 지지한다.',delta:{},flags:{spring_duel:'supported_friend'},offscreen:'지지받지 못한 쪽은 그 장면을 기억한다.'},
        {id:'practice',label:'말싸움 대신 자기 결투 실력을 보여준다',intent:'성급한 만능 마법은 불가능하다. 수련의 성취와 실패를 실제 준비 상태로 판정한다.',delta:{neville:1},flags:{spring_duel:'practiced'},offscreen:'학생들의 갈등은 당신이 자리를 떠난 뒤에도 계속된다.'}
      ]},
    { id:'forest_warning',year:1,date:'1992-05-18',slot:3,kind:'plot',
      title:'금지된 숲에서 들려온 소리',background:'night_garden',actors:['hagrid','harry','hermione','neville'],
      intro:'금지된 숲에서 다친 생물이 발견됐다는 소문. 해그리드는 불안해 보인다. 출입 제한 구역을 조사할지, 맡은 일만 할지 판단해야 한다.',
      options:[
        {id:'with_hagrid',label:'해그리드를 도와 안전하게 조사한다',intent:'해그리드가 허락한 범위에서 발자국과 현장을 살핀다.',delta:{hagrid:2},flags:{forest:'helped'},offscreen:'다른 학생들은 자신들의 징계·수업과 관련된 일을 처리한다.'},
        {id:'secret',label:'규칙을 어기고 직접 추적한다',intent:'교직원 보호 없이 추적한다. 위험과 실패가 실제로 따를 수 있다.',delta:{hagrid:-1},flags:{forest:'sneaked'},offscreen:'누군가 숲에서 당신을 목격했을 가능성이 남는다.'},
        {id:'abstain',label:'무리하지 않고 정보를 기록해 둔다',intent:'안전한 경로로 소문을 확인한다.',delta:{},flags:{forest:'stayed'},offscreen:'금지된 숲의 사건은 다른 인물들의 선택대로 진행된다.'}
      ]},
    { id:'stone_finale',year:1,date:'1992-06-07',slot:2,kind:'plot',
      title:'함정문 너머의 밤',background:'corridor',actors:['harry','ron','hermione','mcgonagall'],
      intro:'시험이 끝나고도 호그와트는 조용하지 않다. 해리 일행은 무언가를 서두르는 눈치다. 당신은 1학년 동안 모아 온 정보와 신뢰만 가지고 판단해야 한다.',
      options:[
        {id:'follow',label:'해리 일행에게 협력을 제안한다',intent:'거절당할 가능성도 있다. 비밀을 알고 있다는 전제로 행동하지 말며 실제 준비와 신뢰에 따라 결과를 결정한다.',delta:{harry:2,hermione:1},flags:{stone_finale:'tried_to_join'},offscreen:'해리 일행은 당신의 참여 여부에 관계없이 자신의 결정을 내린다.'},
        {id:'report',label:'교수들에게 확인한 근거를 전달한다',intent:'확실한 증거만 말한다. 교수들은 독립적으로 판단한다.',delta:{mcgonagall:2},flags:{stone_finale:'reported'},offscreen:'학생들 역시 각자 상황에 맞춰 움직인다.'},
        {id:'protect',label:'친구들과 기숙사의 안전을 우선한다',intent:'학교 내부의 위험에 대비한다. 모든 핵심 사건의 현장에 억지로 끌려가지 않는다.',delta:{malfoy:0},flags:{stone_finale:'protected_house'},offscreen:'해리 일행의 핵심 대결은 현장에서 직접 보지 못한 것으로 기록한다.'}
      ]},
    { id:'end_of_first_year',year:1,date:'1992-06-26',slot:1,kind:'aftermath',
      title:'첫해의 마지막 기차',background:'hogwarts_courtyard',actors:['malfoy','hermione','harry'],
      intro:'첫 학년의 마지막 날. 지난 가을의 초대에 응했는지, 누구의 곁에 서 있었는지, 무엇을 보았는지가 작별 인사에 묻어난다. 다음 해에는 같은 관계로 돌아오지 못할 수도 있다.',
      options:[
        {id:'friends',label:'가까워진 친구들에게 작별을 고한다',intent:'쌓인 관계에 근거한 인사와 다음 학년의 약속을 나눈다.',delta:{},flags:{year1_end:'friends'},offscreen:'방학 동안 인물들의 각자 계획은 계속 진행된다.'},
        {id:'quiet',label:'혼자 한 해의 사건을 정리한다',intent:'자신이 실제로 목격한 것만 회고한다.',delta:{},flags:{year1_end:'quiet'},offscreen:'다른 학생들은 각자 떠나거나 방학을 시작한다.'},
        {id:'promise',label:'내년에는 다른 선택을 하겠다고 결심한다',intent:'달라질 수도 있는 관계와 선택에 관해 성찰한다.',delta:{},flags:{year1_end:'promise'},offscreen:'변화는 선언만으로 이루어지지 않고 다음 해 실제 행동으로 입증해야 한다.'}
      ]},
    {id:'chamber_opening',year:2,date:'1992-10-31',slot:2,kind:'plot',title:'벽에 남은 경고',background:'corridor',actors:['harry','hermione','malfoy'],intro:'학교 복도에 섬뜩한 메시지가 남고 학생들 사이에 혈통과 비밀의 방 소문이 번진다. 당신이 무엇을 알 수 있는지는 위치와 앞선 관계에 달려 있다.',options:[
      {id:'investigate',label:'현장의 소문과 증거를 구분한다',intent:'직접 확인 가능한 흔적만 조사한다.',delta:{hermione:1},flags:{chamber:'investigate'},offscreen:'학교의 공포는 다른 인물들의 선택에도 영향을 미친다.'},
      {id:'protect',label:'불안해하는 기숙사 학생들을 돕는다',intent:'기숙사 내에서 실제로 믿는 사람들을 돕는다.',delta:{neville:1},flags:{chamber:'protect'},offscreen:'다른 학생들도 자신들의 방식으로 대응한다.'},
      {id:'distance',label:'거리를 두고 변화를 주시한다',intent:'의심과 불확실성을 인정한다.',delta:{},flags:{chamber:'distance'},offscreen:'사건은 당신이 없더라도 진행된다.'}]},
    {id:'chamber_finale',year:2,date:'1993-06-01',slot:2,kind:'plot',title:'사라진 학생',background:'corridor',actors:['harry','ron','ginny'],intro:'학교의 봉쇄가 강화되며 한 학생이 사라졌다는 소식이 전해진다. 학교 전체가 긴장에 휩싸인다.',options:[
      {id:'search',label:'확인된 범위에서 수색을 돕는다',intent:'단서를 좇되 위험에 따른 대가를 인정한다.',delta:{ginny:1},flags:{chamber_end:'search'},offscreen:'해리는 자신이 발견한 단서를 활용해 독립적으로 움직인다.'},
      {id:'staff',label:'교직원과 함께 질서를 유지한다',intent:'학생 안전을 보조한다.',delta:{mcgonagall:1},flags:{chamber_end:'staff'},offscreen:'비밀의 방 내부는 직접 목격하지 않는 한 알지 못한다.'}]},
    {id:'azkaban_opening',year:3,date:'1993-09-04',slot:1,kind:'plot',title:'디멘터의 그림자',background:'corridor',actors:['harry','lupin','malfoy'],intro:'아즈카반 탈옥 소식과 함께 학교 주변의 디멘터 경계가 강화된다.',options:[
      {id:'study',label:'루핀에게 방어법을 묻는다',intent:'학습과 연습에 실제 시간이 필요하다.',delta:{lupin:2},flags:{dementor:'study'},offscreen:'시리우스의 행방을 아무도 자동으로 알지 못한다.'},
      {id:'observe',label:'당장의 안전을 챙기고 사건을 관찰한다',intent:'증거 없는 단정 없이 관찰한다.',delta:{},flags:{dementor:'observe'},offscreen:'보안 강화는 계속된다.'}]},
    {id:'pettigrew_crossroads',year:3,date:'1994-06-06',slot:3,kind:'plot',title:'비명을 지르는 오두막의 비밀',background:'shrieking_shack',actors:['harry','ron','hermione','lupin','sirius'],intro:'오두막 근처에서 다툼이 벌어지고 시리우스 블랙의 정체를 둘러싼 이야기들이 충돌한다. 무엇을 믿을지는 지금껏 확인한 증거에 달렸다.',options:[
      {id:'intervene',label:'정면으로 진실 확인에 나선다',intent:'증거를 직접 확인해 행동한다. 피터가 도망칠지 여부는 실제 행동과 실패 가능성을 고려한다.',delta:{harry:1},flags:{pettigrew:'investigate'},offscreen:'누구의 생존과 탈출도 단정하지 말고 실제 결과가 기록될 때만 확정한다.'},
      {id:'stay',label:'섣부른 개입보다 안전한 증언을 남긴다',intent:'관찰한 범위만 증언한다.',delta:{},flags:{pettigrew:'witness'},offscreen:'오두막에서 벌어지는 다른 사건들은 각자 독립적으로 진행된다.'}]},
    {id:'goblet_tournament',year:4,date:'1994-10-31',slot:2,kind:'plot',title:'불의 잔의 이름',background:'great_hall',actors:['harry','cedric','malfoy'],intro:'트리위저드 대표가 발표되고 규칙을 벗어난 이름이 나온다. 학교 전체가 편을 나누기 시작한다.',options:[
      {id:'support',label:'소문보다 사실을 확인하고 해리에게 접근한다',intent:'상대가 즉시 신뢰하지 않을 수 있다.',delta:{harry:1},flags:{goblet:'support'},offscreen:'각 학교와 선수의 판단은 별개다.'},
      {id:'rival',label:'학생들 사이의 경쟁과 의혹을 추적한다',intent:'근거를 모으면서 위험을 감수한다.',delta:{},flags:{goblet:'rival'},offscreen:'시합은 당신이 없어도 계속된다.'}]},
    {id:'goblet_graveyard',year:4,date:'1995-06-24',slot:3,kind:'plot',title:'시합이 끝난 밤',background:'great_hall',actors:['harry','cedric','albus'],intro:'세 번째 시합의 마지막 밤. 축제가 공포로 뒤바뀌고 돌아오지 않는 사람을 기다리는 시간이 길어진다.',options:[
      {id:'comfort',label:'돌아온 이들을 돕고 소식을 확인한다',intent:'실제 목격·증언만 믿는다.',delta:{harry:1},flags:{goblet_end:'comfort'},offscreen:'볼드모트 부활의 구체적 경위는 직접 확인한 인물만 알고 있다.'},
      {id:'investigate',label:'현장의 이상한 조짐을 조사한다',intent:'기록과 증인을 찾는다.',delta:{},flags:{goblet_end:'investigate'},offscreen:'마법부의 정치적 대응은 독립적으로 발생한다.'}]},
    {id:'phoenix_decree',year:5,date:'1995-09-04',slot:1,kind:'plot',title:'새로운 교육령',background:'classroom',actors:['umbridge','harry','hermione'],intro:'마법부의 지침을 들고 온 엄브리지가 수업과 학생의 행동을 통제하기 시작한다.',options:[
      {id:'resist',label:'공개적으로 규정의 문제를 제기한다',intent:'실제 징계 위험을 감수한다.',delta:{umbridge:-2,harry:1},flags:{phoenix:'resist'},offscreen:'학생들 사이에 당신의 행동이 알려진다.'},
      {id:'caution',label:'의도를 숨기고 정보부터 모은다',intent:'조용히 자료를 기록한다.',delta:{},flags:{phoenix:'caution'},offscreen:'통제는 다른 학생들에게도 적용된다.'}]},
    {id:'phoenix_department',year:5,date:'1996-06-18',slot:3,kind:'plot',title:'마법부에서 온 불길한 소식',background:'corridor',actors:['harry','albus','mcgonagall'],intro:'한밤중 마법부에 관한 불길한 소식이 학교로 전해진다.',options:[
      {id:'help',label:'믿을 수 있는 사람들을 지원한다',intent:'현재 위치와 지식으로 가능한 범위에서만 행동한다.',delta:{harry:1},flags:{phoenix_end:'help'},offscreen:'마법부 내부의 실제 사건을 억지로 목격하지 않는다.'},
      {id:'listen',label:'정보를 확인하고 혼란을 막는다',intent:'확인되지 않은 사망·생존 정보를 사실처럼 확정하지 않는다.',delta:{},flags:{phoenix_end:'listen'},offscreen:'기사단의 대응은 독립적으로 이어진다.'}]},
    {id:'prince_secret',year:6,date:'1996-09-08',slot:2,kind:'person',title:'말포이가 숨긴 것',background:'corridor',actors:['malfoy','snape'],intro:'여성 말포이는 전과 다르게 행동한다. 교복 뒤에 감춘 사정과 가족의 압박을 누구에게도 쉽게 털어놓지 않는다.',options:[
      {id:'reach',label:'억지로 캐묻지 않고 다가간다',intent:'1~5학년의 관계 기록대로 말포이가 신뢰하거나 경계하도록 한다.',delta:{malfoy:1},flags:{prince:'approached'},offscreen:'말포이는 자신의 임무를 혼자 감당하려는 선택을 계속한다.'},
      {id:'investigate',label:'수상한 행동을 객관적으로 조사한다',intent:'증거 없는 의심을 확정 사실로 바꾸지 않는다.',delta:{malfoy:-1},flags:{prince:'investigate'},offscreen:'다른 학생들도 평소와 달라진 말포이를 느끼기 시작한다.'}]},
    {id:'prince_tower',year:6,date:'1997-06-30',slot:3,kind:'plot',title:'천문탑의 밤',background:'astronomy',actors:['malfoy','snape','albus'],intro:'호그와트의 안전이 흔들리는 밤. 누군가의 선택이 전쟁의 시작을 알릴 수 있다.',options:[
      {id:'intervene',label:'지금까지 파악한 증거로 개입을 시도한다',intent:'선행 사건과 실제 관찰·실력이 부족하면 실패할 수 있다. 결과는 행동의 증거로 기록해야 한다.',delta:{},flags:{tower:'intervene_attempt'},offscreen:'지팡이 충성권과 생존 여부는 임의로 재작성하지 않는다.'},
      {id:'protect',label:'다른 학생들의 피난을 돕는다',intent:'구출과 생존을 우선한다.',delta:{},flags:{tower:'evacuation'},offscreen:'천문탑에서 벌어지는 핵심 선택은 별도의 인물들이 수행한다.'}]},
    {id:'hallows_school',year:7,date:'1997-09-02',slot:1,kind:'plot',title:'점령된 학교',background:'occupied_hogwarts',actors:['mcgonagall','neville','ginny'],intro:'정권이 바뀐 뒤 호그와트에 새로운 통제가 내려온다. 해리 일행은 정규 수업에 없다. 남은 학생들은 협력, 저항, 은둔의 갈림길에 선다.',options:[
      {id:'resist',label:'신뢰하는 동료와 비밀리에 저항한다',intent:'실패하면 실제 처벌과 관계의 위험이 뒤따른다.',delta:{neville:2},flags:{hallows:'resist'},offscreen:'학교 밖 해리 일행은 자신들의 임무를 계속한다.'},
      {id:'hide',label:'주변 사람들의 안전을 먼저 지킨다',intent:'위험을 줄이되 다른 학생의 선택을 대신하지 않는다.',delta:{},flags:{hallows:'hide'},offscreen:'저항은 다른 학생들을 통해 이어질 수 있다.'},
      {id:'comply',label:'공식 통제 안에서 살아남을 방법을 찾는다',intent:'협력이 가져올 도덕적·관계적 대가를 직면한다.',delta:{},flags:{hallows:'comply'},offscreen:'서로 다른 선택을 한 친구들이 멀어질 수 있다.'}]},
    {id:'battle_of_hogwarts',year:7,date:'1998-05-02',slot:3,kind:'plot',title:'호그와트 최후의 밤',background:'hogwarts_battle_courtyard',actors:['neville','mcgonagall','malfoy','harry'],intro:'학교로 전쟁이 몰려온다. 모든 사람의 운명과 지난 7년의 선택이 한밤에 모인다.',options:[
      {id:'defend',label:'학교를 지키는 사람들과 함께 싸운다',intent:'능력과 관계에 맞는 역할을 맡으며 누구의 생존도 보장하지 않는다.',delta:{neville:2},flags:{finale:'defend'},offscreen:'해리의 최종 대결은 이 세계의 기존 인과를 따른다.'},
      {id:'save',label:'전쟁 속에서 소중한 사람을 구한다',intent:'지난 7년간 실제로 맺은 관계와 위험을 기준으로 특정 인물을 돕는다.',delta:{},flags:{finale:'save'},offscreen:'다른 전투 구역도 독립적으로 진행된다.'},
      {id:'separate',label:'전장 밖으로 사람들을 대피시킨다',intent:'대피와 보호를 맡으며 결과에 책임진다.',delta:{},flags:{finale:'evacuate'},offscreen:'성의 다른 구역 전투는 당신이 없이도 벌어진다.'}]}
  ];
  const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id,e]));
  // Long quiet stretches are condensed into occasional personal scenes,
  // not simulated day-by-day. Reconstructed from the date after a reload.
  function dayISO(date, delta) {
    const t = new Date(date+'T00:00:00Z');
    t.setUTCDate(t.getUTCDate()+delta);
    return t.toISOString().slice(0,10);
  }
  function dayGap(a,b) { return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000); }
  function routine(date, st) {
    const id='routine_'+date.replace(/-/g,'_');
    const i=(Number(date.replace(/-/g,''))+st.decisions.length)%3;
    const themes=[
      {title:'사라진 교실의 편지',bg:'library',actors:['hermione','malfoy'],
       intro:'도서관 한쪽에 이름이 적히지 않은 편지가 놓였다. 내용보다 중요한 것은 누가 그것을 먼저 발견했고 누구에게 말했는지다.',
       labels:['헤르미온느와 자료를 확인한다','말포이에게 편지를 보여준다','편지를 건드리지 않는다'],
       delta:[{hermione:1},{malfoy:1},{}],intent:['공개 문서와 실제 발신인을 구분한다','말포이는 경계하면서도 자기 판단으로 반응한다','학교의 다른 인물들이 이 편지를 처리한다']},
      {title:'기숙사의 작은 소문',bg:'common_room',actors:['malfoy','neville'],
       intro:'기숙사 사이에서 누군가의 실수에 관한 이야기가 퍼진다. 소문이 누구에게 불리하게 바뀌는지는 당신의 대응에 따라 달라진다.',
       labels:['당사자에게 직접 사실을 확인한다','소문을 확산시키지 말자고 제안한다','이번 소동에는 관여하지 않는다'],
       delta:[{neville:1},{malfoy:1},{}],intent:['몰래 듣지 말고 당사자에게 묻는다','기숙사 사이의 감정이 무엇인지 듣고 조정한다','소문을 다른 NPC가 독자적으로 정리한다']},
      {title:'늦은 오후의 연습',bg:'dueling',actors:['harry','hermione','neville'],
       intro:'그날의 연습에 초대받지 못한 학생도 있고, 먼저 찾아온 학생도 있다. 무슨 마법을 잘하고 못하는지는 누적된 연습과 준비로 갈린다.',
       labels:['친구들과 기초 마법을 연습한다','혼자 취약한 주문을 연습한다','연습 대신 주변 상황을 살핀다'],
       delta:[{harry:1,neville:1},{},{}],intent:['실패와 진전이 모두 있을 수 있는 훈련','꾸준히 연습하되 한 번에 고급 주문을 숙달하지 못한다','다른 학생들은 수업과 연습에 참여한다']}
    ];
    const x=themes[i];
    const year=Number(date.slice(0,4));
    const month=Number(date.slice(5,7));
    const schoolYear=Math.max(1,Math.min(7,month>=9?year-1990:year-1991));
    return {id,year:schoolYear,date,slot:1,kind:'life',title:x.title,
      background:x.bg,actors:x.actors,intro:x.intro,
      options:x.labels.map((label,j)=>({id:'path'+j,label,intent:x.intent[j],
        delta:x.delta[j],flags:{[id]:'path'+j},
        offscreen:'다른 학생들은 플레이어의 참여와 무관하게 자신들의 일정과 관계를 이어간다.'}))};
  }
  function getEvent(id, st) {
    if (EVENT_BY_ID[id]) return EVENT_BY_ID[id];
    if (CHAPTER_CATALOG?.byId[id] && CHAPTER_CATALOG.byId[id].interactive)
      return CHAPTER_HELPER.eventFor(CHAPTER_CATALOG.byId[id],st);
    const m=/^routine_(\d{4})_(\d{2})_(\d{2})$/.exec(String(id||''));
    return m?routine(m[1]+'-'+m[2]+'-'+m[3],st):null;
  }
  function canPreempt(st) {
    return st.agency.broom_response==='investigated' && st.agency.clue_path==='records';
  }
  function introFor(ev,st) {
    let intro=ev.intro;
    const first=st.agency.first_circle;
    if(ev.id==='winter_choice') {
      if(first==='hermione') intro+='\n\n말포이는 학기 초 모임에 오지 않았던 일을 아직 기억한다. 오늘의 제안 역시 온전히 호의적이지 않을 수 있다.';
      else if(first==='malfoy') intro+='\n\n말포이는 지난 모임에서 나눈 말을 기억한다. 초대가 있었다고 해서 신뢰가 완성된 건 아니다.';
      else if(first==='independent') intro+='\n\n두 사람 모두 당신이 첫 초대를 거절했던 일을 기억한다. 이번 만남은 새로 시작해야 한다.';
    }
    if(ev.id==='spring_duel') {
      const d=st.ties.malfoy||0,h=st.ties.hermione||0;
      if(d>h) intro+='\n\n말포이는 당신이 자신에게 조금 더 가까운 사람이라고 여긴다. 그 기대는 오늘 공개적으로 시험받는다.';
      else if(h>d) intro+='\n\n헤르미온느는 당신이 자신과 함께 조사했던 일을 기억한다. 말포이도 그때 당신의 선택을 잊지 않았다.';
      else intro+='\n\n누구에게도 쉽게 편을 들어 주지 않았던 선택이 되돌아온다.';
    }
    if(ev.id==='end_of_first_year') {
      if((st.ties.malfoy||0)>=3)intro+='\n\n말포이는 표현하지 않지만, 떠나기 전에 당신에게 따로 할 말이 있어 보인다.';
      if((st.ties.hermione||0)>=3)intro+='\n\n헤르미온느는 여러 번 함께 공부하거나 조사했던 일을 적어 두었다.';
    }
    if(ev.id==='prince_secret') {
      if((st.ties.malfoy||0)>=3)intro+='\n\n5년 전 첫 학기의 모임에서 시작된 신뢰가 있다면, 지금 그 흔적이 아주 작은 망설임으로 나타날 수 있다. 그렇다고 임무의 비밀을 바로 털어놓지는 않는다.';
      else if((st.ties.malfoy||0)<0)intro+='\n\n오래전의 냉담함을 말포이는 아직 기억한다. 당신이 그 비밀에 접근하려면 먼저 불신부터 넘어서야 한다.';
    }
    if(ev.id==='hallows_school' && st.agency.phoenix==='resist')
      intro+='\n\n엄브리지 시절 위험을 감수했던 학생들이 당신의 태도를 기억한다. 같은 사람들이 다시 도움을 청할 수도 있다.';
    if (CHAPTER_CATALOG && CHAPTER_HELPER && CHAPTER_CATALOG.byMajor[ev.id])
      intro+='\n\n이 사건은 이미 기록된 원작 장별 역사와 연결되며, 이 장면에서 보여 주는 내용은 플레이어가 실제로 겪을 수 있는 것에 한정된다.';
    return intro;
  }
  function optionsFor(ev,st) {
    const base=ev.options.map(x=>'▶ 선택 ['+ev.id+'] '+x.id+' — '+x.label);
    if(ev.id==='stone_finale' && canPreempt(st))
      base.push('▶ 선택 [stone_finale] preempt — 모은 단서로 교수진에게 먼저 진범을 밝힌다');
    return base.concat(['▶ 선택 ['+ev.id+'] skip — 참여하지 않고 다음 사건으로 넘어간다']);
  }
  function selectedOption(ev,id,st) {
    if(ev.id==='stone_finale' && id==='preempt' && canPreempt(st))
      return {id:'preempt',label:'사전에 모은 단서로 교수진에게 진범을 밝힌다',
        intent:'퀴디치 경기에서 조사한 이상 징후와 도서관의 기록을 함께 제시한다. 그 증거를 바탕으로 교수들이 사건이 터지기 전에 움직이도록 설득한다. 다른 학생들 역시 자신의 판단대로 행동한다.',
        delta:{mcgonagall:3,hermione:2},flags:{stone_finale:'preempt'},
        offscreen:'교수들이 검증된 단서에 따라 학교의 의심스러운 교수를 미리 조사한다. 원작의 함정문 대면은 그대로 반복되지 않는다.'};
    if(id==='preempt')return null;
    if(id==='observe' && (ev.kind==='plot'||ev.autoStart))
      return {id:'observe',label:'현장에서 사건이 진행되는 모습을 본다',
        intent:'공개된 상황과 지금 나타난 인물의 행동으로 사건을 시작한다. 플레이어의 행동·대사·태도를 대신 결정하지 않는다.',
        delta:{},flags:{},offscreen:'다른 장소에서도 관련 인물의 행동이 독립적으로 이어진다.'};
    if(id==='skip')return {id:'skip',label:'사건에 참여하지 않는다',intent:'사건 현장에 가지 않으며 직접 목격한 것으로 주장하지 않는다.',
      delta:{},flags:{},offscreen:'당신의 미참여와 무관하게 관련 인물들은 자신의 목적을 위해 행동했고 그 사건은 흘러갔다.'};
    return ev.options.find(x=>x.id===id);
  }
  function createState() {
    return { schemaVersion:1, finished:{}, active:null, pending:null, decisions:[],
      ties:{}, agency:{}, publicConsequences:[], lastTransition:null };
  }
  function valid(st) {
    return !!(st && st.schemaVersion===1 && st.finished && typeof st.finished==='object' &&
      st.ties && typeof st.ties==='object' && Array.isArray(st.decisions) &&
      Array.isArray(st.publicConsequences));
  }
  function ensure(st) { if(!valid(st)) throw new Error('Hogwarts world state invalid');return st; }
  function parseChoice(v) {
    const m=EVENT_CHOICE.exec(String(v||'').trim());
    return m ? {eventId:m[1],optionId:m[2]} : null;
  }
  function isNext(v) { return SCENE_NEXT.test(String(v||'').trim()); }
  function isFinish(v) { return SCENE_FINISH.test(String(v||'').trim()); }
  function fitSceneSlot(event,date,currentSlot){
    if(!event)return null;
    if(event.date===date && Number.isInteger(currentSlot) &&
       currentSlot>=0 && currentSlot<=3 && event.slot<currentSlot)
      return {...event,slot:currentSlot};
    return event;
  }
  function nextEvent(st, date, currentSlot) {
    ensure(st);
    // A manually skipped overdue event becomes a genuine off-screen event,
    // never an encounter the player retroactively attended.
    let upcoming=null;
    for (const ev of EVENTS) {
      if (st.finished[ev.id] || (st.active && st.active.id===ev.id) ||
          (st.pending && st.pending.id===ev.id)) continue;
      if (ev.date < date) continue;
      upcoming=ev;break;
    }
    const oneChapter=CHAPTER_CATALOG && CHAPTER_HELPER && CHAPTER_HELPER.nextPlayable(CHAPTER_CATALOG,st,date,upcoming);
    if(oneChapter)return fitSceneSlot(oneChapter,date,currentSlot);
    if (!upcoming) return null;
    if (dayGap(date,upcoming.date)>65) return routine(dayISO(date,45),st);
    return fitSceneSlot(upcoming,date,currentSlot);
  }
  function offer(st, event) {
    ensure(st);
    if (!event || st.finished[event.id] || st.active || st.pending) return null;
    st.pending={id:event.id, offeredAt:event.date};
    return {id:event.id,title:event.title,date:event.date,slot:event.slot,kind:KIND[event.kind],
      background:event.background,intro:introFor(event,st),
      choices:optionsFor(event,st)};
  }
  function start(st, selected) {
    ensure(st);
    const choice=typeof selected==='string'?parseChoice(selected):selected;
    if(!choice||!st.pending||st.pending.id!==choice.eventId||st.active) return null;
    const ev=getEvent(choice.eventId,st);
    const opt=ev&&selectedOption(ev,choice.optionId,st);
    if(!opt) return null;
    st.pending=null;
    st.active={id:ev.id,choice:opt.id,at:ev.date};
    return {id:ev.id,year:ev.year,date:ev.date,background:ev.background,location:ev.title,
      actors:ev.actors.slice(),kind:KIND[ev.kind],title:ev.title,
      instruction:'[호그와트 확정 장면: '+ev.title+']\n'
        +'사건 시점: '+ev.date+'. 플레이어가 선택한 행동: '+opt.label+'.\n'
        +'진입 상황: '+introFor(ev,st)+'\n'
        +(ev.kind==='chapter'?'이 장은 198개 원작 장 가운데 한 개다. 433개 세부 사건 장부와 연결되지만 아직 일어나지 않은 결과나 비밀은 먼저 밝히지 마라.\n':'')
        +'장면의 실제 목표: '+opt.intent+'\n'
        +'플레이어가 없는 곳에서 진행되는 일: '+opt.offscreen+'\n'
        +'이번 응답은 이 장면의 첫 대사/행동을 실제로 보여 줘야 한다. '
        +'한 번에 모든 결말까지 요약하지 말고 플레이어가 추가로 말하고 행동할 기회를 남겨라. '
        +'이 장면 동안 AI는 공식 날짜와 학년을 바꾸지 않는다. '
        +'이미 플레이어가 해결한 일과 앞으로 벌어질 일을 혼동하지 마라.'};
  }
  // Public historical incidents unfold even without the player clicking
  // 'participate'. Players may interrupt them through a genuine decision.
  function startAmbient(st){
    ensure(st);
    if(!st.pending||st.active)return null;
    const ev=getEvent(st.pending.id,st);
    if(!ev||(ev.kind!=='plot'&&!ev.autoStart))return null;
    return start(st,{eventId:ev.id,optionId:'observe'});
  }
  function shouldStartAmbient(st){
    ensure(st);
    const ev=st.pending&&getEvent(st.pending.id,st);
    return !!(ev&&(ev.kind==='plot'||ev.autoStart));
  }
  function activeChoices(st){
    ensure(st);
    if(!st.active||st.active.choice!=='observe')return [];
    const ev=getEvent(st.active.id,st);
    return ev?optionsFor(ev,st).filter(v=>!v.includes('] skip')):[];
  }
  function interrupt(st,input){
    ensure(st);
    if(!st.active||st.active.choice!=='observe')return null;
    const choice=typeof input==='string'?parseChoice(input):input;
    if(!choice||choice.eventId!==st.active.id||choice.optionId==='skip'||choice.optionId==='observe')return null;
    const ev=getEvent(st.active.id,st),opt=selectedOption(ev,choice.optionId,st);
    if(!opt)return null;
    st.active.choice=opt.id;
    return {id:ev.id,choice:opt.id,title:ev.title,
      instruction:'[호그와트 사건 진행 중 플레이어의 실제 개입] '+ev.title+'\n'
        +'사용자가 직접 선택한 행동: '+opt.label+'\n'
        +'의도: '+opt.intent+'\n'
        +'행동의 성공을 자동 확정하지 말고 실제 장면의 결과와 NPC 반응을 이어서 보여라. '
        +'사건의 날짜와 장소, 다른 사람의 독립 행동은 보존하라.'};
  }
  // Ordinary free-text roleplay must not vanish when a scripted event ends.
  // This records attempted player actions (not an invented success/failure result).
  function noteAction(st,raw) {
    ensure(st);
    if(!st.active)return false;
    const text=String(raw||'').trim().replace(/\s+/g,' ').slice(0,220);
    if(!text || /^▶/.test(text))return false;
    const notes=st.active.actions||(st.active.actions=[]);
    if(notes.at(-1)===text)return false;
    notes.push(text);
    if(notes.length>14)notes.shift();
    return true;
  }
  function finish(st) {
    ensure(st);
    if(!st.active) return null;
    const ev=getEvent(st.active.id,st);
    const opt=selectedOption(ev,st.active.choice,st);
    // Decide scene consequences exactly once, at the scene boundary.
    const effects=opt.delta||{};
    for(const [id,delta] of Object.entries(effects)) {
      const prev=st.ties[id]||0;st.ties[id]=Math.max(-10,Math.min(10,prev+delta));
    }
    Object.assign(st.agency,opt.flags||{});
    const actions=(st.active.actions||[]).slice();
    const actualChoice=opt.id==='observe' && actions.length ? 'freeform' : opt.id;
    const consequence={id:ev.id,date:ev.date,title:ev.title,choice:opt.label,
      actions,offscreen:opt.offscreen,visible:'당신의 선택과 실제 시도한 행동이 기록된다.'};
    st.finished[ev.id]={choice:actualChoice,date:ev.date,actions};
    st.decisions.push({id:ev.id,choice:actualChoice,date:ev.date,actions});
    st.publicConsequences.push(consequence);
    st.publicConsequences=st.publicConsequences.slice(-32);
    st.active=null;
    st.lastTransition=ev.id;
    return consequence;
  }
  function resume(st) {
    ensure(st);
    if (st.pending) { const e=getEvent(st.pending.id,st);return e?{
      mode:'offer',id:e.id,title:e.title,intro:introFor(e,st),
      choices:optionsFor(e,st),background:e.background}:null; }
    if (st.active) { const e=getEvent(st.active.id,st); return e?{mode:'active',title:e.title,choice:st.active.choice}:null; }
    return {mode:'idle'};
  }
  function context(st) {
    ensure(st);
    const recent=st.publicConsequences.slice(-10);
    const ties=Object.entries(st.ties).map(([id,n])=>id+': '+(n>0?'신뢰+':'경계')+n).join(', ');
    const last=recent.map(r=>'- '+r.title+' / 플레이어: '+r.choice+
      ((r.actions||[]).length?' / 직접 시도한 행동: '+r.actions.slice(-3).join('; '):'')+
      ' / 현장 밖: '+r.offscreen).join('\n');
    const active=st.active&&getEvent(st.active.id,st);
    return '\n\n## 호그와트 개인 세계선(실제 확정된 플레이 기록; 대사에 메타 상태 표기 금지)\n'
      +'- 유저 행동으로 쌓인 인상: '+(ties||'아직 초면')+'\n'
      +'- 관계/분기 확정: '+JSON.stringify(st.agency)+'\n'
      +'- 최근 사건과 독립적인 NPC 행동:\n'+(last||'- 아직 없음')+'\n'
      +(active?'- 진행 중인 장면: '+active.title+' / 날짜 고정, 대화가 끝날 때까지 바꾸지 마라.\n':'')
      +(st.active && st.active.actions?.length?'- 플레이어가 현재 장면에서 직접 시도한 행동(성공 확정 아님): '+st.active.actions.slice(-5).join(' / ')+'\n':'')
      +'- NPC는 플레이어가 함께하지 않은 모임·연구·행동도 스스로 진행했다. '
      +'나중에 소문으로 알 수 있지만 주인공이 직접 본 것처럼 회상시키지 마라.\n'
      +'- 인물 관계는 점수로 연애를 결정하지 않는다. 신뢰/경계는 말투, 초대, 도움, 비밀 공개에만 반영한다. '
      +'전지적 선지식·자동 복종·갑작스런 고백 금지.\n';
  }
  function ending(st) {
    ensure(st);
    if(!st.finished.battle_of_hogwarts) return null;
    const route=st.agency.finale;
    const title=route==='defend'?'호그와트의 수호자'
      :route==='save'?'한 사람을 지킨 마법사'
      :route==='evacuate'?'살아남은 이들의 증언':'호그와트 이후의 삶';
    const closest=Object.entries(st.ties).sort((a,b)=>b[1]-a[1])[0];
    let note='1998년 5월. 호그와트를 뒤흔든 전쟁이 끝났다. 당신은 예언의 주인공이 아니었지만, 당신이 떠난 자리에 선택의 흔적이 남았다.';
    if(closest && closest[1]>0)note+='\n\n오래 쌓아 온 신뢰 중 가장 크게 남은 인연은 '+({malfoy:'말포이',hermione:'헤르미온느',neville:'네빌',harry:'해리'}[closest[0]]||'한 친구')+'와의 관계였다.';
    note+='\n\n그동안의 사건을 기억하는 이들은 각자의 삶으로 돌아간다. 호그와트의 7년은 이대로 당신만의 기록이 된다.';
    return {title,narration:note};
  }
  function titleFor(id){ const e=getEvent(id,{decisions:[]});return e&&e.title; }
  return Object.freeze({createState,valid,nextEvent,installChapterCatalog,offer,parseChoice,start,startAmbient,shouldStartAmbient,activeChoices,interrupt,noteAction,finish,resume,context,ending,
    isNext,isFinish,titleFor,EVENTS:EVENTS.map(x=>({...x,options:x.options.map(y=>({...y}))}))});
});