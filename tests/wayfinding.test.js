import test from 'node:test';
import assert from 'node:assert/strict';
import { START, distanceToTrail } from '../src/data.js';
import { ENTRANCE_PATH, ENTRANCE_YAW, entranceGuidance, coversEntrancePath } from '../src/wayfinding.js';
import { Habitat } from '../src/habitat.js';
import * as THREE from 'three';

test('spawn looks into a continuous entrance path leading beyond the banyan to the inner trail', () => {
  assert.ok(ENTRANCE_PATH[0].z > START.z);
  assert.ok(ENTRANCE_PATH.at(-1).z < 0);
  for (const point of ENTRANCE_PATH) {
    assert.ok(distanceToTrail(point.x, point.z) < 1e-9);
    assert.ok(coversEntrancePath(point.x, point.z));
  }
  const guide = entranceGuidance({ ...START, yaw: ENTRANCE_YAW });
  assert.ok(Math.abs(guide.angle) < .05);
  assert.equal(guide.direction, '向前走');
  assert.ok(guide.target.z < START.z);
});

test('foliage clearance accounts for fronds reaching in from outside the path, not just plant centres', () => {
  const { x, z } = ENTRANCE_PATH[3];
  assert.equal(coversEntrancePath(x + 3, z, 2), true);
  assert.equal(coversEntrancePath(x + 5, z, 2), false);
  assert.equal(coversEntrancePath(0, -85, 2), false);
});

test('entrance clearance removes only low foliage placements, not genuine tree wood or vegetation elsewhere', () => {
  const variant = new THREE.Group();
  variant.userData.spread = 4;
  variant.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4)));
  const habitat = { models: new Map(['fern', 'banyan'].map(key => [key, [variant]])), dummy: new THREE.Object3D(), batches: new Map(), nearTrunks: { captureDisabled: true } };
  assert.deepEqual(Habitat.prototype.place.call(habitat, 'fern', 2, 25), []);
  assert.equal(Habitat.prototype.place.call(habitat, 'fern', 8, 25).length, 1);
  assert.equal(Habitat.prototype.place.call(habitat, 'fern', 0, -85).length, 1);
  assert.equal(Habitat.prototype.place.call(habitat, 'banyan', 0, 25).length, 1);
});

test('guidance responds to looking backwards, returning from the side and continuing normal walking', () => {
  const ahead = entranceGuidance({ ...START, yaw: ENTRANCE_YAW });
  const behind = entranceGuidance({ ...START, yaw: ENTRANCE_YAW + Math.PI });
  assert.equal(behind.direction, '转身回到小径');
  assert.ok(Math.abs(Math.abs(behind.angle) - Math.PI) < .05);
  const right = entranceGuidance({ x: 8, z: 30, yaw: 0 });
  assert.equal(right.direction, '向左转');
  assert.equal(right.onPath, false);
  assert.equal(right.target.z, 30);
  const moved = entranceGuidance({ x: 1.3, z: 22, yaw: 0 });
  assert.ok(moved.target.z < ahead.target.z);
  assert.ok(moved.remaining < ahead.remaining);
  assert.equal(entranceGuidance({ x: 0, z: 6, yaw: 0 }).remaining, 1);
  assert.equal(entranceGuidance({ x: 0, z: 5, yaw: 0 }), null);
  assert.equal(entranceGuidance({ x: 0, z: -14, yaw: 0 }), null);
  assert.equal(entranceGuidance({ x: -100, z: 30, yaw: 0 }), null);
});
