import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMountainRockCover, rockRouteClearance } from '../src/cave/cave-rock-cover.js';
import { CaveLink } from '../src/cave/cave-link.js';
import { loadProductionMountain } from './production-mountain-fixture.js';
import data from '../src/cave/cave-data.json' with { type: 'json' };

const link = new CaveLink({ scene: new T.Scene() }), material = new T.MeshStandardMaterial({ side: T.DoubleSide });
const bytes = readFileSync(new URL('../public/models/moss-rock.glb', import.meta.url)), length = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + length));
delete document.images; delete document.textures; delete document.materials;
for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material;
const json = Buffer.from(JSON.stringify(document)), padding = Buffer.alloc((4 - json.length % 4) % 4, 32), header = Buffer.alloc(20);
[0x46546c67, 2, 20 + json.length + padding.length + bytes.length - 20 - length, json.length + padding.length, 0x4e4f534a].forEach((value, i) => header.writeUInt32LE(value, i * 4));
const glb = Buffer.concat([header, json, padding, bytes.subarray(20 + length)]);
const { scene } = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
scene.updateMatrixWorld(true);
const variants = scene.children.map(child => {
  const group = new T.Group(), box = new T.Box3().setFromObject(child), center = box.getCenter(new T.Vector3());
  child.traverse(mesh => { if (mesh.isMesh) group.add(new T.Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).translate(-center.x, -box.min.y, -center.z), material)); });
  return group;
});
const models = new Map([['rock', variants]]);
const fit = JSON.parse(readFileSync(new URL('../public/cave/mouth-fit.json', import.meta.url), 'utf8'));
const native = await loadProductionMountain(link, fit, data.mouths);
after(() => native.dispose());

test('shipped scanned boulder covers A/B, is buried, and its entire footprint clears the 1.2 m route', () => {
  const route = structuredClone(link.route), mouth = structuredClone(link.mouths[1]), source = variants[3].children[0], positions = source.geometry.attributes.position.array.slice();
  const cover = createMountainRockCover(models, link.mouths[1], link.route, (x, z) => link.mountain.groundHeight(x, z), material);
  assert.equal(cover.children.length, 1); cover.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(cover);
  assert.ok(box.min.y <= link.mountain.groundHeight(cover.children[0].position.x, cover.children[0].position.z) - .35 + 1e-6);
  assert.ok(rockRouteClearance(box, link.route) >= 1.2);
  const eye = new T.Vector3(67.66670958693521, 2.197335113964226, -346.51420778755266);
  for (const target of [[74.35775465, 1.00021869, -347.74752216], [74.64734393, .83715196, -347.20352213]]) {
    const direction = new T.Vector3(...target).sub(eye), distance = direction.length();
    const hits = new T.Raycaster(eye, direction.normalize(), 0, distance).intersectObject(cover, true);
    assert.ok(hits.length, `Uncovered shard ${target}`);
  }
  const camera = new T.PerspectiveCamera(60, 1.6, .1, 220); camera.position.copy(eye);
  camera.quaternion.set(.01069002016223082, -.7915946606256361, .01385432088508169, .6107959352604831); camera.updateMatrixWorld();
  for (const [x, y, distance] of [[250, 448, 6.90827302], [278, 451, 6.94323231], [285, 445, 7.02823615], [305, 455, 7.14524375], [245, 440, 12.99498735], [265, 410, 16.11792413], [265, 430, 13.80900216]]) {
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x / 512 - 1, 1 - y / 320), camera); ray.far = Math.min(9, distance - .005);
    assert.ok(ray.intersectObject(cover, true).length, `Uncovered still pixel ${x},${y}`);
  }
  const mesh = cover.children[0].children[0];
  assert.notEqual(mesh.geometry, source.geometry); assert.equal(mesh.material, material);
  assert.equal(mesh.geometry.attributes.caveGranite.getX(0), 1);
  assert.deepEqual(source.geometry.attributes.position.array, positions);
  assert.equal(source.geometry.attributes.caveGranite, undefined);
  assert.deepEqual(link.route, route); assert.deepEqual(link.mouths[1], mouth); assert.equal(cover.userData.colliders, undefined);
});

test('cover is omitted for missing scans or unsupported terrain', () => {
  assert.equal(createMountainRockCover(new Map(), link.mouths[1], link.route, () => 0, material).children.length, 0);
  for (const height of [null, NaN, Infinity]) assert.equal(createMountainRockCover(models, link.mouths[1], link.route, () => height, material).children.length, 0);
  assert.throws(() => createMountainRockCover(models, null, [], null, null), TypeError);
});

test('route clearance detects crossing, diagonal proximity, endpoint and repeated route points', () => {
  const box = new T.Box3(new T.Vector3(-1, 0, -1), new T.Vector3(1, 2, 1));
  assert.equal(rockRouteClearance(box, [[-3, 0, 0], [3, 0, 0]]), 0);
  assert.equal(rockRouteClearance(box, [[3, 0, 0], [3, 0, 0]]), 2);
  assert.equal(rockRouteClearance(box, [[0, 0, 0], [0, 0, 0]]), 0);
  assert.ok(Math.abs(rockRouteClearance(box, [[2, 0, 2], [4, 0, 4]]) - Math.SQRT2) < 1e-9);
});

test('visual cover attaches after collision construction without entering collider or floor indices', () => {
  const source = readFileSync(new URL('../src/cave/cave-link.js', import.meta.url), 'utf8');
  const start = source.indexOf('const cover = createMountainRockCover'), end = source.indexOf("this.phase = 'upload-mountain'", start);
  assert.ok(start > 0 && end > start);
  assert.ok(source.slice(start, end).includes('this.dressing.add(cover)'));
  assert.ok(source.indexOf('await warmCaveAssets({ root: cover', start) < source.indexOf('this.dressing.add(cover)', start));
  assert.doesNotMatch(source.slice(start, end), /dressingIndex|floor\.cells|colliders/);
});
