import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCaveMaterial, caveBlendWeights, caveDepthOcclusion, CAVE_TEXTURE_SETS } from '../src/cave/cave-material.js';

test('mouth-depth occlusion reaches half light at four metres without darkening the accepted deep-light level again', () => {
  assert.equal(caveDepthOcclusion(-1), 1); assert.equal(caveDepthOcclusion(0), 1);
  assert.equal(caveDepthOcclusion(4), .5); assert.ok(Math.abs(caveDepthOcclusion(10) - .33) < 1e-6);
  assert.equal(caveDepthOcclusion(100), caveDepthOcclusion(10));
  assert.throws(() => caveDepthOcclusion(NaN), RangeError);
});
import { attachCaveRoute, routeParameter, loadCaveAssets, warmCaveAssets } from '../src/cave/cave-assets.js';

const data = JSON.parse(readFileSync(new URL('../src/cave/cave-data.json', import.meta.url)));
const bytes = readFileSync(new URL('../public/cave/cave.glb', import.meta.url));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const root = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
root.scene.updateMatrixWorld(true);
const meshes = []; root.scene.traverse(o => { if (o.isMesh) meshes.push(o); });

test('cave is one local atlas-free quantized scan within the triangle and transfer budgets', () => {
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(meshes.length, 1);
  assert.equal(json.images, undefined); assert.equal(json.textures, undefined);
  assert.deepEqual(json.extensionsRequired, ['KHR_mesh_quantization']);
  assert.ok(json.buffers.every(b => !b.uri));
  assert.ok(data.mesh.triangles >= 150000 && data.mesh.triangles <= 250000);
  assert.equal(meshes[0].geometry.index.count / 3, data.mesh.triangles);
  assert.equal(bytes.length, data.mesh.bytes); assert.ok(bytes.length <= 4_000_000);
  assert.equal(data.source.uid, '1183fc2d392e4eee9ebe74d07af0361c');
  assert.equal(data.source.author, 'cave-dive-make');
  assert.equal(data.source.license, 'CC BY 4.0');
  assert.match(data.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(data.transform.scale, 1); assert.equal(data.units, 'metres');
  const tint = meshes[0].geometry.getAttribute('color');
  let min = 1, max = 0;
  for (let i = 0; i < tint.count; i++) { min = Math.min(min, tint.getX(i)); max = Math.max(max, tint.getX(i)); }
  assert.ok(max - min > .1, 'retain atlas-derived macro variation');
  for (const view of json.bufferViews.filter(v => v.target === 34962)) assert.equal(view.byteStride % 4, 0);
});

test('route is floor-grounded, half-metre sampled and retains two recorded bends', () => {
  assert.ok(data.route.length > 84); assert.equal(data.routeDistances[0], 0);
  for (let i = 1; i < data.routeDistances.length - 1; i++) assert.ok(Math.abs(data.routeDistances[i] - data.routeDistances[i - 1] - .5) < 1e-6);
  assert.ok(Math.abs(data.routeDistances.at(-1) - data.routeLength) < .001);
  assert.equal(data.bends.length, 2);
  assert.ok(data.bends[0].distance < data.routeLength * .5);
  assert.ok(data.bends[1].distance > data.routeLength * .5);
  const mat = meshes[0].material; mat.side = T.DoubleSide;
  for (let i = 4; i < data.route.length - 4; i += 7) {
    const p = new T.Vector3(...data.route[i]);
    const hit = new T.Raycaster(p.clone().add(new T.Vector3(0, 1, 0)), new T.Vector3(0, -1, 0), 0, 2).intersectObject(root.scene, true)[0];
    assert.ok(hit, `floor sample ${i}`); assert.ok(Math.abs(hit.point.y - p.y) < .025, `floor agreement ${i}`);
  }
  assert.ok(data.mesh.minHeight >= 2.2); assert.ok(data.mesh.minWidth >= 1.6);
});

test('the only open mesh boundaries are the two clean mouth cross-sections', () => {
  const mesh = meshes[0], index = mesh.geometry.index, position = mesh.geometry.getAttribute('position');
  const edges = new Map();
  for (let i = 0; i < index.count; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const x = index.getX(i + a), y = index.getX(i + b), key = x < y ? `${x},${y}` : `${y},${x}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  let boundary = 0; const mouths = [0, 0];
  for (const [key, count] of edges) {
    assert.ok(count <= 2, 'manifold shell');
    if (count !== 1) continue;
    boundary++;
    for (const vertex of key.split(',').map(Number)) {
      const p = new T.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
      const d = data.mouths.map(m => Math.abs(p.clone().sub(new T.Vector3(...m.floorCenter)).dot(new T.Vector3(...m.outward))));
      assert.ok(Math.min(...d) < .015, 'no unintentional roof/wall holes'); mouths[d[0] < d[1] ? 0 : 1]++;
    }
  }
  assert.equal(boundary, data.mesh.boundaryEdges); assert.ok(mouths.every(n => n > 20));
  for (const m of data.mouths) assert.ok(Math.abs(Math.hypot(...m.outward) - 1) < 1e-6);
  const a = new T.Vector3(...data.mouths[0].floorCenter).add(new T.Vector3(0, 1.7, 0));
  const b = new T.Vector3(...data.mouths[1].floorCenter).add(new T.Vector3(0, 1.7, 0));
  const direction = b.clone().sub(a).normalize();
  const hit = new T.Raycaster(a.clone().addScaledVector(direction, .05), direction, .05, a.distanceTo(b) - .1).intersectObject(root.scene, true)[0];
  assert.ok(hit, 'bends block direct mouth-to-mouth eye-height sightline');
});

test('four complete photographed 2K sets have auditable local maps under 18 MB total', () => {
  assert.deepEqual(data.materials.map(m => m.id), CAVE_TEXTURE_SETS);
  let total = bytes.length;
  for (const material of data.materials) {
    assert.equal(material.license, 'CC0');
    for (const [key, map] of Object.entries(material.maps)) {
      assert.ok(['color', 'normal', 'roughness'].includes(key));
      const path = new URL('../public/cave/' + map.file, import.meta.url), file = readFileSync(path);
      assert.equal(file.toString('ascii', 8, 12), 'WEBP'); assert.equal(statSync(path).size, map.bytes);
      assert.equal(createHash('sha256').update(file).digest('hex'), map.sha256);
      assert.equal(Math.max(map.width, map.height), 2048);
      assert.match(map.source.url, /^https:\/\/dl.polyhaven.org\//); total += file.length;
    }
  }
  assert.equal(total, data.downloadBytes); assert.ok(total <= 18_000_000);
});

test('route parameters handle endpoints, bends, empty and zero-length routes', () => {
  const route = [[0, 0, 0], [0, 0, 10], [10, 0, 10]];
  assert.equal(routeParameter(new T.Vector3(0, 0, -2), route), 0);
  assert.equal(routeParameter(new T.Vector3(5, 2, 10), route), .75);
  assert.equal(routeParameter(new T.Vector3(12, 0, 10), route), 1);
  assert.throws(() => routeParameter(new T.Vector3(), []), /two points/);
  assert.throws(() => attachCaveRoute(new T.Group(), []), /two points/);
  assert.throws(() => routeParameter(new T.Vector3(), [[0, 0, 0], [0, 0, 0]]), /zero length/);
  attachCaveRoute(root.scene, data.route);
  const geometry = meshes[0].geometry;
  assert.equal(geometry.getAttribute('caveRoute'), geometry.getAttribute('_cave_route'), 'use baked route attribute, not per-frame CPU nearest-route work');
});

test('material weights continuously partition forest/interior/mountain/floor', () => {
  for (let t = -.1; t < 1.1; t += .01) for (const y of [-1, 0, .6, 1]) {
    const w = caveBlendWeights(t, y);
    assert.ok(w.every(n => n >= -1e-9 && n <= 1 + 1e-9));
    assert.ok(Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-9);
  }
  assert.deepEqual(caveBlendWeights(0, 0), [1, 0, 0, 0]);
  assert.deepEqual(caveBlendWeights(.5, 0), [0, 1, 0, 0]);
  assert.deepEqual(caveBlendWeights(1, 0), [0, 0, 1, 0]);
  assert.deepEqual(caveBlendWeights(.5, 1), [0, 0, 0, 1]);
});

test('material injects world-metre triplanar colour, roughness and signed whiteout normals', () => {
  const sets = Array.from({ length: 4 }, () => ({ color: new T.Texture(), normal: new T.Texture(), roughness: new T.Texture() }));
  const material = createCaveMaterial(sets), shader = { ...T.ShaderLib.standard, uniforms: {} };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.caveRepeat.value, 1.8); assert.equal(material.vertexColors, true);
  assert.match(shader.vertexShader, /modelMatrix \* vec4\(transformed/);
  assert.match(shader.vertexShader, /vCaveWallOnly = caveWallOnly/);
  assert.match(shader.vertexShader, /vCaveGranite = caveGranite/);
  assert.match(shader.fragmentShader, /caveAlbedo = mix\(caveAlbedo, vec3\(dot\(caveAlbedo/);
  assert.match(shader.fragmentShader, /vec3 graniteMacro = caveSample\(caveColor2/);
  assert.match(shader.fragmentShader, /mix\(graniteFine, graniteMacro, 0.62 \* vCaveGranite\)/);
  assert.match(shader.fragmentShader, /caveSample\(caveRough2, caveGranitePosition\(caveP\), caveN\)/);
  assert.match(shader.fragmentShader, /caveMappedNormal\(caveNormal2, caveGranitePosition\(caveP\), caveN\)/);
  assert.match(shader.fragmentShader, /caveOcclusion = mix\(caveOcclusion, 1.0, vCaveWallOnly\)/);
  assert.match(shader.fragmentShader, /1.0 - vCaveWallOnly/);
  assert.deepEqual(material.defaultAttributeValues.caveWallOnly, [0]);
  assert.match(shader.fragmentShader, /mat3\(viewMatrix\) \* caveWorldNormal/);
  assert.match(shader.fragmentShader, /x.z \* n.x/); assert.match(shader.fragmentShader, /y.z \* n.y/); assert.match(shader.fragmentShader, /z.z \* n.z/);
  for (let i = 0; i < 4; i++) assert.equal(shader.uniforms['caveNormal' + i].value, sets[i].normal);
  assert.throws(() => createCaveMaterial([]), /four complete/);
  assert.throws(() => createCaveMaterial(sets, { repeatMetres: 0 }), /scale/);
  assert.throws(() => createCaveMaterial(sets, { routeLength: NaN }), RangeError);
  material.dispose(); sets.forEach(set => Object.values(set).forEach(t => t.dispose()));
});

test('loading is explicit and warming refuses an already-visible cave', async () => {
  await assert.rejects(loadCaveAssets(), /requires renderer/);
  await assert.rejects(loadCaveAssets({ renderer: {}, data: { route: [] } }), /requires renderer/);
  const group = new T.Group(); new T.Scene().add(group);
  await assert.rejects(warmCaveAssets({ root: group }), /off-scene/);
  for (const file of ['world.js', 'main.js']) assert.doesNotMatch(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), /cave-assets/);
});
