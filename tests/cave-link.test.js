import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rainforest } from '../src/world.js';
import { CaveLink } from '../src/cave/cave-link.js';
import { CaveFloorIndex, nearestRoute, placeScannedCliff, fitCaveMouthCliffs } from '../src/cave/cave-space.js';
import { prepareCavePhysics } from '../src/cave/cave-physics.js';
import { findWalk, simulateWalk } from '../src/cave/cave-check.js';
import { MOUNTAIN_ENTRANCE } from '../src/xianxia-mountain.js';
import { START, BOUNDS, groundHeight } from '../src/data.js';
import { TERRAIN } from '../src/ground-relief.js';
import { insideScannedCave } from '../src/cave/cave-volume.js';
import caveData from '../src/cave/cave-data.json' with { type: 'json' };
import { CaveRayIndex } from '../src/cave/cave-rays.js';
import { CAVE_TEXTURE_SETS } from '../src/cave/cave-material.js';
import { loadProductionMountain } from './production-mountain-fixture.js';
import mountainEyes from './cave-mountain-eyes.json' with { type: 'json' };
import { createMountainFloorSeal } from '../src/cave/cave-rock-cover.js';

const host = { scene: new T.Scene(), rain: new T.Group(), rainy: false, lowDetail: false, position: new T.Vector3(START.x, 0, START.z), keys: new Set(), colliderIndex: { query: () => [] } };
host.canMove = Rainforest.prototype.canMove; host.groundHeight = Rainforest.prototype.groundHeight;
const link = host.worldLink = new CaveLink(host), bytes = readFileSync(new URL('../public/cave/cave-fitted.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const mesh = gltf.scene.getObjectByProperty('isMesh', true), positions = new Float32Array(mesh.geometry.attributes.position.count * 3), point = new T.Vector3();
for (let i = 0; i < positions.length / 3; i++) point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(link.transform).toArray(positions, i * 3);
const physics = prepareCavePhysics({ positions, indices: new Uint32Array(mesh.geometry.index.array), route: link.route, mouths: link.mouths, grade: MOUNTAIN_ENTRANCE.approach.grade, prepared: true });
link.floor = Object.assign(Object.create(CaveFloorIndex.prototype), structuredClone(physics.floor));
link.ready = true; link.caveAttached = true;
const cliffBytes = readFileSync(new URL('../public/cave/outcrop.glb', import.meta.url));
const cliff = (await new GLTFLoader().parseAsync(cliffBytes.buffer.slice(cliffBytes.byteOffset, cliffBytes.byteOffset + cliffBytes.byteLength), '')).scene;
cliff.position.fromArray(link.mouths[0].floorCenter); cliff.rotation.y = Math.PI;
const forestBytes = readFileSync(new URL('../public/cave/mouth-forest.glb', import.meta.url));
const forest = (await new GLTFLoader().parseAsync(forestBytes.buffer.slice(forestBytes.byteOffset, forestBytes.byteOffset + forestBytes.byteLength), '')).scene;
forest.applyMatrix4(link.transform);
const mountainBytes = readFileSync(new URL('../public/cave/mouth-mountain.glb', import.meta.url));
const mountain = (await new GLTFLoader().parseAsync(mountainBytes.buffer.slice(mountainBytes.byteOffset, mountainBytes.byteOffset + mountainBytes.byteLength), '')).scene;
mountain.applyMatrix4(link.transform);
const fitData = JSON.parse(readFileSync(new URL('../public/cave/mouth-fit.json', import.meta.url)));
const nativeIndex = await loadProductionMountain(link, fitData, caveData.mouths);
after(() => nativeIndex.dispose());
test('mountain fixture loads production native-v3 terrain and instanced props', () => {
  assert.equal(link.mountain.world.floorIndex.constructor.name, 'MountainTileSurface');
  assert.ok(link.mountain.group.getObjectByName('native-mountain'));
  assert.ok(nativeIndex.parts > 100);
  assert.equal(link.mountain.group.getObjectByName('coastal-cliff-04-native-capture'), undefined);
  let instanced = 0, batched = 0;
  link.mountain.group.traverse(mesh => { if (mesh.isInstancedMesh) instanced++; if (mesh.isBatchedMesh) batched++; });
  assert.ok(instanced > 0); assert.ok(batched > 0);
});
const cliffs = [forest, mountain], obstaclePositions = [];
for (const cliff of cliffs) {
  cliff.updateMatrixWorld(true);
  cliff.traverse(mesh => {
    if (!mesh.isMesh) return;
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < index.count; i++) point.fromBufferAttribute(p, index.getX(i)).applyMatrix4(mesh.matrixWorld).toArray(obstaclePositions, obstaclePositions.length);
  });
}
link.dressingIndex = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(obstaclePositions, 3)), link.route);
for (const [key, triangles] of link.dressingIndex.cells) {
  const floors = triangles.filter(triangle => triangle.floor);
  if (!floors.length) continue;
  if (!link.floor.cells.has(key)) link.floor.cells.set(key, []);
  link.floor.cells.get(key).push(...floors);
}

