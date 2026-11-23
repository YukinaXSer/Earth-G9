import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedFragments } from '../scripts/trim-mountain-fragments.mjs';

test('fragment trimming removes small connected neighbours but leaves unrelated islands', () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 0,0,1, 1,0,1, 4,0,0, 5,0,0, 4,0,1]);
  const indices = new Uint32Array([0,2,1, 1,2,3, 4,6,5]);
  assert.deepEqual(connectedFragments(positions, indices, [0]), [0,1]);
  assert.deepEqual(connectedFragments(positions, indices, []), []);
  assert.deepEqual(connectedFragments(new Float32Array(), new Uint32Array(), []), []);
  assert.throws(() => connectedFragments(positions, indices, [3]), RangeError);
  assert.throws(() => connectedFragments(positions, indices, [0], 0), TypeError);
});
