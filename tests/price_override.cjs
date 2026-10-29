const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const O=require('../assets/price-override.js');
const prices=JSON.parse(fs.readFileSync(path.join(root,'data/prices.json'),'utf8'));
const history=JSON.parse(fs.readFileSync(path.join(root,'data/history.json'),'utf8')).history;
// Fixed baseline: regression checks must keep working after automatic expiry.
prices.markets.GOOGL={price:324.89,date:'2026-10-28',currency:'USD',source:'Stock Analysis',stale:false};
prices.locked=false;
const before=JSON.stringify({prices,history});
const effective=O.apply(prices);
assert.equal(effective.markets.GOOGL.price,291.70);
assert.equal(effective.markets.GOOGL.asOf,null);
assert.equal(effective.markets.GOOGL.date,null);
assert.equal(effective.markets.GOOGL.priceType,'user_override');
assert.equal(effective.markets.GOOGL.userOverride.specifiedAt,null);
assert.deepEqual(effective.markets.GOOGL.userOverride.referenceClose,{price:324.89,date:'2026-10-28'});
for(const [symbol,q] of Object.entries(prices.markets))if(symbol!=='GOOGL')assert.strictEqual(effective.markets[symbol],q);
function snapshot(fields,extra={}){return {...prices,...extra,markets:{...prices.markets,GOOGL:{...prices.markets.GOOGL,...fields}}};}
for(const date of ['2026-10-27','2026-10-28'])assert.equal(O.apply(snapshot({date},{updatedAt:'2026-11-02T12:00:00Z'})).markets.GOOGL.price,291.70);
for(const fields of [
  {date:'2026-10-29'},
  {date:'2026-10-29',priceType:'previous_close',session:'regular',asOf:'2026-10-29T20:00:00Z',stale:true}
]){const next=snapshot(fields);assert.strictEqual(O.apply(next),next);}
for(const fields of [
  {date:'2026-10-29',priceType:'last_trade',session:'regular',asOf:'2026-10-29T14:00:00Z'},
  {date:'2026-10-29',priceType:'last_trade',session:'after',asOf:'2026-10-29T22:00:00Z'},
  {date:'2026-10-28',priceType:'previous_close',session:'regular',asOf:'2026-10-30T00:00:00Z'},
  {date:'2026-10-32'}, {date:'2026-10-29',price:null}
])assert.equal(O.apply(snapshot(fields)).markets.GOOGL.price,291.70);
const locked=snapshot({},{locked:true});assert.strictEqual(O.apply(locked),locked);
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'all',open:false,hidden:false,style:{setProperty(){}},classList:{toggle(){},add(){}},addEventListener(){},focus(){}});return elements.get(id);}
const ctx=vm.createContext({console,document:{addEventListener(){},getElementById:el},prices,effective,records:history,
  fetch:async url=>({ok:true,json:async()=>url.includes('prices.json')?prices:{history:[]}})});
const run=code=>vm.runInContext(code,ctx);
for(const f of ['price-override.js','details.js','app.js'])run(fs.readFileSync(path.join(root,'assets',f),'utf8'));
(async()=>{
  await run('loadData()');
  assert.equal(run('priceData.markets.GOOGL.price'),291.70,'actual fetch/render path uses override');
  const people=JSON.parse(run('JSON.stringify(PARTICIPANTS)'));
  assert.equal(people.find(p=>p.ticker==='GOOGL').start,328.57);
  const oldRanks=JSON.parse(run('JSON.stringify(computeRanking(prices))'));
  const newRanks=JSON.parse(run('JSON.stringify(computeRanking(priceData))'));
  const bitna=newRanks.find(p=>p.id==='bitna');
  assert.equal(bitna.price,291.70);
  assert.ok(Math.abs(bitna.roi-(291.70/328.57-1)*100)<1e-10);
  for(const row of newRanks){
    const detail=ctx.BattleDetails.compute(people,effective,history,row.id);
    assert.equal(detail.person.rank,row.rank);assert.equal(detail.person.roi,row.roi);
    if(row.ticker!=='GOOGL'){const old=oldRanks.find(p=>p.id===row.id);assert.equal(row.price,old.price);assert.equal(row.roi,old.roi);}
  }
  assert.match(el('dataStatus').innerHTML,/사용자 지정 현재가 포함/);
  assert.match(el('rankRows').innerHTML,/\$291.70.*기준 \$328.57/s);
  assert.match(el('rankRows').innerHTML,/사용자 지정 현재가 · 체결시각 미확인/);
  assert.match(el('rankFoot').textContent,/검증된 실시간 체결값이나 종가가 아니며/);
  run('BattleDetails.init({getData:()=>({participants:PARTICIPANTS,prices:priceData,history:records}),quoteLabel:quoteBasisLabel})');
  el('participantDetail').open=true;
  run('BattleDetails.open("bitna")');
  assert.match(el('detailSummary').innerHTML,/사용자 지정 현재가.*실제 체결시각·세션 미확인.*사용자 지정 시각 미기록.*체결시각 아님.*보존 종가 2026-10-28 \$324.89/s);
  assert.match(el('detailSummary').innerHTML,/간당간당/);
  run('history=records');
  const oldWeeks=run('JSON.stringify(weeklyHistory())');
  run('priceData=prices');
  assert.equal(run('JSON.stringify(weeklyHistory())'),oldWeeks);
  assert.equal(JSON.stringify({prices,history}),before,'raw close/history inputs unchanged');
  ctx.future=snapshot({date:'2026-10-29',price:330});
  run('priceData=UserPriceOverride.apply(future);renderAll();BattleDetails.open("bitna")');
  assert.doesNotMatch(el('detailSummary').innerHTML,/사용자 지정 현재가|\$291.70/);
  assert.match(el('detailSummary').innerHTML,/확정 종가.*2026.10.29/s);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.indexOf('price-override.js')<html.indexOf('assets/app.js'));
  console.log('PASS: display-only GOOGL override, actual loading/rendering, rank/detail agreement, unknown trade time, 7 other markets and history preserved, same-day re-save retained, next regular close expiry (v1/v2).');
})().catch(error=>{console.error(error);process.exitCode=1;});
