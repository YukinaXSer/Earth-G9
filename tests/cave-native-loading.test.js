import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CaveLink } from '../src/cave/cave-link.js';

const frame = async () => {};
function fixture() {
  const link = new CaveLink({ camera: new T.PerspectiveCamera() }), events = [];
  link.clearEntrance = async () => { events.push('entrance-cleared'); };
  link.attachCave = () => { link.caveAttached = true; events.push('entry-ready'); };
  return { link, events };
}

test('entry and mountain loading do not wait for the floor bake, but mountain readiness does', async () => {
  const { link, events } = fixture(), bake = Promise.withResolvers(), loaded = Promise.withResolvers(), prepared = Promise.withResolvers(), started = Promise.withResolvers(), patch = {};
  link.prepareNativeFloorPatch = async () => { events.push('bake-start'); await bake.promise; link.nativeFloorPatch = patch; };
  link.mountain.load = async () => { events.push('mountain-load'); started.resolve(); await loaded.promise; };
  link.mountain.prepare = async camera => { assert.equal(camera, link.host.camera); prepared.resolve(); };
  let complete = false;
  const loading = link.loadMountainAssets(frame).then(() => { complete = true; });
  await started.promise;
  assert.deepEqual(events, ['entrance-cleared', 'entry-ready', 'bake-start', 'mountain-load']);
  assert.equal(link.caveAttached, true); assert.equal(link.nativeFloorPatch, undefined);
  loaded.resolve(); await prepared.promise;
  assert.equal(complete, false); assert.equal(link.ready, false); assert.equal(link.mountain.group.visible, false);
  link.floor = {}; link.regionAt = () => 'cave';
  const point = link.route.at(-10);
  assert.equal(link.canMove(point[0], point[2], point[0], point[2]), false);
  bake.resolve(); await loading;
  assert.equal(complete, true); assert.equal(link.nativeFloorPatch, patch);
});

for (const failure of ['bake', 'mountain']) test(`${failure} failure prevents unpatched mountain exposure and handles the other pending job`, async () => {
  const { link } = fixture(), bake = Promise.withResolvers(), loaded = Promise.withResolvers(), started = Promise.withResolvers(), error = new Error(failure);
  link.prepareNativeFloorPatch = () => bake.promise;
  link.mountain.load = () => { started.resolve(); return loaded.promise; };
  link.mountain.prepare = async () => {};
  const loading = link.loadMountainAssets(frame), rejected = assert.rejects(loading, value => value === error);
  await started.promise;
  (failure === 'bake' ? bake : loaded).reject(error); await rejected;
  assert.equal(link.ready, false); assert.equal(link.mountain.group.visible, false);
  (failure === 'bake' ? loaded : bake).resolve();
});

test('failed entrance preparation starts neither a bake nor a mountain load', async () => {
  const { link } = fixture(), error = new Error('entrance');
  link.clearEntrance = async () => { throw error; };
  link.attachCave = () => assert.fail('incomplete entrance attached');
  link.prepareNativeFloorPatch = () => assert.fail('bake started');
  link.mountain.load = () => assert.fail('mountain load started');
  await assert.rejects(link.loadMountainAssets(frame), value => value === error);
});
