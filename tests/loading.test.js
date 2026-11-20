import test from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../src/loading.js';
import { Rainforest } from '../src/world.js';

test('loading completes or fails normally before its deadline', async () => {
  assert.equal(await withTimeout(Promise.resolve('ready'), 100), 'ready');
  const error = new Error('asset unavailable');
  await assert.rejects(withTimeout(Promise.reject(error), 100), value => value === error);
});

test('a resource that never settles produces a recoverable loading timeout', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), /加载超时/);
});

test('scene preparation waits for environment and terrain downloads, not only model completion', async () => {
  let finishEnvironment, finishTexture;
  const phases = [], frames = [];
  const world = {
    habitat: { load: () => Promise.resolve(), compose() {}, flush() {}, updateVisibility: () => frames.push('cull') },
    wildlife: { load: () => Promise.resolve() },
    environmentReady: new Promise(resolve => { finishEnvironment = resolve; }),
    textureLoads: [new Promise(resolve => { finishTexture = resolve; })],
    onLoading: state => phases.push(state.phase),
    makeLandmarks() {}, makeGroundShadows() {},
    renderer: { compileAsync: () => Promise.resolve(), render: () => frames.push('frame') },
    initializing: true,
  };
  const ready = Rainforest.prototype.loadHabitat.call(world);
  await Promise.resolve();
  assert.deepEqual(phases, []);
  finishEnvironment();
  await Promise.resolve();
  assert.deepEqual(phases, []);
  finishTexture();
  await ready;
  assert.deepEqual(phases, ['compose', 'prepare']);
  assert.deepEqual(frames, ['cull', 'frame']);
  assert.equal(world.initializing, false);
});