const { scene: floorRockSource } = await new GLTFLoader().loadAsync('/models/moss-rock.glb');
floorRockSource.updateMatrixWorld(true);
const floorRockVariants = floorRockSource.children.map(child => {
  const group = new T.Group(), box = new T.Box3().setFromObject(child), center = box.getCenter(new T.Vector3());
  child.traverse(mesh => { if (mesh.isMesh) group.add(new T.Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).translate(-center.x, -box.min.y, -center.z), new T.MeshBasicMaterial({ side: T.DoubleSide }))); });
  return group;
});
const floorRock = createMountainFloorSeal(new Map([['rock', floorRockVariants]]), link.mouths[1], link.route, (x, z) => link.floor.heightAt(x, z), new T.MeshBasicMaterial({ side: T.DoubleSide }));
floorRock.updateMatrixWorld(true);
const floorRockPositions = [];
floorRock.traverse(mesh => { if (mesh.isMesh) for (const i of mesh.geometry.index.array) point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).toArray(floorRockPositions, floorRockPositions.length); });
const floorRockRays = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(floorRockPositions, 3)), []);

test('cloned scanned cliffs use absolute yaw even when the source quaternion has a noncanonical Euler representation', () => {
  for (const yaw of [-1.0337963267948966, 2.1077963267948965]) {
    const ridge = placeScannedCliff(cliff, new T.Vector3(2, 3, 4), yaw);
    assert.deepEqual(ridge.position.toArray(), [2, 3, 4]);
    assert.ok(new T.Vector3(1, 0, 0).transformDirection(ridge.matrixWorld).distanceTo(new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))) < 1e-10);
    assert.equal(cliff.rotation.y, Math.PI);
  }
  assert.equal(placeScannedCliff(new T.Group(), new T.Vector3(), 0).children.length, 0);
  assert.throws(() => placeScannedCliff(null, new T.Vector3(), 0), TypeError);
});

test('capsule collision rejects the interior of a large low sloped face, not only its edges', () => {
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([
    -5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0, -5, -5, 0, 5, 5, 0, 5,
    -2, .5, -2, 2, .5, -2, 0, 1.5, 2,
  ], 3));
  const floor = new CaveFloorIndex(geometry, [[0, 0, -5], [0, 0, 5]]);
  assert.equal(floor.canMove(0, 0, 0, 0), false);
  assert.equal(floor.canMove(-4, -4, -4, -4), true);
  assert.equal(floor.canMove(20, 20, 20, 20), false);
});

