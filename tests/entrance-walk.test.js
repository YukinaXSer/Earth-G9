import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { colliderContains } from '../src/captured-collisions.js';
import { groundHeight, mainTrailX, START } from '../src/data.js';
import { ENTRANCE_YAW } from '../src/wayfinding.js';
import { ENTRANCE_FOREST } from '../src/forest-layout.js';
import { Habitat } from '../src/habitat.js';

test('entrance scanned eye-level wood is solid without old banyan, rock or invisible root walls', async () => {
  const bytes = fs.readFileSync(new URL('../public/models/near-forest-trunk.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let geometry;
  gltf.scene.traverse(mesh => { if (mesh.isMesh) geometry = mesh.geometry; });
  const placed = [], variants = Array.from({ length: 4 }, () => {
    const group = new THREE.Group(); group.userData = { spread: 1, height: 1 };
    group.add(new THREE.Mesh(new THREE.BoxGeometry(.2, 1, .2)));
    return group;
  });
  const habitat = new Habitat({ colliders: [], rand: () => assert.fail('entrance planting must not advance the shared random stream') });
  habitat.models = { get: () => variants };
  habitat.nearTrunks.geometry = geometry;
  const place = habitat.place.bind(habitat);
  habitat.place = (...args) => { placed.push(args); return place(...args); };
  habitat.world.colliders.push(...Habitat.prototype.composeEntranceForest.call(habitat));
  assert.equal(habitat.lodTrees.length, ENTRANCE_FOREST.trees.length);
  assert.equal(placed.filter(([key]) => key === 'distant').length, ENTRANCE_FOREST.trees.length);
  assert.ok(placed.every(([key]) => !['banyan', 'rooted', 'rooted-far', 'rock'].includes(key)));
  assert.equal(placed.length, ENTRANCE_FOREST.trees.length + ENTRANCE_FOREST.plants.length);
  assert.equal(habitat.world.colliders.length, ENTRANCE_FOREST.trees.length * 2);
  assert.equal(habitat.world.colliders.filter(c => !c.collisionOnly).length, ENTRANCE_FOREST.trees.length, 'surface broad bounds must not add ground shadows or travel landmarks');
  assert.equal(habitat.world.colliders.filter(c => c.minY === undefined && c.radius < .5).length, ENTRANCE_FOREST.trees.length);
  const blocked = (x, z) => habitat.world.colliders.some(c => colliderContains(c, x, z, .4, groundHeight(x, z)));
  assert.equal(blocked(1.5, 23), false, 'removed board roots must leave no invisible wall');
  assert.equal(blocked(5.2, 23), false, 'former main-tree centre no longer has its solid circle');
  for (const tree of ENTRANCE_FOREST.trees) assert.equal(blocked(tree.x, tree.z), true, 'replacement trunks are solid');
  for (const tree of habitat.lodTrees) {
    const { position } = geometry.attributes, indices = geometry.index, matrix = tree.parts[0].matrix;
    let checked = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const point = new THREE.Vector3();
      for (let j = 0; j < 3; j++) point.add(new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + j)));
      point.divideScalar(3).applyMatrix4(matrix);
      const height = point.y - groundHeight(point.x, point.z);
      if (height < 1.5 || height > 1.85 || Math.hypot(point.x - tree.x, point.z - tree.z) < 1) continue;
      assert.equal(blocked(point.x, point.z), true, 'off-axis eye-level scanned wood must block the player');
      if (++checked === 12) break;
    }
    assert.ok(checked > 0, 'regression must exercise real wood beyond the old tiny cylinder');
  }
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
    nearTrunks: { geometry: model.children[0].geometry },
    composeEntranceForest: Habitat.prototype.composeEntranceForest,
    backgroundTree: (x, z, scale, angle) => habitat.place('distant', x, z, scale, angle), composeBackground() {}, composeForest() {},
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
