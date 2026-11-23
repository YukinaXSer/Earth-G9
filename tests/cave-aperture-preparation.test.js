import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CaveLink } from '../src/cave/cave-link.js';
import { CaveFloorIndex } from '../src/cave/cave-space.js';
import { prepareCavePhysics } from '../src/cave/cave-physics.js';
import { MOUNTAIN_ENTRANCE } from '../src/xianxia-mountain.js';
import { loadProductionMountain } from './production-mountain-fixture.js';
import data from '../src/cave/cave-data.json' with { type: 'json' };

const baseline = ['96f4345160ed1f50f2145cbf28bd884ca369e4e8806f776e18186f2659b419ea', 'b6e62c6aa711256c69740ad63f3dcdaf5cdf5ad5a6679ea1e29dfe384ec50423', '058dba83b4dfc6eeeea64162a5bd02df6c6dea59d7a03adc0b93e4f546aa671b', '96f4345160ed1f50f2145cbf28bd884ca369e4e8806f776e18186f2659b419ea'];
async function parse(name) {
  const b = readFileSync(new URL('../public/cave/' + name + '.glb', import.meta.url));
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene;
}

test('cooperative production aperture indices remain byte-identical to 8f186c4 at all four initial tile placements', async () => {
  const link = new CaveLink({ lowDetail: true }), body = await parse('cave-fitted'); body.updateMatrixWorld(true);
  const mesh = body.getObjectByProperty('isMesh', true), v = new T.Vector3(), positions = new Float32Array(mesh.geometry.attributes.position.count * 3);
  for (let i = 0; i < positions.length / 3; i++) v.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(link.transform).toArray(positions, i * 3);
  const physical = prepareCavePhysics({ positions, indices: new Uint32Array(mesh.geometry.index.array), route: link.route, mouths: link.mouths, grade: MOUNTAIN_ENTRANCE.approach.grade, prepared: true });
  link.floor = Object.assign(Object.create(CaveFloorIndex.prototype), physical.floor);
  for (const name of ['mouth-forest', 'mouth-mountain']) {
    const mouth = await parse(name), values = []; mouth.applyMatrix4(link.transform); mouth.updateMatrixWorld(true);
    mouth.traverse(m => { if (m.isMesh) for (const i of m.geometry.index.array) v.fromBufferAttribute(m.geometry.attributes.position, i).applyMatrix4(m.matrixWorld).toArray(values, values.length); });
    const floor = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(values, 3)), link.route);
    for (const [key, triangles] of floor.cells) {
      if (!link.floor.cells.has(key)) link.floor.cells.set(key, []);
      link.floor.cells.get(key).push(...triangles.filter(t => t.floor));
    }
  }
  const fit = JSON.parse(readFileSync(new URL('../public/cave/mouth-fit.json', import.meta.url)));
  const native = await loadProductionMountain(link, fit, data.mouths, { clipAperture: false });
  try {
    const hashes = []; let yields = 0;
    for (const root of link.mountain.group.children) {
      if (!root.getObjectByName('native-mountain')) continue;
      await link.prepareMountainMeshesAsync(root, async () => { yields++; await new Promise(setImmediate); });
      const hash = createHash('sha256');
      root.traverse(m => { if (m.isMesh) { hash.update(m.name); if (m.geometry.index) hash.update(Buffer.from(m.geometry.index.array.buffer, m.geometry.index.array.byteOffset, m.geometry.index.array.byteLength)); } });
      hashes.push(hash.digest('hex'));
    }
    assert.deepEqual(hashes, baseline);
    assert.ok(yields > 0);
    console.log('Cooperative aperture selection: byte-identical to 8f186c4 for all four initial production tiles');
  } finally { native.dispose(); }
});
