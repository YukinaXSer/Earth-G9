import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { findFloorHandoff, floorHandoffHeight, useMountainFloorMaterial } from '../src/cave/cave-floor-handoff.js';
import { CaveLink } from '../src/cave/cave-link.js';

const route = [[0, 0, 0], [0, 0, 4]];
test('handoff selects the first continuously safe suffix rather than an isolated early match', () => {
  const plan = findFloorHandoff(route, () => 0, (x, z) => z >= 1.5 && z < 2 ? .15 : .05);
  assert.equal(plan.along, 2); assert.equal(plan.rampStart, 1.5);
  assert.equal(floorHandoffHeight(plan, route, 0, 1.5, 0, .05), 0);
  assert.ok(Math.abs(floorHandoffHeight(plan, route, 0, 1.75, 0, .05) - .025) < 1e-12);
  assert.equal(floorHandoffHeight(plan, route, 0, 2, null, .05), .05);
  assert.equal(floorHandoffHeight(plan, route, 2, 2, 0, .05), 0);
  assert.equal(floorHandoffHeight(plan, route, 0, 2, 0, null), 0);
});
test('missing terrain or floor does not manufacture a handoff; invalid inputs fail', () => {
  assert.equal(findFloorHandoff(route, () => 0, () => null), null);
  assert.equal(findFloorHandoff(route, () => null, () => 0), null);
  assert.equal(findFloorHandoff(route, () => 0, () => .2), null);
  assert.throws(() => findFloorHandoff([], () => 0, () => 0), TypeError);
  assert.throws(() => findFloorHandoff(route, () => 0, () => 0, { spacing: 0 }), TypeError);
  assert.throws(() => findFloorHandoff([[0, 0, 0], [0, 0, 0]], () => 0, () => 0), RangeError);
});
test('remaining authored floor faces use the complete native shader without changing wall material or source uniforms', () => {
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(new Float32Array(18), 3)).setAttribute('_cave_native_floor', new T.Uint8BufferAttribute([0, 0, 0, 1, 1, 1], 1)).setIndex([0, 1, 2, 3, 4, 5]);
  const cave = new T.MeshStandardMaterial(), native = new T.MeshStandardMaterial({ vertexColors: true }), force = { value: -1 };
  native.onBeforeCompile = shader => { shader.uniforms.forceMaterial = force; shader.fragmentShader = 'native photo normal roughness'; };
  const mesh = new T.Mesh(geometry, cave);
  assert.equal(useMountainFloorMaterial(mesh, { along: 2 }, native), 1);
  assert.equal(mesh.material[0], cave); assert.equal(mesh.material[1].vertexColors, false);
  assert.deepEqual(geometry.groups, [{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }]);
  const shader = { uniforms: {} }; mesh.material[1].onBeforeCompile(shader);
  assert.equal(shader.uniforms.forceMaterial.value, 1); assert.equal(force.value, -1); assert.equal(shader.fragmentShader, 'native photo normal roughness');
  const empty = new T.Mesh(new T.BufferGeometry().setIndex([]).setAttribute('_cave_native_floor', new T.Uint8BufferAttribute([], 1)), cave);
  assert.equal(useMountainFloorMaterial(empty, {}, native), 0);
  assert.throws(() => useMountainFloorMaterial(new T.Mesh(), {}, native), TypeError);
});
test('collision reaches native terrain after the inward handoff while retaining cave wall checks', () => {
  let nativeCalls = 0;
  const link = Object.assign(Object.create(CaveLink.prototype), { route, ready: true, caveAttached: true, mouths: [{ floorCenter: [0, 0, 0], outward: [0, 0, -1] }, { floorCenter: [0, 0, 4], outward: [0, 0, 1] }], floorHandoff: { along: 2, rampStart: 1.5, band: 3 }, regionAt: () => 'cave', floor: { heightAt: () => 0, canMove: () => true }, mountain: { groundHeight: () => .05, canMove: () => { nativeCalls++; return false; } } });
  assert.equal(link.canMove(0, 2.1, 0, 2.2), false); assert.equal(nativeCalls, 1);
  assert.equal(link.canMove(0, 1.2, 0, 1.3), true); assert.equal(nativeCalls, 1);
});
