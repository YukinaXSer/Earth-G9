import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CaveLink } from '../src/cave/cave-link.js';

function fixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: callback => queueMicrotask(() => callback(16)) });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'requestAnimationFrame', descriptor) : delete globalThis.requestAnimationFrame);
  const host = { scene: new T.Scene(), camera: new T.PerspectiveCamera(), renderer: {
    initTexture() {}, getRenderTarget() { return null; }, setRenderTarget() {}, render() {},
    async readRenderTargetPixelsAsync() {}, async compileAsync() {},
  } };
  const link = new CaveLink(host), horizon = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial({ map: new T.Texture() }));
  link.mountain = { group: new T.Group(), async loadHorizon() { link.mountain.group.add(horizon); return horizon; } };
  link.caveAttached = true; link.floor = { canMove: () => true };
  link.regionAt = () => 'cave'; link.groundHeight = () => 0;
  const [x, , z] = link.route[80], walk = () => link.canMove(x, z, x, z);
  assert.equal(walk(), false, 'The unloaded near mountain gates walking beyond the first bend');
  return { link, host, horizon, walk };
}

for (const failure of ['download', 'warm']) test(`optional horizon ${failure} failure cannot revoke near-mountain readiness or block walking`, async t => {
  const { link, host, horizon, walk } = fixture(t), error = new Error(`${failure} failed`), warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  if (failure === 'download') link.mountain.loadHorizon = async () => { throw error; };
  else host.renderer.initTexture = () => { throw error; };
  link.attachMountain();
  assert.equal(link.ready, true); assert.equal(walk(), true);
  assert.equal(await link.horizonLoading, null);
  assert.equal(link.ready, true); assert.equal(link.state, 'ready'); assert.equal(link.error, undefined);
  assert.equal(link.horizonError, error); assert.equal(walk(), true);
  assert.equal(link.mountain.group.parent, host.scene);
  assert.equal(link.mountain.group.visible, true);
  assert.equal(warnings.length, 1); assert.equal(warnings[0][1], error);
  if (failure === 'warm') { assert.equal(horizon.visible, false); assert.equal(horizon.parent, link.mountain.group); }
});

test('a pending optional horizon never delays walking and attaches only after successful warm-up', async t => {
  const { link, horizon, walk } = fixture(t);
  let resolve;
  link.mountain.loadHorizon = () => new Promise(yes => { resolve = () => { link.mountain.group.add(horizon); yes(horizon); }; });
  link.attachMountain();
  assert.equal(link.ready, true); assert.equal(walk(), true); assert.equal(horizon.parent, null);
  resolve();
  assert.equal(await link.horizonLoading, horizon);
  assert.equal(horizon.visible, true); assert.equal(horizon.parent, link.mountain.group);
  assert.equal(walk(), true); assert.equal(link.horizonError, undefined);
  assert.match(CaveLink.prototype.start.toString(), /this\.attachMountain\(\)/);
  assert.doesNotMatch(CaveLink.prototype.start.toString(), /await this\.horizonLoading/);
});
