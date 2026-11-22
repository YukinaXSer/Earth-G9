import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { clipMountainAperture, limitMountainToExit } from '../src/cave/cave-aperture.js';

test('host clips repeated mountain tiles and their shadows behind the exit without adding faces', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial(), geometry = new T.BoxGeometry();
  root.add(new T.Mesh(geometry, material));
  const index = geometry.index.array.slice(), plane = limitMountainToExit(root, mouths[1]);
  assert.ok(plane.distanceToPoint(new T.Vector3(0, 0, 1)) < 0);
  assert.ok(plane.distanceToPoint(new T.Vector3(0, 0, 2)) > 0);
  assert.equal(material.clippingPlanes[0], plane); assert.equal(material.clipShadows, true);
  assert.deepEqual(geometry.index.array, index);
  assert.doesNotThrow(() => limitMountainToExit(new T.Group(), mouths[1]));
});

const volume = { route: [[0, 0, 0], [0, 0, 2]], side: [[1, 0, 0], [1, 0, 0]], radius: [Array(8).fill(2), Array(8).fill(2)], axisHeight: 1.1, clearance: .15 };
const mouths = [{ floorCenter: [0, 0, 0], outward: [0, 0, -1] }, { floorCenter: [0, 0, 2], outward: [0, 0, 1] }];

for (const name of ['capture-grounded-rock', 'native-mountain']) test(`${name} clipping deletes interior triangles but preserves the graded approach and source geometry`, () => {
  const root = new T.Group(), geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-.2, .2, 1, .2, .2, 1, 0, 1, 1, -.2, .025, 2.5, .2, .025, 2.5, 0, .05, 3, 20, 0, 1, 21, 0, 1, 20, 1, 1], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const mesh = new T.Mesh(geometry); mesh.name = name; root.add(mesh); root.position.set(7, 0, -4);
  assert.equal(clipMountainAperture(root, new T.Matrix4().makeTranslation(-7, 0, 4), volume, mouths), 1);
  assert.deepEqual(Array.from(mesh.geometry.index.array), [3, 4, 5, 6, 7, 8]);
  assert.equal(geometry.index.count, 9);
  assert.deepEqual(mesh.geometry.attributes.position.array, geometry.attributes.position.array);
});

test('native cliff clipping accepts an empty group and rejects missing profiles', () => {
  assert.equal(clipMountainAperture(new T.Group(), new T.Matrix4(), volume, mouths), 0);
  assert.throws(() => clipMountainAperture(new T.Group(), new T.Matrix4(), {}, mouths), /requires scanned cave profiles/);
});

test('whole scanned floor triangles straddling the exit survive centroid clipping, without retaining deeper backing floors', () => {
  const root = new T.Group(), geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-.3, 0, 1.7, .3, 0, 1.7, 0, 0, 2.1, -.3, 0, .5, .3, 0, .5, 0, 0, .9], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const mesh = new T.Mesh(geometry); mesh.name = 'native-mountain'; root.add(mesh);
  assert.equal(clipMountainAperture(root, new T.Matrix4(), volume, mouths), 1);
  assert.deepEqual(Array.from(mesh.geometry.index.array), [0, 1, 2]);
  assert.equal(geometry.index.count, 6);
});
