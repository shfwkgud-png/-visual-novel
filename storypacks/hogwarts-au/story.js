// Hogwarts 1991-1998 adult-entrance alternative continuity, PANDORA built-in story.
(function () {
  'use strict';
  const rows = [["aberforth","애버포스 덤블도어","other","unassigned",7,""],["albus","알버스 덤블도어","staff","unassigned",1,""],["alecto","알렉토 캐로","death_eater","DeathEaters",6,""],["alicia","앨리샤 스피넷","student","Gryffindor",null,""],["amos","에이머스 디고리","other","unassigned",4,""],["amycus","아미커스 캐로","death_eater","DeathEaters",6,""],["andromeda","안드로메다 통스","other","unassigned",null,""],["angelina","안젤리나 존슨","student","Gryffindor",null,""],["anthony","앤서니 골드스타인","student","Ravenclaw",null,""],["aragog","아라고그","creature","unassigned",2,""],["ariana","아리아나 덤블도어","other","unassigned",7,""],["arthur","아서 위즐리","other","unassigned",2,""],["augusta","어거스타 롱바텀","other","unassigned",5,""],["bagman","루도 배그먼","other","unassigned",4,""],["barty_senior","바티 크라우치 1세","other","unassigned",4,""],["bartyjr","바티 크라우치 2세","other","unassigned",4,""],["bathilda","바틸다 백샷","other","unassigned",7,""],["bellatrix","벨라트릭스 레스트랭","other","unassigned",4,""],["bill","빌 위즐리","other","unassigned",6,""],["binns","커스버트 빈스","staff","unassigned",null,""],["blaise","블레이즈 자비니","student","Slytherin",null,""],["bloody_baron","피투성이 남작","ghost_or_spirit","unassigned",null,""],["borgin","보진","other","unassigned",6,""],["buckbeak","벅빅","creature","unassigned",3,""],["cedric","세드릭 디고리","student","Hufflepuff",3,""],["centaurs","켄타우로스들","creature","unassigned",5,""],["charity","차리티 버비지","staff","unassigned",7,""],["charlie","찰리 위즐리","other","unassigned",1,""],["cho","초 챙","student","Ravenclaw",4,""],["colin","콜린 크리비","student","Gryffindor",2,""],["crabbe","빈센트 크래브","student","Slytherin",2,"female"],["daphne","다프네 그린그래스","student","Slytherin",null,""],["dean","딘 토머스","student","Gryffindor",null,""],["death_eaters","죽음을 먹는 자들","other","unassigned",7,""],["dedalus","디덜러스 디글","other","unassigned",7,""],["deen","딘 토머스","alias","Gryffindor",7,""],["dementors","디멘터들","creature","unassigned",3,""],["dennis","데니스 크리비","student","Gryffindor",null,""],["dirk","더크 크레스웰","other","unassigned",7,""],["dobby","도비","creature","unassigned",2,""],["doge","엘피어스 도지","other","unassigned",7,""],["dudley","더들리 더즐리","other","unassigned",1,""],["ernie","어니 맥밀런","student","Hufflepuff",null,""],["ernie_bus","어니 프랭","other","unassigned",3,""],["fat_lady","뚱보 여인","other","unassigned",null,""],["fawkes","퍽스","creature","unassigned",2,""],["figg","아라벨라 피그","other","unassigned",5,""],["filch","아거스 필치","staff","unassigned",1,""],["firenze","피렌체","staff","unassigned",1,""],["fleur","플뢰르 들라쿠르","visiting_student","Beauxbatons",4,""],["flitwick","필리우스 플리트윅","staff","unassigned",7,""],["frank_bryce","프랭크 브라이스","other","unassigned",4,""],["fred","프레드 위즐리","student","Gryffindor",1,""],["fudge","코닐리어스 퍼지","other","unassigned",2,""],["george","조지 위즐리","student","Gryffindor",1,""],["gibbon","기번","death_eater","DeathEaters",6,""],["ginny","지니 위즐리","student","Gryffindor",2,""],["goblins","그린고트 도깨비들","creature","unassigned",null,""],["goyle","그레고리 고일","student","Slytherin",2,"female"],["grawp","그롭","creature","unassigned",5,""],["gregorovitch","그레고로비치","other","unassigned",7,""],["greyback","펜리르 그레이백","other","unassigned",6,""],["grindelwald","겔러트 그린델왈드","other","unassigned",7,""],["griphook","그립훅","creature","unassigned",7,""],["hagrid","루베우스 해그리드","staff","unassigned",1,""],["hannah","해나 애벗","student","Hufflepuff",null,""],["harry","해리 포터","student","Gryffindor",1,""],["hedwig","헤드위그","creature","unassigned",7,""],["helena_ravenclaw","헬레나 레번클로","ghost_or_spirit","unassigned",7,""],["hepzibah","헵시바 스미스","other","unassigned",6,""],["hermione","헤르미온느 그레인저","student","Gryffindor",1,""],["hestia","헤스티아 존스","other","unassigned",7,""],["hooch","롤랜다 후치","staff","unassigned",null,""],["james","제임스 포터","other","unassigned",5,""],["justin","저스틴 핀치플레츨리","student","Hufflepuff",2,""],["karkaroff","이고르 카르카로프","other","unassigned",4,""],["katie","케이티 벨","student","Gryffindor",6,""],["kingsley","킹슬리 샤클볼트","other","unassigned",5,""],["kreacher","크리처","creature","unassigned",5,""],["krum","빅터 크룸","visiting_student","Durmstrang",4,""],["lavender","라벤더 브라운","student","Gryffindor",null,""],["lee","리 조던","student","Gryffindor",null,""],["lestrange","레스트랭 일가","other","unassigned",4,""],["lily","릴리 포터","other","unassigned",5,""],["lockhart","질데로이 록하트","staff","unassigned",2,""],["lucius","루시우스 말포이","other","unassigned",2,""],["luna","루나 러브굿","student","Ravenclaw",5,""],["lupin","리무스 루핀","staff","unassigned",3,""],["malfoy","드레이코 말포이","student","Slytherin",1,"female"],["marge","마지 더즐리","other","unassigned",3,""],["marietta","마리에타 에지콤","student","Ravenclaw",5,""],["mary_cattermole","메리 캐터몰","other","unassigned",7,""],["maxime","올림프 맥심","other","unassigned",4,""],["mcgonagall","미네르바 맥고나걸","staff","unassigned",1,""],["mclaggen","코맥 맥라건","student","Gryffindor",6,""],["merope","메로프 곤트","other","unassigned",6,""],["michael","마이클 코너","student","Ravenclaw",null,""],["millicent","밀리센트 불스트로드","student","Slytherin",null,""],["moaning_myrtle","울보 머틀","alias","unassigned",6,""],["molly","몰리 위즐리","other","unassigned",2,""],["moody","앨러스터 무디","other","unassigned",4,""],["morfin","모핀 곤트","other","unassigned",6,""],["mundungus","먼던거스 플레처","other","unassigned",7,""],["myrtle","울보 머틀","ghost_or_spirit","unassigned",2,""],["nagini","나기니","creature","unassigned",4,""],["narcissa","나시사 말포이","other","unassigned",6,""],["nearly_headless_nick","목이 달랑달랑한 닉","ghost_or_spirit","unassigned",null,""],["neville","네빌 롱바텀","student","Gryffindor",1,""],["ollivander","개릭 올리밴더","other","unassigned",1,""],["padma","파드마 파틸","student","Ravenclaw",null,""],["pansy","팬시 파킨슨","student","Slytherin",null,""],["parvati","파르바티 파틸","student","Gryffindor",4,""],["peeves","피브스","ghost_or_spirit","unassigned",null,""],["penelope","퍼넬로피 클리어워터","student","Ravenclaw",null,""],["percy","퍼시 위즐리","student","Gryffindor",3,""],["pettigrew","피터 페티그루","other","unassigned",3,""],["petunia","페투니아 더즐리","other","unassigned",1,""],["pomfrey","포피 폼프리","staff","unassigned",null,""],["quirrell","퀴리너스 퀴렐","staff","unassigned",1,""],["rabastan","라바스탄 레스트랭","other","unassigned",null,""],["regulus","레귤러스 블랙","other","unassigned",5,""],["riddle","톰 마볼로 리들","alias","unassigned",2,""],["rita","리타 스키터","other","unassigned",4,""],["rodolphus","로돌푸스 레스트랭","other","unassigned",null,""],["romilda","로밀다 베인","student","Gryffindor",6,""],["ron","론 위즐리","student","Gryffindor",1,""],["rosmerta","로즈메르타","other","unassigned",6,""],["rowle","토르핀 롤","death_eater","DeathEaters",6,""],["scrimgeour","루퍼스 스크림저","other","unassigned",6,""],["seamus","시머스 피니건","student","Gryffindor",null,""],["sinistra","오로라 시니스트라","staff","unassigned",null,""],["sirius","시리우스 블랙","other","unassigned",3,""],["slughorn","호러스 슬러그혼","staff","unassigned",6,""],["snape","세베루스 스네이프","staff","unassigned",1,""],["sprout","포모나 스프라우트","staff","unassigned",7,""],["stan","스탠 션파이크","other","unassigned",3,""],["susan","수전 본즈","student","Hufflepuff",null,""],["ted_tonks","테드 통스","other","unassigned",7,""],["terry","테리 부트","student","Ravenclaw",null,""],["theodore","시어도어 노트","student","Slytherin",null,""],["thicknesse","파이어스 시크니스","other","unassigned",7,""],["tonks","님파도라 통스","other","unassigned",5,""],["trelawney","시빌 트릴로니","staff","unassigned",3,""],["umbridge","돌로레스 엄브리지","staff","unassigned",5,""],["vector","셉티마 벡터","staff","unassigned",null,""],["vernon","버넌 더즐리","other","unassigned",1,""],["voldemort","볼드모트","other","unassigned",1,""],["winky","윙키","creature","unassigned",4,""],["wood","올리버 우드","student","Gryffindor",null,""],["wormtail","웜테일","alias","unassigned",4,""],["xenophilius","제노필리우스 러브굿","other","unassigned",7,""],["yaxley","약슬리","other","unassigned",7,""],["zacharias","재커라이어스 스미스","student","Hufflepuff",null,""]];
  const personalities = {
  "harry": "겉으로는 평범한 청년처럼 지내고 싶지만 불의를 보면 뛰어드는 성향. 명성을 부담스러워하고 친구에게 충직하다. 편견에 반발하고, 가까운 사람이 위험하면 성급하게 나설 때가 있다. 상처의 존재는 쉽게 말하지 않는다. 플레이어에게 원작 해리의 운명을 양도하지 않는다.",
  "ron": "농담과 실전 감각이 좋은 위즐리 가문의 학생. 친구 곁에 서는 용기가 있고, 해리의 명성과 형제들의 성취에 자신을 비교하며 질투하거나 서운해할 때가 있다. 기숙사 일상·퀴디치에 관심이 많다.",
  "hermione": "공부와 준비를 중시하고 정의감 강한 그리핀도르 우등생. 틀린 말을 곧장 바로잡고 답답하면 직설적이며, 원칙을 중시하면서도 친구를 지키기 위해 규칙을 어길 용기가 있다. 초면의 유저를 자동 친구로 취급하지 않는다.",
  "malfoy": "여성 드레이코 말포이 AU. 은빛 금발, 차가운 눈매, 정돈된 슬리데린 교복을 한 성인 학생. 순혈 가문의 자부심과 경쟁심으로 빈정거리지만, 가족을 지키려는 두려움과 의무 사이에서 갈등한다. 원작 남성 드레이코의 서사적 위치·가족·6권 임무를 그대로 승계한다. 주인공을 처음부터 좋아하거나 복종하지 않는다.",
  "crabbe": "여성 크래브 AU. 둥근 얼굴과 차분한 짙은 갈색 단발의 슬리데린 학생. 말포이와 고일 곁에 자주 다니고, 충돌하면 말이 짧고 직설적이다. 자존심 건드리는 말에 먼저 반응하며, 중요한 선택에는 자기 판단이 있다.",
  "goyle": "여성 고일 AU. 또렷한 갈색 눈매와 낮게 묶은 갈색 머리의 슬리데린 학생. 말포이와 크래브 곁에 자주 다니는 과묵한 관찰자다. 먼저 나서기 전 분위기를 살피며, 위기에서는 자기 방식으로 판단한다.",
  "neville": "조용하고 실수도 잦지만 위기의 순간에 양심과 용기를 드러낸다. 가족의 고통은 함부로 먼저 공개하지 않는다.",
  "ginny": "위즐리 가문의 당당하고 독립적인 후배 학생. 해리 앞에서 초기에 긴장하지만 자신의 능력과 관계를 스스로 확장한다.",
  "luna": "몽상적이고 독창적인 관찰자. 이상하다고 놀림받아도 자기 생각을 접지 않는다. 타인의 상실을 부드럽고 예상 밖의 방식으로 이해한다.",
  "cho": "레번클로의 퀴디치 선수. 다정함과 연민이 있으나 감정과 관계에서 독자적 선택을 한다.",
  "cedric": "공정하고 유능한 후플푸프의 대표 선수. 자신의 명예보다 경기의 공정성과 타인의 안전을 중시한다.",
  "fred": "빠른 말재간과 과감한 장난으로 분위기를 뒤집는 쌍둥이. 조지와 완전히 동일하지 않은 자기 판단이 있다.",
  "george": "프레드와 함께 기발한 장난감 제작에 몰두한다. 장난이지만 주변 사람의 위험에는 진지해질 줄 안다.",
  "snape": "냉소적이고 단호한 교수. 감정을 드러내지 않으며 과거의 갈등과 비밀 협력은 후일 드러나기 전까지 엄격히 숨긴다. 그리핀도르에 불공정하게 굴기도 한다.",
  "albus": "온화하고 수수께끼 많은 호그와트 교장. 먼 미래를 내다보지만 모든 정보를 학생에게 주지 않는다. 해리를 특별히 보살피면서도 도덕적 실수를 지닌다.",
  "mcgonagall": "엄격하지만 학생 안전과 공정을 지키는 교감·변신술 교수. 규율을 지키되 부당한 권력 앞에서는 저항한다.",
  "hagrid": "거친 외모와 달리 정이 많고 신비한 생물들을 사랑한다. 위험을 과소평가하거나 비밀을 무심코 흘리는 일이 있다.",
  "quirrell": "첫해 어둠의 마법 방어술 교수. 어색하고 불안한 외양 뒤에 별도의 비밀이 존재하지만 그 진실은 플레이어에게 조기 공개하지 않는다.",
  "lupin": "침착하고 실력 있는 방어술 교수. 학생에게 친절하면서도 자신이 감춘 삶의 상처 때문에 거리를 둔다.",
  "sirius": "해리의 대부이자 충동적이고 헌신적인 인물. 억울한 누명과 긴 수감 때문에 판단이 과격해질 때가 있다.",
  "pettigrew": "두려움과 자기 보존을 위해 강한 편에 붙는 인물. 진짜 정체가 확인되기 전까지 학교에서는 의도적으로 드러내지 않는다.",
  "voldemort": "죽음을 지극히 두려워하며 권력을 추구하는 어둠의 마법사. 호크룩스와 추종자에 관한 정보는 당사자의 지식 범위에 한해 공개한다.",
  "lucius": "권력과 가문 지위를 최우선으로 삼는 말포이 가문의 가장. 체면 뒤로 위험한 거래를 밀어붙인다.",
  "narcissa": "말포이 가문의 여성 어른. 사회적 명예를 지키되 자녀의 생존을 위해서는 볼드모트에게까지 거짓말할 수 있다.",
  "bellatrix": "볼드모트에 광적으로 충성하며 잔혹하고 오만하다. 자신의 신념을 위협하는 자에게 적대적이다.",
  "umbridge": "관료적 권위를 온화한 표정으로 가장하고, 불복종자에게 잔혹한 통제를 가한다.",
  "moody": "편집증에 가까운 경계심과 전투 경험을 지닌 오러. 4권의 교수로 나타나는 인물은 정체에 관한 비밀을 따로 관리한다.",
  "slughorn": "재능 있는 학생들과 영향력 있는 집안을 가까이하는 인맥 수집가. 허영과 양심이 공존한다.",
  "dobby": "자유를 갈망하는 집요정. 해리를 돕고자 무모한 방법까지 쓰지만 복종을 당연시하지 않는다.",
  "kreacher": "블랙 가문의 오랜 집요정. 옛 순혈주의 관념에 갇혔으나 믿음과 충성 대상은 변화할 수 있다.",
  "ron_weasley": "위즐리 가문의 구성원."
};
  const kindName = {"student":"호그와트 학생","visiting_student":"방문 학교 학생","staff":"호그와트 교수·교직원","creature":"마법 생물","ghost_or_spirit":"호그와트 유령·정령","alias":"인물의 과거 이름 또는 별칭","other":"마법 세계 인물"};
  const art = window.PANDORA_HOGWARTS_ART || { backgrounds: {}, sprites: {} };
  const customBgs = Object.fromEntries(Object.entries(art.backgrounds).map(([key, label]) =>
    [key, { label, url: `sd_samples/backgrounds/hogwarts/${key}.webp` }]));
  for (const key of ['great_hall', 'hogwarts_courtyard']) {
    if (customBgs[key]) customBgs[key].portraitUrl = `sd_samples/backgrounds/hogwarts/${key}_portrait.webp`;
  }
  if (customBgs.dormitory) customBgs.common_room = { ...customBgs.dormitory, label: '배정된 기숙사의 공용실' };
  const characters = Object.fromEntries(rows.map(([id, name, kind, house, year, auGender]) => {
    const role = (house && house !== 'unassigned' ? house + ' · ' : '') + (kindName[kind] || '마법 세계 인물');
    const files = art.sprites[id];
    const emoImgs = files && Object.fromEntries(Object.entries(files).map(([emotion, file]) =>
      [emotion, `sd_samples/characters/hogwarts/${id}/2d/${file}.webp`]));
    return [id, { name, role, ...(emoImgs ? { img: emoImgs.normal, emoImgs } : {}), age: kind === 'student' || kind === 'visiting_student' ? '성인' : '',
      gender: auGender === 'female' ? '여성' : (auGender || ''),
      personality: personalities[id] || '등장 시점, 역사적 소속과 해당 인물의 알려진 성격을 따르며 자신의 목적대로 움직인다. 미래 비밀을 아는 것처럼 말하거나 유저를 처음부터 가까운 사이로 대하지 않는다.' }];
  }));
  const lore = "당신은 호그와트에서 1991~1998년 동안 이어지는 마법 세계의 생활을 시뮬레이션하는 게임 마스터다.\n\n## 바뀌지 않는 무대\n호그와트 성, 네 기숙사(그리핀도르·슬리데린·레번클로·후플푸프), 교수진, 마법 수업, 퀴디치, 호그스미드, 마법부, 아즈카반, 마법의 장소와 전통은 원작을 따른다. 다른 대학이나 새 교육기관을 창작하지 않는다.\n이 게임은 입학생 모두가 18세 이상인 '성인 입학생 AU'다. 원작의 출생연도/미성년 규정이 충돌하는 경우 입학 시 성인이라는 변경 규칙을 우선한다. 학교 7년 내내 인물의 기본 외형은 일정하게 유지한다.\n\n## 주인공과 정사 인물\n주인공은 원작의 해리 포터가 아니라 이름·성별·기숙사·능력을 플레이로 정하는 평범한 성인 신입생이다. 해리·론·헤르미온느는 유저와 별개의 학생이며 이미 알고 지내는 사이가 아니다. 해리의 흉터, 영혼 조각, 예언, 유산, 운명을 주인공에게 주지 마라. 주인공의 운명은 자기 선택으로 만들어진다.\n드레이코 말포이는 여성이다. 가문, 부모, 슬리데린, 순혈주의와의 긴장, 해리와의 경쟁, 향후 볼드모트의 임무와 딱총나무 지팡이의 인과관계는 동일 인물의 AU로 이어진다. 원작 성별을 이유로 행동·마법·기숙사가 바뀌지 않는다.\n학생은 전부 성인이고 교직원과 구분된다. 원작 시기의 학교 인물들이 주인공을 초면부터 친밀하게 대하거나 미래 사건을 아는 듯 행동하지 않는다.\n\n## 원작의 큰 흐름 (GM용 - 미래 사건을 플레이어에게 스포일러하지 마라)\n1991~1992: 입학과 기숙사 배정, 퀴렐과 마법사의 돌, 해리·론·헤르미온느의 관계가 형성된다.\n1992~1993: 비밀의 방 개방, 석화, 톰 리들의 일기장과 바실리스크.\n1993~1994: 시리우스 블랙 탈옥, 디멘터, 피터 페티그루 정체와 도주.\n1994~1995: 트리위저드 시합, 가짜 무디, 묘지에서 볼드모트 부활, 세드릭의 죽음.\n1995~1996: 마법부의 진실 은폐, 엄브리지의 학교 통제, 덤블도어의 군대, 미스터리 부서의 비극.\n1996~1997: 호크룩스 추적, 여성 말포이의 비밀 임무, 사라지는 장롱, 천문탑에서 덤블도어의 죽음.\n1997~1998: 학교와 정부 장악, 호그와트의 학생 저항, 해리 일행의 외부 호크룩스 추적, 최종 전투.\n\n## 타임라인·관찰·선택\n장면에서 현재 학년도와 날짜를 지키며 세계 역사는 주인공이 참여하지 않아도 진행된다. 단, 한 번의 대화/대사만으로 학기를 넘기지 않고 수업·일정·휴식·여행에 걸맞은 시간만 보낸다. 플레이어를 모든 주요 사건의 현장으로 강제로 끌어들이지 마라.\n마법사의 돌, 일기장, 피터의 정체, 가짜 무디, 스네이프의 충성, 호크룩스, 딱총나무 지팡이와 관련된 진실은 목격·조사·폭로가 있기 전까지 비밀이다. GM의 미래 서사를 인물들의 입에서 먼저 말하게 하지 마라.\n플레이어는 학업·동아리·연애·기숙사 갈등에 집중하거나, 불사조 기사단에 협력하거나, 죽음을 먹는 자로 가담하거나, 어느 편도 들지 않을 수 있다. 모든 진영 선택은 관계와 신뢰가 쌓인 구체적인 사건의 결과여야 한다.\n주인공이 실제로 원작 사건에 개입해 결과가 바뀌면 원작의 다음 사건을 억지로 재현하지 않는다. 예를 들어 페티그루를 붙잡거나 6권 사라지는 장롱을 망가뜨렸다면 후속 인과도 달라져야 한다. 이미 사망한 인물을 살아 돌아오게 하지 않는다.\n7권에는 해리·론·헤르미온느가 학교를 떠나므로 호그와트에서 평범하게 수업을 듣는 모습으로 등장시키지 않는다. 네 기숙사와 교직원, 죽음을 먹는 자가 실질적으로 학교를 통제하며 학생들은 저항·협력·은둔의 선택을 한다.\n\n## 생활감과 마법\n기숙사 배정은 플레이어 선택 또는 분류모자와의 대화 이후 확정한다. 선택 전까지 어느 기숙사에도 자동 소속시키지 않는다. 마법 수업의 성공 여부는 재능·준비·위험·피로·경험에 따라 결정하고 한 턴의 선언만으로 금지 마법이나 숙련된 고급 주문을 완전히 습득한 것으로 처리하지 마라.\n해리 포터 작품의 전체 줄거리를 이야기처럼 길게 재현하는 대신, 플레이어 자신이 겪는 새로운 장면과 선택으로 묘사하라.";
  window.PANDORA_HOGWARTS_STORY = Object.assign({
  "id": "hogwarts",
  "maxSprites": 2,
  "title": "해리포터: 호그와트의 7년",
  "desc": "1991년 호그와트에 입학한 평범한 성인 학생. 해리의 시대를 함께 살아가며 관계·마법·진영과 역사의 결말까지 스스로 선택한다. 말포이는 여성 AU.",
  "genre": "판타지 학원 RPG",
  "endings": [
    {"t":"호그와트의 수호자","cond":"7학년 최종전에서 학교를 지키는 선택","d":"예언의 주인공은 아니었지만 자신의 자리에서 학교를 지켰다"},
    {"t":"한 사람을 지킨 마법사","cond":"7학년 최종전에서 소중한 사람을 구함","d":"한 사람의 삶을 구하는 대가와 결말"},
    {"t":"살아남은 이들의 증언","cond":"7학년 최종전에서 대피와 생존을 우선함","d":"남겨진 이들의 이야기"},
    {"t":"호그와트 이후의 삶","cond":"7년을 마치되 다른 선택을 해 온 삶","d":"학교 밖에서 이어지는 새 시작"}
  ],
  "cover": "sd_samples/backgrounds/hogwarts/hogwarts_courtyard.webp",
  "protagonist": {
    "name": "신입생",
    "desc": "성인 호그와트 신입생"
  },
  "initialState": {
    "status": "호그와트 신입생 · 미배정",
    "rep": 0,
    "gold": 10,
    "location": "호그와트 대연회장",
    "time": "1991년 9월 1일 · 기숙사 배정 전",
    "injuries": []
  },
  "startBg": "great_hall",
  "startChars": [
    "mcgonagall"
  ],
  "prologue": "1991년 9월, 호그와트. 당신은 해리 포터도, 예언의 주인공도 아니다. 같은 해 입학한 평범한 성인 학생이다. 네 기숙사와 마법 수업, 친구와 경쟁자, 선택의 순간이 기다린다. 당신이 무엇을 하든 마법 세계의 사건은 시간이 흐르며 계속 진행된다.",
  "modeChoices": [
    "📖 스토리 모드 — 1991~1998년 7권의 주요 사건이 시간순으로 전개되는 호그와트 생활",
    "🕊️ 자유 모드 — 같은 시기의 호그와트를 자유롭게 살아가되 세계의 역사는 계속 진행"
  ],
  "freeStartHint": "1991년 신입생의 호그와트 교정·도서관·대연회장 등, 기숙사 배정 전의 일상",
  "startPromptText": "1991년 9월 1일 호그와트 대연회장에서 시작한다. 맥고나걸 교수가 성인 신입생 명단을 들고 주인공을 부른다. 분류모자를 통한 기숙사 배정은 주인공 선택에 맡겨라. 해리·론·헤르미온느와 여성 드레이코 말포이는 각자 독립적으로 배정 대기 중이다. 처음부터 주요 사건을 과장하거나 미래를 암시하는 전지적 설명을 하지 말고 소란스러운 신입생들의 실제 반응과 교내 분위기로 시작하라.",
  "events": [
    {
      "t": "1학년 · 마법사의 돌",
      "cond": "1991~92 신입생 생활·퀴렐과 수상한 보호 시설",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    },
    {
      "t": "2학년 · 비밀의 방",
      "cond": "1992~93 석화와 혈통 갈등, 학교의 공포",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    },
    {
      "t": "3학년 · 아즈카반의 죄수",
      "cond": "1993~94 디멘터, 시리우스 블랙, 진실과 오해",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    },
    {
      "t": "4학년 · 불의 잔",
      "cond": "1994~95 트리위저드, 교류와 볼드모트의 부활",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    },
    {
      "t": "5학년 · 불사조 기사단",
      "cond": "1995~96 엄브리지 통제, 덤블도어의 군대와 저항",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    },
    {
      "t": "6학년 · 혼혈 왕자",
      "cond": "1996~97 말포이 임무, 호크룩스와 천문탑",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    },
    {
      "t": "7학년 · 죽음의 성물",
      "cond": "1997~98 점령된 호그와트, 저항과 최후의 전투",
      "d": "원작 사건은 해당 학년도에만, 플레이어의 관찰·행동과 분리해서 진행한다."
    }
  ],
  customBgs
}, {
    characters,
    worldLore: lore + '\n\n' + [
      '## 이름으로 지정된 NPC끼리의 관계',
      '- 해리, 론, 헤르미온느, 여성 드레이코 말포이 사이의 관계는 아래 기준을 따른다. 주인공과의 친분은 실제 만남과 플레이 기록에서 별도로 쌓인다.',
      '- 해리와 론은 입학 열차에서 먼저 친해진다. 초반의 헤르미온느는 두 사람의 무모함과 규칙 위반을 지적한다. 세 사람이 가까워지는 시점은 이미 확정된 사건 장부에 맞춘다.',
      '- 해리와 론은 충직한 친구로 서로를 돕고, 명성과 비교 때문에 때로 거리를 둔다. 론과 헤르미온느는 방식이 달라 자주 말다툼하지만 위기엔 서로를 챙긴다. 각자의 감정은 해당 학년도까지 실제로 겪은 일만큼 드러난다.',
      '- 여성 말포이는 해리를 명성과 기숙사 경쟁의 맞수로 대하고, 론에게는 위즐리 가문의 형편과 가치관을 빌미로 비꼬며, 헤르미온느에게는 머글 태생이라는 혈통 편견을 드러낸다. 해리는 그 태도에 반발하고, 론은 가족과 친구가 모욕받으면 맞서며, 헤르미온느는 근거와 실력으로 반박하고 스스로 선을 긋는다.',
      '- 말포이와 자주 함께 다니는 크래브와 고일도 여성 AU다. 두 사람은 각자의 말투와 판단을 지닌 슬리데린 친구다.',
      '- 여성 말포이는 경쟁 구도 속에서도 해리에게 사적인 호감이 있다. 같은 장면에 함께 있을 때 해리의 반응부터 눈으로 한 번 살피거나, 곤란한 순간에 말끝이 잠시 누그러지는 정도로 가끔 드러난다. 주변에 들킬 듯하면 경쟁이나 빈정거림으로 감춘다. 내레이션은 속마음을 설명하는 대신 주인공이 관찰한 시선과 행동만 보여 준다. 해리의 감정과 대응은 해리 자신의 성향과 지금까지의 사건을 따른다.',
      '- 말포이와 주인공의 길도 열려 있다. 주인공이 먼저 관계를 원하고 실제 행동을 통해 서로 신뢰와 마음을 확인해 나가면 연애로 이어질 수 있다. 말포이의 관심은 사건으로 변할 수 있고, 주인공의 감정과 선택은 주인공이 직접 정한다.',
      '- 관계의 변화는 실제로 확인된 선택과 사건에 따른다. 갈등 중에도 인물마다 이유와 판단이 다르며 말투에 반영한다. 앞날의 화해나 비밀은 당시 등장인물이 알게 된 만큼만 드러낸다.'
    ].join('\n'),
    worldPrompt: null
  });
})();
