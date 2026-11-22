import test from 'node:test';
import assert from 'node:assert/strict';
import { createForestLayout, createBackdropLayout, vegetationAllowed, riverBankX } from '../src/forest-layout.js';
import { BOUNDS, riverX } from '../src/data.js';
import { Habitat, modelVariantId } from '../src/habitat.js';
import * as THREE from 'three';
import { groundHeight, RIVER_LEVEL } from '../src/data.js';
import { capturedRelief } from '../src/ground-relief.js';
import { createColliderIndex } from '../src/captured-collisions.js';

test('numeric rock-set objects remain individual grounded variants, not one floating six-rock collection', () => {
  assert.notEqual(modelVariantId('rock', 'rock_moss_set_01_rock01'), modelVariantId('rock', 'rock_moss_set_01_rock02'));
  assert.equal(modelVariantId('sapling', 'pachira_aquatica_01_bark_a'), modelVariantId('sapling', 'pachira_aquatica_01_leaves_a'));
});

test('both quality levels populate the full map and preserve the river, trail and interaction clearings', () => {
  for (const lowDetail of [false, true]) {
    const layout = createForestLayout(lowDetail);
    assert.ok(layout.canopy.length > 180);
    assert.ok(layout.subcanopy.length > 450);
    assert.ok(layout.understory.length > (lowDetail ? 6000 : 8000));
    for (const [layer, plants] of Object.entries(layout)) {
      if (layer !== 'riparian') {
        assert.ok(plants.some(p => p.x < BOUNDS.minX));
        assert.ok(plants.some(p => p.x > BOUNDS.maxX));
      }
      assert.ok(plants.some(p => p.z < BOUNDS.minZ));
      assert.ok(plants.some(p => p.z > BOUNDS.maxZ));
      for (const p of plants) {
        assert.ok(vegetationAllowed(p.x, p.z, layer));
        assert.ok([p.x, p.z, p.angle, p.scale ?? p.spread ?? p.height].every(Number.isFinite));
      }
    }
  }
});

test('eligible ground samples across both river banks have local understory, not just the entrance strip', () => {
  for (const lowDetail of [false, true]) {
    const layout = createForestLayout(lowDetail);
    const index = createColliderIndex(layout.understory);
    for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 4) for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 4) {
      if (!vegetationAllowed(x, z, 'understory')) continue;
      const radius = lowDetail ? 4.2 : 3.6;
      assert.ok(index.query(x, z, radius).some(p => Math.hypot(p.x - x, p.z - z) < radius), `unplanted ground at ${x},${z}`);
    }
  }
});

test('quality fallback preserves the same canopy and middle-layer locations', () => {
  const normal = createForestLayout(false), low = createForestLayout(true);
  assert.deepEqual(normal.canopy, low.canopy);
  assert.deepEqual(normal.emergent, low.emergent);
  assert.deepEqual(normal.subcanopy, low.subcanopy);
  assert.deepEqual(normal, createForestLayout(false));
});

test('both banks have a continuous low riparian layer without filling the water or hiding the river view', () => {
  for (const lowDetail of [false, true]) {
    const { riparian } = createForestLayout(lowDetail);
    assert.ok(riparian.length > 600);
    assert.ok(riparian.every(p => p.height <= .95 && Math.abs(p.x - riverX(p.z)) >= 5.5));
    assert.ok(riparian.every(p => groundHeight(p.x, p.z) > RIVER_LEVEL + .04));
    for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 7) for (const side of [-1, 1]) for (const offset of [6.5, 9, 12.5]) {
      const x = riverX(z) + side * offset;
      if (!vegetationAllowed(x, z, 'riparian') || groundHeight(x, z) <= RIVER_LEVEL + .04) continue;
      assert.ok(Math.min(...riparian.map(p => Math.hypot(p.x - x, p.z - z))) < 3.2, `missing bank cover at ${x},${z}`);
    }
  }
});

