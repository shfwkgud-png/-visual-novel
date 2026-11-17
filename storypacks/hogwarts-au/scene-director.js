/* Hogwarts scene continuity director — version 1.
 * Owns automatic ceremony beats, walk-in reactions, offscreen date bridges,
 * and automatic opening of public canonical incidents. Does not run on other stories.
 * "Next narration" taps (not dialogue choices) consume automatic beats.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(root)root.PandoraHogwartsScenes=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const HOUSES={
    '그리핀도르':{
      tag:'gryffindor',guide:'퍼시 위즐리',guideId:'percy',peer:'론 위즐리',peerId:'ron',
      entrance:'그리핀도르 탑 초상화 앞',home:'gryffindor_common_room',
      arrival:{
        narrator:'반장이 나선형 계단 꼭대기의 오래된 초상화 앞에서 학생들을 세운다. 초상화 속 여인이 고개를 들어 새 얼굴들을 훑는다.',
        speaker:'뚱보 여인',id:'fat_lady',
        line:'새 학생들이군요. 암호를 잊지 마세요. 오늘은 반장에게 들으세요. 그다음부터는 여러분 차례랍니다.',
        reply:'퍼시 위즐리',replyId:'percy',
        answer:'퍼시가 모두 들을 수 있도록 암호를 말하자 초상화가 옆으로 열리고 통로가 드러난다. 출입 허가가 확인되었다.'
      }
    },
    '슬리데린':{
      tag:'slytherin',guide:'슬리데린 반장',guideId:null,peer:'드레이코 말포이',peerId:'malfoy',
      entrance:'지하 호숫가의 돌벽',home:'slytherin_common_room',
      arrival:{
        narrator:'지하로 내려가자 벽 너머 검은 호수의 빛이 흔들린다. 반장이 아무 문도 보이지 않는 축축한 돌벽 앞에 멈춰 선다.',
        speaker:'슬리데린 반장',id:null,line:'이곳은 아무에게나 열리지 않아. 암호를 알고 있는 학생만 들어올 수 있다.',
        reply:'드레이코 말포이',replyId:'malfoy',
        answer:'반장이 암호를 낮게 읊자 돌벽의 일부가 옆으로 물러난다. 말포이는 잠시 당신의 반응을 살핀 뒤 먼저 안으로 들어간다.'
      }
    },
    '레번클로':{
      tag:'ravenclaw',guide:'레번클로 반장',guideId:null,peer:'레번클로 신입생',peerId:null,
      entrance:'레번클로 탑의 독수리 문',home:'ravenclaw_common_room',
      arrival:{
        narrator:'가파른 계단 끝에 청동 독수리 모양 문고리가 달린 문이 나타난다. 반장이 문고리를 건드리자 마법의 목소리가 질문을 던진다.',
        speaker:'독수리 문고리',id:null,line:'들어오는 자는 생각할 줄 알아야 해. 정답보다 중요한 것은 생각하는 이유겠지.',
        reply:'레번클로 반장',replyId:null,
        answer:'반장이 문제를 풀어 설명하자 문이 열린다. 이 문은 비밀번호 대신 수수께끼로 학생들을 맞이한다.'
      }
    },
    '후플푸프':{
      tag:'hufflepuff',guide:'후플푸프 반장',guideId:null,peer:'후플푸프 신입생',peerId:null,
      entrance:'주방 근처 통과 참나무통',home:'hufflepuff_common_room',
      arrival:{
        narrator:'주방 근처의 따뜻한 통로 끝에 똑같이 생긴 참나무통 여러 개가 쌓여 있다. 반장이 정확한 통을 골라 손가락으로 일정한 박자를 두드린다.',
        speaker:'후플푸프 반장',id:null,line:'여기선 정해진 통에 정확한 리듬을 두드려야 해. 장난으로 다른 통을 치면 물세례를 맞을 수도 있어.',
        reply:'후플푸프 반장',replyId:null,
        answer:'두드림이 끝나자 통의 뚜껑이 열리고 작은 통로가 나타난다. 모두의 안전을 확인한 뒤 학생들이 한 명씩 들어간다.'
      }
    }
  };
  const PLACE={
    great_hall:'호그와트 대연회장',corridor:'호그와트 복도',common_room:'기숙사 공용실',
    library:'호그와트 도서관',potions:'마법약 교실',classroom:'교실',dormitory:'기숙사',
    quidditch:'퀴디치 경기장',dueling:'결투 연습장',infirmary:'병동',
    hagrid_hut:'해그리드의 오두막',forbidden_forest:'금지된 숲',night_garden:'학교 교정',
    hogwarts_courtyard:'호그와트 교정',astronomy:'천문탑',hogsmeade:'호그스미드',
    hogwarts_express_compartment:'호그와트 특급열차',occupied_hogwarts:'점령된 호그와트'
  };
  function resolveBackground(background,house) {
    const h=HOUSES[house];
    if(!h)return background;
    if(background==='common_room')return h.home;
    if(background==='dormitory')return h.tag+'_dormitory';
    return background;
  }
  const introLine=(n,speaker,id,text,reply=null)=>({
    title:n,narration:'',dialogue:[{speaker,char_id:id||null,text},...(reply||[])],background:null
  });
  function createState(){
    return {schemaVersion:1,phase:'idle',queue:[],cursor:0,followUp:null,
      lastLocation:'great_hall',visited:{},arrivalCompleted:false,sceneNonce:0};
  }
  function valid(s){
    return !!(s&&s.schemaVersion===1&&['idle','arrival','transition'].includes(s.phase)
      &&Array.isArray(s.queue)&&Number.isInteger(s.cursor)&&s.cursor>=0&&s.cursor<=s.queue.length
      &&s.visited&&typeof s.visited==='object');
  }
  function ensure(s){if(!valid(s))throw Error('Hogwarts scene continuity state invalid');return s;}
  const d=(speaker,char_id,text)=>({speaker,char_id,text});
  function b(id,background,narration,dialogue=[],opts={}){
    return {id,background,narration,dialogue,slot:opts.slot??null,location:opts.location||PLACE[background]||'호그와트',
      event:opts.event||null};
  }
  function arrival(house,playerName){
    const h=HOUSES[house];
    if(!h)throw Error('Unsorted house for scene arrival');
    const who=String(playerName||'당신');
    return [
      b('arrival_sorting_reaction','great_hall',
        '분류모자가 기숙사의 이름을 외치자 '+house+' 테이블에서 환호가 터진다. '+who+'은(는) 자신의 자리를 향한다. 다른 신입생들의 분류도 계속되고 있다.',
        [d('맥고나걸','mcgonagall','축하합니다. 자리로 가세요. 아직 모든 신입생의 배정이 끝나지 않았습니다.')]),
      b('arrival_speech','great_hall',
        '배정이 모두 끝나자 교직원 테이블 쪽에서 덤블도어가 자리에서 일어난다. 넓은 홀의 웅성거림이 잦아든다.',
        [d('덤블도어','albus','호그와트에 온 것을 환영합니다. 이곳에서 여러분은 마법뿐 아니라 함께 살아가는 법도 배우게 될 겁니다. 서로를 존중하며 좋은 한 해를 보내길 바랍니다.')]),
      b('arrival_feast','great_hall',
        '교장의 환영 인사가 끝난 뒤 식탁에 음식이 차려진다. 접시가 오가고 학생들이 지난 여름과 새 학기에 관해 이야기한다. 분위기가 풀려도 교수들은 학생들을 지켜보고 있다.',
        [d(h.peer,h.peerId,house==='슬리데린'
          ?'여기는 누구나 앉을 수 있는 자리가 아니야. 앞으로 일곱 해 동안 서로 자주 마주치겠네.'
          :'저쪽에서 들려오는 이야기는 벌써 다른 기숙사 소문이야. 새 학기가 시작됐다는 게 실감 나네.')]),
      b('arrival_prefect','corridor',
        '한참 뒤 만찬이 끝난다. 학생들이 차례로 일어나자 반장들이 신입생들을 부른다. '+house+' 학생들은 반장의 뒤를 따라 복도와 계단을 지나간다.',
        [d(h.guide,h.guideId,'흩어지지 말고 따라오세요. 학교는 넓고 밤의 복도에는 출입이 금지된 구역도 있습니다.')],{slot:3}),
      b('arrival_entrance','corridor',h.arrival.narrator,
        [d(h.arrival.speaker,h.arrival.id,h.arrival.line),
         d(h.arrival.reply,h.arrival.replyId,h.arrival.answer)],
        {location:h.entrance}),
      b('arrival_common_room',h.home,
        '문을 통과하자 '+house+' 공용실이 펼쳐진다. 여러 학생이 짐을 내려놓고 자리를 잡는다. 반장은 침실 방향과 아침 첫 일정을 안내한다. 이제부터 이곳이 당신의 학교생활을 보내는 집이다.',
        [d(h.guide,h.guideId,'오늘은 이동하느라 고생했어요. 늦지 않게 쉬세요. 내일부턴 직접 학교를 익혀야 합니다.')],
        {location:house+' 공용실'})
    ];
  }
  function startArrival(s,house,player){
    ensure(s);
    if(s.arrivalCompleted||s.phase==='arrival')return false;
    s.phase='arrival';s.queue=arrival(house,player);s.cursor=0;s.followUp=null;s.sceneNonce++;
    return true;
  }
  function daysBetween(a,b){
    const x=Date.parse(String(a)+'T00:00:00Z'),y=Date.parse(String(b)+'T00:00:00Z');
    return Number.isFinite(x)&&Number.isFinite(y)?Math.round((y-x)/86400000):0;
  }
  function periodTransition(event, clock, world){
    const diff=daysBetween(clock.date,event.date);
    const lastYear=clock.date.slice(0,4),newYear=event.date.slice(0,4);
    if(diff<=1)return null;
    if(diff>150||lastYear!==newYear){
      return b('bridge_term_'+event.id,'hogwarts_courtyard',
        '지난 학기를 거치며 호그와트의 분위기는 조금씩 달라졌다. 수업과 시험, 기숙사 내 사소한 다툼과 화해가 계속되었다. 방학이 끝나 학생들이 다시 돌아왔을 때에도 지난 선택의 흔적은 남아 있다.',
        [d('나레이터',null,'당신이 참석하지 않은 모임과 사건도 그동안 다른 학생들의 선택대로 진행됐다.')] );
    }
    if(diff>20)return b('bridge_days_'+event.id,'corridor',
      '그 뒤로 며칠과 몇 주가 흘렀다. 사람들은 각자의 수업과 과제를 이어 갔고, 전에 맺은 약속과 다툼은 사라지지 않았다. 기록되지 않은 일을 플레이어가 모두 목격한 것은 아니다.',[]);
    return b('bridge_short_'+event.id,'corridor',
      '학교생활이 계속되는 가운데 다음 일정이 다가왔다. 학생들은 저마다 바쁜 하루를 보내며 복도에서 스쳐 지나갔다.',[]);
  }
  function onEnter(event,house,world){
    const bg=resolveBackground(event.background,house);
    const year=event.year||1;
    let intro,dialogue=[];
    if(bg==='great_hall'){
      intro='대연회장 안으로 들어서자 학생들이 저마다 자리를 찾고 있다. 교수진의 움직임이 보이지만, 오늘 무슨 일이 일어날지는 아직 누구도 다 알지 못한다.';
      if(year>=5)intro='대연회장의 공기는 예전과 다르다. 학교 안의 권력과 소문에 따라 학생들의 표정이 엇갈리지만 식사와 대화는 계속된다.';
    }else if(bg==='potions'){
      intro='차가운 돌계단을 내려가자 약초와 물약 냄새가 풍겨온다. 학생들이 책을 펼치고 솥 앞에 서자 교사가 수업을 준비한다.';
      const teacher=year>=6?'슬러그혼':'스네이프',id=year>=6?'slughorn':'snape';
      dialogue.push(d(teacher,id,'재료를 먼저 확인하세요. 오늘은 서두른다고 좋은 결과가 나오는 수업이 아닙니다.'));
    }else if(bg==='library'){
      intro='도서관 문을 지나자 책장을 넘기는 소리가 들린다. 자료를 찾는 학생들은 자리를 옮기고, 사서의 시선은 조용히 소란을 제지한다.';
    }else if(bg==='corridor'){
      intro='계단과 복도가 이어지는 학교 안에서 학생들이 다음 수업과 기숙사를 향해 움직인다. 초상화들은 지나가는 사람들에게 관심을 보인다.';
    }else if(bg==='common_room'||/common_room|dormitory/.test(bg)){
      const key=HOUSES[house];
      intro=key?house+' 공용실에서 학생들이 자신의 일정을 보내고 있다. 이곳은 남의 기숙사에 마음대로 출입하는 장소가 아니며, 출입 절차가 먼저 확인되어야 한다.':'기숙사 안에는 학생들의 일상이 이어지고 있다.';
    }else if(bg==='quidditch'){
      intro='운동장에 도착하자 바람과 관중의 소리가 들려온다. 선수와 관중은 각자의 위치에 있고, 경기는 진행될 준비를 하고 있다.';
    }else if(bg==='night_garden'||bg==='forbidden_forest'){
      intro='학교 건물의 불빛이 멀어질수록 주변은 조용해진다. 출입이 제한된 구역에서는 교사의 허락이나 안전 확보가 필요하다.';
    }else if(bg==='astronomy'){
      intro='천문탑 계단을 오르자 찬 공기가 들어온다. 학교의 먼 지붕과 호수가 보인다. 높은 곳에서 벌어지는 일은 쉽게 감춰지지 않는다.';
    }else if(bg==='occupied_hogwarts'){
      intro='통제받는 호그와트의 복도에는 이전보다 순찰이 많다. 학생들은 누구 앞에서 어떤 말을 해도 되는지 신중하게 살핀다.';
    }else{
      const where=PLACE[bg]||'다음 목적지';
      intro=where+'에 도착한다. 이곳의 사람들은 플레이어가 나타나기 전부터 자신의 일정과 목적을 가지고 움직이고 있다.';
    }
    const route=world?.agency||{};
    if(event.id==='prince_secret'&&route.first_circle==='malfoy')
      intro+=' 말포이는 입학 초기에 나눴던 대화를 기억하는 듯 눈길을 잠시 멈춘다.';
    if(event.id==='phoenix_decree'&&route.spring_duel==='mediated')
      intro+=' 학생들 가운데는 예전에 양쪽을 중재하려 했던 당신을 기억하는 사람도 있다.';
    return b('enter_'+event.id,bg,intro,dialogue,{location:PLACE[bg]||'호그와트'});
  }
  function stageEvent(s,clock,event,house,world){
    ensure(s);
    if(s.phase!=='idle'||s.followUp)return false;
    const steps=[];
    const jump=periodTransition(event,clock,world);
    if(jump)steps.push(jump);
    if(s.lastLocation!==resolveBackground(event.background,house)||jump)steps.push(onEnter(event,house,world));
    if(!steps.length)steps.push(b('continuity_'+event.id,event.background,
      '같은 장소에서 사람들이 차례로 자신의 일을 이어 간다. 다음 사건은 앞선 대화와 움직임의 연장선에서 시작된다.',[]));
    s.phase='transition';s.queue=steps;s.cursor=0;s.followUp={type:'event',id:event.id};
    s.sceneNonce++;
    return true;
  }
  // Convert only public, already-committed canon beats into short school news.
  // The same user should never learn private or GM facts simply by time-skipping.
  function injectNews(s,records){
    ensure(s);
    if(s.phase!=='transition'||s.cursor!==0||!Array.isArray(records)||!records.length)return 0;
    const safe=records.filter(r=>r&&r.access==='public'&&typeof r.fact==='string'&&
      r.fact.length>0&&typeof r.id==='string').slice(-2);
    if(!safe.length)return 0;
    const note=b('public_news_'+s.sceneNonce,'corridor',
      '그 사이 학교생활은 멈추지 않았다. 학생과 교수 사이에 공개된 소식이 전해졌다. '+
      safe.map(r=>r.fact).join(' ')+' 모두가 같은 사건을 직접 목격한 것은 아니다.',[],
      {location:'호그와트 복도'});
    s.queue.unshift(note);
    return safe.length;
  }
  function startRoomReturn(s,house) {
    ensure(s);
    const h=HOUSES[house];
    if(!h||s.phase!=='idle'||s.followUp||s.lastLocation===h.home)return false;
    const stages=[
      b('return_corridor_'+(s.sceneNonce+1),'corridor',
        '일정을 마친 당신은 수업을 듣던 곳에서 나와 자신의 기숙사를 향한다. 이어지는 복도를 따라 걸으며 다른 학생들이 오가는 모습을 본다.',[]),
      b('return_entrance_'+(s.sceneNonce+1),'corridor',h.arrival.narrator,
        [d(h.arrival.speaker,h.arrival.id,h.arrival.line),
         d(h.arrival.reply,h.arrival.replyId,h.arrival.answer)],{location:h.entrance}),
      b('return_home_'+(s.sceneNonce+1),h.home,
        '허가된 출입 절차를 마치고 '+house+' 공용실에 들어선다. 학생들은 저마다 다른 일을 하며 지내고 있다. 이곳에서는 자유롭게 대화하거나 다음 일정을 계획할 수 있다.',[],
        {location:house+' 공용실'})
    ];
    s.phase='transition';s.queue=stages;s.cursor=0;s.followUp=null;s.sceneNonce++;
    return true;
  }
  function parseManualTravel(text,house) {
    const x=String(text||'').trim().replace(/^[([]/,'').replace(/[)\]]$/,'');
    if (!HOUSES[house])return null;
    if (/^(?:나는\s*)?(?:기숙사|공용실|내 방)\s*(?:로|에)\s*(?:돌아가|돌아간|돌아갈|가|간|갈|향해|향하|이동하|이동)/.test(x))
      return HOUSES[house].home;
    return null;
  }
  function take(s){
    ensure(s);
    if(s.cursor<s.queue.length){
      const beat=s.queue[s.cursor++];
      s.visited[beat.id]=1;
      if(beat.background)s.lastLocation=beat.background;
      if(beat.id==='arrival_common_room')s.arrivalCompleted=true;
      return {mode:'beat',beat};
    }
    if(s.followUp){
      const after=s.followUp;s.followUp=null;s.queue=[];s.cursor=0;s.phase='idle';
      return {mode:after.type,eventId:after.id};
    }
    if(s.phase!=='idle'){s.phase='idle';s.queue=[];s.cursor=0;}
    return null;
  }
  function hasPending(s){return valid(s)&&
    (s.cursor<s.queue.length||!!s.followUp);}
  function describe(s){
    if(!valid(s))return '';
    return '호그와트 장면 단계: '+s.phase+', 현재 '+s.cursor+'/'+s.queue.length+
      ', 입학식 진행 완료: '+s.arrivalCompleted+'. 장소 이동은 실제 도착 비트가 완결되어야 확정된다.';
  }
  return Object.freeze({createState,valid,startArrival,stageEvent,injectNews,startRoomReturn,parseManualTravel,resolveBackground,take,hasPending,describe,arrival,onEnter,daysBetween,HOUSES});
});