const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'src/scripts/libs/audio-reactive.js'), 'utf8');
const helpers = source.slice(source.indexOf('export const clamp'), source.indexOf('export default class'));
const { modulation } = vm.runInNewContext(
  helpers.replace(/export /g, '') + '\n({ modulation });'
);
assert.equal(modulation(0), 65);
assert.equal(modulation(1), 315);
for (const invalid of [NaN, Infinity, undefined, {}, -1]) {
  assert.equal(modulation(invalid), 65);
}
let previous = modulation(0);
for (let step = 1; step <= 100; step++) {
  const brightness = modulation(step / 100);
  assert.ok(brightness > previous && brightness <= 315);
  previous = brightness;
}
assert.equal(modulation(10), 315);
console.log('Audio response checks passed: bounds, invalid input, monotonic brightness.');
