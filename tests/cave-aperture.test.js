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

test('native floor retention uses normal angle at every triangle size and preserves whole handoff-crossing faces', () => {
  for (const size of [.0001, .01, .3]) {
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-size, 0, .8 - size, size, 0, .8 - size, 0, 0, .8 + size], 3)).setIndex([0, 1, 2]);
    const mesh = new T.Mesh(geometry); mesh.name = 'native-mountain';
    const root = new T.Group(); root.add(mesh);
    assert.equal(clipMountainAperture(root, new T.Matrix4(), volume, mouths, { nativeCliff: true, floorHandoff: { along: .8 } }), 0);
    assert.equal(mesh.geometry.index.count, 3);
  }
});

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

test('native cliff keeps photographed shader callbacks without sharing the exit clipping plane', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial();
  material.onBeforeCompile = shader => { shader.uniforms.nativePhoto = { value: 1 }; };
  const cliff = new T.Mesh(new T.BoxGeometry(), material); cliff.name = 'coastal-cliff-04-native-capture';
  const other = new T.Mesh(new T.BoxGeometry(), material); root.add(cliff, other);
  const original = cliff.geometry.index.array.slice();
  const plane = limitMountainToExit(root, mouths[1], { nativeCliff: true });
  assert.notEqual(cliff.material, material);
  assert.equal(cliff.material.onBeforeCompile, material.onBeforeCompile);
  assert.equal(cliff.material.customProgramCacheKey, material.customProgramCacheKey);
  assert.deepEqual(cliff.material.clippingPlanes, []);
  assert.equal(other.material.clippingPlanes[0], plane);
  assert.deepEqual(cliff.geometry.index.array, original);
  assert.doesNotThrow(() => limitMountainToExit(new T.Group(), mouths[1], { nativeCliff: true }));
});

test('native terrain beneath the trimmed floor flanks survives, but corridor backing, deep floors and walls do not', () => {
  const root = new T.Group(), geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([
    .9, 0, .4, 1.1, 0, .4, 1, 0, .8,
    -.1, 0, .4, .1, 0, .4, 0, 0, .8,
    .9, 0, -4, 1.1, 0, -4, 1, 0, -3.6,
    .9, 0, .4, 1.1, 0, .4, 1, 1, .4
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const mesh = new T.Mesh(geometry); mesh.name = 'native-mountain'; root.add(mesh);
  const longVolume = { ...volume, route: [[0, 0, -6], [0, 0, 2]] }, longMouths = [{ ...mouths[0], floorCenter: [0, 0, -6] }, mouths[1]];
  clipMountainAperture(root, new T.Matrix4(), longVolume, longMouths, { nativeCliff: true });
  assert.deepEqual(Array.from(mesh.geometry.index.array), [0, 1, 2]);
  assert.equal(geometry.index.count, 12);
  assert.deepEqual(mesh.geometry.attributes.position.array, geometry.attributes.position.array);
});

test('native cliff opening extends beyond the recessed tube with only whole-triangle deletion', () => {
  const root = new T.Group(), geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-.2, .2, 2.5, .2, .2, 2.5, 0, 1, 2.5, -.2, 0, 2.5, .2, 0, 2.5, 0, 0, 3] , 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const mesh = new T.Mesh(geometry); mesh.name = 'coastal-cliff-04-native-capture'; root.add(mesh);
  const options = { nativeCliff: true, outwardDepth: 1.5 };
  assert.equal(clipMountainAperture(root, new T.Matrix4(), volume, mouths, options), 1);
  assert.deepEqual(Array.from(mesh.geometry.index.array), [3, 4, 5]);
  assert.equal(geometry.index.count, 6);
  assert.deepEqual(mesh.geometry.attributes.position.array, geometry.attributes.position.array);
  assert.equal(clipMountainAperture(new T.Group(), new T.Matrix4(), volume, mouths, options), 0);
  assert.throws(() => clipMountainAperture(root, new T.Matrix4(), volume, mouths, { outwardDepth: -1 }), RangeError);
});