for (const end of [0, 1]) test(`${end ? 'mountain' : 'forest'} scan has no sky gaps or exposed boundary edges from twenty eyes`, () => {
  const fit = fitData.mouths[end];
  const ground = new T.PlaneGeometry(TERRAIN.width, TERRAIN.depth, TERRAIN.width / TERRAIN.step, TERRAIN.depth / TERRAIN.step);
  ground.rotateX(-Math.PI / 2);
  const p = ground.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i) + TERRAIN.centerZ; p.setXYZ(i, x, groundHeight(x, z), z); }
  link.openTerrain(ground);
  const terrain = new CaveFloorIndex(ground, []), body = Object.assign(Object.create(CaveFloorIndex.prototype), physics.floor);
  const surfaces = new CaveRayIndex([body, link.dressingIndex, terrain, floorRockRays]), tube = new CaveRayIndex([body]);
  const cast = (origin, direction, maximum, onlyBody = false) => {
    return onlyBody ? tube.cast(origin, direction, maximum) : Math.min(surfaces.cast(origin, direction, maximum), nativeIndex.cast(origin, direction, maximum));
  };
  const mouth = link.mouths[end], center = new T.Vector3(...mouth.floorCenter), forward = new T.Vector3(...mouth.outward), side = new T.Vector3(forward.z, 0, -forward.x), eyes = [];
  if (end) eyes.push(...mountainEyes.map(p => new T.Vector3(...p)));
  else for (const distance of [4, 6, 9, 12]) for (const lateral of [-3, -1.5, 0, 1.5, 3]) {
    const eye = center.clone().addScaledVector(forward, distance).addScaledVector(side, lateral);
    const height = end ? link.mountain.groundHeight(eye.x, eye.z) : groundHeight(eye.x, eye.z);
    if (eyes.length >= 20 || height == null || (end && !host.canMove(eye.x, eye.z, eye.x, eye.z))) continue;
    eye.y = height + 1.85; eyes.push(eye);
  }
  assert.equal(eyes.length, 20);
  let rays = 0;
  for (const eye of eyes) for (const [x, y] of fit.apertureGuards) {
    const target = center.clone().addScaledVector(side, x).addScaledVector(forward, -.1); target.y += y;
    const direction = target.sub(eye).normalize();
    assert.ok(Number.isFinite(cast(eye, direction, link.length + 24)), `Sky through ${fit.mouth} rim from ${eye.toArray()} toward ${[x, y]}`); rays++;
  }
  const boundary = [];
  cliffs[end].traverse(mesh => {
    if (!mesh.isMesh) return;
    const counts = new Map(), index = mesh.geometry.index, p = mesh.geometry.attributes.position;
    for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
      const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3), key = `${Math.min(a, b)},${Math.max(a, b)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) if (count === 1) {
      const [a, b] = key.split(',').map(Number);
      boundary.push(new T.Vector3().fromBufferAttribute(p, a).add(new T.Vector3().fromBufferAttribute(p, b)).multiplyScalar(.5).applyMatrix4(mesh.matrixWorld));
    }
  });
  const triangle = new T.Triangle(), closest = new T.Vector3();
  const joined = point => [-.004, 0, .004].some(dx => [-.004, 0, .004].some(dz => body.triangles(point.x + dx, point.z + dz).some(({ vertices }) => {
    triangle.set(...vertices); triangle.closestPointToPoint(point, closest); return closest.distanceTo(point) < .003;
  })));
  const unjoined = boundary.filter(point => !joined(point));
  for (const eye of eyes) for (const point of unjoined) {
    const direction = point.clone().sub(eye), distance = direction.length(); direction.normalize();
    const surface = cast(eye, direction, distance + .004);
    assert.ok(surface < distance - .003 || cast(eye, direction, distance + .004, true) <= distance + .003, `Exposed ${fit.mouth} boundary ${point.toArray()} from ${eye.toArray()}`);
  }
  console.log(`${fit.mouth} mouth: ${eyes.length} eyes, ${rays} sky-gap rays, ${boundary.length} boundary edges checked`);
});

test('the mountain shell uses scanned faces without generated caps or an unsupported fitted rim', () => {
  const fit = JSON.parse(readFileSync(new URL('../public/cave/mouth-fit.json', import.meta.url)));
  if (fit.mouths[1].strategy === 'native-cliff') {
    if (fit.mouths[1].scannedShell) {
      assert.ok(mountain.getObjectByProperty('isMesh', true));
      assert.ok(fit.mouths[1].rockTriangles > 1000);
      assert.equal(fit.mouths[1].scannedShell.source, 'https://polyhaven.com/a/coastal_cliff_04');
      assert.equal(fit.mouths[1].scannedShell.license, 'CC0');
      assert.ok(fit.mouths[1].scannedShell.burialMetres >= .5);
      assert.ok(fit.mouths[1].scannedShell.protectedHeadroomMetres >= 3);
      assert.equal(fit.mouths[1].scannedShell.createdCapFaces, 0);
      assert.equal(fit.mouths[1].scannedShell.snappedVertices, 0);
    } else {
      assert.equal(mountain.getObjectByProperty('isMesh', true), undefined);
      assert.equal(fit.mouths[1].rockTriangles, 0);
    }
    assert.equal(fit.mouths[1].createdFaces, 0);
    assert.equal(fit.mouths[1].tubeRecessMetres, 3);
    assert.equal(fit.mouths[1].tubeRecessCriterion, 'all non-floor triangle vertices behind recess plane');
    assert.ok(fit.mouths[1].tubeTrianglesAfterRecess < fit.mouths[1].tubeTrianglesBeforeRecess);
    return;
  }
  assert.equal(fit.createdFaces, 0);
  const inverse = link.transform.clone().invert(), centroid = new T.Vector3(), vertex = new T.Vector3();
  for (const cliff of cliffs) cliff.updateMatrixWorld(true);
  let count = 0;
  for (const cliff of [mountain]) cliff.traverse(mesh => {
    if (!mesh.isMesh) return;
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      centroid.set(0, 0, 0);
      for (let j = 0; j < 3; j++) centroid.add(vertex.fromBufferAttribute(p, index.getX(i + j)));
      centroid.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      assert.equal(insideScannedCave(centroid.toArray(), { ...fit.volume, clearance: 0 }, caveData.mouths, .00003), false, `Inside centroid ${centroid.toArray()}`);
      count++;
    }
  });
  assert.ok(count > 1000);
  assert.equal(insideScannedCave([0, 1.1, 0], fit.volume, caveData.mouths), true);
  assert.equal(insideScannedCave([10000, 10000, 10000], fit.volume, caveData.mouths), false);
  assert.equal(insideScannedCave([0, 0, 0], { route: [] }, []), false);
  assert.equal(insideScannedCave([NaN, 0, 0], fit.volume, caveData.mouths), false);
  assert.throws(() => insideScannedCave([0, 0, 0], { route: [[0, 0, 0]] }, []), TypeError);
  assert.equal(fit.mouths.length, 2);
  for (const mouth of fit.mouths.filter(m => !m.source?.uid)) { assert.equal(mouth.insideCentroids, 0); assert.equal(mouth.createdFaces, 0); assert.ok(mouth.maxSnapMetres <= .4); assert.ok(mouth.maxApertureEdgeBeforeCut <= .0800001); }
  console.log(`Centroid exclusion: ${count} scan triangles checked`);
});

test('the forest mouth uses the uniformly scaled natural entrance with native macro tint and no added caps', () => {
  const fit = fitData.mouths[0];
  assert.equal(fit.source.uid, '6b0765f8887a47e1b0a063a118293c83');
  assert.equal(fit.source.license, 'CC BY 4.0');
  assert.deepEqual(fit.source.atlasResolution, [1024, 1024]);
  assert.ok(Math.abs(fit.openingWidthMetres - 5.1) < .2);
  assert.ok(Math.abs(fit.openingHeightMetres - 3.1) < .2);
  assert.ok(fit.neckWidthMetres > 3.5 && fit.neckHeightMetres > 2.8);
  assert.ok(fit.uniformScale > 0 && fit.overlapMetres >= .3 && fit.overlapMetres <= .5);
  assert.equal(fit.createdFaces, 0);
  assert.ok(fit.rockTriangles < fit.source.triangles / 2);
  assert.ok(forestBytes.byteLength < 8502724);
  forest.traverse(mesh => {
    if (!mesh.isMesh) return;
    assert.ok(mesh.geometry.attributes.color.count > 1000);
    const shade = mesh.geometry.getAttribute('_cave_shade');
    assert.ok(shade && shade.count === mesh.geometry.attributes.position.count);
    assert.ok(Array.from({ length: shade.count }, (_, i) => shade.getX(i)).some(value => value < .3));
    const normals = mesh.geometry.attributes.normal, v = new T.Vector3();
    for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(v.fromBufferAttribute(normals, i).length() - 1) < .001);
    const normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
    let shaded = 0, downward = 0;
    for (let i = 0; i < shade.count; i++) {
      v.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
      const height = point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).y - link.mouths[0].floorCenter[1];
      assert.ok(shade.getX(i) >= .09 && shade.getX(i) <= 1);
      if (height < .79 || height > 3.91) assert.equal(shade.getX(i), 1, 'Floor and exterior top must not receive ceiling shade');
      if (shade.getX(i) < .3) { shaded++; if (v.y < 0) downward++; }
    }
    assert.ok(shaded > 0 && downward / shaded > .7, 'Strong shade follows the inward ceiling surface');
  });
});

test('body coarsening keeps scanned floor and mouth triangles without broad baked AO', () => {
  const reduction = fitData.mouths[0].bodyReduction;
  assert.equal(reduction.bodyShade, false);
  assert.equal(mesh.geometry.getAttribute('_cave_shade'), undefined);
  assert.ok(reduction.protectedTriangles > 10000);
  assert.equal(reduction.protectedMouthRadiusMetres, 6);
  assert.ok(reduction.webTriangles < reduction.sourceTriangles * .7);
  assert.ok(bytes.byteLength < 4500000);
});

test('deferred cave, mouth and PBR files remain below 28 MB including low-tier forest', () => {
  const files = ['cave-fitted.glb', 'mouth-forest.glb', 'mouth-mountain.glb', 'mouth-fit.json', 'forest-low.glb',
    ...CAVE_TEXTURE_SETS.flatMap(id => ['color', 'normal', 'roughness'].map(key => `${id}-${key}.webp`))];
  const total = files.reduce((sum, file) => sum + readFileSync(new URL(`../public/cave/${file}`, import.meta.url)).byteLength, 0);
  assert.ok(total <= 28000000, `Deferred payload ${total} bytes exceeds 28 MB`);
});

test('unit-scale yaw/translation joins the exact mountain contract and excludes forest overlap', () => {
  const p = new T.Vector3(...Object.values(MOUNTAIN_ENTRANCE.position));
  link.mountain.group.localToWorld(p);
  assert.ok(p.distanceTo(new T.Vector3(...link.mouths[1].floorCenter)) < 1e-10);
  assert.deepEqual(link.mountain.group.scale.toArray(), [1, 1, 1]);
  const direction = new T.Vector3(1, 0, 0).transformDirection(link.mountain.group.matrixWorld);
  assert.ok(direction.distanceTo(new T.Vector3(...link.mouths[1].outward)) < 1e-10);
  const geometry = link.mountain.world.ground.geometry.clone();
  geometry.applyMatrix4(link.mountain.group.matrixWorld); geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.z < BOUNDS.minZ - 40);
  console.log(`Forest mouth world: ${link.mouths[0].floorCenter.join(', ')}`);
  console.log(`Mountain position: ${link.mountain.group.position.toArray().join(', ')}; yaw: ${link.mountain.group.rotation.y}`);
});

test('both visible scanned floors meet their neighbour within 3 cm across the seam width', () => {
  const differences = [0, 0];
  for (let end = 0; end < 2; end++) {
    const mouth = link.mouths[end], origin = new T.Vector3(...mouth.floorCenter), forward = new T.Vector3(...mouth.outward), side = new T.Vector3(-forward.z, 0, forward.x);
    for (const lateral of [-.45, -.3, 0, .3, .45]) {
      const inside = origin.clone().addScaledVector(forward, -.025).addScaledVector(side, lateral), outside = origin.clone().addScaledVector(forward, .025).addScaledVector(side, lateral);
      const a = link.floor.heightAt(inside.x, inside.z), b = end ? link.mountain.groundHeight(outside.x, outside.z) : groundHeight(outside.x, outside.z);
      assert.notEqual(a, null); assert.notEqual(b, null);
      differences[end] = Math.max(differences[end], Math.abs(a - b));
    }
  }
  assert.ok(differences.every(step => step < .03), `seam mismatch ${differences} m`);
  console.log(`Seam height differences: forest ${differences[0].toFixed(9)} m; mountain ${differences[1].toFixed(9)} m`);
});

test('host movement walks terrain, both seams, real cave floor and graded mountain approach, then back', () => {
  const first = new T.Vector3(...link.mouths[0].floorCenter).addScaledVector(new T.Vector3(...link.mouths[0].outward), 2);
  const end = new T.Vector3(MOUNTAIN_ENTRANCE.approach.endX, MOUNTAIN_ENTRANCE.approach.endY, MOUNTAIN_ENTRANCE.approach.endZ).applyMatrix4(link.mountain.group.matrixWorld);
  const goals = [[0, -172], [36, -180], [first.x, first.z], ...[40, 80, 120, 160, link.route.length - 1].map(i => [link.route[i][0], link.route[i][2]]), [end.x, end.z]];
  const canMove = (ax, az, x, z) => host.canMove(ax, az, x, z) && host.canMove(x, z, ax, az);
  let path = [[START.x, START.z]];
  for (const goal of goals) path.push(...findWalk(path.at(-1), goal, canMove, { step: link.regionAt(...goal) === 'forest' ? .35 : .12, margin: 8 }).slice(1));
  const forward = simulateWalk(host, path, Rainforest.prototype.movePlayer);
  assert.ok(host.position.distanceTo(new T.Vector3(end.x, 0, end.z)) < 1e-5);
  const backward = simulateWalk(host, [...path].reverse(), Rainforest.prototype.movePlayer);
  assert.ok(Math.hypot(host.position.x - START.x, host.position.z - START.z) < 1e-5);
  assert.ok(forward.distance > 400); assert.ok(Math.abs(forward.distance - backward.distance) < 1e-5);
  console.log(`Cave round-trip host movement: ${forward.distance.toFixed(3)} m each way, ${forward.frames + backward.frames} steps`);
});

test('mouth trimming preserves the scanned floor and roof in the deep interior', () => {
  const surfaces = new CaveRayIndex([Object.assign(Object.create(CaveFloorIndex.prototype), physics.floor)]);
  for (const i of [50, 80, 106, 130, 160]) {
    const origin = new T.Vector3(...link.route[i]); origin.y += 1.85;
    for (const direction of [new T.Vector3(0, 1, 0), new T.Vector3(0, -1, 0), new T.Vector3(-1, -.6, 0).normalize(), new T.Vector3(1, -.6, 0).normalize()]) {
      assert.ok(Number.isFinite(surfaces.cast(origin, direction, 24)), `Missing interior scan at route sample ${i}, direction ${direction.toArray()}`);
    }
  }
});

test('unfinished streaming gates the first bend; region bounds do not open the whole forest edge', () => {
  link.ready = false;
  const beforeBend = link.route[20]; assert.equal(host.canMove(beforeBend[0], beforeBend[2], beforeBend[0], beforeBend[2]), true);
  const p = link.route[50]; assert.equal(host.canMove(p[0], p[2], p[0] + .01, p[2]), false);
  link.ready = true;
  assert.equal(host.canMove(p[0], p[2], p[0] + .01, p[2]), true);
  assert.equal(host.canMove(-150, -272, -150, -274), false);
  assert.equal(link.floor.heightAt(1e6, 1e6), null);
  assert.equal(link.floor.canMove(1e6, 1e6, 1e6 + .1, 1e6), false);
});

test('visibility can only change between bends; host remains the only scene', () => {
  const forest = new T.Group(); host.scene.add(forest); link.forestGroups = [forest]; host.camera = new T.PerspectiveCamera();
  host.scene.add(link.mountain.group); link.mountain.group.visible = false;
  for (const index of [0, 60, 180, 211, 180, 60, 0]) {
    host.position.fromArray(link.route[index]); const before = link.mountain.group.visible, forestBefore = forest.visible;
    link.update(1 / 60);
    const along = nearestRoute(host.position.x, host.position.z, link.route).along;
    if (before !== link.mountain.group.visible || forestBefore !== forest.visible) assert.ok(along > link.bends[0] && along < link.bends[1]);
  }
  assert.equal(link.mountain.group.parent, host.scene);
  const source = readFileSync(new URL('../src/cave/cave-link.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/cave/cave-assets.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new (?:T\.|THREE\.)?Scene\(/);
});

test('navigation rejects empty space and preserves host walking and sprint speeds', () => {
  assert.throws(() => findWalk([0, 0], [2, 0], () => false, { maxNodes: 20 }), /No walkable path/);
  const world = { position: new T.Vector3(), yaw: 0, keys: new Set(), canMove: () => true };
  Rainforest.prototype.movePlayer.call(world, 1, 1, 0); assert.ok(Math.abs(world.position.z + 4.3) < 1e-10);
  world.position.set(0, 0, 0); world.keys.add('ShiftLeft'); Rainforest.prototype.movePlayer.call(world, 1, 1, 0); assert.ok(Math.abs(world.position.z + 8) < 1e-10);
});

test('forest ground, water and mouth vegetation hide behind the bends and the camera retains its 220 m far plane', () => {
  const scene = new T.Scene(), ground = new T.Group(), water = new T.Group(); scene.add(ground, water);
  const h = { scene, ground, water, lowDetail: false, rainy: false, rain: new T.Group(), camera: new T.PerspectiveCamera(), position: new T.Vector3(), habitat: { updateVisibility() {} } };
  const l = new CaveLink(h); l.ready = true; l.forestDressing = new T.Group();
  h.position.fromArray(l.route[180]); l.update(1 / 60);
  assert.equal(ground.visible, false); assert.equal(water.visible, false); assert.equal(l.forestDressing.visible, false); assert.equal(h.camera.far, 220);
  h.position.fromArray(l.route[60]); l.update(1 / 60);
  assert.equal(ground.visible, true); assert.equal(water.visible, true); assert.equal(l.forestDressing.visible, true); assert.equal(h.camera.far, 220);
});

test('returning from the mountain restores prior forest visibility instead of exposing every LOD', () => {
  const visible = new T.Group(), hidden = new T.Group(), scene = new T.Scene(); hidden.visible = false; scene.add(visible, hidden);
  const h = { scene, lowDetail: false, rainy: false, rain: new T.Group(), camera: new T.PerspectiveCamera(), position: new T.Vector3(), habitat: { updateVisibility() {} } };
  const l = new CaveLink(h); l.ready = true;
  h.position.fromArray(l.route[180]); l.update(1 / 60);
  assert.equal(visible.visible, false); assert.equal(hidden.visible, false);
  h.position.fromArray(l.route[60]); l.update(1 / 60);
  assert.equal(visible.visible, true); assert.equal(hidden.visible, false); assert.equal(h.rain.visible, false);
});

test('one lighting authority blends readable cave daylight, eases exposure, preserves weather and names the region', () => {
  for (const lowDetail of [false, true]) {
    const scene = new T.Scene(); scene.fog = new T.FogExp2();
    const h = { scene, lowDetail, rainy: false, moisture: 0, camera: new T.PerspectiveCamera(), position: new T.Vector3(),
      renderer: { toneMappingExposure: .96 }, sun: new T.DirectionalLight(), hemisphere: new T.HemisphereLight(), ambient: new T.AmbientLight(),
      sunRays: new T.Group(), rain: new T.Group(), ground: new T.Mesh(new T.BufferGeometry(), new T.MeshStandardMaterial()),
      sunnySky: new T.Texture(), rainySky: new T.Texture(), mouthLights: [new T.SpotLight(), new T.SpotLight()],
      waterMaterial: { uniforms: { fogColor: { value: new T.Color() }, rain: { value: 0 } } }, habitat: { setWet() {} }, updateSky: Rainforest.prototype.updateSky };
    const l = h.worldLink = new CaveLink(h); l.ready = true; l.mountain.groundHeight = () => 1; l.addMouthLights();
    assert.equal(l.spills.length, 2); assert.notEqual(l.spills[0].color.getHex(), l.spills[1].color.getHex());
    assert.ok(l.spills.every(light => !light.castShadow && light.position.distanceTo(light.target.position) > 8));
    h.position.fromArray(l.route[Math.floor(l.route.length / 2)]); l.update(1 / 60);
    assert.ok(l.lighting.brightness >= .25 && l.lighting.brightness <= .4);
    const exposure = h.renderer.toneMappingExposure;
    Rainforest.prototype.setWeather.call(h, false); Rainforest.prototype.applyLinkLighting.call(h, .1);
    const sunny = h.sun.intensity, fog = h.scene.fog.density;
    assert.equal(l.region, '山腹石径'); assert.ok(h.renderer.toneMappingExposure > exposure && h.renderer.toneMappingExposure < 1.13);
    assert.ok(Math.abs(h.sun.intensity - 3 * l.lighting.brightness) < 1e-8);
    Rainforest.prototype.setWeather.call(h, true); l.update(1 / 60); Rainforest.prototype.applyLinkLighting.call(h, .1);
    assert.equal(scene.background, h.rainySky); assert.ok(h.sun.intensity < sunny); assert.ok(h.scene.fog.density > fog);
    assert.ok(l.spills.every(light => light.intensity === 22));
    const mouth = l.mouths[1]; h.position.fromArray(mouth.floorCenter).addScaledVector(new T.Vector3(...mouth.outward), 2); l.update(1 / 60);
    assert.equal(l.region, '青岚境'); assert.equal(l.lighting.blend, 1); assert.ok(Math.abs(l.lighting.brightness - 1) < 1e-12);
    const first = l.mouths[0]; h.position.fromArray(first.floorCenter).addScaledVector(new T.Vector3(...first.outward), 2); l.update(1 / 60);
    assert.equal(l.region, null); assert.equal(l.lighting.blend, 0);
    h.ground.geometry.dispose(); h.ground.material.dispose(); h.sunnySky.dispose(); h.rainySky.dispose();
  }
  assert.match(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), /world\?\.worldLink\?\.region \?\?/);
});

test('the scanned walls occlude the world being toggled at both visibility thresholds', () => {
  const geometry = mesh.geometry.clone().setAttribute('position', new T.BufferAttribute(physics.positions, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const shell = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide })); shell.updateMatrixWorld(true);
  for (const [index, end] of [[49, 1], [158, 0]]) {
    const p = link.route[index], eye = new T.Vector3(p[0], link.floor.heightAt(p[0], p[2]) + 1.85, p[2]), mouth = link.mouths[end];
    for (const offset of [-2, 0, 2]) {
      const target = new T.Vector3(...mouth.floorCenter).add(new T.Vector3(-mouth.outward[2] * offset, 1.85, mouth.outward[0] * offset)), ray = target.sub(eye);
      assert.ok(new T.Raycaster(eye, ray.clone().normalize(), .05, ray.length() - .15).intersectObject(shell).length > 0);
    }
  }
  geometry.dispose(); shell.material.dispose();
});

test('initial rainforest asset requests stay identical to the recorded production baseline', () => {
  const baseline = JSON.parse(readFileSync(new URL('../src/cave/cave-boot.json', import.meta.url)));
  const habitat = readFileSync(new URL('../src/habitat.js', import.meta.url), 'utf8');
  const world = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
  const files = [...habitat.match(/const FILES = \{([^}]+)\}/)[1].matchAll(/\w+: '([^']+)'/g)].map(m => m[1] === 'captured-banyan' ? 'captured-banyan-low' : m[1]);
  files.push('captured-banyan-far', 'morpho-butterfly');
  const requested = [...files.map(name => `/models/${name}.glb`), ...[...world.matchAll(/texture\('([^']+)'/g)].map(m => '/textures/' + m[1]), ...[...world.matchAll(/hdrLoader.loadAsync\('([^']+)'/g)].map(m => m[1])];
  assert.deepEqual(requested.sort(), [...baseline.assets].sort());
  assert.match(world, /scheduleCave\(start = \(\) => import\('\.\/cave\/cave-link.js'\)/);
  assert.ok(world.indexOf('this.initializing = false;') < world.indexOf("import('./cave/cave-link.js')"));
  assert.doesNotMatch(world, /import .*from ['"].*cave/);
});

test('attachment waits when the mouth is visible nearby, but releases off-frustum or beyond 60 m', async t => {
  const original = host.camera, raf = globalThis.requestAnimationFrame, callbacks = [];
  t.after(() => { host.camera = original; if (raf) globalThis.requestAnimationFrame = raf; else delete globalThis.requestAnimationFrame; });
  globalThis.requestAnimationFrame = callback => callbacks.push(callback);
  const mouth = new T.Vector3(...link.mouths[0].center), outward = new T.Vector3(...link.mouths[0].outward);
  host.camera = new T.PerspectiveCamera(60, 1, .1, 220);
  host.camera.position.copy(mouth).addScaledVector(outward, 15); host.camera.lookAt(mouth);
  let attached = false; const waiting = link.waitHidden().then(() => { attached = true; });
  await Promise.resolve(); assert.equal(attached, false); assert.equal(callbacks.length, 1);
  host.camera.lookAt(host.camera.position.clone().add(outward)); callbacks.shift()();
  await waiting; assert.equal(attached, true);
  host.camera.position.copy(mouth).addScaledVector(outward, 61); host.camera.lookAt(mouth);
  await link.waitHidden(); assert.equal(callbacks.length, 0);
});
