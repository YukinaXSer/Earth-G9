import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { capturedCollider, colliderContains } from '../src/captured-collisions.js';
import { groundHeight, mainTrailX, START } from '../src/data.js';
import { ENTRANCE_YAW } from '../src/wayfinding.js';

test('fresh forward movement and the visible entrance route avoid the actual captured banyan wood', async () => {
  const source = readFileSync(new URL('../public/models/captured-banyan-low.glb', import.meta.url));
  const jsonLength = source.readUInt32LE(12), json = JSON.parse(source.subarray(20, 20 + jsonLength));
  delete json.images; delete json.textures; delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
  const bin = source.subarray(20 + jsonLength), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + encoded.length + bin.length, 8);
  header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const packed = Buffer.concat([header, encoded, bin]);
  const gltf = await new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const variant = new THREE.Group();
  gltf.scene.traverse(mesh => { if (mesh.isMesh) variant.add(new THREE.Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))); });
  const bounds = new THREE.Box3().setFromObject(variant), centre = bounds.getCenter(new THREE.Vector3()), scale = 12 / (bounds.max.y - bounds.min.y);
  for (const mesh of variant.children) {
    mesh.geometry.translate(-centre.x, -bounds.min.y, -centre.z).scale(scale, scale, scale);
    const p = mesh.geometry.attributes.position, indices = mesh.geometry.index.array, kept = [];
    for (let i = 0; i < indices.length; i += 3) {
      if ([indices[i], indices[i + 1], indices[i + 2]].some(v => p.getY(v) >= .65)) kept.push(indices[i], indices[i + 1], indices[i + 2]);
    }
    mesh.geometry.setIndex(kept);
  }
  const transform = new THREE.Object3D();
  transform.position.set(5.2, groundHeight(5.2, 23) - .85, 23); transform.rotation.y = 2.8; transform.updateMatrix();
  const collider = capturedCollider(variant, transform.matrix);
  const blocked = (x, z) => colliderContains(collider, x, z, .4, groundHeight(x, z)) || Math.hypot(x - 5.2, z - 23) < 2.7;
  assert.equal(blocked(1.5, 23), true, 'real root still blocks the old trail');
  for (let distance = 0; distance < 31; distance += .1) {
    const x = START.x - Math.sin(ENTRANCE_YAW) * distance, z = START.z - Math.cos(ENTRANCE_YAW) * distance;
    assert.equal(blocked(x, z), false, `fresh forward position ${x},${z}`);
    assert.equal(blocked(mainTrailX(z), z), false, `trail centre at ${z}`);
  }
});
