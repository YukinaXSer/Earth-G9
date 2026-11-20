import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { animalPlacements, crabBank } from '../src/wildlife.js';
import { poseCritter } from '../src/ground-critters.js';
import { groundHeight, RIVER_LEVEL } from '../src/data.js';

test('small trail animals stay in the walking corridor and the unaccepted bird is withheld', () => {
  const placements = animalPlacements();
  assert.deepEqual([...new Set(placements.map(p => p.kind))].sort(), ['beetle', 'crab', 'frog', 'iguana']);
  for (const placement of placements.filter(p => ['beetle', 'frog'].includes(p.kind))) {
    const animal = { ...placement, group: new THREE.Group() };
    for (let t = 0; t < 40; t += .1) {
      poseCritter(animal, t);
      const { x, z } = animal.group.position;
      assert.ok(Math.abs(x - Math.sin(z * .06) * 1.4) < .6);
    }
  }
});

test('crab lateral movements stay on the dry shallow shoreline', () => {
  for (const z of [-12, -48]) {
    const { x } = crabBank(z);
    for (const offset of [-.18, 0, .18]) assert.ok(groundHeight(x + offset, z) > RIVER_LEVEL + .04);
  }
});

test('the iguana does not rotate its scanned wooden branch and its cut base stays buried', () => {
  const animal = { kind: 'iguana', x: -1.9, z: 30, heading: .65, groundOffset: -.04, group: new THREE.Group() };
  for (let t = 0; t < 40; t += .1) {
    poseCritter(animal, t);
    assert.equal(animal.group.rotation.y, .65);
    assert.ok(Math.abs(animal.group.position.y - groundHeight(-1.9, 30) + .04) < 1e-8);
  }
});
