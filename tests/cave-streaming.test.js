import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Rainforest } from '../src/world.js';
import { Habitat } from '../src/habitat.js';
import { Wildlife } from '../src/wildlife.js';
import { warmCaveAssets } from '../src/cave/cave-assets.js';

const baseline = JSON.parse(readFileSync(new URL('../src/cave/cave-boot.json', import.meta.url)));
const replaceGlobal = (t, key, value) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
};

function bootWorld(t, { lowDetail = false, failure } = {}) {
  const requests = [], frames = [], idle = [], events = [], beforeFrame = [];
  replaceGlobal(t, 'requestAnimationFrame', callback => frames.push(callback));
  replaceGlobal(t, 'window', { requestIdleCallback: (callback, options) => { assert.equal(options.timeout, 1500); idle.push(callback); } });
  replaceGlobal(t, 'document', { createElement: () => ({ getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) });
  t.mock.method(T.TextureLoader.prototype, 'load', (url, loaded) => {
    requests.push(url); const texture = new T.Texture(); queueMicrotask(() => loaded(texture)); return texture;
  });
  t.mock.method(HDRLoader.prototype, 'loadAsync', async url => { requests.push(url); return new T.Texture(); });
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    requests.push(url);
    if (url === failure) throw new Error('asset unavailable');
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3));
    geometry.setIndex([0, 1, 2]); geometry.computeVertexNormals();
    const scene = new T.Group(); scene.add(new T.Mesh(geometry, new T.MeshStandardMaterial())); return { scene };
  });
  const world = {
    lowDetail, rainy: false, initializing: true, scene: new T.Scene(), position: new T.Vector3(),
    loadingManager: new T.LoadingManager(), rand: (a, b) => (a + b) / 2,
    waterMaterial: { uniforms: { environmentSampler: { value: null } } },
    renderer: {
      capabilities: { getMaxAnisotropy: () => 8 }, compileAsync: async () => events.push('compile'),
      render: () => { beforeFrame.push(...requests); events.push('first-frame'); },
    },
    updateSky: Rainforest.prototype.updateSky, makeLandmarks() {}, makeGroundShadows() {},
    scheduleCave: () => Rainforest.prototype.scheduleCave.call(world, async () => { events.push('cave'); requests.push('/cave/cave.glb'); }),
  };
  world.habitat = new Habitat(world); world.wildlife = new Wildlife(world);
  for (const method of ['compose', 'flush', 'updateVisibility']) world.habitat[method] = () => {};
  world.wildlife.startAdditional = () => events.push('post-frame-wildlife');
  Rainforest.prototype.makeMaterials.call(world); Rainforest.prototype.makeLighting.call(world);
  return { world, requests, frames, idle, events, beforeFrame };
}

for (const lowDetail of [false, true]) test(`actual ${lowDetail ? 'low' : 'high'}-quality loaders match main before the first frame; cave starts only after frame and idle`, async t => {
  const boot = bootWorld(t, { lowDetail });
  assert.equal(baseline.baseline, 'e83d5fb8103a44a63036c1c9052c81c21e0f3853');
  assert.equal(boot.frames.length, 0);
  await Rainforest.prototype.loadHabitat.call(boot.world);
  assert.deepEqual([...boot.beforeFrame].sort(), [...baseline.assets].sort());
  assert.equal(new Set(boot.beforeFrame).size, baseline.assets.length);
  assert.deepEqual(boot.events, ['compile', 'first-frame', 'post-frame-wildlife']);
  assert.equal(boot.idle.length, 0); assert.equal(boot.frames.length, 1);
  boot.frames.shift()();
  assert.equal(boot.idle.length, 1); assert.ok(boot.requests.every(url => !/cave|xianxia/.test(url)));
  await boot.idle.shift()();
  assert.equal(boot.events.at(-1), 'cave'); assert.equal(boot.requests.at(-1), '/cave/cave.glb');
  console.log(`Main boot request diff (${lowDetail ? 'low' : 'high'}): ${baseline.assets.length} -> ${boot.beforeFrame.length} assets; added []; removed []`);
});

test('a failed boot asset never schedules cave downloads or a first scene frame', async t => {
  const boot = bootWorld(t, { failure: '/models/fern.glb' });
  await assert.rejects(Rainforest.prototype.loadHabitat.call(boot.world), /asset unavailable/);
  assert.deepEqual(boot.beforeFrame, []); assert.deepEqual(boot.frames, []); assert.deepEqual(boot.idle, []);
});

test('deferred initialization catches synchronous and asynchronous failures without another loading screen', async t => {
  const frames = [], idle = [], errors = [];
  replaceGlobal(t, 'requestAnimationFrame', callback => frames.push(callback));
  replaceGlobal(t, 'window', { requestIdleCallback: callback => idle.push(callback) });
  t.mock.method(console, 'error', (...args) => errors.push(args));
  for (const start of [() => { throw new Error('sync'); }, () => Promise.reject(new Error('async'))]) {
    Rainforest.prototype.scheduleCave.call({}, start); frames.shift()(); await idle.shift()();
  }
  assert.deepEqual(errors.map(args => args[1].message), ['sync', 'async']);
});

