import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import * as T from 'three';
import { createNativeCaveFloorPatch, createNativeCaveWallProfile, nativeCaveFloorWeight } from '../src/cave/cave-native-floor.js';
import { createCaveMaterial, CAVE_TRIPLANAR_GLSL } from '../src/cave/cave-material.js';
import { CaveFloorIndex } from '../src/cave/cave-space.js';
import { CaveLink } from '../src/cave/cave-link.js';
import { addPhotographicCapture } from '../src/xianxia-surface.js';

const route = [[0, 0, 0], [0, 0, 12]], mouth = { floorCenter: [0, 0, 12], outward: [0, 0, 1] };
const frame = async () => {};
const radii = route.map(() => Array(64).fill(2));
function fixture() {
  const sets = Array.from({ length: 4 }, () => ({ color: new T.Texture(), normal: new T.Texture(), roughness: new T.Texture() }));
  const cave = createCaveMaterial(sets, { routeLength: 12 }), root = new T.Group(), geometry = new T.PlaneGeometry(6, 12, 3, 6);
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, 6);
  const colors = Array.from({ length: geometry.attributes.position.count }, () => [.4, .5, .6]).flat();
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('caveRoute', new T.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(.8), 1));
  root.add(new T.Mesh(geometry, cave)); return { sets, cave, root, geometry };
}
function native(Material) { return addPhotographicCapture(new Material(), {}); }
function geometryBytes(g) { return serialize({ attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, a.array])), index: g.index?.array, groups: g.groups }); }
function collisionBytes(floor) { return Buffer.from(JSON.stringify(floor, (_key, value) => { if (value instanceof Map) return [...value]; if (typeof value !== 'number') return value; const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return { float64: bytes.toString('hex') }; })); }
function shader() { return { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader }; }

test('native rock footprint is full inward, noise-broken across 1.5m, and zero outside the mouth, wall margin, floor height or floor normals', () => {
  const sample = { depth: -1, distance: 0, wallDistance: 1.4, heightDelta: 0, normalY: 1 };
  assert.equal(nativeCaveFloorWeight(sample), 1);
  for (const noise of [0, .5, 1]) {
    assert.equal(nativeCaveFloorWeight({ ...sample, depth: -.75, noise }), 1);
    assert.equal(nativeCaveFloorWeight({ ...sample, depth: .75, noise }), 0);
  }
  assert.notEqual(nativeCaveFloorWeight({ ...sample, depth: 0, noise: 0 }), nativeCaveFloorWeight({ ...sample, depth: 0, noise: 1 }));
  assert.equal(nativeCaveFloorWeight({ ...sample, distance: 1.8 }), 1);
  assert.ok(Math.abs(nativeCaveFloorWeight({ ...sample, distance: 1.95 }) - .5) < 1e-10);
  assert.equal(nativeCaveFloorWeight({ ...sample, wallDistance: 2.5, distance: 2.134 }), 1);
  for (const override of [{ distance: 2.1 }, { heightDelta: 1.25 }, { normalY: 0 }, { depth: 2 }]) assert.equal(nativeCaveFloorWeight({ ...sample, ...override }), 0);
  assert.throws(() => nativeCaveFloorWeight({ ...sample, depth: NaN }), TypeError);
});

