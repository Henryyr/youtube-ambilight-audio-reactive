import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  audioVisuals,
  sampleEdgeColors,
  spatialize,
} from './audio-modulation.js';
import {
  analyzeCorrelation,
  analyzeTransient,
} from './audio-analyzer.js';

const base = { level: 0.5, left: 0.4, right: 0.4, bass: 0.4, treble: 0.4 };

test('left channel expands only the left edge', () => {
  const before = audioVisuals(base).spread;
  const after = audioVisuals({ ...base, left: 0.9 }).spread;
  assert.ok(after.left > before.left, 'left should move outward');
  assert.ok(after.right === before.right, 'right must not move');
  assert.ok(after.top === before.top);
  assert.ok(after.bottom >= before.bottom);
});

test('right channel expands only the right edge', () => {
  const before = audioVisuals(base).spread;
  const after = audioVisuals({ ...base, right: 0.9 }).spread;
  assert.ok(after.right > before.right);
  assert.ok(after.left === before.left);
});

test('treble expands only the top edge', () => {
  const before = audioVisuals(base).spread;
  const after = audioVisuals({ ...base, treble: 0.9 }).spread;
  assert.ok(after.top > before.top);
  assert.ok(after.bottom === before.bottom);
  assert.ok(after.left === before.left);
  assert.ok(after.right === before.right);
});

test('bass expands only the bottom edge', () => {
  const before = audioVisuals(base).spread;
  const after = audioVisuals({ ...base, bass: 0.9 }).spread;
  assert.ok(after.bottom > before.bottom);
  assert.ok(after.top === before.top);
  assert.ok(after.left === before.left);
});

test('silence collapses the glow entirely', () => {
  for (const level of [0, 0.002, 0.011]) {
    const v = audioVisuals({
      level,
      left: level,
      right: level,
      bass: level,
      treble: level,
    });
    assert.equal(v.gate, 0);
    assert.deepEqual(v.spread, { left: 0, right: 0, top: 0, bottom: 0 });
  }
});

test('antiphase stereo still gates open', () => {
  const v = audioVisuals({ level: 0, left: 0.5, right: 0.5 });
  assert.equal(v.gate, 1);
});

test('null and NaN input are safe', () => {
  const v = audioVisuals({
    level: NaN,
    left: 'x',
    right: undefined,
    bass: null,
  });
  assert.equal(v.gate, 0);
});

test('sensitivity and expansion settings scale the response', () => {
  const low = audioVisuals(base, { sensitivity: 0.25, expansion: 0.5 });
  const high = audioVisuals(base, { sensitivity: 2, expansion: 2.5 });
  assert.ok(low.spread.left < high.spread.left);
  assert.ok(low.gate <= high.gate);
});

function frame(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = paint(x, y) ?? [0, 0, 0];
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

test('black frame yields no edge colors', () => {
  const colors = sampleEdgeColors(frame(32, 18, () => null), 32, 18);
  assert.deepEqual(colors, {
    left: null,
    right: null,
    top: null,
    bottom: null,
  });
});

test('edge colors come from the matching video edge', () => {
  const colors = sampleEdgeColors(
    frame(32, 18, (x, y) =>
      x < 3 ? [255, 0, 0] : x > 28 ? [0, 255, 0] : y < 2 ? [0, 0, 255] : null
    ),
    32,
    18
  );
  assert.ok(colors.left[0] > 230 && colors.left[0] > colors.left[2] * 10);
  assert.ok(colors.right[1] > 230 && colors.right[1] > colors.right[2] * 10);
  assert.ok(colors.top[2] > colors.top[0] && colors.top[2] > colors.top[1]);
  // Bottom band only overlaps the corner colors of this frame.
  assert.equal(colors.bottom?.[2], 0);

  const bottomOnly = sampleEdgeColors(
    frame(32, 18, (x, y) => (y >= 16 && x >= 6 && x < 27 ? [10, 20, 30] : null)),
    32,
    18
  );
  assert.deepEqual(bottomOnly.bottom, [10, 20, 30]);
  assert.equal(bottomOnly.left, null);
  assert.equal(bottomOnly.right, null);
});

test('sampleEdgeColors skips letterbox bars when barsClip is provided', () => {
  const colors = sampleEdgeColors(
    frame(32, 18, (_x, y) => (y >= 4 && y < 7 ? [255, 255, 0] : null)),
    32,
    18,
    [0, 4 / 18]
  );
  assert.ok(colors.top, 'top edge should detect yellow content despite letterboxing');
  assert.ok(colors.top[0] > 200 && colors.top[1] > 200);
});

test('projectorListElem is never styled by the audio visual code', () => {
  const source = readFileSync(
    new URL('./ambientlight.js', import.meta.url),
    'utf8'
  );
  const visualBlock = source.slice(
    source.indexOf('updateAudioVisuals = () => {'),
    source.indexOf('setAudioPlayback = (playing) => {')
  );
  assert.ok(visualBlock.includes('audioGlowElems'));
  assert.ok(
    !/projectorListElem\.style/.test(visualBlock),
    'audio visuals must not touch projectorListElem styles'
  );
  const clearBlock = source.slice(
    source.indexOf('clearAudioVisuals = () => {'),
    source.indexOf('setAudioPlayback = (playing) => {')
  );
  assert.ok(
    !/projectorListElem\.style/.test(clearBlock),
    'clearing audio visuals must not touch projectorListElem styles'
  );
});

test('stereo correlation measures mono, stereo, and antiphase', () => {
  const monoL = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  const monoR = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  assert.ok(analyzeCorrelation(monoL, monoR) > 0.99, 'identical signals should correlate to 1');

  const antiR = new Float32Array([-0.1, 0.2, -0.3, 0.4]);
  assert.ok(analyzeCorrelation(monoL, antiR) < -0.99, 'inverted signals should correlate to -1');

  const orthoL = new Float32Array([1, 0, -1, 0]);
  const orthoR = new Float32Array([0, 1, 0, -1]);
  assert.ok(Math.abs(analyzeCorrelation(orthoL, orthoR)) < 0.01, 'orthogonal signals should correlate to ~0');
});

test('transient detector flags sudden energy jumps', () => {
  assert.ok(analyzeTransient(0.8, 0.1) > 0.5, 'big attack should trigger transient');
  assert.equal(analyzeTransient(0.5, 0.5), 0, 'sustained level has no transient');
  assert.equal(analyzeTransient(0.2, 0.7), 0, 'decay has no transient');
});

test('per-channel bass and treble spatialize independently', () => {
  const leftHeavy = spatialize({
    level: 0.5,
    left: 0.5,
    right: 0.5,
    leftBass: 0.9,
    rightBass: 0.1,
    leftTreble: 0.1,
    rightTreble: 0.9,
  });
  assert.ok(leftHeavy.leftRear > leftHeavy.rightRear, 'leftBass should drive leftRear harder');
  assert.ok(leftHeavy.rightFrontHeight > leftHeavy.leftFrontHeight, 'rightTreble should drive rightFrontHeight harder');
});

test('antiphase correlation boosts diffuse rear zones', () => {
  const monoZones = spatialize({ level: 0.5, left: 0.5, right: 0.5, bass: 0.5, correlation: 1 });
  const surroundZones = spatialize({ level: 0.5, left: 0.5, right: 0.5, bass: 0.5, correlation: -1 });
  assert.ok(surroundZones.leftRear > monoZones.leftRear, 'diffuse audio should expand to rear');
  assert.ok(monoZones.center > surroundZones.center, 'mono audio should stay focused in center');
});
