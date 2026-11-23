import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { enableCaveShadows } from '../src/cave/cave-shadows.js';

test('player-following low-tier sun shadow projection covers the mouth, not the default five-metre box', () => {
  const scene = new T.Scene(), sun = new T.DirectionalLight();
  const host = { renderer: { shadowMap: { enabled: false } }, sun, lowDetail: true };
  scene.add(sun, sun.target);
  sun.position.set(-24, 30, 12);
  enableCaveShadows(host);
  scene.updateMatrixWorld(true); sun.shadow.updateMatrices(sun);
  const camera = sun.shadow.camera;
  for (const x of [-3, 0, 3]) for (const y of [0, 4, 8]) for (const z of [-15, -9, -4]) {
    const p = new T.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) <= 1, `${x},${y},${z} outside shadow projection`);
  }
  assert.ok(host.renderer.shadowMap.enabled && sun.castShadow);
  assert.equal(sun.shadow.mapSize.x, 256);
});
