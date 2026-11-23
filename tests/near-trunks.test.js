import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { KTXLoader } from 'three/addons/loaders/KTXLoader.js';
import { NearTrunks, NEAR_TRUNK_LIMIT, trunkBlend, nearTrunkMaterial, treeDetailDistance } from '../src/near-trunks.js';
import { Habitat } from '../src/habitat.js';
import { START } from '../src/data.js';

const assets = () => ({ geometry: new THREE.BoxGeometry(), color: new THREE.Texture(), normal: new THREE.Texture() });

for (const prefix of ['near-banyan', 'near-trunk']) test(`${prefix} GPU detail retains both 2K maps and all mips within the entrance texture budget`, () => {
  let bytes = 0;
  for (const [kind, format, blockBytes] of [['color', THREE.RGB_ETC2_Format, 8], ['normal', THREE.RGBA_ETC2_EAC_Format, 16]]) {
    const raw = fs.readFileSync(new URL(`../public/textures/${prefix}-${kind}.ktx`, import.meta.url));
    const texture = new KTXLoader().parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), true);
    assert.equal(texture.format, format);
    assert.equal(texture.width, 2048);
    assert.equal(texture.height, 2048);
    assert.equal(texture.mipmapCount, 12);
    texture.mipmaps.forEach((mip, level) => {
      assert.equal(mip.width, Math.max(1, 2048 >> level));
      assert.equal(mip.height, Math.max(1, 2048 >> level));
      assert.equal(mip.data.byteLength, Math.ceil(mip.width / 4) * Math.ceil(mip.height / 4) * blockBytes);
      bytes += mip.data.byteLength;
    });
  }
  assert.equal(bytes, 8388648);
  assert.ok(bytes <= 314638324 * .05);
});

test('compressed normals reconstruct the photographic hemisphere on the scanned wood shaders', () => {
  const maps = assets(); maps.normal.format = THREE.RGBA_ETC2_EAC_Format;
  for (const [source, strength, shaderName] of [[new THREE.MeshBasicMaterial(), .12, 'lambert'], [new THREE.MeshLambertMaterial(), .4, 'lambert'], [new THREE.MeshStandardMaterial(), .4, 'standard']]) {
    const { material } = nearTrunkMaterial(source, maps, 1, new THREE.Vector3(.25, .25, .25));
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[shaderName].vertexShader, fragmentShader: THREE.ShaderLib[shaderName].fragmentShader };
    material.onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes('texture2D( normalMap, vNormalMapUv ).ag'));
    assert.ok(shader.fragmentShader.includes('1.0 - abs(trunkOct.x) - abs(trunkOct.y)'));
    assert.ok(shader.fragmentShader.includes('mapN.xy *= normalScale'));
    assert.ok(shader.fragmentShader.includes('normal = normalize(mix(trunkOriginalNormal, normal, trunkSurface))'));
    assert.equal(shader.fragmentShader.includes('mapN.xy -= sign(mapN.xy)'), !source.isMeshBasicMaterial);
    assert.deepEqual(material.normalScale.toArray(), [strength, strength]);
    assert.notEqual(material.customProgramCacheKey(), nearTrunkMaterial(source, assets(), 1).material.customProgramCacheKey());
  }
  for (const v of [[0, 0, 1], [.3, -.6, .2], [-.8, .2, .1], [.3, -.6, -.2], [0, -.6, -.2], [-.8, 0, -.1], [0, 0, -1]]) {
    const source = new THREE.Vector3(...v).normalize();
    const oct = source.clone().divideScalar(Math.abs(source.x) + Math.abs(source.y) + Math.abs(source.z));
    if (source.z < 0) {
      const { x, y } = oct;
      oct.x = (1 - Math.abs(y)) * (x < 0 ? -1 : 1);
      oct.y = (1 - Math.abs(x)) * (y < 0 ? -1 : 1);
    }
    const restored = new THREE.Vector3(oct.x, oct.y, 1 - Math.abs(oct.x) - Math.abs(oct.y));
    const fold = Math.max(-restored.z, 0);
    restored.x -= Math.sign(restored.x) * fold;
    restored.y -= Math.sign(restored.y) * fold;
    restored.normalize();
    assert.ok(restored.distanceTo(source) < 1e-12);
  }
});

