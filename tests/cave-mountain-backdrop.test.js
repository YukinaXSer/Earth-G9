import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { holdMountainBackdrop } from '../src/cave/cave-mountain-backdrop.js';
import { CaveLink } from '../src/cave/cave-link.js';
import data from '../src/cave/cave-data.json' with { type: 'json' };

test('pending near preparation retains only the matching far phase and restores its visibility', () => {
  const root = new T.Group(), geometry = new T.BoxGeometry(), far = new T.BatchedMesh(2, 48, 72);
  far.name = 'native-mountain-far';
  const id = far.addGeometry(geometry), instance = far.addInstance(id), other = far.addInstance(id);
  far.setMatrixAt(other, new T.Matrix4().makeTranslation(3, 0, 0)); far.setVisibleAt(instance, false); far.setVisibleAt(other, false);
  root.add(far);
  const replacement = new T.Group(), near = new T.Mesh(geometry); near.name = 'native-mountain'; replacement.add(near); root.add(replacement); root.updateMatrixWorld(true);
  const release = holdMountainBackdrop(root, replacement);
  assert.equal(far.getVisibleAt(instance), true); assert.equal(far.getVisibleAt(other), false);
  release(); assert.equal(far.getVisibleAt(instance), false);
  holdMountainBackdrop(root, new T.Group())();
});

test('streamed replacement stays hidden until cooperative preparation finishes and update waits for it', async () => {
  const link = new CaveLink({ lowDetail: false }), root = link.mountain.group;
  link.fit = { volume: { route: data.route }, mouths: [{}, { strategy: 'native-cliff' }] };
  link.floor = null;
  link.mountain.world.updateMountain = async () => {};
  await link.prepareMountainMeshesAsync(root, async () => {});
  let finish;
  link.prepareMountainMeshesAsync = () => new Promise(resolve => { finish = resolve; });
  const child = new T.Group(), mesh = new T.Mesh(new T.BoxGeometry()); mesh.name = 'native-mountain'; child.add(mesh); root.add(child);
  assert.equal(child.visible, false);
  let returned = false;
  const update = link.mountain.world.updateMountain().then(() => { returned = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(returned, false);
  finish(); await update;
  assert.equal(child.visible, true); assert.equal(returned, true);
});

test('failed streamed preparation keeps replacement hidden and records the error', async () => {
  const link = new CaveLink({ lowDetail: false }); link.fit = { volume: { route: data.route }, mouths: [{}, { strategy: 'native-cliff' }] };
  link.mountain.world.updateMountain = async () => {};
  await link.prepareMountainMeshesAsync(link.mountain.group, async () => {});
  const error = new Error('preparation failed');
  link.prepareMountainMeshesAsync = async () => { throw error; };
  const child = new T.Mesh(new T.BoxGeometry()); child.name = 'native-mountain'; link.mountain.group.add(child);
  await link.mountain.world.updateMountain();
  assert.equal(child.visible, false); assert.equal(link.mountain.world.streamingError, error);
});
