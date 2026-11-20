import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { capturedCollider, colliderContains, createColliderIndex } from '../src/captured-collisions.js';
import { Rainforest } from '../src/world.js';

test('captured wood uses transformed surface columns without blocking air gaps or overhead branches', () => {
  const tree = new THREE.Group(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-2, 0, 0, -2, 7, 0, -2, 0, 1, 2, 4, 0, 2, 4, 1, 3, 4, 0], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]); tree.add(new THREE.Mesh(geometry));
  const matrix = new THREE.Matrix4().makeTranslation(10, -1.3, 20), collider = capturedCollider(tree, matrix);
  assert.ok(colliderContains(collider, 8, 20.3, .4, 0));
  assert.ok(!colliderContains(collider, 10, 20.3, .4, 0));
  assert.ok(!colliderContains(collider, 12.2, 20.3, .4, 0));
  assert.ok(colliderContains(collider, 12.2, 20.3, .4, 1));
  const rotated = capturedCollider(tree, new THREE.Matrix4().makeRotationY(Math.PI / 2));
  assert.ok(colliderContains(rotated, .3, 2, .4, 1));
  assert.ok(colliderContains({ x: 0, z: 0, radius: 1 }, 0, 0, .4, 10));
});

test('a saved or map position inside newly captured wood recovers to nearby clear land', () => {
  const world = { position: new THREE.Vector3(0, 0, 15), colliders: [{ x: 0, z: 15, radius: 3 }] };
  Rainforest.prototype.recoverPosition.call(world);
  assert.ok(!colliderContains(world.colliders[0], world.position.x, world.position.z));
  assert.ok(world.position.distanceTo(new THREE.Vector3(0, 0, 15)) <= 4);
  const recovered = world.position.clone();
  Rainforest.prototype.recoverPosition.call(world);
  assert.ok(world.position.equals(recovered));
});

test('spatial broad phase preserves full collision results across cell boundaries and wood air gaps', () => {
  const colliders = [{ x: -16, z: 0, radius: 3 }, { x: 16, z: -16, radius: 4, parts: [{ x: 14, z: -17, radius: .4, minY: 2, maxY: 3 }] }];
  const index = createColliderIndex(colliders);
  for (let z = -25; z <= 10; z += .73) for (let x = -25; x <= 25; x += .91) for (const floor of [0, 1.8]) {
    assert.equal(index.query(x, z).some(c => colliderContains(c, x, z, .4, floor)), colliders.some(c => colliderContains(c, x, z, .4, floor)));
  }
  assert.equal(index.query(100, 100).length, 0);
});

test('a late animal collider updates the spatial index and cannot trap a player already at its position', () => {
  const world = { position: new THREE.Vector3(-1.9, 0, 30), colliders: [], colliderIndex: createColliderIndex([]) };
  world.recoverPosition = () => Rainforest.prototype.recoverPosition.call(world);
  const collider = { x: -1.9, z: 30, radius: .2 };
  Rainforest.prototype.addCollider.call(world, collider);
  assert.ok(world.colliderIndex.query(-1.9, 30).includes(collider));
  assert.ok(!colliderContains(collider, world.position.x, world.position.z));
  assert.ok(world.position.distanceTo(new THREE.Vector3(-1.9, 0, 30)) <= 1.01);
});
