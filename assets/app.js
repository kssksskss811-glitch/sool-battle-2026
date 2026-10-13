/* 술값배틀 2026 — vanilla JavaScript, no external runtime required. */
"use strict";

const PEOPLE = [
  { id:"eunji", name:"은지", asset:"엔비디아", ticker:"NVDA", start:184.86, currency:"USD", color:"#39452c", ink:"#dfff67" },
  { id:"dongmin", name:"동민", asset:"엔비디아", ticker:"NVDA", start:184.86, currency:"USD", color:"#39452c", ink:"#dfff67" },
  { id:"seongsu", name:"성수", asset:"테슬라", ticker:"TSLA", start:445, currency:"USD", color:"#3f304a", ink:"#dbbaff" },
  { id:"ojing", name:"오징", asset:"아마존", ticker:"AMZN", start:247.3, currency:"USD", color:"#4b3a26", ink:"#ffda94" },
  { id:"bitna", name:"빛나", asset:"구글", ticker:"GOOGL", start:328.57, currency:"USD", color:"#234148", ink:"#a3ebff" },
  { id:"yumin", name:"유민", asset:"비트코인", ticker:"KRW-BTC", start:133600000, currency:"KRW", color:"#53402b", ink:"#ffcb78" },
  { id:"jeonguk", name:"정욱", asset:"두산에너빌리티", ticker:"034020.KS", start:84800, currency:"KRW", color:"#40323c", ink:"#ffb3ca" },
  { id:"gwangil", name:"광일", asset:"HD현대일렉트릭", ticker:"267260.KS", start:849000, currency:"KRW", color:"#2b3d53", ink:"#a9caff" },
  { id:"geumseung", name:"금승", asset:"HMM", ticker:"011200.KS", start:20050, currency:"KRW", color:"#344438", ink:"#a6efbc" }
];
const SYMBOLS = ["NVDA","TSLA","AMZN","GOOGL","KRW-BTC","034020.KS","267260.KS","011200.KS"];
const DEMO_PRICES = {
  "NVDA":190.75, "TSLA":412.2, "AMZN":256.4, "GOOGL":338.3,
  "KRW-BTC":125700000, "034020.KS":79500, "267260.KS":781000, "011200.KS":21300
};
const FINAL_ISO = "2026-12-31T23:59:59+09:00";
const $ = (id)=>document.getElementById(id);
let snapshot = demoSnapshot();
let history = [];
let ranked = [];
let chosenFilter = "all";
let chosenSort = "rank";
let activePerson = "gwangil";
let toastTimeout;

