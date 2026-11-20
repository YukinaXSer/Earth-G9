import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { poseButterfly } from '../src/wildlife.js';
import { groundHeight } from '../src/data.js';

function butterfly(resting) {
  const group = new THREE.Group();
  const wings = ['left', 'right'].flatMap(side => ['up', 'under'].map(part => {
    const wing = new THREE.Group(); wing.name = `wing-${side}-${part}`; group.add(wing); return wing;
  }));
  return { group, wings, x: -6, z: -31, seed: 2, resting };
}

test('resting sourced butterfly stays on the leaf while its left and right wings articulate', () => {
  const insect = butterfly(true), leaf = new THREE.Vector3(-6.2, 1.3, -30.9);
  for (const time of [0, 1, 5, 20]) {
    poseButterfly(insect, time, leaf);
    assert.ok(insect.group.position.equals(leaf));
    assert.equal(insect.wings[0].rotation.z, -insect.wings[2].rotation.z);
    assert.ok(Math.abs(insect.wings[0].rotation.z) < 1.1);
  }
});

test('flying butterflies retain their local habitat and safe height during bounded flight', () => {
  const insect = butterfly(false);
  for (let time = 0; time < 100; time += .2) {
    poseButterfly(insect, time);
    assert.ok(Math.hypot(insect.group.position.x - insect.x, insect.group.position.z - insect.z) < 1.1);
    assert.ok(insect.group.position.y > groundHeight(insect.x, insect.z) + 1.3);
    assert.equal(insect.wings[0].rotation.z, -insect.wings[2].rotation.z);
  }
});
