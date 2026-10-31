const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const target = {innerHTML: ''};
const context = vm.createContext({document: {addEventListener() {}, getElementById() {return target;}}});
vm.runInContext(fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8'), context);
function render(values) {
  context.values = values;
  vm.runInContext('ranked=values.map((roi,i)=>({...PARTICIPANTS[i%PARTICIPANTS.length],roi,rank:i+1,position:i+1,price:100})); renderRankRows()', context);
  return [...target.innerHTML.matchAll(/<button[\s\S]*?<\/button>/g)].map(match => match[0]);
}
const values = [35,50,100,150,-35,-50,-100,-150,0,null,0.1,-0.1];
const widths = [35,50,100,100,35,50,100,100,0,0,0.1,0.1];
render(values).forEach((html,i) => {
  assert.equal(Number(html.match(/width:([\d.]+)%/)[1]), widths[i]);
  const value = values[i];
  const label = value === null ? '—' : (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2) + '%';
  assert.ok(html.includes(`<div class="return">${label}</div>`));
  assert.ok(html.includes('--perf:' + (value === null ? '#99a4b4' : value >= 0 ? '#ef4056' : '#2867ec')));
});
// A different participant's result must not rescale a 35% bar.
for (const peer of [1,50,150,1000]) {
  assert.equal(render([35,peer])[0].match(/width:([\d.]+)%/)[1], '35.0');
}
const css = fs.readFileSync(path.join(root, 'assets/style.css'), 'utf8');
const fillRule = css.match(/\.track>i\{([^}]+)\}/)[1];
assert.ok(!/min-width\s*:\s*[1-9]/.test(fillRule), 'zero must have no minimum painted width');
console.log('return bars: fixed absolute scale, clamp, labels, signs, colors, zero and peer independence passed');
