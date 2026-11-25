/* Hogwarts calendar. The game owns the clock, saves and all navigation. */
window.PandoraHogwartsCalendar = (() => {
  const slots=['아침','오후','저녁','밤'];
  const iso=d=>d.toISOString().slice(0,10);
  function open(hp,lockReason,go){
    const dialog=document.getElementById('hwCalendar');
    if(dialog.open)return;
    const world=window.PandoraHogwartsWorld, rows=world.calendarEvents(hp);
    const today=hp.date, first='1991-09', last='1998-06';
    let month=today.slice(0,7), picked=today;
    const find=id=>dialog.querySelector('#'+id);
    const picker=find('hwMonth'),grid=find('hwDays'),list=find('hwDiary'),detail=find('hwDateDetail');
    function button(text,run){
      const el=document.createElement('button');el.type='button';el.textContent=text;el.onclick=run;return el;
    }
    function label(text,tag='span'){
      const el=document.createElement(tag);el.textContent=text;return el;
    }
    function monthOffset(key,n){
      const [y,m]=key.split('-').map(Number);
      return iso(new Date(Date.UTC(y,m-1+n,1))).slice(0,7);
    }
    function monthName(key){
      const [year,m]=key.split('-');return year+'년 '+Number(m)+'월';
    }
    function selectMonth(key){
      month=key;
      picked=key===today.slice(0,7)?today:(rows.find(e=>e.date.startsWith(key)&&e.available)?.date||key+'-01');
      render();
    }
    picker.replaceChildren();
    for(let key=first;key<=last;key=monthOffset(key,1))picker.add(new Option(monthName(key),key));
    picker.onchange=()=>selectMonth(picker.value);
    find('hwPrev').onclick=()=>selectMonth(monthOffset(month,-1));
    find('hwNext').onclick=()=>selectMonth(monthOffset(month,1));
    find('hwToday').onclick=()=>selectMonth(today.slice(0,7));
    function render(){
      picker.value=month;
      find('hwPrev').disabled=month===first;find('hwNext').disabled=month===last;
      grid.replaceChildren();list.replaceChildren();detail.replaceChildren();
      const entries=rows.filter(e=>e.date.startsWith(month));
      const start=new Date(month+'-01T00:00:00Z'),d=new Date(start);
      for(let n=0;n<start.getUTCDay();n++)grid.append(label(''));
      for(;iso(d).startsWith(month);d.setUTCDate(d.getUTCDate()+1)){
        const date=iso(d),events=entries.filter(e=>e.date===date);
        const cell=button(String(d.getUTCDate()),()=>{picked=date;render();grid.querySelector('[aria-pressed="true"]').focus();});
        cell.setAttribute('aria-label',date+' '+events.map(e=>e.title).join(', '));
        cell.setAttribute('aria-pressed',String(date===picked));
        if(date===today)cell.setAttribute('aria-current','date');
        if(events.length){
          const dots=label('');dots.className='hwDots';
          for(const type of new Set(events.map(e=>e.category==='약속'?'meeting':'story'))){
            const dot=label('');dot.className=type;dots.append(dot);
          }
          cell.append(dots);
        }
        grid.append(cell);
      }
      const heading=label(Number(picked.slice(5,7))+'월 '+Number(picked.slice(8))+'일','h3');
      detail.append(heading);
      const ended=hp.world.finished.battle_of_hogwarts;
      const selected=entries.filter(e=>e.date===picked);
      const reason=lockReason();
      function destination(ev){
        if(reason||!world.calendarDestination(hp,picked,ev?.id))return;
        const before=rows.filter(e=>e.available&&(e.date<picked||(ev&&e.date===picked&&rows.indexOf(e)<rows.indexOf(ev))));
        const meetings=before.filter(e=>e.category==='약속');
        if(before.length){
          const msg=label('건너뛸 일정 '+before.length+'건'+(meetings.length?' (약속: '+meetings.map(e=>e.title).join(', ')+')':'')+'. 직접 참여한 기록은 남지 않습니다.','small');
          detail.append(msg);
        }
        const target=picked;
        const action=button(ev?'이 일정으로 이동 →':'이날 자유시간으로 이동 →',()=>{
          if(lockReason())return render();
          dialog.close();go(target,ev?.id);
        });
        if(ev)action.setAttribute('aria-label',ev.title+' 일정으로 이동');
        action.className='hwTravel'; detail.append(action);
      }
      for(const e of selected){
        detail.append(label(e.category+' · '+slots[e.slot]+(e.done?' · 완료':''),'small'),label(e.title,'h4'));
        if(e.available)destination(e);
      }
      if(!selected.length){
        detail.append(label('등록된 사건이나 약속이 없습니다.','p'));destination(null);
      }
      const lessons=hp.magic ? window.PandoraHogwartsMagic.agenda(hp.magic,picked) : [];
      if(lessons.length){
        const schedule=document.createElement('ul');schedule.className='hwLessons';schedule.setAttribute('aria-label','수업 시간표');
        for(const lesson of lessons)schedule.append(label(slots[lesson.slot]+' · '+lesson.label,'li'));
        detail.append(schedule);
      }
      if(!reason && lessons.some(entry=>entry.unit) && world.calendarDestination(hp,picked,'after_school')){
        const after=button('오늘 방과 후로 이동',()=>{if(lockReason())return render();dialog.close();go(picked,'after_school');});
        after.className='hwTravel';detail.append(after);
      }
      if(reason)detail.append(label(reason,'small'));
      else if(!ended && today<='1998-05-02' && picked>'1998-05-02')detail.append(label('최종 사건을 마친 뒤 이동할 수 있습니다.','small'));
      for(const e of entries){
        const line=button('',()=>{picked=e.date;render();detail.scrollIntoView({block:'nearest'});});
        const when=label(Number(e.date.slice(8))+'일','strong');
        const name=label(e.title);name.className='hwName';
        const type=label(e.done?'완료':e.category);type.className=e.category==='약속'?'hwMeeting':'hwType';
        line.append(when,name,type);list.append(line);
      }
      if(!entries.length){
        const upcoming=rows.find(e=>e.available&&e.date>month+'-31');
        if(upcoming)list.append(button('다가오는 일정  ·  '+upcoming.date+'  '+upcoming.title,()=>{
          month=upcoming.date.slice(0,7);picked=upcoming.date;render();
        }));
        else list.append(label('이달에 등록된 일정이 없습니다.','p'));
      }
    }
    render();dialog.showModal();
  }
  return {open};
})();
