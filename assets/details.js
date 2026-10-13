/* Participant details: calculations and charts use stored data only. */
(() => {
  "use strict";
  const EPS=1e-9;
  const finite=value=>typeof value==="number"&&Number.isFinite(value);
  const eq=(a,b)=>Math.abs(a-b)<EPS;
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function dayDate(day){
    if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
    const date=new Date(day+"T00:00:00Z");
    return Number.isNaN(+date)||date.toISOString().slice(0,10)!==day?null:date;
  }
  function ranking(participants,prices){
    const rows=participants.map((p,i)=>{
      const quote=prices?.markets?.[p.ticker]||{};
      const price=finite(quote.price)&&quote.price>0?quote.price:null;
      return {...p,i,quote,price,roi:price===null?null:(price/p.start-1)*100};
    }).sort((a,b)=>a.roi===null?(b.roi===null?a.i-b.i:1):b.roi===null?-1:b.roi-a.roi||a.i-b.i);
    const complete=rows.every(p=>p.roi!==null);
    return rows.map(p=>({...p,rank:complete?rows.findIndex(q=>eq(q.roi,p.roi))+1:null}));
  }
  function target(person,group){
    if(!group?.length||person.price===null)return null;
    if(group.some(p=>p.id!==person.id&&p.ticker===person.ticker))return {shared:true,names:group.map(p=>p.name)};
    const tiePrice=person.start*(1+group[0].roi/100);
    return {shared:false,names:group.map(p=>p.name),tiePrice,extraPct:Math.max(0,(tiePrice/person.price-1)*100)};
  }
  function series(participant,records,period="all"){
    const days=new Map();
    for(const record of Array.isArray(records)?records:[]){
      if(!record||record.demo||!dayDate(record.day)||!finite(record.returns?.[participant.id])||record.returns[participant.id]<=-100)continue;
      const previous=days.get(record.day);
      if(previous&&String(previous.updatedAt||"")>String(record.updatedAt||""))continue;
      const roi=record.returns[participant.id];
      const rank=record.ranks?.[participant.id];
      days.set(record.day,{day:record.day,updatedAt:record.updatedAt,roi,price:participant.start*(1+roi/100),rank:Number.isInteger(rank)&&rank>=1&&rank<=9?rank:null,sourceDay:record.priceDates?.[participant.ticker]||null});
    }
    const points=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
    if(period==="all"||!points.length)return points;
    const daysBack=Number(period);
    if(!Number.isFinite(daysBack)||daysBack<1)return points;
    const cutoff=dayDate(points.at(-1).day);
    cutoff.setUTCDate(cutoff.getUTCDate()-daysBack+1);
    return points.filter(p=>p.day>=cutoff.toISOString().slice(0,10));
  }
  function compute(participants,prices,records,id){
    const rows=ranking(participants,prices),person=rows.find(p=>p.id===id);
    if(!person)return null;
    const points=series(person,records);
    const validRanks=points.map(p=>p.rank).filter(Number.isInteger);
    const result={person,rows,points,complete:rows.every(p=>p.rank!==null),ahead:null,behind:null,aheadTarget:null,leaderGap:null,safety:{status:"pending",gap:null,target:null},peers:rows.filter(p=>p.id!==id&&p.ticker===person.ticker),stats:{best:validRanks.length?Math.min(...validRanks):null,worst:validRanks.length?Math.max(...validRanks):null,change:null}};
    if(!result.complete)return result;
    const same=rows.filter(p=>eq(p.roi,person.roi));
    result.joint=same.length>1;
    result.tiedNames=same.filter(p=>p.id!==id).map(p=>p.name);
    const above=rows.filter(p=>p.roi-person.roi>EPS),below=rows.filter(p=>person.roi-p.roi>EPS);
    if(above.length){const roi=above.at(-1).roi;const group=above.filter(p=>eq(p.roi,roi));result.ahead={group,gap:roi-person.roi};result.aheadTarget=target(person,group);}
    if(below.length){const roi=below[0].roi;result.behind={group:below.filter(p=>eq(p.roi,roi)),gap:person.roi-roi};}
    result.leaderGap=Math.max(0,rows[0].roi-person.roi);
    const safeCount=Math.max(1,rows.length-3),boundary=rows[safeCount-1],riskTop=rows[safeCount];
    if(riskTop){
      const tiedCut=eq(boundary.roi,riskTop.roi);
      const status=person.roi<boundary.roi-EPS?"risk":tiedCut&&eq(person.roi,boundary.roi)?"boundary":"safe";
      const goalGroup=rows.filter(p=>eq(p.roi,boundary.roi));
      result.safety={status,gap:status==="safe"?Math.max(0,person.roi-riskTop.roi):Math.max(0,boundary.roi-person.roi),target:status==="safe"?null:result.peers.length?{shared:true,names:result.peers.map(p=>p.name)}:target(person,goalGroup),tiedCut};
    }else result.safety={status:"safe",gap:null,target:null};
    const last=points.at(-1);
    const sameCurrent=last&&last.updatedAt===prices?.updatedAt;
    const previous=points.at(sameCurrent?-2:-1);
    if(previous?.rank)result.stats.change=previous.rank-person.rank;
    return result;
  }
  const priceFmt=(value,cur,digits=false)=>finite(value)?(cur==="USD"?"$":"₩")+new Intl.NumberFormat(cur==="USD"?"en-US":"ko-KR",{minimumFractionDigits:cur==="USD"?2:0,maximumFractionDigits:digits?(cur==="USD"?4:2):(cur==="USD"?2:0)}).format(value):"미확인";
  const pct=value=>finite(value)?(value>=0?"+":"−")+Math.abs(value).toFixed(2)+"%":"미확인";
  const gap=value=>finite(value)?value>0&&value<.005?"0.01%p 미만":value.toFixed(2)+"%p":"미확인";
  const names=group=>group?.map(p=>p.name).join("·")||"";
  let config=null,selected=null,returnFocus=null,returnPerson=null,scrollState=null;
  const $=id=>document.getElementById(id);
  function close(){if($("participantDetail").open)$("participantDetail").close();}
  function open(id,opener){
    if(!config||!config.getData().prices)return;
    if(!config.getData().participants.some(p=>p.id===id))return;
    const dialog=$("participantDetail");
    if(!dialog.open){
      returnFocus=opener||document.activeElement;returnPerson=id;
      scrollState={y:window.scrollY,style:document.body.getAttribute("style")};
      Object.assign(document.body.style,{position:"fixed",top:-scrollState.y+"px",left:"0",right:"0",width:"100%"});
      dialog.showModal();
    }
    selected=id;$("detailPerson").value=id;$("detailPeriod").value="30";$("detailMetric").value="return";
    refresh();dialog.scrollTop=0;$("detailClose").focus({preventScroll:true});
  }
  function quoteDate(p){
    const day=p.quote.date;
    if(!dayDate(day))return "종가 기준일 미확인";
    if(p.ticker!=="KRW-BTC")return "종가 기준일 "+day.replaceAll("-",".");
    const date=dayDate(day);date.setUTCDate(date.getUTCDate()+1);
    return "일봉 마감 "+date.toISOString().slice(0,10).replaceAll("-",".")+" 09:00 KST";
  }
  function targetText(t,person,kind){
    if(!t)return "";
    if(t.shared)return "같은 종목을 고른 사람과 함께 움직여요. 개인만의 "+kind+" 가격 목표는 계산하지 않습니다.";
    return `계산상 동률가 약 <b>${priceFmt(t.tiePrice,person.cur,true)}</b> · 현재가에서 <b>+${t.extraPct.toFixed(2)}%</b>. 이 계산가보다 높아야 ${kind}합니다. 동률 도달은 ${kind==="추월"?"공동 순위":"공동 경계(선정 규칙 확인 필요)"}입니다.`;
  }
  function chart(model){
    const points=series(model.person,config.getData().history,$("detailPeriod").value);
    const metric=$("detailMetric").value,element=$("detailChart");
    $("detailChartTitle").textContent=metric==="price"?"기록 수익률로 환산한 가격":"선택 종목 수익률 기록";
    $("detailChartRange").textContent=points.length?`${points[0].day} ~ ${points.at(-1).day} · 저장 기록 ${points.length}개`:"저장 기록 없음";
    if(points.length<2){element.innerHTML='<div class="detail-chart-empty">차트를 그릴 저장 기록이 부족해요.<br>기록 2개 이상부터 표시합니다.</div>';return;}
    const values=points.map(p=>metric==="price"?p.price:p.roi),low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.12,metric==="price"?high*.005:.3);
    const W=Math.max(280,element.clientWidth||700),H=element.clientHeight||240,L=metric==="price"?Math.max(54,Math.min(112,priceFmt(high,model.person.cur).length*7+12)):54,R=18,T=16,B=30;
    const min=low-pad,max=high+pad,start=+dayDate(points[0].day),end=+dayDate(points.at(-1).day);
    const x=p=>L+(+dayDate(p.day)-start)/Math.max(1,end-start)*(W-L-R);
    const y=v=>T+(max-v)/(max-min)*(H-T-B);
    const format=v=>metric==="price"?priceFmt(v,model.person.cur):v.toFixed(1)+"%";
    const out=[];
    for(let i=0;i<4;i++){const v=min+(max-min)*i/3,yy=y(v);out.push(`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e7ecf3"/><text x="${L-8}" y="${yy+4}" text-anchor="end" fill="#7b8ca1" font-size="11">${esc(format(v))}</text>`);}
    const line=points.map((p,i)=>(i?"L":"M")+x(p).toFixed(2)+" "+y(values[i]).toFixed(2)).join(" ");
    out.push(`<path d="${line}" fill="none" stroke="${model.person.color}" stroke-width="2.8" stroke-linejoin="round"/>`);
    for(const i of [...new Set([0,Math.floor(points.length/2),points.length-1])])out.push(`<text x="${x(points[i])}" y="${H-6}" text-anchor="middle" fill="#7b8ca1" font-size="11">${points[i].day.slice(5)}</text>`);
    for(let i=0;i<points.length;i++){const p=points[i];out.push(`<circle cx="${x(p)}" cy="${y(values[i])}" r="${i===points.length-1?4:2}" fill="${model.person.color}"><title>${p.day} 저장 · ${esc(format(values[i]))} · 수익률 ${pct(p.roi)}${p.sourceDay?" · 종가 기준일 "+p.sourceDay:" · 종가 기준일 미기록"}</title></circle>`);}
    element.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(model.person.asset)} 저장 기록 기준 ${metric==="price"?"환산 가격":"수익률"} 차트">${out.join("")}</svg>`;
  }
  function refresh(){
    if(!config||!$("participantDetail")?.open||!selected)return;
    const data=config.getData(),model=compute(data.participants,data.prices,data.history,selected);
    if(!model)return;
    const p=model.person;$("participantDetail").style.setProperty("--person",p.color);
    $("detailTitle").textContent=p.name+"의 "+p.asset;
    const rank=model.complete?(model.joint?"공동 ":"")+p.rank+"위":"확인 중";
    const safety={safe:"안전권",risk:"술값 후보",boundary:"공동 경계",pending:"확인 중"}[model.safety.status];
    const safetySub=model.safety.status==="boundary"?"동률 선정 규칙 확인 필요":model.safety.gap===null?"모든 종가 확인 후 계산":(model.safety.status==="safe"?"술값 경계와 ":"안전선까지 ")+gap(model.safety.gap);
    const cards=[["현재 순위",rank,model.joint?model.tiedNames.join("·")+"와 공동 순위":"참가자 "+data.participants.length+"명"],["누적 수익률",pct(p.roi),"시작가격 대비"],["바로 앞과 격차",model.ahead?gap(model.ahead.gap):model.complete?"선두":"미확인",model.ahead?names(model.ahead.group):"상위 수익률 그룹 기준"],["바로 뒤와 격차",model.behind?gap(model.behind.gap):model.complete?"마지막 순위":"미확인",model.behind?names(model.behind.group):"하위 수익률 그룹 기준"],["1위와 격차",gap(model.leaderGap),"현재 선두 수익률 기준"],["술값 상태",safety,safetySub]];
    $("detailSummary").innerHTML=`<div class="detail-quote"><span class="detail-avatar">${esc(p.name[0])}</span><div><p>${esc(p.asset)} · ${esc(p.ticker)}</p><strong>${priceFmt(p.price,p.cur)}</strong><small>${esc(quoteDate(p))} · 시작 ${priceFmt(p.start,p.cur)}</small></div></div><div class="detail-cards">${cards.map(([label,value,note])=>`<div class="detail-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join("")}</div>`;
    let duel=model.complete?(model.ahead?`<p><b>${esc(names(model.ahead.group))} 따라잡기</b><br>${targetText(model.aheadTarget,p,"추월")}</p>`:"<p><b>현재 선두예요 🏁</b><br>동일 수익률은 공동 순위로 표시합니다.</p>"):"<p>전체 종가가 확보되면 순위 격차와 목표를 계산합니다.</p>";
    if(model.safety.status==="risk"||model.safety.status==="boundary")duel+=`<p><b>${model.safety.status==="boundary"?"공동 경계 · 내기 규칙 확인":"술값권 탈출선"}</b><br>${targetText(model.safety.target,p,"안전선 통과")}</p>`;
    if(model.peers.length)duel+=`<p class="detail-peer">${esc(model.peers.map(p=>p.name).join("·"))}도 같은 종목이에요. 같은 시작가격이면 서로를 혼자 추월할 수 없습니다.</p>`;
    $("detailDuel").innerHTML=duel;
    const stats=model.stats,change=stats.change===null?"직전 순위 비교 기록 부족":stats.change===0?"직전 기록과 순위 동일":`직전 기록보다 ${Math.abs(stats.change)}순위 ${stats.change>0?"상승":"하락"}`;
    $("detailRecords").textContent=stats.best===null?"순위 통계를 낼 저장 기록이 부족해요.":`전체 저장 기록: 최고 ${stats.best}위 · 최저 ${stats.worst}위 · ${change}`;
    chart(model);
  }
  function init(options){
    if(config)return;config=options;
    $("detailPerson").innerHTML=config.getData().participants.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.asset)}</option>`).join("");
    $("rankRows").addEventListener("click",event=>{const row=event.target.closest("[data-person]");if(row)open(row.dataset.person,row);});
    $("detailClose").addEventListener("click",close);
    $("participantDetail").addEventListener("click",event=>{if(event.target===$("participantDetail"))close();});
    $("participantDetail").addEventListener("cancel",event=>{event.preventDefault();close();});
    $("participantDetail").addEventListener("keydown",event=>{
      if(event.key!=="Tab")return;
      const dialog=$("participantDetail"),focusable=[...dialog.querySelectorAll("button,select,[tabindex]")].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(!first)return;
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    });
    $("participantDetail").addEventListener("close",()=>{
      if(scrollState){if(scrollState.style===null)document.body.removeAttribute("style");else document.body.setAttribute("style",scrollState.style);window.scrollTo(0,scrollState.y);scrollState=null;}
      const focus=returnFocus?.isConnected?returnFocus:document.querySelector(`[data-person="${returnPerson}"]`);
      focus?.focus({preventScroll:true});selected=null;
    });
    $("detailPerson").addEventListener("change",()=>{selected=$("detailPerson").value;refresh();});
    for(const id of ["detailMetric","detailPeriod"])$(id).addEventListener("change",refresh);
  }
  const api={ranking,target,series,compute,init,open,close,refresh};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else globalThis.BattleDetails=api;
})();
