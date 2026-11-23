import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { prepareForestLOD, useCapturedForestLOD, useLowMountainMaterials, useLowTextureFiltering } from '../src/cave/cave-low-tier.js';

test('forest LOD prepares UV-preserving geometry off-scene and applies without changing photographs or instances', () => {
  const original = new T.BoxGeometry(), coarse = new T.PlaneGeometry(), material = new T.MeshLambertMaterial({ map: new T.Texture() });
  const template = new T.Group(); template.add(new T.Mesh(original, material));
  const cell = new T.InstancedMesh(original, material, 3), root = new T.Group(), lod = new T.Mesh(coarse);
  lod.name = 'fern__0__0'; root.add(lod);
  const habitat = { models: new Map([['fern', [template]]]), cells: [cell] };
  const apply = prepareForestLOD(habitat, root);
  assert.equal(cell.geometry, original); assert.equal(lod.material, material);
  assert.deepEqual(coarse.boundingSphere, original.boundingSphere);
  assert.equal(apply(), 2); assert.equal(cell.geometry, coarse); assert.equal(template.children[0].geometry, coarse);
  assert.equal(cell.count, 3); assert.equal(cell.material.map, material.map); assert.equal(apply(), 0);
  assert.equal(prepareForestLOD({ models: new Map(), cells: [] }, new T.Group())(), 0);
  assert.throws(() => prepareForestLOD(null, root), TypeError);
  const invalid = new T.Mesh(new T.BufferGeometry()); invalid.name = 'fern__0__0';
  assert.throws(() => prepareForestLOD(habitat, new T.Group().add(invalid)), /missing position/);
});

test('low-tier capture reuses the loaded, UV-compatible far scan without changing transforms or materials', () => {
  const near = new T.Group(), far = new T.Group(), original = new T.BoxGeometry(), coarse = new T.SphereGeometry(1, 4, 2);
  const material = new T.MeshBasicMaterial();
  near.add(new T.Mesh(original, material)); far.add(new T.Mesh(coarse, material));
  const cell = new T.InstancedMesh(original, material, 1), other = new T.Mesh();
  const habitat = { models: new Map([['rooted', [near]], ['rooted-far', [far]]]), cells: [cell, other] };
  const transform = cell.matrix.clone();
  assert.equal(useCapturedForestLOD(habitat), 1);
  assert.equal(cell.geometry, coarse); assert.equal(cell.material, material); assert.deepEqual(cell.matrix, transform);
  assert.equal(useCapturedForestLOD(habitat), 0);
  assert.equal(useCapturedForestLOD(null), 0);
  assert.equal(useCapturedForestLOD({ models: new Map() }), 0);
});

test('low-tier mountain keeps photographed maps and macro mapping with diffuse near and unlit distant terrain', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial(), untouched = new T.MeshStandardMaterial();
  material.customProgramCacheKey = () => 'xianxia-native-photo-shared-pbr-v5';
  material.onBeforeCompile = shader => { shader.fragmentShader += 'float detailFade=1.-smoothstep(.0125,.04,max(length(px),length(py)));'; };
  material.map = new T.Texture(); material.map.anisotropy = 8;
  const distant = new T.Mesh(new T.BoxGeometry(), material); distant.name = 'native-mountain-far';
  root.add(new T.Mesh(new T.BoxGeometry(), material), new T.Mesh(new T.BoxGeometry(), untouched), distant);
  useLowMountainMaterials(root);
  const near = root.children[0].material;
  assert.ok(near.isMeshLambertMaterial); assert.ok(distant.material.isMeshBasicMaterial);
  assert.equal(near.map, material.map); assert.equal(near.map.anisotropy, 1);
  const shader = { fragmentShader: 'macro photos;' }; near.onBeforeCompile(shader);
  assert.equal(shader.fragmentShader, 'macro photos;float detailFade=0.;');
  assert.match(near.customProgramCacheKey(), /cave-low-0$/);
  useLowMountainMaterials(root); assert.equal(root.children[0].material, near);
  assert.doesNotThrow(() => useLowMountainMaterials(new T.Group()));
  assert.doesNotThrow(() => useLowTextureFiltering([null, {}]));
  assert.doesNotThrow(() => useLowTextureFiltering());
});

test('low-tier static mountain vegetation merges existing triangles and keeps custom-render surfaces separate', () => {
  const root = new T.Group(), props = new T.Group(), material = new T.MeshStandardMaterial({ map: new T.Texture() });
  root.add(props);
  for (let i = 0; i < 20; i++) { const mesh = new T.Mesh(new T.PlaneGeometry(), material); mesh.position.x = i * 2; props.add(mesh); }
  const rock = new T.Mesh(new T.BoxGeometry(), material); rock.onBeforeRender = () => {}; props.add(rock);
  useLowMountainMaterials(root);
  assert.equal(props.children.length, 2); assert.ok(props.children.includes(rock));
  const batch = props.getObjectByName('Low-tier merged photographed vegetation');
  assert.equal(batch.geometry.index.count, 20 * 6); assert.equal(batch.material.map, material.map);
  batch.geometry.computeBoundingBox(); assert.equal(batch.geometry.boundingBox.max.x, 38.5);
  useLowMountainMaterials(root); assert.equal(props.children.length, 2);
});
