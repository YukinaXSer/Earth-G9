import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { colliderContains } from '../src/captured-collisions.js';
import { groundHeight, mainTrailX, START } from '../src/data.js';
import { ENTRANCE_YAW } from '../src/wayfinding.js';
import { ENTRANCE_FOREST } from '../src/forest-layout.js';
import { Habitat } from '../src/habitat.js';

test('entrance uses ordinary forest LOD and plants, with no old banyan, rock or invisible root collider', () => {
  const placed = [], variants = Array.from({ length: 4 }, () => ({ userData: { spread: 1, height: 1 } }));
  const habitat = {
    world: { colliders: [], rand: () => assert.fail('entrance planting must not advance the shared random stream') },
    models: { get: () => variants }, lodTrees: [],
    backgroundTree: Habitat.prototype.backgroundTree,
    place: (...args) => { placed.push(args); return [{ matrix: new THREE.Matrix4() }]; },
  };
  Habitat.prototype.composeEntranceForest.call(habitat);
  assert.equal(habitat.lodTrees.length, ENTRANCE_FOREST.trees.length);
  assert.equal(placed.filter(([key]) => key === 'distant').length, ENTRANCE_FOREST.trees.length);
  assert.ok(placed.every(([key]) => !['banyan', 'rooted', 'rooted-far', 'rock'].includes(key)));
  assert.equal(placed.length, ENTRANCE_FOREST.trees.length + ENTRANCE_FOREST.plants.length);
  assert.equal(habitat.world.colliders.length, ENTRANCE_FOREST.trees.length);
  assert.ok(habitat.world.colliders.every(c => c.radius < .5 && !c.parts));
  const blocked = (x, z) => habitat.world.colliders.some(c => colliderContains(c, x, z, .4, groundHeight(x, z)));
  assert.equal(blocked(1.5, 23), false, 'removed board roots must leave no invisible wall');
  assert.equal(blocked(5.2, 23), false, 'former main-tree centre no longer has its solid circle');
  for (const tree of ENTRANCE_FOREST.trees) assert.equal(blocked(tree.x, tree.z), true, 'replacement trunks are solid');
  for (let distance = 0; distance < 35.5; distance += .1) {
    const x = START.x - Math.sin(ENTRANCE_YAW) * distance, z = START.z - Math.cos(ENTRANCE_YAW) * distance;
    assert.equal(blocked(x, z), false, `fresh forward position ${x},${z}`);
    assert.equal(blocked(mainTrailX(z), z), false, `trail centre at ${z}`);
  }
});

test('full habitat composition does not place the retired entrance banyan or either legacy root collider', () => {
  const model = new THREE.Group(), placed = [];
  model.userData = { spread: 1, height: 1 };
  model.add(new THREE.Mesh(new THREE.BoxGeometry(.2, 1, .2)));
  const habitat = {
    world: { colliders: [], rand: (a, b) => (a + b) / 2 },
    models: { get: () => [model, model, model, model] },
    composeEntranceForest: Habitat.prototype.composeEntranceForest,
    backgroundTree() {}, composeBackground() {}, composeForest() {},
    place: (...args) => {
      placed.push(args);
      const [, x, z, scale = 1, angle = 0] = args;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(scale, scale, scale));
      return [{ matrix, batch: { part: model.children[0] } }];
    },
  };
  Habitat.prototype.compose.call(habitat);
  assert.ok(placed.every(([key]) => key !== 'banyan'));
  assert.ok(habitat.world.colliders.every(c => c.x !== 5.2 || c.z !== 23));
});
