import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { CaveLink } from '../src/cave/cave-link.js';
import { Rainforest } from '../src/world.js';
import { START, CAVE_FOREST_MOUTH, loadView, saveView } from '../src/data.js';
import { restoreCaveView } from '../src/cave/cave-view.js';
import { decodeMountainGeometry } from '../src/xianxia-mountain-geometry.js';
import { gradeCaptureApproach } from '../src/xianxia-near.js';
import { createFloorIndex } from '../src/xianxia-world.js';
import { MountainTileSurface } from '../src/xianxia-mountain-surface.js';
import { mouthDistance } from '../src/cave/cave-space.js';

function fixture(lowDetail = false) {
  const scene = new T.Scene(), visible = new T.Group(), hidden = new T.Group();
  hidden.visible = false; scene.add(visible, hidden);
  const host = { scene, lowDetail, position: new T.Vector3(), camera: new T.PerspectiveCamera(),
    ground: new T.Group(), water: new T.Group(), rain: new T.Group(), rainy: false, colliders: [],
    habitat: { updateVisibility() {} }, notifyPosition() {}, recoverPosition: Rainforest.prototype.recoverPosition };
  const link = host.worldLink = new CaveLink(host);
  link.ready = true; link.forestDressing = new T.Group();
  return { host, link, visible, hidden };
}

test('map travel and return to entrance restore forest visibility without walking through the bends', () => {
  for (const lowDetail of [false, true]) for (const teleport of ['map', 'entrance']) {
    const { host, link, visible, hidden } = fixture(lowDetail);
    link.mountain.groundHeight = () => 1;
    const mouth = link.mouths[1];
    host.position.fromArray(mouth.floorCenter).addScaledVector(new T.Vector3(...mouth.outward), 2);
    link.update(0);
    assert.equal(link.region, '青岚境');
    assert.equal(visible.visible, false);
    if (teleport === 'map') Rainforest.prototype.travelTo.call(host, START);
    else Rainforest.prototype.resetPosition.call(host);
    link.update(0);
    assert.equal(link.forestHidden, false);
    assert.equal(visible.visible, true);
    assert.equal(hidden.visible, false);
    assert.equal(host.ground.visible, true);
    assert.equal(host.water.visible, true);
    assert.equal(link.forestDressing.visible, true);
    assert.equal(host.rain.visible, false);
  }
});

test('saved linked positions retain coordinates and restore exactly only when support is ready', () => {
  const { host, link } = fixture();
  const cave = link.route[100], mountain = new T.Vector3(...link.mouths[1].floorCenter).addScaledVector(new T.Vector3(...link.mouths[1].outward), 4);
  for (const [point, region] of [[link.route[10], 'cave'], [cave, 'cave'], [link.route.at(-1), 'cave'], [mountain.toArray(), 'mountain']]) {
    const original = { x: point[0], z: point[2], yaw: .7, pitch: -.2 };
    let stored;
    const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
    assert.equal(saveView(storage, original), true);
    const view = loadView(storage, { preservePosition: true });
    assert.deepEqual(view, original);
    host.worldLink = null;
    assert.equal(restoreCaveView(host, view), true);
    assert.deepEqual([host.position.x, host.position.z], [CAVE_FOREST_MOUTH.x, CAVE_FOREST_MOUTH.z]);
    assert.equal(host.yaw, original.yaw); assert.equal(host.pitch, original.pitch);
    host.worldLink = link; link.ready = false;
    link.regionAt = (x, z) => x === view.x && z === view.z ? region : 'forest';
    link.canMove = () => true;
    restoreCaveView(host, view);
    assert.deepEqual([host.position.x, host.position.z], [CAVE_FOREST_MOUTH.x, CAVE_FOREST_MOUTH.z]);
    link.ready = true;
    restoreCaveView(host, view);
    assert.deepEqual([host.position.x, host.position.z], [original.x, original.z]);
    if (region === 'mountain') { assert.equal(link.mountain.group.visible, true); assert.equal(host.ground.visible, false); }
    link.canMove = () => false;
    restoreCaveView(host, view);
    assert.deepEqual([host.position.x, host.position.z], [CAVE_FOREST_MOUTH.x, CAVE_FOREST_MOUTH.z]);
  }
});

test('forest saves still recover locally, while malformed or unavailable saves leave position alone', () => {
  const { host } = fixture(); host.worldLink = null;
  const view = { x: -6, z: -31, yaw: .5, pitch: .12 };
  assert.equal(restoreCaveView(host, view), true);
  assert.deepEqual([host.position.x, host.position.z], [view.x, view.z]);
  for (const invalid of [null, {}, { ...view, z: Infinity }, { ...view, yaw: NaN }]) {
    assert.equal(restoreCaveView(host, invalid), false);
    assert.deepEqual([host.position.x, host.position.z], [view.x, view.z]);
  }
  assert.equal(loadView({ getItem() { throw Error('denied'); } }, { preservePosition: true }), null);
});

test('supported mountain paths outside the cave bounds delegate movement to the native tile surface', () => {
  const { host, link } = fixture(), surface = new MountainTileSurface();
  for (let phase = 0; phase < 4; phase++) {
    const bytes = readFileSync(new URL(`../public/xianxia/surface/v3/tile-${phase}-near.bin`, import.meta.url));
    let geometry = decodeMountainGeometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (!phase) geometry = gradeCaptureApproach(geometry);
    const index = createFloorIndex([geometry], 2);
    surface.set(0, phase, [index]);
    surface.set(-1, phase, [index], 1);
  }
  link.mountain.world.floorIndex = surface;
  link.floor = {}; link.caveAttached = true;
  const from = new T.Vector3(126.95, 0, -110.35).applyMatrix4(link.mountain.group.matrixWorld);
  const to = new T.Vector3(127, 0, -110.35).applyMatrix4(link.mountain.group.matrixWorld);
  assert.equal(link.bounds.containsPoint(to), false);
  assert.ok(Number.isFinite(link.mountain.groundHeight(to.x, to.z)));
  assert.equal(link.mountain.canMove(from.x, from.z, to.x, to.z), true);
  assert.equal(link.regionAt(to.x, to.z), 'mountain');
  assert.equal(link.canMove(from.x, from.z, to.x, to.z), true);
  assert.equal(link.canMove(to.x, to.z, from.x, from.z), true);
  const clipped = new T.Vector3(90, 0, -75).applyMatrix4(link.mountain.group.matrixWorld);
  assert.ok(Number.isFinite(link.mountain.groundHeight(clipped.x, clipped.z)));
  assert.ok(mouthDistance(clipped, link.mouths[1]) < -.03);
  assert.equal(link.regionAt(clipped.x, clipped.z), 'forest');
  assert.equal(link.canMove(clipped.x, clipped.z, clipped.x, clipped.z), false);
  assert.equal(link.regionAt(1e6, 1e6), 'forest');
  assert.equal(link.canMove(to.x, to.z, 1e6, 1e6), false);
  assert.equal(link.regionAt(START.x, START.z), 'forest');
  assert.equal(host.worldLink, link);
});
