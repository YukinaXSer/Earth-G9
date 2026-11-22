import test from 'node:test';
import assert from 'node:assert/strict';
import { warmMountainHorizon } from '../src/cave/cave-horizon.js';

test('deferred mountain horizon stays hidden until host warm-up finishes', async () => {
  const parent = { remove(mesh) { mesh.parent = null; }, add(mesh) { mesh.parent = this; } };
  const horizon = { visible: true, parent };
  let finish;
  const warming = warmMountainHorizon({ loadHorizon: async () => horizon }, async mesh => {
    assert.equal(mesh, horizon); assert.equal(mesh.visible, false);
    assert.equal(mesh.parent, null);
    await new Promise(resolve => { finish = resolve; });
  });
  await Promise.resolve();
  assert.equal(horizon.visible, false);
  finish();
  assert.equal(await warming, horizon);
  assert.equal(horizon.visible, true);
  assert.equal(horizon.parent, parent);
});

test('deferred horizon propagates download and warm-up failures without exposing an unprepared mesh', async () => {
  const error = new Error('offline'), horizon = { visible: true };
  await assert.rejects(warmMountainHorizon({ loadHorizon: async () => { throw error; } }, () => {}), error);
  await assert.rejects(warmMountainHorizon({ loadHorizon: async () => horizon }, async () => { throw error; }), error);
  assert.equal(horizon.visible, false);
  await assert.rejects(warmMountainHorizon({ loadHorizon: async () => null }, () => {}), TypeError);
});
