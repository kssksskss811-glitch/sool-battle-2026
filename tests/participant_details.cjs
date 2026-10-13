const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const D=require('../assets/details.js');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({document:{addEventListener(){}},console});
vm.runInContext(fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),context);
const people=JSON.parse(vm.runInContext('JSON.stringify(PARTICIPANTS)',context));
const live=JSON.parse(fs.readFileSync(path.join(root,'data/prices.json'),'utf8'));
const hist=JSON.parse(fs.readFileSync(path.join(root,'data/history.json'),'utf8')).history;
const close=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const fixture={mode:'manual',markets:{}};
const values={NVDA:226.32,TSLA:378.03,AMZN:259.53,GOOGL:352.72,'KRW-BTC':110863000,'034020.KS':70200,'267260.KS':560000,'011200.KS':22050};
for(const p of people)fixture.markets[p.ticker]={price:values[p.ticker]};
const currentBefore=JSON.stringify({live,hist});
context.live=live;
const frontRanks=JSON.parse(vm.runInContext('JSON.stringify(computeRanking(live))',context));
for(const row of frontRanks){const model=D.compute(people,live,hist,row.id);assert.equal(model.person.rank,row.rank);close(model.person.roi,row.roi);}
const eunji=D.compute(people,fixture,hist,'eunji');
assert.equal(eunji.person.rank,1);assert.equal(eunji.joint,true);assert.equal(eunji.ahead,null);assert.equal(eunji.aheadTarget,null);assert.equal(eunji.leaderGap,0);assert.deepEqual(eunji.tiedNames,['동민']);
const geum=D.compute(people,fixture,hist,'geumseung');
assert.equal(geum.person.rank,3);assert.deepEqual(geum.ahead.group.map(p=>p.id),['eunji','dongmin']);assert.equal(geum.ahead.group[0].rank,1);
const yumin=D.compute(people,fixture,hist,'yumin');
assert.equal(yumin.ahead.group[0].id,'seongsu');close(yumin.ahead.gap,1.969275);close(yumin.aheadTarget.extraPct,(133600000*(378.03/445)/110863000-1)*100,1e-10);
const jeonguk=D.compute(people,fixture,hist,'jeonguk');
assert.equal(jeonguk.ahead.group[0].id,'yumin');close(jeonguk.ahead.gap,.198268);close(jeonguk.aheadTarget.extraPct,(84800*(110863000/133600000)/70200-1)*100,1e-10);
const last=D.compute(people,fixture,hist,'gwangil');assert.equal(last.behind,null);assert.equal(last.safety.status,'risk');assert.ok(last.safety.target.tiePrice>last.person.price);
const goal=structuredClone(fixture);goal.markets['KRW-BTC'].price=yumin.aheadTarget.tiePrice;
const atTie=D.compute(people,goal,[],'yumin');assert.equal(atTie.person.rank,6);assert.equal(atTie.joint,true);assert.equal(atTie.safety.status,'boundary');
goal.markets['KRW-BTC'].price*=1.000001;assert.equal(D.compute(people,goal,[],'yumin').safety.status,'safe');
const custom=people.map(p=>({...p,start:100}));
function dataFor(rois){const data={mode:'manual',markets:{}};for(const [id,roi] of Object.entries(rois)){const p=custom.find(p=>p.id===id);data.markets[p.ticker]={price:p.start*(1+roi/100)};}return data;}
const boundary=dataFor({eunji:-5,dongmin:-5,geumseung:50,bitna:40,ojing:30,seongsu:20,jeonguk:10,yumin:-10,gwangil:-20});
for(const id of ['eunji','dongmin']){const m=D.compute(custom,boundary,[{day:'2026-01-14',returns:{eunji:-5,dongmin:-5},ranks:{eunji:6,dongmin:6},losers:['dongmin']}],id);assert.equal(m.safety.status,'boundary');assert.equal(m.safety.target.shared,true);assert.equal(m.safety.target.tiePrice,undefined);}
const linked=custom.map(p=>({...p,start:p.id==='dongmin'?200:p.start}));
const linkedData=dataFor({eunji:20,dongmin:20,geumseung:50,bitna:40,ojing:30,seongsu:-60,jeonguk:-65,yumin:-70,gwangil:-80});
assert.equal(D.compute(linked,linkedData,[],'dongmin').aheadTarget.shared,true);
const equal=dataFor(Object.fromEntries(custom.map(p=>[p.id,0])));
for(const p of custom){const m=D.compute(custom,equal,[],p.id);assert.equal(m.person.rank,1);assert.equal(m.safety.status,'boundary');}
const incomplete=structuredClone(fixture);delete incomplete.markets.TSLA;
assert.equal(D.compute(people,incomplete,[],'eunji').complete,false);assert.equal(D.compute(people,incomplete,[],'eunji').person.rank,null);assert.equal(D.compute(people,incomplete,[],'eunji').aheadTarget,null);
assert.equal(D.compute(people,fixture,[],'unknown'),null);
const records=[{day:'2026-10-01',returns:{eunji:10},ranks:{eunji:3}},{day:'2026-10-02',returns:{eunji:20},ranks:{eunji:1}},{day:'2026-10-02',updatedAt:'2026-10-02T18:00:00+09:00',returns:{eunji:21},ranks:{eunji:1}},{day:'2026-10-03',demo:true,returns:{eunji:50}},{day:'2026-02-30',returns:{eunji:0}},{day:'2026-10-04',returns:{eunji:NaN}}];
const points=D.series(people[0],records);assert.equal(points.length,2);assert.equal(points[1].roi,21);close(points[0].price,people[0].start*1.1);assert.equal(points[0].sourceDay,null);assert.equal(D.series(people[0],records,'1').length,1);
assert.equal(JSON.stringify({live,hist}),currentBefore);
console.log('participant calculations passed: 9 live participants, %p/% targets, ties, shared assets, boundary rules, partial data, historical reconstruction and data preservation');
