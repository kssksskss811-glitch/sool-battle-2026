/* 술값배틀 2026 - 주간 확정 순위 Bump Chart: 공동 순위 + 색상 강조 */
"use strict";
const PARTICIPANTS=[
{id:"eunji",name:"은지",asset:"엔비디아",ticker:"NVDA",start:184.86,cur:"USD",color:"#128541"},
{id:"dongmin",name:"동민",asset:"엔비디아",ticker:"NVDA",start:184.86,cur:"USD",color:"#687B1B"},
{id:"geumseung",name:"금승",asset:"HMM",ticker:"011200.KS",start:20050,cur:"KRW",color:"#008F92"},
{id:"bitna",name:"빛나",asset:"구글",ticker:"GOOGL",start:328.57,cur:"USD",color:"#2768EF"},
{id:"ojing",name:"오징",asset:"아마존",ticker:"AMZN",start:247.3,cur:"USD",color:"#A46C00"},
{id:"seongsu",name:"성수",asset:"테슬라",ticker:"TSLA",start:445,cur:"USD",color:"#7839D4"},
{id:"jeonguk",name:"정욱",asset:"두산에너빌리티",ticker:"034020.KS",start:84800,cur:"KRW",color:"#D52678"},
{id:"yumin",name:"유민",asset:"비트코인",ticker:"KRW-BTC",start:133600000,cur:"KRW",color:"#EA4B0B"},
{id:"gwangil",name:"광일",asset:"HD현대일렉트릭",ticker:"267260.KS",start:849000,cur:"KRW",color:"#334155"}
];
const CHART_SERIES=[
{id:"eunji",label:"은지·동민",color:"#128541"},
{id:"geumseung",label:"금승",color:"#008F92"},
{id:"bitna",label:"빛나",color:"#2768EF"},
{id:"ojing",label:"오징",color:"#C28B00"},
{id:"seongsu",label:"성수",color:"#7839D4"},
{id:"jeonguk",label:"정욱",color:"#D52678"},
{id:"yumin",label:"유민",color:"#EA4B0B"},
{id:"gwangil",label:"광일",color:"#334155"}
];
const $=id=>document.getElementById(id);
const escapeHtml=str=>String(str).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
let priceData=null, history=[], chartRecords=[], ranked=[], focusedSeries=null, lastFetched=null;
const fmtKRW=v=>"₩"+new Intl.NumberFormat("ko-KR",{maximumFractionDigits:0}).format(v);
const fmtUSD=v=>"$"+new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const fmtPrice=(value,currency)=>currency==="USD"?fmtUSD(value):fmtKRW(value);
const fmtPct=value=>(value>=0?"+":"−")+Math.abs(value).toFixed(2)+"%";
const kstFmt=iso=>{
  if(!iso)return "—";
  const date=new Date(iso);
  if(Number.isNaN(+date))return "—";
  return new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",hour12:false}).format(date);
};
function sourceDayDate(day){
  if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const parsed=new Date(day+"T00:00:00Z");
  return Number.isNaN(+parsed)||parsed.toISOString().slice(0,10)!==day?null:parsed;
}
function marketDateLabel(markets,symbols){
  const dates=symbols.map(symbol=>sourceDayDate(markets?.[symbol]?.date)?markets[symbol].date:null);
  if(dates.every(day=>day&&day===dates[0]))return dates[0].replaceAll("-",".");
  if(dates.every(day=>!day))return "미확인";
  return symbols.map((symbol,i)=>symbol.replace(".KS","")+" "+(dates[i]?dates[i].slice(5).replace("-","/"):"미확인")).join(" · ");
}
function bitcoinCloseLabel(day){
  const parsed=sourceDayDate(day);
  if(!parsed)return "미확인";
  parsed.setUTCDate(parsed.getUTCDate()+1);
  return parsed.toISOString().slice(0,10).replaceAll("-",".")+" 09:00 KST";
}
function dataUpdateLabel(iso){
  if(typeof iso!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(iso))return "갱신 시각 미확인";
  const date=new Date(iso);
  if(Number.isNaN(+date))return "갱신 시각 미확인";
  const parts={};
  for(const part of new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date))parts[part.type]=part.value;
  return `데이터 갱신 ${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
}
function quoteTimeLabel(iso){
  if(typeof iso!=="string"||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(iso)||Number.isNaN(+new Date(iso)))return "실제 시각 미확인";
  const parts={};
  for(const part of new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso)))parts[part.type]=part.value;
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
}
function quoteBasisLabel(quote,symbol){
  if(!quote)return "가격 기준 미확인";
  if(quote.priceType==="user_override"){
    const custom=quote.userOverride;
    return "사용자 지정 현재가 · 실제 체결시각·세션 미확인 · 사용자 지정 시각 미기록 · 지정값 기록 "+quoteTimeLabel(custom.recordedAt)+" (체결시각 아님) · 보존 종가 "+custom.referenceClose.date+" "+fmtPrice(custom.referenceClose.price,quote.currency)+" · 이후 거래일의 정규장 종가 반영 시 자동 해제";
  }
  const source=quote.source?" · 출처 "+quote.source:" · 출처 미확인";
  if(!quote.asOf){
    const basis=symbol==="KRW-BTC"?"완료 일봉 · 일봉 마감 "+bitcoinCloseLabel(quote.date):"확정 종가 · "+(sourceDayDate(quote.date)?quote.date.replaceAll("-","."):"기준일 미확인")+" · 실제 시각 미기록";
    return basis+(quote.stale?" · 이전 값 / 확인 필요":"")+source;
  }
  const sessions={day:"데이장",pre:"프리장",regular:"정규장",after:"시간외",continuous:"연속거래",daily:"일봉"};
  const types={last_trade:(sessions[quote.session]||"세션 미확인")+" 거래가격",previous_close:"직전 정규장 종가",spot:"BTC 현물",daily_close:"완료 일봉"};
  const delay=quote.delay?.status==="realtime"?"실시간 (출처 표시)":quote.delay?.status==="delayed"?`지연 ${quote.delay.minutes}분 (출처 표시)`:"지연 여부 미확인";
  return (types[quote.priceType]||"가격 유형 미확인")+" · "+quoteTimeLabel(quote.asOf)+" · "+delay+source;
}
function marketQuoteLabel(markets,symbols){
  const labels=symbols.map(symbol=>quoteBasisLabel(markets?.[symbol],symbol));
  return labels.every(label=>label===labels[0])?labels[0]:symbols.map((symbol,i)=>symbol.replace(".KS","")+" "+labels[i]).join(" / ");
}
function quoteRowLabel(quote,symbol){
  if(quote?.priceType==="user_override")return "사용자 지정 현재가 · 체결시각 미확인";
  const full=quoteBasisLabel(quote,symbol);
  if(!quote?.asOf)return full.split(" · 출처")[0];
  const parts=full.split(" · ");
  const shortTime=parts[1].replace(/^\d{4}\./,"");
  return parts[0]+" · "+shortTime+(quote.delay?.status==="realtime"?"":" · "+parts[2]);
}
function computeRanking(data) {
  return PARTICIPANTS.map((p,i)=>{
    const quote=data.markets?.[p.ticker];
    const price=Number.isFinite(quote?.price)&&quote.price>0?quote.price:null;
    return {...p,i,price,roi:price===null?null:(price/p.start-1)*100,stale:!!quote?.stale,sourceDay:quote?.date||"—"};
  }).sort((a,b)=>{
    if(a.roi===null)return b.roi===null?a.i-b.i:1;
    if(b.roi===null)return -1;
    return b.roi-a.roi||a.i-b.i;
  }).map((p,position,items)=>({
    ...p,position:position+1,
    rank:items.findIndex(q=>p.roi!==null&&q.roi!==null&&Math.abs(q.roi-p.roi)<1e-9)+1
  }));
}
function rankBadge(p) {
  return p.rank!==p.position || ranked.some(x=>x!==p && x.rank===p.rank)
    ?'<span class="rank-number tied">공동 '+p.rank+'위</span>'
    :'<span class="rank-number">'+p.rank+'위</span>';
}
function renderRankRows() {
  $("rankRows").innerHTML=ranked.map(p=>{
    const fill=Math.min(100,Math.abs(p.roi||0));
    const perf=p.roi===null?"#99a4b4":p.roi>=0?"#ef4056":"#2867ec";
    return `<button type="button" class="rank-row" data-person="${p.id}" aria-haspopup="dialog" aria-label="${escapeHtml(p.name)} ${escapeHtml(p.asset)} 상세 보기" style="--person:${p.color};--perf:${perf}">
      ${rankBadge(p)}
      <div class="person"><span class="person-avatar">${p.name[0]}</span><div style="min-width:0">
        <div class="person-name">${p.name}${p.stale?'<span title="가격 지연 · 순위 잠정"> ⚠</span>':""}</div>
        <div class="asset" title="${escapeHtml(p.asset+" · "+p.ticker)}">${escapeHtml(p.asset)} · ${escapeHtml(p.ticker)}</div>
      </div></div>
      <div class="performance"><div class="track"><i style="width:${fill.toFixed(1)}%"></i></div><div class="return">${p.roi===null?"—":fmtPct(p.roi)}</div></div>
      <div class="price">${p.price===null?"미수집":fmtPrice(p.price,p.cur)}<small>기준 ${fmtPrice(p.start,p.cur)}</small><small class="quote-basis" title="${escapeHtml(quoteBasisLabel(priceData?.markets?.[p.ticker],p.ticker))}">${escapeHtml(quoteRowLabel(priceData?.markets?.[p.ticker],p.ticker))}</small></div>
    </button>`;
  }).join("");
}
function renderRisk() {
  if(ranked.some(p=>p.price===null)){
    $("dangerRows").innerHTML='<div class="loading">종목 가격이 모두 확보되면 표시됩니다.</div>';return;
  }
  const losers=ranked.slice(-3).reverse();
  $("dangerRows").innerHTML=losers.map(p=>
    `<div class="danger-row" style="--person:${p.color}">
    <span class="danger-rank">${p.rank}위</span>
    <div style="min-width:0"><div class="danger-person">${p.name}</div><div class="danger-asset">${escapeHtml(p.asset)} · ${escapeHtml(p.ticker)}</div></div>
    <div class="danger-pct">${fmtPct(p.roi)}</div>
    </div>`).join("");
}
function renderHeader(){
  $("asOf").textContent=dataUpdateLabel(priceData?.updatedAt);
  $("krCloseDay").textContent=marketQuoteLabel(priceData?.markets,["034020.KS","267260.KS","011200.KS"]);
  $("usCloseDay").textContent=marketQuoteLabel(priceData?.markets,["NVDA","TSLA","AMZN","GOOGL"]);
  $("btcCandleClose").textContent=quoteBasisLabel(priceData?.markets?.["KRW-BTC"],"KRW-BTC");
  $("verifiedAt").textContent=priceData?.manualInput?.verifiedAt?"입력 확인 "+quoteTimeLabel(priceData.manualInput.verifiedAt):"입력 확인 시각 미기록";
  const label=$("dataStatus");
  const custom=Object.values(priceData?.markets||{}).some(q=>q.priceType==="user_override");
  const stale=ranked.some(p=>p.stale||p.price===null||!sourceDayDate(p.sourceDay)) || Object.values(priceData?.markets||{}).some(q=>q.asOf&&(!["realtime"].includes(q.delay?.status)||quoteTimeLabel(q.asOf)==="실제 시각 미확인")) || !["live","manual"].includes(priceData?.mode);
  label.classList.toggle("partial",stale);
  label.innerHTML=custom?"<i></i> 사용자 지정 현재가 포함 · 잠정 순위":stale?"<i></i> 지연 / 확인 필요":"<i></i> 확인된 가격 기준";
  const cut=ranked.length>=4 && Math.abs((ranked[5]?.roi??1e99)-(ranked[6]?.roi??-1e99))<1e-9;
  const cautions=[];
  if(custom)cautions.push("GOOGL은 사용자 지정 현재가 $291.70으로 평가합니다. 검증된 실시간 체결값이나 종가가 아니며, 저장된 종가·히스토리는 유지됩니다.");
  if(stale)cautions.push("⚠ 시세 지연 또는 지연 여부 미확인으로 순위는 잠정입니다.");
  if(Object.values(priceData?.markets||{}).some(q=>q.asOf))cautions.push("가격 유형·세션·기준시각이 다를 수 있습니다. 세션 중 순위는 잠정입니다.");
  if(cut)cautions.push("⚠ 술값 커트라인에 동률이 있습니다. 실제 내기 규칙을 정해야 합니다.");
  $("rankFoot").textContent="수익률 = ("+(custom?"평가 가격":"확인된 가격")+" ÷ 시작 단가 − 1) × 100 · 공동 순위 인정"+(cautions.length?" · "+cautions.join(" "):"");
}
function toast(message){
  const el=$("toast");
  el.textContent=message;el.hidden=false;
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.hidden=true,3000);
}
async function share() {
  const url=location.href.split("#")[0];
  try{
    if(navigator.share){await navigator.share({title:"술값배틀 2026",text:"오늘 술값 낼 3명은 누구? 🍻",url});return;}
    await navigator.clipboard.writeText(url);
    toast("사이트 주소를 복사했어요! 단톡방에 붙여넣으세요.");
  }catch(err){
    if(err?.name==="AbortError")return;
    toast("주소창의 링크를 복사해서 공유해주세요.");
  }
}

function cleanHistory(values){
  const rows=Array.isArray(values)?values:[];
  return rows.filter(r=>{
    if(!r||r.demo||!r.day||r.day<"2026-01-01"||r.day>"2026-12-31")return false;
    return r.ranks&&typeof r.ranks==="object"&&
      CHART_SERIES.every(s=>Number.isInteger(r.ranks[s.id])&&r.ranks[s.id]>=1&&r.ranks[s.id]<=9);
  }).sort((a,b)=>a.day.localeCompare(b.day));
}
// 월~일을 한 주로 묶고, 한국시간 토요일 기록을 대표값으로 사용합니다.
// 토요일 기록은 그 시각에 확인한 가격 기준. v2에는 종가와 세션 가격이 섞일 수 있습니다.
// 미완료 주는 마지막으로 확보된 일별 기록을 사용합니다.
function saturdayOfWeek(iso){
  const day=new Date(iso+"T12:00:00Z");
  const weekday=day.getUTCDay(); // 0=일요일, 1=월요일 ... 6=토요일
  day.setUTCDate(day.getUTCDate()+(weekday===0?-1:6-weekday));
  return day.toISOString().slice(0,10);
}
function weeklyHistory(){
  const daily=cleanHistory(history);
  if(!daily.length)return [];
  const grouped=new Map();
  for(const row of daily){
    const key=saturdayOfWeek(row.day);
    const entry=grouped.get(key)||{sat:key,record:null,sundayOnly:null};
    // 일요일은 토요일까지의 시세와 혼합하지 않습니다.
    if(row.day<=key){
      if(!entry.record||row.day>entry.record.day)entry.record=row;
    }else if(!entry.sundayOnly||row.day>entry.sundayOnly.day){
      entry.sundayOnly=row;
    }
    grouped.set(key,entry);
  }
  return [...grouped.values()]
    .sort((a,b)=>a.sat.localeCompare(b.sat))
    .map(e=>({...e.record||e.sundayOnly,weekEnd:e.sat,complete:(e.record?.day===e.sat)}))
    .filter(e=>e.day);
}
function selectHistory(){
  const all=weeklyHistory();
  const period=$("period").value;
  return period==="all"?all:all.slice(-Math.max(1,Number(period)||12));
}
function legendHtml(){
  $("legend").innerHTML=CHART_SERIES.map(s=>{
    const isFocus=focusedSeries===s.id;
    const dim=focusedSeries!==null&&!isFocus;
    return `<button class="${isFocus?"selected":dim?"dimmed":""}" type="button" data-series="${s.id}" aria-pressed="${isFocus}" title="${escapeHtml(s.label)} 순위선 강조 / 다시 누르면 전체 보기" style="--person:${s.color}">
      <i></i><span>${escapeHtml(s.label)}</span></button>`;
  }).join("");
  const hint=$("legendHint");
  if(hint)hint.textContent=focusedSeries?"선택한 참가자만 강조 · 다시 누르면 전체 표시":"이름을 누르면 해당 참가자 선 강조";
}
function buildChart(){
  chartRecords=selectHistory();
  legendHtml();
  const element=$("chart"),foot=$("chartRange"),notice=$("chartNotice");
  const tip=$("chartHover"); if(tip)tip.hidden=true;
  notice.hidden=true;
  if(chartRecords.length<2){
    element.innerHTML='<div class="chart-empty">주간 순위 기록이 아직 부족합니다.<br>실제 가격 기록이 2주 이상 쌓이면 표시됩니다.</div>';
    foot.textContent=chartRecords.length?"1주 기록 · 다음 주부터 선 표시":"과거 순위 기록 대기";
    if(history.length && !cleanHistory(history).length){
      notice.hidden=false;notice.textContent="유효한 실제 순위 기록이 없습니다. GitHub Actions 과거 복원 결과를 확인해주세요.";
    }
    return;
  }
  const asShort=iso=>iso.slice(5).replace("-","/");
  foot.textContent=`${asShort(chartRecords[0].day)} ~ ${asShort(chartRecords.at(-1).day)} · ${chartRecords.length}주`;
  const incomplete=chartRecords.filter((r,i)=>!r.complete && i<chartRecords.length-1);
  if(incomplete.length){
    notice.hidden=false;
    notice.textContent=`※ ${incomplete.length}개 주에는 토요일 순위 기록이 없어 그 주 마지막 확보 기록을 사용했습니다.`;
  }else if(!history.some(x=>x.source==="backfill-2026-v1")){
    notice.hidden=false;
    notice.textContent="과거 종가 복원 여부를 확인해주세요. 실제 기록만 표시합니다.";
  }
  // 똑같은 종목+기준가를 고른 두 참가자는 반드시 같은 등수여야 합니다.
  const tieMismatch=chartRecords.some(r=>r.ranks.eunji!==r.ranks.dongmin);
  if(tieMismatch){
    notice.hidden=false;
    notice.textContent+=" ※ 공동 1위 참가자의 과거 순위가 불일치하는 날짜가 있어 기록 확인이 필요합니다.";
  }

  const W=700,H=390,L=39,R=15,T=17,B=37;
  const plotW=W-L-R,plotH=H-T-B;
  const x=i=>L+(chartRecords.length<=1?0:i/(chartRecords.length-1)*plotW);
  const y=r=>T+(r-1)/8*plotH;
  const out=[];
  // 그리드(순위 1위는 위쪽)
  out.push(`<rect x="${L}" y="${T}" width="${plotW}" height="${plotH}" fill="#fff"/>`);
  for(let rank=1;rank<=9;rank++){
    const yy=y(rank);
    out.push(`<line x1="${L}" x2="${W-R}" y1="${yy.toFixed(2)}" y2="${yy.toFixed(2)}" stroke="${rank===1?"#d7ece0":"#e7ecf3"}" stroke-width="1"/>`);
    out.push(`<text x="${L-11}" y="${(yy+4).toFixed(2)}" fill="${rank===1?"#16834c":"#6b788e"}" text-anchor="end" font-size="12" font-weight="800">${rank}</text>`);
  }
  // 날짜 라벨은 범위에 따라 6~7개, 순위 데이터 자체는 매주 모두 사용합니다.
  const ticks=new Set([0,chartRecords.length-1]);
  const tickCount=Math.min(7,chartRecords.length);
  for(let i=0;i<tickCount;i++)ticks.add(Math.round(i*(chartRecords.length-1)/Math.max(1,tickCount-1)));
  for(const idx of [...ticks].sort((a,b)=>a-b)){
    const xx=x(idx);
    out.push(`<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H-B}" stroke="#f1f4f9"/>`);
    out.push(`<text x="${xx}" y="${H-12}" text-anchor="middle" fill="#66758f" font-size="11" font-weight="750">${asShort(chartRecords[idx].day)}</text>`);
  }

  // 범례를 선택하면 다른 선은 흐려지고, 선택한 선이 가장 앞으로 나옵니다.
  const sorted=CHART_SERIES.slice().sort((a,b)=>Number(a.id===focusedSeries)-Number(b.id===focusedSeries));
  for(const s of sorted){
    const focused=focusedSeries===s.id, faded=focusedSeries&& !focused;
    const coords=chartRecords.map((r,i)=>[x(i),y(r.ranks[s.id])]);
    // 계단형: 다음 주 순위가 확정되기 전까지 직전 등수를 유지.
    let path=`M ${coords[0][0].toFixed(2)} ${coords[0][1].toFixed(2)}`;
    for(let i=1;i<coords.length;i++){
      const [xx,yy]=coords[i];
      path+=` H ${xx.toFixed(2)} V ${yy.toFixed(2)}`;
    }
    const opacity=faded?".09":"1";
    const strokeWidth=focused?4.1:2.6;
    // 가시성 높은 화이트 테두리로 겹친 순위선을 분리합니다.
    if(!faded)out.push(`<path d="${path}" fill="none" stroke="#ffffff" stroke-width="${strokeWidth+2.7}" stroke-linejoin="round" opacity=".96"/>`);
    out.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${strokeWidth}" stroke-linejoin="round" opacity="${opacity}"/>`);
    coords.forEach(([xx,yy],i)=>{
      if(chartRecords.length>17 && i!==coords.length-1 && i%Math.ceil(chartRecords.length/16)!==0)return;
      const r=focused?4.1:chartRecords.length>17?2.5:3;
      out.push(`<circle cx="${xx.toFixed(2)}" cy="${yy.toFixed(2)}" r="${r}" stroke="${s.color}" stroke-width="${focused?2.4:1.8}" fill="#fff" opacity="${opacity}"/>`);
    });
  }
  out.push(`<rect id="graphHit" x="${L}" y="${T}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair"/>`);
  element.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-label="주차별 참가자 순위 계단형 변동 그래프">${out.join("")}</svg>`;
  const hit=$("graphHit");
  hit.addEventListener("pointermove",ev=>{
    const rect=hit.getBoundingClientRect();
    const ratio=Math.min(1,Math.max(0,(ev.clientX-rect.left)/Math.max(1,rect.width)));
    const idx=Math.round(ratio*(chartRecords.length-1));
    const rec=chartRecords[idx];
    const active=CHART_SERIES.filter(s=>!focusedSeries||s.id===focusedSeries);
    tip.innerHTML=`<b>${asShort(rec.day)} 기준${rec.complete?"":" · 주중/대체 기록"}${rec.quotes?" · 시세 스냅샷":" · 종가 기록"}</b><div>${active.map(s=>`<span style="color:${s.color}">●</span> ${escapeHtml(s.label)} ${rec.ranks[s.id]}위`).join("<br>")}</div>`;
    tip.hidden=false;
    const wrap=element.getBoundingClientRect();
    tip.style.left=Math.min(Math.max(5,ev.clientX-wrap.left+10),Math.max(5,wrap.width-195))+"px";
    tip.style.top=Math.min(Math.max(5,ev.clientY-wrap.top-90),Math.max(5,wrap.height-115))+"px";
  });
  hit.addEventListener("pointerleave",()=>tip.hidden=true);
}
function renderAll(){
  if(!priceData)return;
  ranked=computeRanking(priceData);
  renderHeader();renderRankRows();renderRisk();buildChart();
  globalThis.BattleDetails?.refresh();
}
async function loadData(){
  try{
    const nocache="?v="+Date.now();
    const [quoteRes,histRes]=await Promise.all([
      fetch("./data/prices.json"+nocache,{cache:"no-store"}),
      fetch("./data/history.json"+nocache,{cache:"no-store"})
    ]);
    if(!quoteRes.ok)throw Error("prices.json HTTP "+quoteRes.status);
    const price=await quoteRes.json();
    if(!price?.markets)throw Error("가격 JSON 형식 오류");
    priceData=globalThis.UserPriceOverride?globalThis.UserPriceOverride.apply(price):price;
    if(histRes.ok){
      const hist=await histRes.json();
      if(Array.isArray(hist.history))history=hist.history;
    }
    lastFetched=new Date();
    renderAll();
  }catch(err){
    console.error("[술값배틀] 종가 데이터를 가져오지 못했습니다:",err);
    if(!priceData){
      $("rankRows").innerHTML='<div class="loading">가격 데이터를 불러오지 못했습니다. 잠시 후 새로고침해주세요.</div>';
      $("dangerRows").innerHTML='<div class="loading">가격 로딩 오류</div>';
      $("dataStatus").innerHTML="<i></i> 데이터 확인 필요";
      $("dataStatus").classList.add("partial");
      $("chart").innerHTML='<div class="chart-empty">종가 데이터 로드 오류<br>실제 수익률이 표시되지 않습니다.</div>';
    }
  }
}
function init(){
  globalThis.BattleDetails?.init({getData:()=>({participants:PARTICIPANTS,prices:priceData,history}),quoteLabel:quoteBasisLabel});
  $("period").addEventListener("change",buildChart);
  $("legend").addEventListener("click",e=>{
    const button=e.target.closest("[data-series]");
    if(!button)return;
    focusedSeries=focusedSeries===button.dataset.series?null:button.dataset.series;
    buildChart();
  });
  $("share").addEventListener("click",share);
  loadData();
  setInterval(()=>{if(!document.hidden)loadData();},15*60*1000);
}
document.addEventListener("DOMContentLoaded",init);
