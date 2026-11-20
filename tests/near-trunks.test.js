import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { NearTrunks, NEAR_TRUNK_LIMIT, trunkBlend, nearTrunkMaterial } from '../src/near-trunks.js';
import { Habitat } from '../src/habitat.js';

const assets = () => ({ geometry: new THREE.BoxGeometry(), color: new THREE.Texture(), normal: new THREE.Texture() });
function tree(x) {
  const group = new THREE.Group(), material = new THREE.MeshLambertMaterial({ map: new THREE.Texture(), color: '#a9b8a2' });
  material.userData.nearTrunk = true; material.userData.foliageTint = material.color.clone();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial({ alphaTest: .35 })));
  group.position.x = x;
  return { x, z: 0, near: true, group };
}

test('source wood upgrades have a hard active budget, no extra scene nodes, and exact fallback', () => {
  const near = new NearTrunks(), trees = [1, 2, 3, 13].map(tree);
  near.assets = assets();
  let time = 0;
  const update = (x, frames = 30) => { for (let i = 0; i < frames; i++) near.update(new THREE.Vector3(x, 0, 0), trees, time += 1 / 60); };
  const before = trees.map(t => ({ geometry: t.group.children[0].geometry, material: t.group.children[0].material, leaf: t.group.children[1].material }));
  update(0);
  assert.equal(near.active.size, NEAR_TRUNK_LIMIT);
  for (let i = 0; i < 4; i++) {
    const mesh = trees[i].group.children[0];
    assert.equal(mesh.geometry, i < 2 ? near.assets.geometry : before[i].geometry);
    assert.equal(trees[i].group.children.length, 2);
    assert.equal(trees[i].group.children[1].material, before[i].leaf);
    assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
  }
  update(13);
  assert.equal(near.active.size, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(trees[i].group.children[0].geometry, before[i].geometry);
    assert.equal(trees[i].group.children[0].material, before[i].material);
  }
  update(100);
  assert.equal(near.active.size, 0);
  trees.forEach((t, i) => assert.equal(t.group.children[0].geometry, before[i].geometry));
});

test('a displaced stem finishes fading before its slot is reused, in both directions', () => {
  const near = new NearTrunks(), trees = [0, 12, 14].map(tree);
  near.assets = assets();
  let time = 0;
  const update = (x, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      near.update(new THREE.Vector3(x, 0, 0), trees, time += 1 / 60);
      assert.ok(near.active.size <= 2);
    }
  };
  const outgoing = trees[0].group.children[0], incoming = trees[2].group.children[0];
  const geometry = outgoing.geometry, incomingGeometry = incoming.geometry;
  update(5.5, 40);
  const state = near.cache.get(outgoing);
  assert.equal(state.blend.value, 1);
  update(7.2);
  assert.ok(state.blend.value > .9 && state.blend.value < 1);
  assert.equal(outgoing.geometry, near.assets.geometry);
  assert.equal(incoming.geometry, incomingGeometry);
  while (state.blend.value > 0) {
    const previous = state.blend.value;
    update(7.2);
    assert.ok(previous - state.blend.value <= .051);
    assert.equal(outgoing.geometry, state.blend.value > 0 ? near.assets.geometry : geometry);
  }
  assert.ok(near.cache.get(incoming).blend.value < .1);
  update(7.2, 40);
  const entered = near.cache.get(incoming);
  assert.ok(entered.blend.value > .9);
  time += 10;
  const previous = entered.blend.value;
  update(5.5);
  assert.ok(previous - entered.blend.value <= .150001, 'a long frame must not collapse the transition');
  update(5.5, 60);
  assert.equal(entered.blend.value, 0);
  assert.equal(incoming.geometry, incomingGeometry);
  assert.equal(state.blend.value, 1);
});

test('upgrade is lazy and failure leaves the original wood usable', async () => {
  const near = new NearTrunks(), t = tree(1), mesh = t.group.children[0], geometry = mesh.geometry;
  near.update(new THREE.Vector3(50, 0, 0), [t]); assert.equal(near.loading, undefined);
  near.load = async () => { throw new Error('offline'); };
  near.update(new THREE.Vector3(), [t]); await near.loading;
  near.update(new THREE.Vector3(), [t]);
  assert.equal(near.disabled, true); assert.equal(mesh.geometry, geometry); assert.equal(near.active.size, 0);
});

