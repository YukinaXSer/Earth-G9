import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CaveLink } from '../src/cave/cave-link.js';
import { Rainforest } from '../src/world.js';
import { START } from '../src/data.js';

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
