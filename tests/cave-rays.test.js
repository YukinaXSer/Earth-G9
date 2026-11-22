import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { CaveRayIndex } from '../src/cave/cave-rays.js';

test('cave ray index returns the closest two-sided surface and respects distance and empty space', () => {
  const face = z => ({ vertices: [new Vector3(-1, -1, z), new Vector3(1, -1, z), new Vector3(0, 1, z)] });
  const index = new CaveRayIndex([{ cells: new Map([['a', Array.from({ length: 40 }, (_, i) => face(i + 2))]]) }]), origin = new Vector3(), direction = new Vector3(0, 0, 1);
  assert.equal(index.cast(origin, direction, 10), 2);
  assert.equal(index.cast(origin, direction, 1), Infinity);
  assert.equal(index.cast(origin, direction.negate(), 10), Infinity);
  assert.equal(index.cast(new Vector3(0, 0, 3.5), direction, 10), .5);
  assert.equal(new CaveRayIndex([]).cast(origin, direction, 10), Infinity);
  assert.throws(() => new CaveRayIndex([{}]), TypeError);
});