test('native floor reuses exact cave-floor textures, triplanar functions, scale, normal strength, tint and live mouth brightness', async () => {
  const { cave, root, sets } = fixture(), patch = await createNativeCaveFloorPatch(cave, root, route, mouth, frame, radii);
  const terrain = new T.Group(), mesh = new T.Mesh(new T.PlaneGeometry(), native(T.MeshStandardMaterial)); mesh.name = 'native-mountain'; terrain.add(mesh);
  const source = mesh.material; source.envMapIntensity = .22; assert.equal(patch.apply(terrain), 1); assert.notEqual(mesh.material, source);
  const compiled = shader(); mesh.material.onBeforeCompile(compiled);
  assert.equal(compiled.uniforms.caveColor3.value, sets[3].color); assert.equal(compiled.uniforms.caveNormal3.value, sets[3].normal); assert.equal(compiled.uniforms.caveRough3.value, sets[3].roughness);
  assert.equal(compiled.uniforms.caveRepeat.value, 1.8); assert.equal(compiled.uniforms.caveNormalStrength.value, .65);
  assert.equal(compiled.uniforms.caveViewerBrightness, cave.userData.viewerBrightness); cave.userData.viewerBrightness.value = .4; assert.equal(compiled.uniforms.caveViewerBrightness.value, .4);
  assert.equal(mesh.material.envMapIntensity, cave.envMapIntensity); assert.equal(compiled.uniforms.nativeCaveEnvironment.value, .22);
  assert.match(compiled.fragmentShader, /mix\(nativeCaveEnvironment,1.,rockWeight\)/);
  assert.match(compiled.fragmentShader, /texelFetch\(nativeCaveField/); assert.match(compiled.fragmentShader, /mix\(rockN,nativeCaveScanNormal\(rockUv\),.85\)/);
  assert.ok(compiled.fragmentShader.includes(CAVE_TRIPLANAR_GLSL)); assert.match(compiled.fragmentShader, /caveSample\(caveRough3/); assert.match(compiled.fragmentShader, /caveMappedNormal\(caveNormal3/);
  assert.match(compiled.fragmentShader, /rockOcclusion\/max\(\.25,caveViewerBrightness\)/); assert.match(compiled.fragmentShader, /texture2D\(caveColor3,rockP.xz/);
  const field = patch.uniforms.nativeCaveTint.value.image.data;
  const tints = []; for (let i = 0; i < field.length; i += 4) if (Math.abs(field[i] - .4) < 1e-6) tints.push([...field.slice(i, i + 4)]);
  assert.ok(tints.length > 0); assert.ok(tints.every(t => Math.abs(t[1] - .5) < 1e-6 && Math.abs(t[2] - .6) < 1e-6 && t[3] === 1));
  const stations = patch.uniforms.nativeCaveField.value.image.data;
  for (let i = 0; i < field.length; i += 4) if (Math.abs(field[i] - .4) < 1e-6) assert.ok(Math.abs(stations[i] - 9.6) < 1e-5);
  const patched = mesh.material; patch.apply(terrain); assert.equal(mesh.material, patched); patch.restore(terrain); assert.equal(mesh.material, source);
});

test('Low diffuse and unlit backdrop retain their outside lighting while using Standard PBR inside', async () => {
  const { cave, root } = fixture(), patch = await createNativeCaveFloorPatch(cave, root, route, mouth, frame, radii), group = new T.Group();
  for (const [Material, name] of [[T.MeshLambertMaterial, 'native-mountain'], [T.MeshBasicMaterial, 'native-mountain-far']]) { const mesh = new T.Mesh(new T.PlaneGeometry(), native(Material)); mesh.name = name; group.add(mesh); }
  patch.apply(group);
  for (const mesh of group.children) assert.equal(mesh.material.isMeshStandardMaterial, true);
  const near = shader(), far = shader(); group.children[0].material.onBeforeCompile(near); group.children[1].material.onBeforeCompile(far);
  assert.match(near.fragmentShader, /getIBLIrradiance\( geometryNormal \) \* rockWeight/); assert.match(near.fragmentShader, /directSpecular\+reflectedLight.indirectSpecular/);
  assert.match(far.fragmentShader, /outgoingLight=mix\(diffuseColor.rgb,outgoingLight,rockWeight\)/);
});

test('material dressing leaves every geometry attribute, triangle, group and collision byte unchanged', async () => {
  const { cave, root, geometry } = fixture(), before = geometryBytes(geometry), collision = new CaveFloorIndex(geometry, route), bytes = collisionBytes(collision);
  const patch = await createNativeCaveFloorPatch(cave, root, route, mouth, frame, radii), group = new T.Group(), mesh = new T.Mesh(geometry, native(T.MeshStandardMaterial)); mesh.name = 'native-mountain'; group.add(mesh);
  patch.apply(group); mesh.material.onBeforeCompile(shader()); patch.restore(group);
  assert.equal(mesh.geometry, geometry); assert.deepEqual(geometryBytes(geometry), before); assert.deepEqual(collisionBytes(collision), bytes);
});

test('native dressing handles empty geometry without mutation and rejects incomplete materials or routes', async () => {
  const { cave } = fixture(), empty = new T.Group(), patch = await createNativeCaveFloorPatch(cave, empty, route, mouth, frame, radii);
  assert.equal(patch.apply(empty), 0); patch.restore(empty);
  await assert.rejects(createNativeCaveFloorPatch(cave, empty, [], mouth, frame, radii), TypeError);
  await assert.rejects(createNativeCaveFloorPatch(new T.MeshStandardMaterial(), empty, route, mouth, frame, radii), TypeError);
  await assert.rejects(createNativeCaveFloorPatch(cave, empty, route, mouth, frame, []), TypeError);
});

for (const lowDetail of [true, false]) test(`${lowDetail ? 'Low' : 'High'} shared preparation patches initial and streamed native materials without touching topology or collision`, async () => {
  const { cave, root, geometry } = fixture(), link = new CaveLink({ lowDetail });
  link.fit = JSON.parse(readFileSync(new URL('../public/cave/mouth-fit.json', import.meta.url))); link.floorHandoff = link.fit.mouths[1].floorHandoff;
  link.mountain.world.updateMountain = async () => {};
  link.floor = new CaveFloorIndex(geometry, route); const collision = collisionBytes(link.floor);
  link.nativeFloorPatch = await createNativeCaveFloorPatch(cave, root, route, mouth, frame, radii);
  const original = native(T.MeshStandardMaterial), initial = new T.Mesh(geometry, original); initial.name = 'native-mountain'; link.mountain.group.add(initial);
  const before = geometryBytes(geometry);
  await link.prepareMountainMeshesAsync(link.mountain.group, frame);
  assert.match(initial.material.name, /cave-floor rock/); assert.deepEqual(geometryBytes(initial.geometry), before);
  const replacement = new T.Group(), next = new T.Mesh(geometry.clone(), original); next.name = 'native-mountain'; replacement.add(next); link.mountain.group.add(replacement);
  await link.mountain.world.updateMountain(); assert.equal(replacement.visible, true); assert.match(next.material.name, /cave-floor rock/);
  assert.deepEqual(geometryBytes(next.geometry), before); assert.deepEqual(collisionBytes(link.floor), collision);
  const key = next.material.customProgramCacheKey(); link.prepareMountainMeshes(replacement); assert.equal(next.material.customProgramCacheKey(), key);
  const compiled = shader(); next.material.onBeforeCompile(compiled); assert.equal(compiled.fragmentShader.split('uniform sampler2D caveColor3;').length - 1, 1);
  link.ready = true; link.host.position = new T.Vector3(...link.route.at(-1)); link.host.camera = new T.PerspectiveCamera();
  for (let i = 0; i < 2; i++) { link.update(0); assert.equal(next.material.isMeshStandardMaterial, true); assert.equal(next.material.customProgramCacheKey(), key); }
  assert.deepEqual(geometryBytes(next.geometry), before); assert.deepEqual(collisionBytes(link.floor), collision);
  console.log(`${lowDetail ? 'Low' : 'High'} native floor PBR: initial/streamed geometry and collision byte-identical`);
});

test('scanned wall distances interpolate both sides by station, follow bends, and reject incomplete profiles', () => {
  const path = [[0, 0, 0], [10, 0, 0], [10, 0, 10]], rings = [[2, 2, 1, 2], [4, 4, 2, 4], [6, 6, 3, 6]], walls = createNativeCaveWallProfile(path, rings);
  assert.equal(walls.at(5, 1), 3); assert.equal(walls.at(5, -1), 1.5);
  assert.equal(walls.at(-10, 1), 2); assert.equal(walls.at(30, -1), 3);
  assert.equal(walls.atPoint(15, 8, 5, [0, 0, 1]), 2.5); assert.equal(walls.atPoint(15, 12, 5, [0, 0, 1]), 5);
  const bulge = [2, 8, 1, 1, 1, 1, 1, 1], envelope = createNativeCaveWallProfile(route, [bulge, bulge]);
  assert.ok(Math.abs(envelope.at(6, 1) - 8 / Math.sqrt(2)) < 1e-10); assert.equal(envelope.at(6, -1), 1);
  assert.throws(() => walls.at(NaN, 1), TypeError); assert.throws(() => createNativeCaveWallProfile([], []), TypeError);
  assert.throws(() => createNativeCaveWallProfile(path, rings.slice(1)), TypeError);
});

test('rock reference darkening, tint, AO and normals exclude authored native-only floor faces', async () => {
  const { cave, root, geometry } = fixture();
  geometry.setAttribute('caveShade', new T.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(.6), 1));
  const borrowed = geometry.clone(); borrowed.translate(0, .05, 0);
  borrowed.setAttribute('_cave_native_floor', new T.Float32BufferAttribute(new Float32Array(borrowed.attributes.position.count).fill(1), 1));
  borrowed.attributes._cave_native_floor.setX(0, 0);
  borrowed.attributes.caveRoute.array.fill(.99); borrowed.attributes.caveShade.array.fill(1); borrowed.attributes.color.array.fill(.9);
  root.add(new T.Mesh(borrowed, cave));
  const before = geometryBytes(geometry), after = geometryBytes(borrowed), patch = await createNativeCaveFloorPatch(cave, root, route, mouth, frame, radii);
  const tint = patch.uniforms.nativeCaveTint.value.image.data, field = patch.uniforms.nativeCaveField.value.image.data;
  let checked = 0;
  for (let i = 0; i < tint.length; i += 4) {
    assert.ok(tint[i] < .8);
    if (Math.abs(tint[i] - .4) >= 1e-6) continue;
    assert.ok(Math.abs(field[i] - 9.6) < 1e-5); assert.ok(Math.abs(tint[i + 3] - .6) < 1e-6);
    const x = Math.floor(field[i + 3] / 4096) / 4095 * 2 - 1, z = (field[i + 3] % 4096) / 4095 * 2 - 1;
    assert.ok(Math.abs(x) < .0003 && Math.abs(z) < .0003); checked++;
  }
  assert.ok(checked > 0); assert.deepEqual(geometryBytes(geometry), before); assert.deepEqual(geometryBytes(borrowed), after);
});
