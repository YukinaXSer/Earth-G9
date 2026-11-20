import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { findBirdPerch, crabBank } from '../src/wildlife.js';
import { poseCritter } from '../src/ground-critters.js';
import { groundHeight, RIVER_LEVEL } from '../src/data.js';

test('the entrance bird has a real captured-root surface near eye level', () => {
  const bytes = readFileSync(new URL('../public/models/captured-banyan-low.glb', import.meta.url));
  const length = bytes.readUInt32LE(12), model = JSON.parse(bytes.subarray(20, 20 + length));
  const binary = bytes.subarray(28 + length);
  const attribute = (id, size) => {
    const accessor = model.accessors[id], view = model.bufferViews[accessor.bufferView];
    const width = accessor.componentType === 5123 ? 2 : 4;
    const method = accessor.componentType === 5126 ? 'readFloatLE' : width === 2 ? 'readUInt16LE' : 'readUInt32LE';
    return (i, component = 0) => binary[method]((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? size * width) + component * width);
  };
  const primitive = model.meshes[0].primitives[0];
  const position = attribute(primitive.attributes.POSITION, 3), index = attribute(primitive.indices, 1);
  const positions = Array.from({ length: model.accessors[primitive.attributes.POSITION].count * 3 }, (_, i) => position(Math.floor(i / 3), i % 3));
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(Array.from({ length: model.accessors[primitive.indices].count }, (_, i) => index(i)));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, center = box.getCenter(new THREE.Vector3()), scale = 12 / (box.max.y - box.min.y);
  geometry.translate(-center.x, -box.min.y, -center.z).scale(scale, scale, scale);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const source = new THREE.Group().add(new THREE.Mesh(geometry, material));
  const support = new THREE.InstancedMesh(geometry, material, 1);
  support.setMatrixAt(0, new THREE.Matrix4().makeRotationY(2.8).setPosition(5.2, groundHeight(5.2, 23) - .85, 23));
  const world = { scene: new THREE.Scene().add(support), habitat: { models: new Map([['banyan', [source]]]), cells: [support] } };
  const perch = findBirdPerch(world);
  assert.ok(perch);
  const height = perch.y - groundHeight(perch.x, perch.z);
  assert.ok(height >= 1.3 && height <= 1.8);
  const bird = { kind: 'tanager', x: perch.x, z: perch.z, perch, scale: 1.2, group: new THREE.Group() };
  for (let t = 0; t < 20; t += .1) {
    poseCritter(bird, t);
    assert.ok(bird.group.position.y >= perch.y);
    assert.equal(bird.group.position.x, perch.x);
    assert.equal(bird.group.position.z, perch.z);
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