test('riparian ribbons follow actual dry bank contours rather than a fixed strip through the water', () => {
  const { riparian } = createForestLayout(true);
  for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += 2.4) for (const side of [-1, 1]) {
    const bank = riverBankX(z, side);
    assert.notEqual(bank, null);
    assert.ok(groundHeight(bank, z) > RIVER_LEVEL + .08);
    if (!vegetationAllowed(bank + side * .4, z, 'riparian')) continue;
    assert.ok(riparian.some(p => Math.hypot(p.x - bank - side * .4, p.z - z) < 2));
  }
});

test('habitat instantiates every ground layer and rejects woody overlaps without removing the wider forest', () => {
  const trees = [], plants = [], colliders = [{ x: -48, z: 30, radius: 2 }];
  const variants = [[2, 3], [4, 1]].map(([spread, height]) => {
    const group = new THREE.Group();
    group.userData = { spread, height };
    group.add(new THREE.Mesh(new THREE.BoxGeometry(spread, height, .2).translate(0, height / 2, 0)));
    return group;
  });
  const habitat = {
    world: { lowDetail: true, colliders }, models: { get: () => variants }, backgroundTree: (...args) => trees.push(args),
    place: (...args) => {
      plants.push(args);
      const [, x, z, scale, angle] = args;
      return [{ matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(scale, scale, scale)) }];
    },
  };
  Habitat.prototype.composeForest.call(habitat);
  const layout = createForestLayout(true);
  assert.ok(trees.length > 250);
  const groundPlants = [...layout.understory, ...layout.riparian];
  const groundPositions = new Set(groundPlants.map(p => [p.key, p.x, p.z].join(':')));
  assert.equal(plants.filter(p => groundPositions.has(p.slice(0, 3).join(':'))).length, groundPlants.length);
  const actual = new Map(plants.map(p => [p.slice(0, 3).join(':'), p[3]]));
  for (const plant of groundPlants) {
    const size = variants[plant.variant % variants.length].userData;
    assert.equal(actual.get([plant.key, plant.x, plant.z].join(':')), plant.spread ? plant.spread / size.spread : plant.height / size.height);
  }
  assert.ok(trees.some(([x, z]) => x < -40 && z > 30));
  assert.ok(trees.some(([x, z]) => x < -40 && z < -90));
  assert.ok(trees.some(([x, z]) => x > 40 && z < -90));
  assert.ok(trees.every(([x, z]) => Math.hypot(x + 48, z - 30) >= 2.7));
});

test('background canopy and low foliage surround every map edge, not only rings around the entrance', () => {
  const backdrop = createBackdropLayout();
  assert.ok(backdrop.canopy.length > 1300);
  assert.ok(backdrop.subcanopy.length > 1500);
  for (const [x, z] of [[BOUNDS.minX, BOUNDS.minZ], [0, BOUNDS.minZ], [BOUNDS.maxX, BOUNDS.minZ], [BOUNDS.minX, BOUNDS.maxZ], [0, BOUNDS.maxZ], [BOUNDS.maxX, BOUNDS.maxZ]]) {
    const dx = x ? Math.sign(x) : 0, dz = z === BOUNDS.minZ ? -1 : 1;
    for (const distance of [40, 80, 140, 200]) {
      const px = x + dx * distance * .7, pz = z + dz * distance * .7;
      assert.ok(Math.min(...backdrop.canopy.map(p => Math.hypot(p.x - px, p.z - pz))) < 20, `missing distant canopy past ${x},${z}`);
    }
    const px = x + dx * 35, pz = z + dz * 35;
    assert.ok(Math.min(...backdrop.subcanopy.map(p => Math.hypot(p.x - px, p.z - pz))) < 12);
  }
});

test('captured relief is continuous, bounded and varies beyond the old broad terrain waves', () => {
  const values = [];
  for (let z = -110; z < 50; z += 3) for (let x = -50; x < 50; x += 3) {
    const y = capturedRelief(x, z); values.push(y);
    assert.ok(Number.isFinite(y) && Math.abs(y) <= .550001);
    assert.ok(Math.abs(y - capturedRelief(x + 32, z + 32)) < 1e-10);
    assert.ok(Math.abs(y - capturedRelief(x + 1e-5, z)) < 1e-5);
  }
  assert.ok(Math.max(...values) - Math.min(...values) > .5);
});

