// Render the actual dashboard and detail functions with offline synthetic data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const elements=new Map();
const element=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'all',hidden:false,open:false,
    classList:{toggle(name,value){this[name]=value;}},style:{setProperty(){}},addEventListener(){},focus(){}});
  return elements.get(id);
};
const prices=JSON.parse(fs.readFileSync(path.join(root,'data/prices.json'),'utf8'));
const records=JSON.parse(fs.readFileSync(path.join(root,'data/history.json'),'utf8')).history;
const fixtures=structuredClone(prices);
for(const [symbol,q] of Object.entries(fixtures.markets)){
  q.asOf='2026-10-15T09:09:03+09:00';
  q.priceType=symbol==='KRW-BTC'?'spot':'last_trade';
  q.session=symbol==='KRW-BTC'?'continuous':q.currency==='USD'?'day':'regular';
  q.delay={status:'realtime',minutes:0};
}
fixtures.mode='manual';
fixtures.manualInput={verifiedAt:'2026-10-15T09:10:00+09:00',schemaVersion:2};
fixtures.updatedAt='2026-10-15T09:11:00+09:00';
fixtures.markets['034020.KS'].delay={status:'delayed',minutes:15};
fixtures.markets['034020.KS'].stale=true;
fixtures.markets.GOOGL.delay={status:'unknown',minutes:null};
fixtures.markets.GOOGL.stale=true;
const before=JSON.stringify({prices,fixtures,records});
const context=vm.createContext({document:{addEventListener(){},getElementById:element},console,prices,fixtures,records});
for(const file of ['assets/details.js','assets/app.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const run=code=>vm.runInContext(code,context);
const label=(q,s='NVDA')=>{context.q=q;context.s=s;return run('quoteBasisLabel(q,s)');};
for(const [session,text] of [['day','데이장'],['pre','프리장'],['regular','정규장'],['after','시간외']]){
  assert.match(label({...fixtures.markets.NVDA,session}),new RegExp(text+' 거래가격'));
}
assert.match(label({...fixtures.markets.NVDA,priceType:'previous_close',session:'regular'}),/직전 정규장 종가/);
assert.match(label(fixtures.markets['034020.KS'],'034020.KS'),/지연 15분/);
assert.match(label(fixtures.markets.GOOGL),/지연 여부 미확인/);
assert.match(label(fixtures.markets['KRW-BTC'],'KRW-BTC'),/BTC 현물/);
assert.match(label({...fixtures.markets['KRW-BTC'],priceType:'daily_close',session:'daily'},'KRW-BTC'),/완료 일봉/);
assert.match(label(prices.markets.NVDA),/확정 종가.*실제 시각 미기록/);
assert.match(label(prices.markets['KRW-BTC'],'KRW-BTC'),/완료 일봉.*09:00 KST/);
assert.equal(run('quoteTimeLabel("2026-10-15T00:09:03Z")'),'2026.10.15 09:09:03 KST');
assert.equal(run('quoteTimeLabel("2026-10-15T09:09:03")'),'실제 시각 미확인');
assert.equal(run('quoteTimeLabel(null)'),'실제 시각 미확인');
run('priceData=fixtures;ranked=computeRanking(priceData);renderHeader();renderRankRows();renderRisk()');
assert.match(element('usCloseDay').textContent,/데이장.*09:09:03 KST.*지연 여부 미확인/);
assert.match(element('krCloseDay').textContent,/정규장.*지연 15분/);
assert.match(element('btcCandleClose').textContent,/BTC 현물/);
assert.match(element('verifiedAt').textContent,/입력 확인.*09:10:00 KST/);
assert.match(element('asOf').textContent,/데이터 갱신.*09:11 KST/);
assert.equal(element('dataStatus').classList.partial,true);
assert.match(element('rankFoot').textContent,/세션 중 순위는 잠정/);
assert.equal((element('rankRows').innerHTML.match(/data-person=/g)||[]).length,9);
assert.equal((element('dangerRows').innerHTML.match(/class="danger-row"/g)||[]).length,3);
run('history=records');
const people=JSON.parse(run('JSON.stringify(PARTICIPANTS)'));
const D=context.BattleDetails;
for(const p of people){
  const old=D.compute(people,prices,records,p.id),current=D.compute(people,fixtures,records,p.id);
  assert.equal(current.person.rank,old.person.rank);
  assert.equal(current.person.roi,old.person.roi);
  assert.equal(current.safety.status,old.safety.status);
  assert.equal(JSON.stringify(current.aheadTarget),JSON.stringify(old.aheadTarget));
}
const oldWeeks=run('JSON.stringify(weeklyHistory())');
run('history=records.map(r=>({...r,quotes:fixtures.markets}))');
assert.equal(run('JSON.stringify(weeklyHistory().map(({quotes,...r})=>r))'),oldWeeks);
const point=D.series(people[0],[{day:'2026-10-15',returns:{eunji:10},ranks:{eunji:1},priceDates:{NVDA:'2026-10-14'},quotes:fixtures.markets}])[0];
assert.equal(point.quote.session,'day');
assert.equal(point.quote.asOf,fixtures.markets.NVDA.asOf);
run('BattleDetails.init({getData:()=>({participants:PARTICIPANTS,prices:fixtures,history:[]}),quoteLabel:quoteBasisLabel})');
element('participantDetail').open=true;
run('BattleDetails.open("eunji")');
assert.match(element('detailSummary').innerHTML,/데이장 거래가격.*09:09:03 KST.*출처/);
context.unsafe=structuredClone(fixtures);
context.unsafe.markets.NVDA.source='<script>alert(1)</script>';
run('priceData=unsafe;renderRankRows()');
assert.match(element('rankRows').innerHTML,/&lt;script&gt;/);
assert.doesNotMatch(element('rankRows').innerHTML,/<script>/);
assert.equal(JSON.stringify({prices,fixtures,records}),before);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(html,/09:10 KST/);
assert.match(html,/예약 변경 별도 확인/);
assert.doesNotMatch(html,/17:30 KST|최근 종가|국장 종가|미장 종가/);
console.log('market quote UI passed: four stock sessions, previous close, BTC spot/daily, delays, actual/verified/saved times, details, ranking/risk/weekly compatibility, escaping and unchanged data');
