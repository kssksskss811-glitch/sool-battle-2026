/* 술값배틀 2026 - 밝은 한 화면 대시보드 + 실제 날짜별 순위 Bump Chart */
"use strict";
const PARTICIPANTS=[
{id:"eunji",name:"은지",asset:"엔비디아",ticker:"NVDA",start:184.86,cur:"USD",color:"#008c48"},
{id:"dongmin",name:"동민",asset:"엔비디아",ticker:"NVDA",start:184.86,cur:"USD",color:"#5c8f20"},
{id:"geumseung",name:"금승",asset:"HMM",ticker:"011200.KS",start:20050,cur:"KRW",color:"#00a982"},
{id:"bitna",name:"빛나",asset:"구글",ticker:"GOOGL",start:328.57,cur:"USD",color:"#057ce7"},
{id:"ojing",name:"오징",asset:"아마존",ticker:"AMZN",start:247.3,cur:"USD",color:"#d98300"},
{id:"seongsu",name:"성수",asset:"테슬라",ticker:"TSLA",start:445,cur:"USD",color:"#7432dd"},
{id:"jeonguk",name:"정욱",asset:"두산에너빌리티",ticker:"034020.KS",start:84800,cur:"KRW",color:"#e52869"},
{id:"yumin",name:"유민",asset:"비트코인",ticker:"KRW-BTC",start:133600000,cur:"KRW",color:"#f15d18"},
{id:"gwangil",name:"광일",asset:"HD현대일렉트릭",ticker:"267260.KS",start:849000,cur:"KRW",color:"#205fdc"}
];
const CHART_SERIES=[
{id:"eunji",label:"은지·동민",color:"#008c48"},
{id:"geumseung",label:"금승",color:"#00a982"},
{id:"bitna",label:"빛나",color:"#057ce7"},
{id:"ojing",label:"오징",color:"#d98300"},
{id:"seongsu",label:"성수",color:"#7432dd"},
{id:"jeonguk",label:"정욱",color:"#e52869"},
{id:"yumin",label:"유민",color:"#f15d18"},
{id:"gwangil",label:"광일",color:"#205fdc"}
];
const $=id=>document.getElementById(id);
const escapeHtml=str=>String(str).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
let priceData=null, history=[], chartRecords=[], ranked=[], hiddenGroups=new Set(), lastFetched=null;
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
  const maxAbs=Math.max(...ranked.map(x=>Math.abs(x.roi||0)),1);
  $("rankRows").innerHTML=ranked.map(p=>{
    const fill=Math.max(3,100*Math.abs(p.roi||0)/maxAbs);
    const perf=p.roi===null?"#99a4b4":p.roi>=0?"#ef4056":"#2867ec";
    return `<div class="rank-row" style="--person:${p.color};--perf:${perf}">
      ${rankBadge(p)}
      <div class="person"><span class="person-avatar">${p.name[0]}</span><div style="min-width:0">
        <div class="person-name">${p.name}${p.stale?'<span title="가격 지연 · 순위 잠정"> ⚠</span>':""}</div>
        <div class="asset" title="${escapeHtml(p.asset+" · "+p.ticker)}">${escapeHtml(p.asset)} · ${escapeHtml(p.ticker)}</div>
      </div></div>
      <div class="performance"><div class="track"><i style="width:${fill.toFixed(1)}%"></i></div><div class="return">${p.roi===null?"—":fmtPct(p.roi)}</div></div>
      <div class="price">${p.price===null?"미수집":fmtPrice(p.price,p.cur)}<small>기준 ${fmtPrice(p.start,p.cur)}</small></div>
    </div>`;
  }).join("");
}
function renderRisk() {
  if(ranked.some(p=>p.price===null)){
    $("dangerRows").innerHTML='<div class="loading">종목 종가가 모두 확보되면 표시됩니다.</div>';return;
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
  $("asOf").textContent=priceData?.updatedAt ? "갱신 "+kstFmt(priceData.updatedAt)+" KST" : "시세 조회 중";
  const label=$("dataStatus");
  const stale=ranked.some(p=>p.stale||p.price===null) || priceData?.mode!=="live";
  label.classList.toggle("partial",stale);
  label.innerHTML=stale?"<i></i> 일부 종가 지연 · 잠정":"<i></i> 확정 종가 자동 갱신";
  const cut=ranked.length>=4 && Math.abs((ranked[5]?.roi??1e99)-(ranked[6]?.roi??-1e99))<1e-9;
  const cautions=[];
  if(stale)cautions.push("⚠ 일부 종목 시세가 지연되어 현재 순위는 잠정입니다.");
  if(cut)cautions.push("⚠ 술값 커트라인에 동률이 있습니다. 실제 내기 규칙을 정해야 합니다.");
  $("rankFoot").textContent=cautions.join(" ")||"수익률 = (최근 확정 종가 ÷ 시작 단가 − 1) × 100 · 공동 순위 인정";
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
function selectHistory(){
  const period=$("period").value;
  const arr=cleanHistory(history);
  if(!arr.length)return [];
  const latest=arr[arr.length-1].day;
  const date=new Date(latest+"T12:00:00Z");
  if(period==="all")return arr;
  date.setUTCDate(date.getUTCDate()-(Number(period)-1));
  const cutoff=date.toISOString().slice(0,10);
  return arr.filter(x=>x.day>=cutoff);
}
function legendHtml(){
  $("legend").innerHTML=CHART_SERIES.map(s=>`
    <button class="${hiddenGroups.has(s.id)?"off":""}" type="button" data-series="${s.id}" title="${escapeHtml(s.label)} 선 보기/숨기기" style="--person:${s.color}">
      <i></i><span>${escapeHtml(s.label)}</span>
    </button>`).join("");
}
function buildChart(){
  chartRecords=selectHistory();
  legendHtml();
  const element=$("chart");
  const foot=$("chartRange"),notice=$("chartNotice");
  notice.hidden=true;
  if(chartRecords.length<2){
    element.innerHTML='<div class="chart-empty">과거 종가를 복원하고 있어요.<br>복원 작업이 완료되면 실제 날짜별 순위가 표시됩니다.<br>(가상 순위는 표시하지 않습니다.)</div>';
    foot.textContent="기록 복원 대기";
    if(history.length) {
      notice.hidden=false;notice.textContent="GitHub Actions에서 과거 데이터 복원이 성공했는지 확인해주세요.";
    }
    return;
  }
  foot.textContent=chartRecords[0].day.slice(5).replace("-","/")+" ~ "+
    chartRecords[chartRecords.length-1].day.slice(5).replace("-","/")+
    " · "+chartRecords.length+"일 기록";
  if(!history.some(x=>x.source==="backfill-2026-v1")){
    notice.hidden=false;
    notice.textContent="아직 2026년 1월부터 과거 데이터 복원이 완료되지 않았습니다.";
  }
  const W=610,H=390, left=34,right=12,top=16,bottom=34;
  const plotW=W-left-right,plotH=H-top-bottom;
  const x=i=>left+(chartRecords.length===1?0:i/(chartRecords.length-1)*plotW);
  const y=r=>top+(r-1)/8*plotH;
  let lines=[];
  for(let rank=1;rank<=9;rank++){
    const yy=y(rank);
    lines.push(`<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}" stroke="#e6edf6" stroke-width="1"/>`);
    lines.push(`<text x="${left-10}" y="${yy+3.7}" fill="#8595b0" text-anchor="end" font-size="11" font-weight="700">${rank}</text>`);
  }
  const tickCount=Math.min(7,chartRecords.length);
  const xticks=new Set([0,chartRecords.length-1]);
  for(let t=0;t<tickCount;t++)xticks.add(Math.round(t*(chartRecords.length-1)/(tickCount-1)));
  [...xticks].sort((a,b)=>a-b).forEach(i=>{
    const xx=x(i);
    lines.push(`<line x1="${xx}" x2="${xx}" y1="${top}" y2="${H-bottom}" stroke="#eef2f8"/>`);
    lines.push(`<text x="${xx}" y="${H-11}" text-anchor="middle" fill="#8a9bb4" font-size="10" font-weight="650">${chartRecords[i].day.slice(5).replace("-","/")}</text>`);
  });
  let plot=[];
  for(const s of CHART_SERIES) {
    if(hiddenGroups.has(s.id))continue;
    const coords=chartRecords.map((row,i)=>[x(i),y(row.ranks[s.id])]);
    const d=coords.map((point,i)=>(i?"L":"M")+point[0].toFixed(2)+" "+point[1].toFixed(2)).join(" ");
    plot.push(`<path d="${d}" stroke="${s.color}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".93"/>`);
    // 전체 기간은 밀도가 높아 매일 점을 그리면 화면이 답답해져 마지막 점만 표시
    const picked=coords.length<=35?coords: [coords[coords.length-1]];
    picked.forEach(([cx,cy],index)=>{
      plot.push(`<circle cx="${cx}" cy="${cy}" r="${coords.length>35?4:2.8}" fill="#fff" stroke="${s.color}" stroke-width="2"/>`);
    });
  }
  element.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-label="2026 순위변동 차트">
  ${lines.join("")}${plot.join("")}
  <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent" id="graphHit"/>
  </svg>`;
  const hit=$("graphHit"),tooltip=$("chartHover");
  hit.addEventListener("pointermove",event=>{
    const bounds=hit.getBoundingClientRect();
    const ratio=Math.min(1,Math.max(0,(event.clientX-bounds.left)/bounds.width));
    const idx=Math.round(ratio*(chartRecords.length-1));
    const day=chartRecords[idx];
    const s=CHART_SERIES.filter(s=>!hiddenGroups.has(s.id)).map(s=>`${s.label}: ${day.ranks[s.id]}위`);
    tooltip.textContent=day.day+"\n"+s.join("   ");
    tooltip.hidden=false;
    const wrap=$("chart").getBoundingClientRect();
    const xpos=event.clientX-wrap.left;
    tooltip.style.left=Math.max(0,Math.min(wrap.width-205,xpos+12))+"px";
    tooltip.style.top=Math.max(0,event.clientY-wrap.top-140)+"px";
  });
  hit.addEventListener("pointerleave",()=>tooltip.hidden=true);
}
function renderAll(){
  if(!priceData)return;
  ranked=computeRanking(priceData);
  renderHeader();renderRankRows();renderRisk();buildChart();
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
    priceData=price;
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
  $("period").addEventListener("change",buildChart);
  $("legend").addEventListener("click",e=>{
    const button=e.target.closest("[data-series]");
    if(!button)return;
    const id=button.dataset.series;
    if(hiddenGroups.has(id))hiddenGroups.delete(id);else hiddenGroups.add(id);
    buildChart();
  });
  $("share").addEventListener("click",share);
  loadData();
  setInterval(()=>{if(!document.hidden)loadData();},15*60*1000);
}
document.addEventListener("DOMContentLoaded",init);