test('large traversable trees retain the complete captured trunk and its native roots, not a graft', () => {
  const placed = [], habitat = {
    place: (...args) => { placed.push(args); return []; }, lodTrees: [],
    models: new Map([['distant', [{ userData: { height: 3.4 } }]], ['rooted', [{ userData: { height: 12 } }]]]),
  };
  Habitat.prototype.backgroundTree.call(habitat, -44, 40, 4.5, .3);
  assert.deepEqual(placed, [['rooted', -44, 40, 4.5 * 3.4 / 12, .3], ['rooted-far', -44, 40, 4.5 * 3.4 / 12, .3]]);
  assert.equal(habitat.lodTrees.length, 0);
  placed.length = 0;
  Habitat.prototype.backgroundTree.call(habitat, -200, -200, 4.5, .3, true);
  assert.deepEqual(placed.map(p => p[0]), ['horizon']);
});

test('captured tree near and distant batches switch together without drawing both or leaving a gap', () => {
  const center = new THREE.Vector3(50, 8, 0), radius = 12;
  const near = { boundingSphere: new THREE.Sphere(center, radius), userData: { viewDistance: 36, minViewDistance: -Infinity } };
  const far = { boundingSphere: near.boundingSphere.clone(), userData: { viewDistance: 240, minViewDistance: 36 } };
  const habitat = { cells: [near, far], lodTrees: [] };
  for (const x of [0, 1, 10, 30, 60, 100, 180]) {
    Habitat.prototype.updateVisibility.call(habitat, new THREE.Vector3(x, 0, 0));
    assert.notEqual(near.visible, far.visible);
  }
});

test('captured soil skirts stay below terrain consistently in near and distant tree LODs', () => {
  const habitat = new Habitat({}), variant = new THREE.Group();
  variant.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  for (const key of ['forest', 'distant', 'horizon', 'rooted', 'broadleaf']) habitat.models.set(key, [variant]);
  for (const key of ['forest', 'distant', 'horizon']) {
    const [{ matrix }] = habitat.place(key, -43, 37, 5);
    for (let i = 0; i < 8; i++) assert.ok(matrix.elements[13] + .7 <= groundHeight(-43 + Math.cos(i * Math.PI / 4) * 2.25, 37 + Math.sin(i * Math.PI / 4) * 2.25) + 1e-12);
    assert.equal(matrix.elements[13], habitat.place('forest', -43, 37, 5)[0].matrix.elements[13]);
  }
  assert.ok(habitat.place('rooted', -43, 37, 1)[0].matrix.elements[13] <= groundHeight(-43, 37) - 1.3);
  assert.equal(habitat.place('broadleaf', -43, 37, 1)[0].matrix.elements[13], groundHeight(-43, 37));
  assert.equal(habitat.place('forest', -43, 37, 5, 0, 0, -2)[0].matrix.elements[13], -2);
});

test('LOW river reflections bound foliage submissions without changing main visibility, including on failure', () => {
  for (const lowDetail of [true, false]) {
    const makeCell = (x, visible) => ({ visible, boundingSphere: new THREE.Sphere(new THREE.Vector3(x, 0, 0), 2) });
    const cells = [makeCell(10, true), makeCell(21, true), makeCell(30, true), makeCell(10, false)];
    const habitat = { world: { lowDetail, position: new THREE.Vector3() }, cells };
    const draw = () => {
      assert.deepEqual(cells.map(m => m.visible), [true, true, !lowDetail, false]);
      return 'drawn';
    };
    assert.equal(Habitat.prototype.renderWaterReflection.call(habitat, draw), 'drawn');
    assert.deepEqual(cells.map(m => m.visible), [true, true, true, false]);
    assert.throws(() => Habitat.prototype.renderWaterReflection.call(habitat, () => { draw(); throw new Error('render failed'); }), /render failed/);
    assert.deepEqual(cells.map(m => m.visible), [true, true, true, false]);
  }
});