test('devices without ETC2 keep the original captured banyan outside the near-slot competition', () => {
  const habitat = new Habitat({ renderer: { extensions: { has: () => false } } });
  assert.equal(habitat.nearTrunks.compressedSupported, false, 'forest detail retains the original JPEG fallback');
  habitat.models.set('banyan', [capture(0, new NearTrunks()).group]);
  habitat.place('banyan', 0, 35, 1, 0);
  assert.equal(habitat.nearTrunks.captureDisabled, true);
  assert.equal(habitat.lodTrees.length, 0);
  assert.ok(habitat.batches.size > 0);
});

function capture(x, near) {
  const t = tree(x), mesh = t.group.children[0], source = mesh.geometry;
  mesh.material = new THREE.MeshBasicMaterial({ map: new THREE.Texture(), color: '#a9b8a2', side: THREE.DoubleSide });
  mesh.material.userData = { nearTrunk: 'capture', captureTint: mesh.material.color.clone() };
  source.userData.captureCorners = Uint32Array.from({ length: source.index.count }, (_, i) => i);
  const uv = source.toNonIndexed().attributes.uv;
  near.captureLayout = { uv, weight: new THREE.Float32BufferAttribute(new Float32Array(uv.count).fill(1), 1), grainMean: new THREE.Vector3(1, 1, 1), ...assets() };
  return t;
}

test('captured grain changes no scanned face, normal, old atlas coordinate or collider transform', () => {
  const near = new NearTrunks(), t = capture(0, near), mesh = t.group.children[0], original = mesh.geometry;
  const expected = original.toNonIndexed(), geometry = near.captureGeometry(original);
  assert.equal(geometry.index, null);
  for (const name of ['position', 'normal', 'uv']) assert.deepEqual(geometry.attributes[name].array, expected.attributes[name].array);
  assert.equal(geometry.attributes.position.count, original.index.count);
  assert.equal(geometry.attributes.trunkLodPosition, geometry.attributes.position);
  assert.equal(geometry.attributes.trunkLodNormal, geometry.attributes.normal);
  assert.equal(geometry.attributes.captureWeight.count, geometry.attributes.position.count);
  assert.equal(geometry.attributes.tangent.count, geometry.attributes.position.count);
  assert.ok(geometry.attributes.tangent.array.every(Number.isFinite));
  for (let i = 0; i < geometry.attributes.tangent.count; i++) {
    const tangent = new THREE.Vector3().fromBufferAttribute(geometry.attributes.tangent, i);
    const normal = new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, i);
    assert.ok(Math.abs(tangent.dot(normal)) < 1e-6);
    assert.equal(Math.abs(geometry.attributes.tangent.getW(i)), 1);
  }
  assert.equal(near.captureGeometry(original), geometry);
  assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
  assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
  const invalid = original.clone(); invalid.userData = {};
  assert.throws(() => near.captureGeometry(invalid), /correspondence/);
});

