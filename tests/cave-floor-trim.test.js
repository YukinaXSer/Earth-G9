import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mountainFloorFaces } from '../scripts/trim-mountain-floor.mjs';
import { createCaveMaterial, setMountainFloorGround } from '../src/cave/cave-material.js';
import { CaveFloorIndex } from '../src/cave/cave-space.js';

const route = [[0, 0, -10], [0, 0, 0]], mouth = { floorCenter: [0, 0, 0], outward: [0, 0, 1] };
const floor = (x, y = 0, z = -1) => [x, y, z, x, y, z + .3, x + .2, y, z];

test('mountain trim deletes low flat sheets on either flank, but retains the corridor, walls, roof and deeper floor', () => {
  const faces = [floor(1), floor(-1.3), floor(-.1), floor(1, 1.3), floor(1, 0, -4), [1, 0, -1, 1, 2, -1, 1, 0, -.5], [1, 0, -1, 1.2, 0, -1, 1, 0, -.7]];
  const positions = new Float32Array(faces.flat()), indices = new Uint32Array(Array.from({ length: faces.length * 3 }, (_, i) => i));
  assert.deepEqual(mountainFloorFaces(positions, indices, route, mouth), [0, 1]);
  assert.deepEqual(mountainFloorFaces(new Float32Array(), new Uint32Array(), route, mouth), []);
  assert.throws(() => mountainFloorFaces(positions, indices, [], mouth), TypeError);
  assert.throws(() => mountainFloorFaces(positions, indices.subarray(1), route, mouth), TypeError);
});

test('past the seam only the low corridor floor is exempt, regardless of wall orientation', () => {
  const faces = [floor(1, 3, .2), floor(-.1, 0, .2), [1, 0, .2, 1, 2, .2, 1, 0, .5]], positions = new Float32Array(faces.flat());
  assert.deepEqual(mountainFloorFaces(positions, new Uint32Array(Array.from({ length: 9 }, (_, i) => i)), route, mouth), [0, 2]);
});

test('reviewed flat neighbours extend the band only locally and never consume the corridor', () => {
  const positions = new Float32Array([1, 0, -4, 1, 0, -3.7, 1.2, 0, -4, 1.2, 0, -3.7, 0, 0, -4]);
  const indices = new Uint32Array([0, 1, 2, 1, 3, 2, 0, 4, 1]);
  assert.deepEqual(mountainFloorFaces(positions, indices, route, mouth), []);
  assert.deepEqual(mountainFloorFaces(positions, indices, route, mouth, [0]), [0, 1]);
  assert.throws(() => mountainFloorFaces(positions, indices, route, mouth, [3]), RangeError);
});

test('floor-sheet height is measured from the actual walking floor rather than the route guide', () => {
  const positions = new Float32Array([-.2, .3, -2, -.2, .3, 0, .2, .3, -2, .2, .3, 0, ...floor(1, 1.4)]), indices = new Uint32Array([0, 1, 2, 1, 3, 2, 4, 5, 6]);
  assert.deepEqual(mountainFloorFaces(positions, indices, route, mouth), [2]);
});

test('floor triangles crossing the protected strip survive even when every vertex lies outside it', () => {
  const positions = new Float32Array([-1, 0, -.1, 0, 0, 1, 1, 0, -.1]);
  assert.deepEqual(mountainFloorFaces(positions, new Uint32Array([0, 1, 2]), route, mouth), []);
  positions[7] = 3.6;
  assert.deepEqual(mountainFloorFaces(positions, new Uint32Array([0, 1, 2]), route, mouth), []);
});

test('committed fitted body has no remaining triangles matching the mountain floor-sheet rule', async () => {
  const data = JSON.parse(readFileSync(new URL('../src/cave/cave-data.json', import.meta.url))), bytes = readFileSync(new URL('../public/cave/cave-fitted.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  scene.updateMatrixWorld(true);
  const mesh = scene.getObjectByProperty('isMesh', true), p = mesh.geometry.attributes.position, positions = new Float32Array(p.count * 3), point = new T.Vector3();
  for (let i = 0; i < p.count; i++) point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
  assert.deepEqual(mountainFloorFaces(positions, mesh.geometry.index.array, data.route, data.mouths[1]), []);
  const floor = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)).setIndex(mesh.geometry.index), data.route);
  const height = floor.heightAt(-.266296592, 96.338121849);
  assert.ok(Number.isFinite(height) && Math.abs(height - .06988) < .001, 'Keep the walking floor at the seam corner, 0.6 m off the route');
});

test('mountain floor fade reuses the existing ground map and frame over the last metre only', () => {
  const sets = Array.from({ length: 4 }, () => ({ color: new T.Texture(), normal: new T.Texture(), roughness: new T.Texture() }));
  const material = createCaveMaterial(sets), shader = { ...T.ShaderLib.standard, uniforms: {} }, texture = new T.Texture(), worldToLocal = new T.Matrix4().makeTranslation(3, 0, 5);
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.caveGroundEnabled.value, 0);
  setMountainFloorGround(material, { texture, worldToLocal, metres: 2.14 });
  assert.equal(shader.uniforms.caveMountainGround.value, texture);
  assert.equal(shader.uniforms.caveGroundEnabled.value, 1);
  assert.deepEqual(shader.uniforms.caveGroundWorldToLocal.value.elements, worldToLocal.elements);
  assert.notEqual(shader.uniforms.caveGroundWorldToLocal.value, worldToLocal);
  assert.match(shader.fragmentShader, /caveFloor \* smoothstep\(caveRouteLength - 1\.0, caveRouteLength, vCaveRoute \* caveRouteLength\)/);
  assert.match(shader.fragmentShader, /vec2\(groundPoint.x, -groundPoint.z\)/);
  assert.ok(shader.fragmentShader.indexOf('float caveGroundFade') > shader.fragmentShader.indexOf('vec3 macroTint'));
  for (const options of [{}, { texture, worldToLocal, metres: 0 }, { texture, worldToLocal, metres: Infinity }, { texture, worldToLocal, metres: 2, reflectance: -1 }]) assert.throws(() => setMountainFloorGround(material, options), TypeError);
  material.dispose(); texture.dispose(); sets.forEach(s => Object.values(s).forEach(t => t.dispose()));
});
