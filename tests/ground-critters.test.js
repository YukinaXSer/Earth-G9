import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { poseCritter, CRITTERS } from '../src/ground-critters.js';
import { groundHeight } from '../src/data.js';

for (const kind of Object.keys(CRITTERS)) {
  test(`${kind} stays near its spot and on its surface`, () => {
    const critter = { group: new THREE.Group(), kind, x: 3, z: -12, heading: .4, scale: 1.4, seed: 1.3 };
    let still = 0;
    const prev = new THREE.Vector3();
    for (let t = 0; t < 120; t += .1) {
      poseCritter(critter, t);
      const { x, y, z } = critter.group.position;
      assert.ok(Math.hypot(x - 3, z + 12) <= CRITTERS[kind].roam + 1e-9);
      assert.ok(y >= groundHeight(x, z) - 1e-9 && y - groundHeight(x, z) < .1);
      if (critter.group.position.distanceTo(prev) < 1e-6) still++;
      prev.copy(critter.group.position);
    }
    assert.ok(still > 500, 'spends most of the time still, moving in short bursts');
  });
  test(`${kind} model is a small lazy asset`, () => {
    const bytes = readFileSync(new URL(`../public/models/${CRITTERS[kind].url.split('/').pop()}`, import.meta.url));
    assert.ok(bytes.length < 1_000_000);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  });
}

test('perched bird keeps its perch point', () => {
  const perch = new THREE.Vector3(1, 2.4, -5);
  const bird = { group: new THREE.Group(), kind: 'tanager', x: 1, z: -5, perch, scale: 1 };
  for (let t = 0; t < 30; t += .13) {
    poseCritter(bird, t);
    assert.equal(bird.group.position.x, 1); assert.equal(bird.group.position.z, -5);
    assert.ok(bird.group.position.y >= 2.4 && bird.group.position.y < 2.45);
  }
});