test('the photographed captured material retains an exact unlit endpoint and finite wet tint', () => {
  const near = new NearTrunks(), source = capture(0, near).group.children[0].material;
  const mean = new THREE.Vector3(.05, .04, .03);
  const { material, blend } = nearTrunkMaterial(source, assets(), 1.8, mean);
  assert.ok(material.isMeshLambertMaterial);
  assert.equal(material.map, source.map);
  assert.equal(material.side, THREE.DoubleSide);
  assert.notEqual(material.userData.captureTint, source.userData.captureTint);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.trunkBlend, blend);
  assert.ok(shader.vertexShader.includes('vCaptureWeight = captureWeight'));
  assert.ok(shader.fragmentShader.includes('vec3 trunkCaptureColor = diffuseColor.rgb'));
  assert.equal(shader.uniforms.trunkGrainMean.value, mean);
  assert.ok(shader.fragmentShader.includes('vec3 normal = trunkOriginalNormal'));
  assert.ok(shader.fragmentShader.includes('material.diffuseColor = vec3(1.0)'));
  assert.ok(shader.fragmentShader.includes('/ trunkGrainMean'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb = trunkCaptureColor * texture2D'));
  assert.ok(!shader.fragmentShader.includes('trunkCaptureTint'));
  assert.ok(shader.fragmentShader.includes('/ (trunkReferenceLight + vec3(.0001))'));
  assert.ok(!shader.fragmentShader.includes('captureShade'));
  assert.equal(shader.fragmentShader.match(/#include <normal_fragment_maps>/g).length, 1);
  assert.equal(shader.fragmentShader.match(/#include <lights_fragment_begin>/g).length, 2);
  const habitat = new Habitat({ rainy: false }); habitat.materials.add(material);
  for (const rainy of [false, true, false]) { habitat.setWet(rainy); assert.ok(material.color.toArray().every(Number.isFinite)); }
});

test('calibrated grain preserves every captured RGB channel under flat normals, including warm wood and wet tint', () => {
  const mean = new THREE.Vector3(.25, .25, .25);
  for (const wet of [1, .68]) {
    const capture = new THREE.Vector3(.09, .07, .05).multiplyScalar(wet);
    const photograph = mean.clone();
    const calibrated = photograph.divide(mean).multiply(capture);
    for (const light of [0, .1, .3, 1, 3]) {
      const outgoing = calibrated.clone().multiplyScalar((light + .0001) / (light + .0001));
      outgoing.toArray().forEach((channel, i) => assert.ok(Math.abs(channel - capture.getComponent(i)) < 1e-10));
    }
  }
  const source = tree(0).group.children[0].material;
  const { material } = nearTrunkMaterial(source, assets(), 1);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  assert.ok(!shader.fragmentShader.includes('trunkReferenceLight'), 'accepted forest shading must remain unchanged');
});

test('captured and forest stems share two slots and fade to their own exact source geometry', () => {
  const near = new NearTrunks(), a = capture(0, near), b = tree(12), c = capture(14, near), trees = [a, b, c];
  near.assets = assets();
  const original = trees.map(t => t.group.children[0].geometry);
  let time = 0;
  const update = (x, count = 1) => { for (let i = 0; i < count; i++) {
    near.update(new THREE.Vector3(x, 0, 0), trees, time += 1 / 60); assert.ok(near.active.size <= 2);
  } };
  update(5.5, 40);
  const mesh = a.group.children[0], state = near.cache.get(mesh);
  assert.equal(state.blend.value, 1);
  assert.notEqual(mesh.geometry, near.assets.geometry);
  update(7.2);
  assert.ok(state.blend.value > .9);
  assert.equal(mesh.geometry, state.nearGeometry);
  update(7.2, 40);
  assert.equal(mesh.geometry, original[0]);
  assert.ok(near.cache.get(c.group.children[0]).blend.value > .9);
  update(100, 40);
  trees.forEach((t, i) => assert.equal(t.group.children[0].geometry, original[i]));
  assert.equal(near.active.size, 0);
});

test('unavailable captured grain keeps the old capture without disabling forest upgrades', async () => {
  const near = new NearTrunks(), t = capture(0, near), other = capture(1, near), original = t.group.children[0].geometry;
  const forests = [tree(2), tree(3)], trees = [t, other, ...forests];
  near.assets = assets(); near.captureLayout = undefined;
  near.loadCapture = async () => { throw new Error('offline'); };
  near.update(new THREE.Vector3(), trees); await near.captureLoading;
  near.update(new THREE.Vector3(), trees);
  assert.equal(near.captureDisabled, true);
  assert.equal(near.disabled, undefined);
  assert.equal(t.group.children[0].geometry, original);
  assert.equal(near.active.size, 2, 'failed nearer captures must not consume either forest slot');
  for (const forest of forests) assert.equal(forest.group.children[0].geometry, near.assets.geometry);
});

test('only entrance captured placements join the new parent LOD, with the original matrices', () => {
  const habitat = new Habitat({ lowDetail: true, scene: new THREE.Scene() });
  const near = new NearTrunks(), model = capture(0, near).group;
  for (const key of ['banyan', 'rooted', 'rooted-far', 'forest']) habitat.models.set(key, [model]);
  const hero = habitat.place('banyan', 5.2, 23, 1, 2.8, 0, -1);
  const entry = habitat.place('rooted', START.x + 23, START.z, 1.8, .7);
  habitat.place('rooted', START.x + 80, START.z, 1.8, .7);
  habitat.place('rooted-far', START.x + 23, START.z, 1.8, .7);
  habitat.place('forest', START.x - 6, START.z, 3.5, .7);
  assert.equal(habitat.lodTrees.length, 2);
  assert.deepEqual(habitat.lodTrees.map(t => t.modelKey), ['banyan', 'rooted']);
  assert.equal(habitat.lodTrees[0].parts, hero);
  assert.equal(habitat.lodTrees[1].parts, entry);
  const expected = new THREE.Matrix4().compose(new THREE.Vector3(5.2, -1, 23), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.8, 0)), new THREE.Vector3(1, 1, 1));
  assert.deepEqual(hero[0].matrix.elements, expected.elements);
});

test('a large captured root can enter close detail beyond its centre radius without changing forest distances', () => {
  const near = new NearTrunks(), t = capture(15, near);
  near.assets = assets();
  t.detailBounds = new THREE.Box3(new THREE.Vector3(1, -1, -10), new THREE.Vector3(29, 20, 10));
  const position = new THREE.Vector3();
  assert.equal(treeDetailDistance(t, position), 1);
  assert.equal(treeDetailDistance(tree(15), position), 15);
  near.update(position, [t]);
  assert.equal(near.active.size, 1);
  assert.ok(near.cache.get(t.group.children[0]).blend.value > 0);
});

test('banyan near data contains only finite grain coordinates tied to the unchanged source scan', () => {
  const read = name => {
    const raw = fs.readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
    const n = raw.readUInt32LE(12), json = JSON.parse(raw.subarray(20, 20 + n));
    return { raw, json, bin: raw.subarray(28 + n) };
  };
  const layout = read('near-banyan-grain'), source = read('captured-banyan-low');
  assert.equal(layout.json.meshes, undefined, 'new coordinates must not replace the scanned geometry');
  assert.equal(layout.json.extras.sourceSha256, createHash('sha256').update(source.raw).digest('hex'));
  const grain = fs.readFileSync(new URL('../public/textures/near-banyan-color.jpg', import.meta.url));
  assert.equal(layout.json.extras.grainSha256, createHash('sha256').update(grain).digest('hex'));
  assert.equal(layout.json.extras.grainMean.length, 3);
  assert.ok(layout.json.extras.grainMean.every(v => Number.isFinite(v) && v > 0 && v <= 1));
  assert.equal(layout.json.extras.grainMetres, 1.36);
  assert.ok(Math.abs(Math.hypot(...layout.json.extras.grainDirection) - 1) < 1e-8);
  assert.ok(layout.raw.length < 3.6e6);
  const value = (doc, index, row, axis = 0) => {
    const a = doc.json.accessors[index], b = doc.json.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type], bytes = a.componentType === 5123 ? 2 : 4;
    const offset = (b.byteOffset ?? 0) + (a.byteOffset ?? 0) + row * (b.byteStride ?? size * bytes) + axis * bytes;
    return a.componentType === 5126 ? doc.bin.readFloatLE(offset) : bytes === 2 ? doc.bin.readUInt16LE(offset) : doc.bin.readUInt32LE(offset);
  };
  const primitive = source.json.meshes[0].primitives[0], count = source.json.accessors[primitive.indices].count;
  assert.equal(layout.json.extras.sourceCorners, count);
  assert.equal(layout.json.accessors[0].count, count);
  assert.equal(layout.json.accessors[1].count, count);
  const positions = source.json.accessors[primitive.attributes.POSITION];
  const scale = 12 / (positions.max[1] - positions.min[1]);
  let fullFaces = 0, capturedFaces = 0, physicalArea = 0, textureArea = 0;
  for (let i = 0; i < count; i += 3) {
    const uv = [0, 1, 2].map(k => new THREE.Vector2(value(layout, 0, i + k), value(layout, 0, i + k, 1)));
    const weights = [0, 1, 2].map(k => value(layout, 1, i + k));
    assert.ok(uv.every(p => p.toArray().every(Number.isFinite)));
    assert.ok(weights.every(w => Number.isFinite(w) && w >= 0 && w <= 1));
    const area = Math.abs(uv[1].clone().sub(uv[0]).cross(uv[2].clone().sub(uv[0]))) / 2;
    assert.ok(area > 1e-12, `singular normal-map coordinates on source face ${i / 3}`);
    if (Math.max(...weights) === 0) capturedFaces++;
    else {
      const vertices = [0, 1, 2].map(k => {
        const id = value(source, primitive.indices, i + k);
        return new THREE.Vector3(...[0, 1, 2].map(axis => value(source, primitive.attributes.POSITION, id, axis)));
      });
      physicalArea += new THREE.Triangle(...vertices).getArea() * scale ** 2;
      textureArea += area;
      if (Math.min(...weights) > .9) fullFaces++;
    }
  }
  assert.ok(fullFaces > 3000, 'reachable wood needs substantial photographic coverage');
  assert.ok(capturedFaces > 30000, 'soil, leaves and upper scan must keep their capture');
  assert.ok(textureArea / physicalArea > .25 && textureArea / physicalArea < 4, 'grain must use physical rather than atlas-scale coordinates');
});
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
