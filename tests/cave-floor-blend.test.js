import test from 'node:test';
import assert from 'node:assert/strict';
import { floorBlendHeight } from '../scripts/blend-mountain-floor.mjs';

test('floor grade blends continuously between its scanned and terrain contacts', () => {
  assert.equal(floorBlendHeight(-.3, .02, 0), -.3);
  assert.ok(Math.abs(floorBlendHeight(-.3, .02, .5) + .14) < 1e-10);
  assert.ok(Math.abs(floorBlendHeight(-.3, .02, 1) - .02) < 1e-10);
  for (let s = .05; s <= 4.5; s += .05) {
    assert.ok(Math.abs(floorBlendHeight(-.3, .02, s / 4.5) - floorBlendHeight(-.3, .02, (s - .05) / 4.5)) < .01);
  }
});
test('floor grade clamps outside the blend and keeps coincident contacts flat', () => {
  assert.equal(floorBlendHeight(0, 1, -1), 0);
  assert.equal(floorBlendHeight(0, 1, 2), 1);
  assert.equal(floorBlendHeight(0, 0, .5), 0);
});
test('missing or nonfinite floor contacts cannot create a grade', () => {
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.throws(() => floorBlendHeight(value, 0, 0), TypeError);
    assert.throws(() => floorBlendHeight(0, value, 0), TypeError);
    assert.throws(() => floorBlendHeight(0, 0, value), TypeError);
  }
});
