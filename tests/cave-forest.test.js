import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { forestSurfaceContains, clipForestSurface, createMouthForest } from '../src/cave/cave-forest.js';

const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
const route = [[0, 0, -2], [0, 0, -50]];
const mouths = [{ floorCenter: [0, 0, -2], outward: [0, 0, 1] }, { floorCenter: [0, 0, -50], outward: [0, 0, -1] }];

test('forest surface keeps only its bounds and the cave corridor, never the mountain approach', () => {
  assert.equal(forestSurfaceContains(1, 1, route, mouths, bounds), true);
  assert.equal(forestSurfaceContains(5, -20, route, mouths, bounds), true);
  assert.equal(forestSurfaceContains(20, -20, route, mouths, bounds), false);
  assert.equal(forestSurfaceContains(0, -51, route, mouths, bounds), false);
  assert.equal(forestSurfaceContains(0, 5, route, mouths, bounds), false);
  assert.equal(forestSurfaceContains(0, -3, [], [], bounds), false);
});

test('forest clipping preserves source attributes and removes out-of-bounds ground and water faces', () => {
  const g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 0, 0, 1, 29, 0, -20, 31, 0, -20, 30, 0, -21], 3));
  const positions = g.attributes.position, before = positions.array.slice();
  clipForestSurface(g, route, mouths, bounds);
  assert.deepEqual([...g.index.array], [0, 1, 2]);
  assert.equal(g.attributes.position, positions); assert.deepEqual(positions.array, before);
  const empty = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([], 3));
  clipForestSurface(empty, [], [], bounds); assert.equal(empty.index.count, 0);
  assert.throws(() => clipForestSurface(new T.BufferGeometry(), [], []), TypeError);
});

test('mouth forest reuses loaded geometry and materials and roots vegetation on its supporting scan', async () => {
  const template = new T.Group(), geometry = new T.BoxGeometry(1, 2, 1), material = new T.MeshStandardMaterial();
  template.add(new T.Mesh(geometry, material)); template.userData = { height: 2, spread: 1 };
  const models = new Map(['tree', 'forest', 'distant', 'fern', 'groundcover', 'rock'].map(key => [key, [template]]));
  const rock = new T.Mesh(new T.BoxGeometry(100, 2, 100), material); rock.position.set(72, 2, -250);
  const mouth = { floorCenter: [72, 0, -250], outward: [0, 0, 1] }, floorRoute = [[72, 0, -250], [72, 0, -290]];
  let frames = 0;
  const result = await createMouthForest(models, rock, mouth, floorRoute, async () => { frames++; });
  assert.ok(result.children.length > 30); assert.ok(frames > 5); assert.ok(result.userData.colliders.length > 0);
  for (const plant of result.children) {
    assert.equal(plant.children[0].geometry, geometry); assert.equal(plant.children[0].material, material);
    assert.ok(Math.abs(plant.position.y - 2.88) < 1e-6);
    assert.ok(Math.abs(plant.position.x - 72) >= 4);
  }
  assert.equal(template.parent, null); assert.deepEqual(template.position.toArray(), [0, 0, 0]);
  assert.equal((await createMouthForest(new Map(), rock, mouth, floorRoute)).children.length, 0);
  await assert.rejects(createMouthForest(models, null, mouth, floorRoute), TypeError);
});
