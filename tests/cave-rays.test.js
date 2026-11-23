import test from 'node:test';
import assert from 'node:assert/strict';
import { Plane, Vector3 } from 'three';
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

test('cave ray index honors material clipping planes without hiding the next visible triangle', () => {
  const faces = [1, 3].map(z => ({ vertices: [new Vector3(-1, -1, z), new Vector3(1, -1, z), new Vector3(0, 1, z)] }));
  const index = new CaveRayIndex([{ cells: new Map([[0, faces]]) }]), origin = new Vector3(), direction = new Vector3(0, 0, 1);
  assert.equal(index.cast(origin, direction, 5, [new Plane(direction, -2)]), 3);
  assert.equal(index.cast(origin, direction, 2, [new Plane(direction, -2)]), Infinity);
  assert.equal(index.cast(origin, direction, 5, []), 1);
  assert.equal(index.cast(origin, direction, 5, [], 1), 3);
  assert.equal(new CaveRayIndex([]).cast(origin, direction, 5, [new Plane(direction, -2)]), Infinity);
});

test('cooperative body BVH preserves closest hits, empty support and clipping', async () => {
  const faces = Array.from({ length: 400 }, (_, i) => ({ vertices: [new Vector3(-2, -2, i / 10 + 1), new Vector3(2, -2, i / 10 + 1), new Vector3(0, 2, i / 10 + 1)] }));
  const indices = [{ cells: new Map([[0, faces], [1, faces]]) }], reference = new CaveRayIndex(indices);
  let yields = 0;
  const result = await CaveRayIndex.createAsync(indices, async () => { yields++; }, 0);
  assert.ok(yields > 0);
  const planes = [new Plane(new Vector3(0, 0, 1), -8)];
  for (let z = -2; z < 42; z += .19) for (const clipping of [[], planes]) {
    const origin = new Vector3(.1, .1, z), direction = new Vector3(0, 0, 1);
    assert.equal(result.cast(origin, direction, 10, clipping), reference.cast(origin, direction, 10, clipping));
  }
  assert.equal((await CaveRayIndex.createAsync([], async () => {})).root, null);
  await assert.rejects(CaveRayIndex.createAsync([{}], async () => {}), TypeError);
});
