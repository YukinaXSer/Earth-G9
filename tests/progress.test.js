import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, PLANT_SITES, START, BOUNDS, nearestPoint, sanitizeProgress, loadProgress, saveProgress, getCompletion, groundHeight, riverX, loadView, saveView, formatCoordinates, loadSettings, saveSettings } from '../src/data.js';

test('weather and audio preferences survive reload and accept only booleans', () => {
  let value = null;
  const storage = { getItem: key => { assert.equal(key, 'earth2-settings'); return value; }, setItem: (key, v) => { assert.equal(key, 'earth2-settings'); value = v; } };
  assert.deepEqual(loadSettings(storage), { rainy: false, sound: false });
  assert.equal(saveSettings(storage, { rainy: true, sound: true }), true);
  assert.deepEqual(loadSettings(storage), { rainy: true, sound: true });
  assert.equal(saveSettings(storage, { rainy: false, sound: false }), true);
  assert.deepEqual(loadSettings(storage), { rainy: false, sound: false });
  value = '{"rainy":"true","sound":1}';
  assert.deepEqual(loadSettings(storage), { rainy: false, sound: false });
  value = '{broken';
  assert.deepEqual(loadSettings(storage), { rainy: false, sound: false });
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(denied), { rainy: false, sound: false });
  assert.equal(saveSettings(denied, { rainy: true, sound: true }), false);
});

test('all landmarks are unique and inside the explorable land', () => {
  const points = [...SPECIES, ...PLANT_SITES];
  assert.equal(new Set(points.map(p => p.id)).size, 8);
  for (const point of points) {
    assert.ok(point.x > BOUNDS.minX && point.x < BOUNDS.maxX);
    assert.ok(point.z > BOUNDS.minZ && point.z < BOUNDS.maxZ);
    assert.ok(point.x < riverX(point.z) - 5.3);
    assert.ok(Number.isFinite(groundHeight(point.x, point.z)));
  }
});

test('only nearby landmarks can be interacted with', () => {
  assert.equal(nearestPoint(START, SPECIES), null);
  assert.equal(nearestPoint({ x: -3, z: 20 }, SPECIES).id, 'fern');
  assert.equal(nearestPoint({ x: 0, z: 0 }, []), null);
  assert.equal(nearestPoint({ x: 0, z: 0 }, [{ id: 'a', x: 0, z: 3 }, { id: 'b', x: 0, z: 1 }]).id, 'b');
});

test('sanitize persisted progress to known, unique identifiers', () => {
  assert.deepEqual(sanitizeProgress(null), { discovered: [], planted: [] });
  assert.deepEqual(sanitizeProgress({ discovered: ['fern', 'fern', 'bad'], planted: ['seed-1', 'seed-1', null] }), { discovered: ['fern'], planted: ['seed-1'] });
  assert.deepEqual(sanitizeProgress({ discovered: 'fern', planted: {} }), { discovered: [], planted: [] });
});

test('progress survives save and reload', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const progress = { discovered: ['fern', 'tree'], planted: ['seed-1'] };
  assert.equal(saveProgress(storage, progress), true);
  assert.deepEqual(loadProgress(storage), progress);
});

test('corrupted and unavailable storage never prevent play', () => {
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(loadProgress(denied), { discovered: [], planted: [] });
  assert.equal(saveProgress(denied, { discovered: [], planted: [] }), false);
  assert.deepEqual(loadProgress({ getItem: () => '{broken json' }), { discovered: [], planted: [] });
});

test('completion includes both discovery and restoration', () => {
  assert.equal(getCompletion({ discovered: [], planted: [] }), 0);
  assert.equal(getCompletion({ discovered: ['fern'], planted: [] }), 13);
  assert.equal(getCompletion({ discovered: SPECIES.map(s => s.id), planted: PLANT_SITES.map(s => s.id) }), 100);
});

test('saved viewpoint keeps position and camera orientation', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const view = { x: -6, z: -31, yaw: 0.5, pitch: 0.12 };
  assert.equal(saveView(storage, view), true);
  assert.deepEqual(loadView(storage), view);
  assert.equal(saveView(storage, null), true);
  assert.equal(loadView(storage), null);
});

test('invalid viewpoint never breaks entry or leaves world bounds', () => {
  for (const value of [null, {}, { x: '0', z: 0, yaw: 0, pitch: 0 }, { x: 0, z: 0, yaw: null, pitch: 0 }]) {
    assert.equal(loadView({ getItem: () => JSON.stringify(value) }), null);
  }
  const view = loadView({ getItem: () => JSON.stringify({ x: 999, z: 999, yaw: 123, pitch: 99 }) });
  assert.equal(view.z, BOUNDS.maxZ);
  assert.ok(view.x <= BOUNDS.maxX);
  assert.equal(view.pitch, 1.05);
  const denied = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } };
  assert.equal(loadView(denied), null);
  assert.equal(saveView(denied, START), false);
});

test('coordinates distinguish all four directions relative to the entrance', () => {
  assert.equal(formatCoordinates(START), '0.0 N   0.0 E');
  assert.equal(formatCoordinates({ x: -8, z: 41 }), '6.0 S   8.0 W');
  assert.equal(formatCoordinates({ x: 7, z: 12 }), '23.0 N   7.0 E');
});