test('the parent forest LOD waits for nonzero wood detail before hiding the near group', () => {
  const near = new NearTrunks(), t = tree(0), mesh = t.group.children[0], original = mesh.geometry;
  near.assets = assets();
  let time = 0;
  const update = near.update.bind(near);
  near.update = (position, trees) => update(position, trees, time += 1 / 60);
  for (let i = 0; i < 30; i++) near.update(new THREE.Vector3(), [t]);
  const state = near.cache.get(mesh), restored = [];
  t.parts = [{ batch: { mesh: { setMatrixAt: (_, matrix) => restored.push(matrix.clone()), instanceMatrix: {} } }, index: 0, matrix: new THREE.Matrix4() }];
  const habitat = { cells: [], lodTrees: [t], nearTrunks: near, hiddenMatrix: new THREE.Matrix4().makeScale(.000001, .000001, .000001) };
  assert.equal(state.blend.value, 1);
  for (let i = 0; i < 40; i++) {
    Habitat.prototype.updateVisibility.call(habitat, new THREE.Vector3(30, 0, 0));
    if (state.blend.value > 0) {
      assert.equal(t.group.visible, true);
      assert.equal(t.near, true);
      assert.equal(mesh.geometry, near.assets.geometry);
    } else assert.equal(mesh.geometry, original);
    if (!t.group.visible) assert.equal(state.blend.value, 0);
  }
  assert.equal(t.group.visible, false);
  assert.equal(t.near, false);
  assert.deepEqual(restored.at(-1).elements, t.parts[0].matrix.elements);
});

test('scan and albedo transition together, preserving real Color metadata and LOW lighting', () => {
  const source = tree(0).group.children[0].material, a = assets();
  const { material, blend } = nearTrunkMaterial(source, a, 1.635);
  assert.ok(material.isMeshLambertMaterial); assert.ok(material.userData.foliageTint.isColor);
  assert.notEqual(material.userData.foliageTint, source.userData.foliageTint);
  assert.equal(material.map, source.map); assert.equal(material.normalMap.channel, 1);
  assert.deepEqual(material.normalMap.repeat.toArray(), [1.635, 1.635]);
  for (const name of ['lambert', 'standard']) {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[name].vertexShader, fragmentShader: THREE.ShaderLib[name].fragmentShader };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.trunkBlend, blend);
    assert.ok(shader.vertexShader.includes('mix(trunkLodPosition, transformed, trunkBlend)'));
    assert.ok(shader.fragmentShader.includes('vNormalMapUv'));
    assert.ok(!shader.fragmentShader.includes('barkThreshold'));
  }
  const habitat = new Habitat({ rainy: false }); habitat.materials.add(material);
  for (const rainy of [false, true, false]) { habitat.setWet(rainy); assert.ok(material.color.toArray().every(Number.isFinite)); }
  assert.equal(trunkBlend(5), 1); assert.equal(trunkBlend(12), 0);
  assert.ok(trunkBlend(9) > 0 && trunkBlend(9) < 1);
});

test('the near asset retains 27k real scan faces and finite geometry, mapped UVs and morph attributes', () => {
  const raw = fs.readFileSync(new URL('../public/models/near-forest-trunk.glb', import.meta.url));
  const length = raw.readUInt32LE(12), json = JSON.parse(raw.subarray(20, 20 + length)), bin = raw.subarray(28 + length);
  const p = json.meshes[0].primitives[0];
  assert.equal(json.accessors[p.indices].count / 3, 27298);
  assert.ok(json.asset.copyright.includes('CC0'));
  const arrays = {};
  for (const [name, index] of Object.entries(p.attributes)) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView], count = a.type === 'VEC2' ? 2 : 3, values = [];
    assert.equal(a.componentType, 5126);
    for (let i = 0; i < a.count * count; i++) values.push(bin.readFloatLE(v.byteOffset + i * 4));
    assert.ok(values.every(Number.isFinite), name); arrays[name] = values;
  }
  assert.equal(arrays.POSITION.length, arrays._LOD_POSITION.length);
  let max = 0;
  for (let i = 0; i < arrays.POSITION.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => arrays.POSITION[i + k] - arrays._LOD_POSITION[i + k])));
  assert.ok(max < .2, `source-to-game LOD displacement ${max}`);
  assert.ok(arrays.TEXCOORD_1.length > 0);
  const index = json.accessors[p.indices], indexView = json.bufferViews[index.bufferView];
  const expanded = Buffer.alloc(index.count * 24);
  let surfaceArea = 0, textureArea = 0;
  for (let i = 0; i < index.count; i += 3) {
    const ids = [0, 1, 2].map(k => bin.readUInt16LE(indexView.byteOffset + (i + k) * 2));
    for (let k = 0; k < 3; k++) for (let axis = 0; axis < 3; axis++) {
      expanded.writeFloatLE(arrays.POSITION[ids[k] * 3 + axis], ((i + k) * 6 + axis) * 4);
      expanded.writeFloatLE(arrays.NORMAL[ids[k] * 3 + axis], ((i + k) * 6 + axis + 3) * 4);
    }
    const vertices = ids.map(id => new THREE.Vector3().fromArray(arrays.POSITION, id * 3));
    surfaceArea += new THREE.Triangle(...vertices).getArea();
    const uv = ids.map(id => new THREE.Vector2().fromArray(arrays.TEXCOORD_1, id * 2));
    textureArea += Math.abs(uv[1].clone().sub(uv[0]).cross(uv[2].clone().sub(uv[0]))) / 2;
  }
  assert.equal(createHash('sha256').update(expanded).digest('hex'), 'dc416ae9a81192bf333b137c86564404d41e3d8c03b0c70728033a8d8421013b', 'accepted scan positions/normals must not change during UV work');
  assert.ok(Math.abs(textureArea / surfaceArea - 1) < .0001, 'branch charts must retain metre-scale area density');
});