function warmFixture(t, textures = 3, failure) {
  let frame = 0, target;
  const previous = new T.WebGLRenderTarget(4, 4), root = new T.Group(), scene = new T.Scene(), events = [];
  target = previous;
  const mesh = new T.Mesh(new T.BufferGeometry(), new T.MeshStandardMaterial()); root.add(mesh);
  const sun = new T.DirectionalLight(); sun.castShadow = true; scene.add(sun, new T.HemisphereLight());
  replaceGlobal(t, 'requestAnimationFrame', callback => { const id = ++frame; queueMicrotask(() => callback(id * 16)); return id; });
  const assets = { root, textures: Array.from({ length: textures }, () => new T.Texture()) };
  const renderer = {
    initTexture: texture => events.push(['upload', frame, texture]),
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    render: staging => {
      assert.equal(staging.isGroup, true); assert.equal(staging.parent, null); assert.equal(root.parent, staging);
      assert.equal(scene.children.includes(root), false); assert.equal(mesh.frustumCulled, false);
      assert.equal(root.visible, true); assert.equal(mesh.visible, true);
      const copy = staging.children.find(o => o.isDirectionalLight);
      assert.notEqual(copy, sun); assert.equal(copy.castShadow, true);
      copy.shadow.map = { dispose: () => events.push(['shadow-disposed']) };
      target.addEventListener('dispose', () => events.push(['target-disposed'])); events.push(['render']);
    },
    readRenderTargetPixelsAsync: () => new Promise((resolve, reject) => queueMicrotask(() => {
      assert.equal(target, previous); events.push(['uploaded']);
      failure === 'upload' ? reject(new Error('upload failed')) : resolve(new Uint8Array(4));
    })),
    compileAsync: async (value, camera, lighting) => {
      assert.equal(value, root); assert.equal(value.parent, null); assert.equal(lighting, scene); events.push(['compile']);
      if (failure === 'compile') throw new Error('compile failed');
    },
  };
  return { assets, renderer, scene, mesh, previous, events };
}

for (const textures of [0, 3]) test(`off-scene warm-up spreads ${textures} texture uploads across frames and prepares a shadow-capable rig`, async t => {
  const f = warmFixture(t, textures);
  await warmCaveAssets(f.assets, f.renderer, new T.PerspectiveCamera(), f.scene);
  const uploads = f.events.filter(e => e[0] === 'upload');
  assert.equal(new Set(uploads.map(e => e[1])).size, textures);
  assert.deepEqual(uploads.map(e => e[2]), f.assets.textures);
  assert.deepEqual(f.events.slice(textures).map(e => e[0]), ['render', 'uploaded', 'compile', 'shadow-disposed', 'target-disposed']);
  assert.equal(f.assets.root.parent, null); assert.equal(f.mesh.frustumCulled, true);
});

test('texture uploads wait for an idle player before consuming the next frame budget', async t => {
  const f = warmFixture(t, 2); let release;
  const idle = new Promise(resolve => { release = resolve; });
  const warming = warmCaveAssets(f.assets, f.renderer, new T.PerspectiveCamera(), f.scene, { waitForIdle: () => idle });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.events, []);
  release(); await warming;
  assert.equal(f.events.filter(e => e[0] === 'upload').length, 2);
});

test('off-scene warm-up includes hidden groups and restores their visibility', async t => {
  const f = warmFixture(t, 0);
  f.assets.root.visible = false; f.mesh.visible = false;
  await warmCaveAssets(f.assets, f.renderer, new T.PerspectiveCamera(), f.scene);
  assert.equal(f.assets.root.visible, false); assert.equal(f.mesh.visible, false);
});

for (const failure of ['upload', 'compile']) test(`failed off-scene ${failure} restores attachment, culling and render target state`, async t => {
  const f = warmFixture(t, 0, failure);
  await assert.rejects(warmCaveAssets(f.assets, f.renderer, new T.PerspectiveCamera(), f.scene), new RegExp(failure + ' failed'));
  assert.equal(f.assets.root.parent, null); assert.equal(f.mesh.frustumCulled, true); assert.equal(f.renderer.getRenderTarget(), f.previous);
  assert.ok(f.events.some(e => e[0] === 'target-disposed')); assert.ok(f.events.some(e => e[0] === 'shadow-disposed'));
});

test('mouth dressing is a local atlas-free scanned cliff with credited reused boulders and mountain capture', () => {
  const bytes = readFileSync(new URL('../public/cave/outcrop.glb', import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(bytes.length < 1_000_000); assert.equal(gltf.images, undefined);
  assert.ok(gltf.meshes.every(mesh => mesh.primitives.every(p => p.attributes.COLOR_0 != null)));
  assert.ok(statSync(new URL('../public/models/moss-rock.glb', import.meta.url)).size < 1_000_000);
  const credits = readFileSync(new URL('../public/ASSET-CREDITS.txt', import.meta.url), 'utf8');
  assert.match(credits, /coastal_cliff_01/); assert.match(credits, /coastal_cliff_04/); assert.match(credits, /moss-rock/);
});