function kstDay(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function demoSnapshot() {
  const markets = {};
  SYMBOLS.forEach((symbol) => {
    markets[symbol] = {price:DEMO_PRICES[symbol],date:"2026-10-12",source:"DEMO",stale:false};
  });
  return {mode:"demo",updatedAt:new Date().toISOString(),locked:false,markets,errors:[]};
}
function dateShort(dateString) {
  if (!dateString || dateString === "—") return "—";
  return dateString.slice(5).replace("-","/");
}
function fmtNumber(n) {
  return Number.isFinite(n) ? new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}).format(n) : "—";
}
function fmtPrice(n,currency) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "미수집";
  if (currency==="USD") return "$"+new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  return "₩"+new Intl.NumberFormat("ko-KR",{maximumFractionDigits:0}).format(n);
}
function pct(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const val=Math.abs(n)<0.004 ? 0 : n;
  return (val>0?"+":val<0?"−":"")+Math.abs(val).toFixed(2)+"%";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function calculateRanking() {
  const rows=PEOPLE.map((person,index) => {
    const market=snapshot.markets?.[person.ticker];
    const close=(market && typeof market.price==="number" && Number.isFinite(market.price) && market.price>0) ? market.price : null;
    const roi=close===null?null:(close/person.start-1)*100;
    return {...person,index,price:close,roi,marketDate:market?.date ?? "—",stale:!!market?.stale};
  }).sort((a,b) => {
    if(a.roi===null&&b.roi===null) return a.index-b.index;
    if(a.roi===null)return 1;
    if(b.roi===null)return -1;
    return b.roi-a.roi||a.index-b.index;
  });
  rows.forEach((p,i)=>{
    const prev=rows.findIndex((o)=>o.roi!==null && p.roi!==null && Math.abs(o.roi-p.roi)<1e-9);
    p.position=i+1;
    p.rank=prev<0 ? i+1 : prev+1; // 공동 순위
    p.risk=i>=rows.length-3;
  });
  return rows;
}
function rankChanges(rows) {
  const today=kstDay(snapshot.updatedAt);
  let past=history.filter(h=>h.day<today && h.ranks && typeof h.ranks==="object");
  if (!past.length && history.length>=2) past=history.slice(0,-1);
  const prev=past.length?past[past.length-1]:null;
  const deltas={};
  rows.forEach(p=>{deltas[p.id]=prev?.ranks?.[p.id] ? prev.ranks[p.id]-p.position : null;});
  return deltas;
}
function getLosers(rows=ranked){ return rows.filter(p=>p.price!==null).slice(-3); }
function hasBoundaryTie(rows) {
  if (rows.length<4 || rows.some(p=>p.roi===null)) return false;
  return Math.abs(rows[rows.length-4].roi-rows[rows.length-3].roi)<1e-9;
}
function isComplete() {return ranked.length===9 && ranked.every(p=>p.price!==null);}
function showStatus(){
  const status=$("dataStatus");
  status.classList.remove("is-demo","is-partial");
  const date=kstDay(snapshot.updatedAt);
  if(snapshot.mode==="demo") {
    status.classList.add("is-demo");
    status.innerHTML='<span class="pulse"></span> DEMO · 가상 시세';
    $("demoNotice").hidden=false;
  } else if(snapshot.locked && isComplete()) {
    status.innerHTML='<span class="pulse"></span> FINAL · 결과 확정';
    $("demoNotice").hidden=true;
  } else if(snapshot.mode==="live" && isComplete()){
    status.innerHTML='<span class="pulse"></span> AUTO · '+escapeHtml(date)+' 기준';
    $("demoNotice").hidden=true;
  }else{
    status.classList.add("is-partial");
    status.innerHTML='<span class="pulse"></span> 일부 시세 수집 지연';
    $("demoNotice").hidden=true;
  }
  const warnings=[];
  if(hasBoundaryTie(ranked)) warnings.push("술값 결제 커트라인에 수익률 동률이 발생했습니다. 동률 처리 규칙을 먼저 정하세요.");
  const stale=ranked.filter(p=>p.stale);
  if(stale.length)warnings.push("일부 종목은 최신 종가 조회에 실패해 이전 값을 표시합니다: "+[...new Set(stale.map(p=>p.asset))].join(", "));
  if(!isComplete() && snapshot.mode!=="demo")warnings.push("모든 종목의 종가가 확보되지 않아 현재 순위는 잠정입니다.");
  $("warningNotice").hidden=!warnings.length;
  $("warningText").textContent=warnings.join(" ");
}
function updateCountdown() {
  const now=Date.now(), target=new Date(FINAL_ISO).getTime();
  const today=kstDay();
  const pieces=today.split("-").map(Number);
  const todayMidnight=Date.UTC(pieces[0],pieces[1]-1,pieces[2]);
  const targetCalendar=Date.UTC(2026,11,31);
  const remain=Math.max(0,Math.round((targetCalendar-todayMidnight)/86400000));
  const closed=(now>=new Date("2027-01-01T09:20:00+09:00").getTime());
  const text=closed?"D-DONE":remain===0?"D-DAY":`D-${remain}`;
  $("sideDays").textContent=text;
  $("statDays").textContent=text;
  const start=new Date("2026-10-01T00:00:00+09:00").getTime();
  const progress=Math.max(3,Math.min(100,(now-start)/(target-start)*100));
  $("dayProgress").style.width=progress.toFixed(1)+"%";
}
function renderStats() {
  const valid=ranked.filter(p=>p.roi!==null);
  const top=valid[0],bottom=valid[valid.length-1];
  $("statLeader").textContent=top?.name??"—";
  $("statLeaderRoi").textContent=top?pct(top.roi):"—";
  $("statBottom").textContent=bottom?.name??"—";
  $("statBottomRoi").textContent=bottom?pct(bottom.roi):"—";
  $("statGap").textContent=valid.length>=2?(top.roi-bottom.roi).toFixed(2)+"%p":"—";
}
function renderRankList() {
  const list=$("rankList"), delta=rankChanges(ranked);
  const maxAbs=Math.max(1,...ranked.map(p=>Math.abs(p.roi||0)));
  let display=[...ranked];
  if(chosenFilter==="risk")display=display.filter(p=>p.risk);
  if(chosenFilter==="plus")display=display.filter(p=>p.roi!==null && p.roi>0);
  if(chosenSort==="name")display.sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  if(chosenSort==="asset")display.sort((a,b)=>a.asset.localeCompare(b.asset,"ko")||a.name.localeCompare(b.name,"ko"));
  if(!display.length) {list.innerHTML='<div class="loading">해당 조건의 참가자가 없습니다.</div>';return;}
  list.innerHTML=display.map(p=>{
    const d=delta[p.id],deltaTag=d===null||d===undefined?"":d>0?`<span class="rank-change up">▲${d}</span>`:d<0?`<span class="rank-change down">▼${Math.abs(d)}</span>`:'<span class="rank-change flat">−</span>';
    const percent=pct(p.roi);
    const width=Math.abs(p.roi||0)>0?Math.max(3,Math.abs(p.roi)/maxAbs*100):0;
    return `<div class="rank-item ${p.risk?"is-risk":""}" role="button" tabindex="0" data-person="${p.id}" aria-label="${p.name} 상세 보기">
      <div class="player-info">
        <span class="rank-no ${p.position===1?"is-first":p.risk?"is-last":""}">${p.position===1?"♛":p.rank}</span>
        <span class="avatar" style="background:${p.color};color:${p.ink}">${escapeHtml(p.name.slice(0,1))}</span>
        <div class="player-text"><strong>${escapeHtml(p.name)} ${deltaTag}</strong><small>${escapeHtml(p.asset)} · ${p.ticker}</small></div>
      </div>
      <div class="return-info">
        <div class="return-line"><b class="return-number ${p.roi===null?"zero":p.roi>0?"positive":p.roi<0?"negative":"zero"}">${percent}</b><span class="return-sub">${p.risk?"위험 구간":"누적 수익률"}</span></div>
        <div class="bar-wrap"><span class="bar-fill ${p.roi!==null && p.roi<0?"negative":""}" style="width:${width.toFixed(1)}%"></span></div>
      </div>
      <div class="price-info"><b>${fmtPrice(p.price,p.currency)}</b><small>기준 ${fmtPrice(p.start,p.currency)}</small></div>
    </div>`;
  }).join("");
  $("rankFooter").textContent="* 같은 종목(엔비디아)을 고른 은지·동민은 수익률이 동일합니다. 순위 변동은 전날 기록과 비교합니다.";
}
function renderLosers() {
  const losers=getLosers().reverse();
  $("loserList").innerHTML=losers.map(p=>`
    <div class="danger-person">
      <div class="danger-rank">${p.position}위</div>
      <div class="danger-person-name"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.asset)} · ${escapeHtml(p.ticker)}</small></div>
      <div class="danger-person-roi">${pct(p.roi)}</div>
    </div>`).join("");
  if(!losers.length)$("loserList").innerHTML='<div class="loading">시세 수집이 필요합니다.</div>';
}
function renderTickerList() {
  const unique=SYMBOLS.map(s=>ranked.find(p=>p.ticker===s)).filter(Boolean);
  $("tickerList").innerHTML=unique.map(p=>`<button type="button" class="ticker-item" data-person="${p.id}">
     <span class="ticker-meta"><b>${escapeHtml(p.asset)}</b><small>${p.ticker}</small></span>
     <span class="ticker-value"><b>${fmtPrice(p.start,p.currency)}</b><small>내기 시작가</small></span>
   </button>`).join("");
}
function escapeSvg(s){return escapeHtml(s);}
function renderChart(){
  const p=ranked.find(v=>v.id===activePerson)??ranked[0];
  if(!p)return;
  const isPos=(p.roi??0)>=0;
  $("chartBadges").innerHTML=`<span class="big-rate" style="color:${isPos?"var(--lime)":"var(--coral)"}">${pct(p.roi)}</span><span class="mini-text">${escapeHtml(p.name)} · ${escapeHtml(p.asset)} 누적 수익률</span>`;
  let series=history.filter(h=>h.returns && typeof h.returns[p.id]==="number").map(h=>({day:h.day,value:h.returns[p.id]}));
  const today=kstDay(snapshot.updatedAt);
  if(p.roi!==null && (!series.length||series[series.length-1].day!==today))series.push({day:today,value:p.roi});
  if(series.length<2){
    $("chartContainer").innerHTML='<div class="empty-chart">첫 자동 수집 이후부터 수익률 변동 기록이 쌓입니다.</div>';
    $("chartNote").textContent="기록 2일 이상 필요";
    return;
  }
  series=series.slice(-30);
  const W=700,H=195,left=43,right=15,top=20,bottom=27;
  const vals=series.map(v=>v.value);
  const spread=Math.max(3,Math.max(...vals)-Math.min(...vals));
  let low=Math.min(...vals)-spread*.28, high=Math.max(...vals)+spread*.28;
  if(high<=low){high=low+1;}
  const sx=i=>left+(W-left-right)*i/(series.length-1);
  const sy=v=>top+(H-top-bottom)*(1-(v-low)/(high-low));
  const points=series.map((v,i)=>`${sx(i).toFixed(2)},${sy(v.value).toFixed(2)}`).join(" ");
  const fill=points+` ${sx(series.length-1).toFixed(2)},${H-bottom} ${sx(0).toFixed(2)},${H-bottom}`;
  const grid=Array.from({length:4},(_,i)=>{
    const y=top+(H-top-bottom)*i/3, v=high-(high-low)*i/3;
    return `<line class="gridline" x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"/><text class="axis-label" x="${left-9}" y="${y+3}" text-anchor="end">${v.toFixed(1)}%</text>`;
  }).join("");
  const last=series.at(-1);
  const color=isPos?"#dfff67":"#ff8586";
  $("chartContainer").innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeSvg(p.name)} 최근 ${series.length}일 수익률 그래프">
    <defs><linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".27"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}<polygon points="${fill}" fill="url(#chartGradient)"/>
    <polyline class="chart-line" style="stroke:${color}" points="${points}"/>
    <circle class="chart-dot" style="fill:${color}" cx="${sx(series.length-1)}" cy="${sy(last.value)}" r="5"/>
    <text class="axis-label" x="${left}" y="${H-3}">${dateShort(series[0].day)}</text>
    <text class="axis-label" x="${W-right}" y="${H-3}" text-anchor="end">${dateShort(last.day)}</text>
    </svg>`;
  $("chartNote").textContent=`${series.length}회 기록 · 데이터 기준일 ${last.day}`;
}
function renderBrief() {
  const losers=getLosers().reverse();
  const leader=ranked[0], bottom=ranked.at(-1);
  let comment;
  if(!isComplete())comment="일부 시세를 불러오지 못했어요. 확인 후 다시 정산!";
  else if(snapshot.locked)comment=`결전 종료! ${losers.map(p=>p.name).join(" · ")} 님, 계산대로 모십니다.`;
  else if(bottom?.roi<0)comment=`${bottom.name} 님, 계산서가 보입니다. 아직 반전할 시간은 있어요.`;
  else comment=`${leader.name} 님은 여유롭지만… 마지막 날의 마법을 조심하세요.`;
  $("battleComment").textContent=comment;
  const us= snapshot.markets?.NVDA?.date||"—";
  const kr= snapshot.markets?.["267260.KS"]?.date||"—";
  const btc=snapshot.markets?.["KRW-BTC"]?.date||"—";
  $("marketDates").innerHTML=`미국 주식 <b>${escapeHtml(us)}</b><br>국내 주식 <b>${escapeHtml(kr)}</b><br>비트코인 <b>${escapeHtml(btc)}</b>`;
}
function renderAll(){
  ranked=calculateRanking();
  showStatus();renderStats();renderRankList();renderLosers();renderTickerList();renderBrief();renderChart();updateCountdown();
}
function getPersonDetail(id){
  const p=ranked.find(x=>x.id===id);
  if(!p)return;
  const line=p.risk ? "현재 술값 결제 위험 구간입니다. 12월 31일까지 분발하세요!" : "현재 결제 위험 구간 밖입니다. 그래도 방심은 금물!";
  return `<div class="modal-overline">${p.risk?"⚠ DANGER ZONE":"★ INVESTOR PROFILE"} / NO.${p.position}</div>
    <h2 class="modal-title" id="modalTitle">${escapeHtml(p.name)} <span style="color:#85929f;font-size:15px">님의 내기 현황</span></h2>
    <p class="modal-sub">${escapeHtml(p.asset)} · ${p.ticker} · ${p.position}위${p.rank!==p.position?" (공동 "+p.rank+"위)":""}</p>
    <div class="modal-roi ${p.roi!==null&&p.roi<0?"negative":"positive"}">${pct(p.roi)}</div>
    <div class="modal-stats">
      <div class="modal-stat"><small>내기 시작 단가</small><b>${fmtPrice(p.start,p.currency)}</b></div>
      <div class="modal-stat"><small>최근 확인 종가</small><b>${fmtPrice(p.price,p.currency)}</b></div>
      <div class="modal-stat"><small>종가 기준일</small><b>${escapeHtml(p.marketDate)}</b></div>
      <div class="modal-stat"><small>현재 위치</small><b>${p.risk?"술값 위험 🚨":"안전권 ✨"}</b></div>
    </div>
    <p class="modal-note">${line}<br>수익률은 배당·세금·환율을 제외한 해당 종목의 가격 변화만으로 계산합니다.${snapshot.mode==="demo"?"<br><b>주의: 현재는 가상 데이터 데모입니다.</b>":""}</p>`;
}
function openPerson(id){
  const html=getPersonDetail(id);
  if(!html)return;
  $("modalBody").innerHTML=html;
  $("detailModal").hidden=false;
  document.body.style.overflow="hidden";
  $("detailModal").querySelector(".modal-close").focus();
}
function closeModal(){
  $("detailModal").hidden=true;
  document.body.style.overflow="";
}
function openRules(){
  $("modalBody").innerHTML=`<div class="modal-overline">OFFICIAL RULEBOOK</div><h2 class="modal-title" id="modalTitle">2026 술값배틀 룰북</h2>
  <p class="modal-note"><b>1. 승부 기준</b><br>(평가 종가 ÷ 처음 정한 단가 − 1) × 100. 투자금 크기나 환율은 비교하지 않습니다.<br><br>
  <b>2. 벌칙</b><br>9명의 참가자를 수익률 높은 순으로 정렬하여 가장 낮은 세 사람이 술값을 냅니다. 엔비디아를 고른 은지와 동민은 서로 동률입니다.<br><br>
  <b>3. 평가 시점</b><br>미국 주식은 2026.12.31 정규장 종가, 국내 주식은 연말 휴장 전 마지막 거래일인 12.30 종가를 사용합니다. 비트코인은 업비트 KRW-BTC의 2026.12.31자 일봉 종가(2027.01.01 09:00 KST에 확정)를 사용합니다.<br><br>
  <b>4. 추가 합의 권장</b><br>결제 3인 커트라인의 동률, 주식분할, 상장폐지, 배당, 종목 변경 및 데이터 제공처 장애 발생 시 처리 기준을 미리 합의하세요.<br><br>
  <b>5. 결과 확정</b><br>2027.01.01 오전 9시 20분(KST) 이후 최종 종가 수집에 성공하면 순위를 고정합니다.</p>`;
  $("detailModal").hidden=false;document.body.style.overflow="hidden";
  $("detailModal").querySelector(".modal-close").focus();
}
function toast(message){
  clearTimeout(toastTimeout);$("toast").textContent=message;$("toast").classList.add("show");
  toastTimeout=setTimeout(()=>$("toast").classList.remove("show"),3100);
}
function shareText(){
  const losers=getLosers().reverse();
  const text=`🍻 술값배틀 2026\n현재 1위: ${ranked[0]?.name} (${pct(ranked[0]?.roi)})\n현재 술값 후보: ${losers.map(p=>`${p.name} ${pct(p.roi)}`).join(" / ")}\n결전: 2026.12.31\n${snapshot.mode==="demo"?"※ 가상 데이터 시연":location.href}`;
  if(navigator.share && location.protocol!=="file:"){
    navigator.share({title:"술값배틀 2026",text}).catch(()=>{});
    return;
  }
  if(navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(()=>toast("단톡방에 붙여넣을 순위가 복사됐어요!")).catch(()=>fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text){
  const el=document.createElement("textarea");el.value=text;el.style.position="fixed";el.style.opacity="0";document.body.appendChild(el);el.select();
  try{document.execCommand("copy");toast("순위가 복사됐어요!");}catch(_){toast("공유가 지원되지 않는 환경입니다.");}
  el.remove();
}
async function loadData(){
  if(location.protocol==="file:")return;
  const cb="?t="+Date.now();
  try {
    const [priceRes,historyRes]=await Promise.all([fetch("./data/prices.json"+cb,{cache:"no-store"}),fetch("./data/history.json"+cb,{cache:"no-store"})]);
    if(!priceRes.ok)throw Error("prices.json HTTP "+priceRes.status);
    const prices=await priceRes.json();
    if(prices && prices.markets && typeof prices.markets==="object" && prices.mode)snapshot=prices;
    if(historyRes.ok){const h=await historyRes.json();if(Array.isArray(h.history))history=h.history;}
    renderAll();
  }catch(e){ console.warn("[술값배틀] 로컬 데모 데이터를 사용합니다:", e); }
}
function shuffleDemo() {
  if(snapshot.mode!=="demo")return;
  SYMBOLS.forEach((symbol)=>{
    const base=PEOPLE.find(p=>p.ticker===symbol).start;
    const delta=(Math.random()*0.35)-0.18;
    const price=Math.max(1,base*(1+delta));
    snapshot.markets[symbol].price = symbol==="KRW-BTC" || symbol.endsWith(".KS") ? Math.round(price) : Math.round(price*100)/100;
  });
  snapshot.updatedAt=new Date().toISOString();
  renderAll();toast("가상 시세가 흔들렸어요. 실제 시세는 아닙니다!");
}
function bindUI(){
  document.querySelectorAll(".filter-pill").forEach(btn=>btn.addEventListener("click",()=>{
    chosenFilter=btn.dataset.filter;
    document.querySelectorAll(".filter-pill").forEach(b=>b.classList.toggle("active",b===btn));
    renderRankList();
  }));
  $("sortSelect").addEventListener("change",e=>{chosenSort=e.target.value;renderRankList();});
  document.addEventListener("click",e=>{
    const personEl=e.target.closest("[data-person]");
    if(personEl){openPerson(personEl.dataset.person);return;}
    if(e.target.closest("[data-close-modal]"))closeModal();
  });
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&!$("detailModal").hidden)closeModal();
    if((e.key==="Enter"||e.key===" ") && e.target.matches(".rank-item[data-person]")){e.preventDefault();openPerson(e.target.dataset.person);}
  });
  $("historyPerson").addEventListener("change",e=>{activePerson=e.target.value;renderChart();});
  $("shareButton").addEventListener("click",shareText);
  $("openRules").addEventListener("click",openRules);
  $("demoShuffle").addEventListener("click",shuffleDemo);
}
function initHistorySelect(){
  const sel=$("historyPerson");
  sel.innerHTML=PEOPLE.map(p=>`<option value="${p.id}" ${p.id===activePerson?"selected":""}>${escapeHtml(p.name)} · ${escapeHtml(p.asset)}</option>`).join("");
}
function init(){
  initHistorySelect();bindUI();renderAll();loadData();
  // 열린 탭에서도 서버에 게시된 종가 데이터가 자동 반영됩니다.
  setInterval(()=>{updateCountdown();if(!document.hidden)loadData();},15*60*1000);
}
document.addEventListener("DOMContentLoaded",init);
