// Exercise the unmodified site's ranking and weekly chart functions, offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const [repo, fixture] = process.argv.slice(2);
const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const prices = read(fixture, "data/prices.json");
const before = read(repo, "data/history.json").history;
const after = read(fixture, "data/history.json").history;
const record = after.find(r => r.day === "2026-10-13");
const context = vm.createContext({ document: { addEventListener() {} }, console, prices, before, after });
vm.runInContext(fs.readFileSync(path.join(repo, "assets/app.js"), "utf8"), context);
const ranking = JSON.parse(vm.runInContext("JSON.stringify(computeRanking(prices))", context));
for (const participant of ranking) {
  assert.equal(participant.rank, record.ranks[participant.id]);
  assert.ok(Math.abs(participant.roi - record.returns[participant.id]) < 0.000001);
  assert.equal(participant.sourceDay, record.priceDates[participant.ticker]);
}
const oldWeeks = JSON.parse(vm.runInContext("history=before; JSON.stringify(weeklyHistory())", context));
const newWeeks = JSON.parse(vm.runInContext("history=after; JSON.stringify(weeklyHistory())", context));
assert.ok(newWeeks.length > 1);
assert.deepEqual(newWeeks.filter(r => r.weekEnd < "2026-10-17"), oldWeeks.filter(r => r.weekEnd < "2026-10-17"));
const targetWeek = newWeeks.find(r => r.weekEnd === "2026-10-17");
// Later real history can already contain a newer snapshot in this same week.
if (targetWeek.day === record.day) assert.deepEqual(targetWeek.ranks, record.ranks);
assert.equal(targetWeek.weekEnd, "2026-10-17");
console.log("ranking and weekly chart compatible");
