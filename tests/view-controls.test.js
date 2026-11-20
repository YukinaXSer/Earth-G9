import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FOV, MIN_FOV, MAX_FOV, setFov, scaleView, bindLookControls } from '../src/view-controls.js';
import { Rainforest } from '../src/world.js';

function fixture() {
  const listeners = {};
  const canvas = { clientHeight: 800, setPointerCapture() {}, addEventListener(name, handler) { listeners[name] = handler; } };
  const camera = { fov: DEFAULT_FOV, projections: 0, updateProjectionMatrix() { this.projections++; } };
  const world = { active: true, paused: false, camera, yaw: 0, pitch: 0, position: { x: 3, y: 0, z: 30 } };
  world.zoomView = factor => Rainforest.prototype.zoomView.call(world, factor);
  const clear = bindLookControls(canvas, world);
  const pointer = (name, id, x, y = 100) => listeners[name]({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch' });
  return { world, camera, listeners, pointer, clear };
}

test('lens zoom is bounded, reversible and does not move the player', () => {
  const { world, camera } = fixture(), position = { ...world.position };
  scaleView(camera, .5);
  assert.ok(camera.fov < DEFAULT_FOV);
  scaleView(camera, 2);
  assert.ok(Math.abs(camera.fov - DEFAULT_FOV) < 1e-10);
  scaleView(camera, .0001); assert.equal(camera.fov, MIN_FOV);
  scaleView(camera, 10000); assert.equal(camera.fov, MAX_FOV);
  for (const value of [NaN, Infinity, -Infinity]) setFov(camera, value);
  for (const factor of [0, -1, NaN, Infinity]) scaleView(camera, factor);
  assert.equal(camera.fov, MAX_FOV);
  Rainforest.prototype.resetZoom.call(world);
  assert.equal(camera.fov, DEFAULT_FOV);
  world.paused = true;
  world.zoomView(.5); assert.equal(camera.fov, DEFAULT_FOV);
  assert.deepEqual(world.position, position);
});

test('canvas wheel zoom ignores inactive, paused and failed scenes', () => {
  const { world, camera, listeners } = fixture();
  let prevented = false;
  const event = { deltaY: -120, deltaMode: 0, preventDefault() { prevented = true; } };
  listeners.wheel(event); assert.ok(prevented); assert.ok(camera.fov < DEFAULT_FOV);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    const fov = camera.fov; prevented = false;
    listeners.wheel({ ...event, [modifier]: true });
    assert.equal(camera.fov, fov); assert.equal(prevented, false);
  }
  for (const [key, value] of [['active', false], ['paused', true], ['contextFailed', true]]) {
    const previous = world[key], fov = camera.fov; world[key] = value; prevented = false;
    listeners.wheel(event); assert.equal(camera.fov, fov); assert.equal(prevented, false);
    world[key] = previous;
  }
  setFov(camera, DEFAULT_FOV);
  listeners.wheel({ ...event, deltaY: 2, deltaMode: 1 }); assert.ok(camera.fov > DEFAULT_FOV);
  listeners.wheel({ ...event, deltaY: 1, deltaMode: 2 }); assert.ok(camera.fov <= MAX_FOV);
});

test('two-finger pinch zooms without rotating, then one-finger look resumes without jumping', () => {
  const { world, camera, pointer } = fixture();
  pointer('pointerdown', 1, 100); pointer('pointerdown', 2, 300);
  pointer('pointermove', 1, 50); pointer('pointermove', 2, 350);
  assert.ok(camera.fov < DEFAULT_FOV);
  assert.equal(world.yaw, 0); assert.equal(world.pitch, 0);
  pointer('pointerup', 2, 350);
  pointer('pointermove', 1, 60);
  assert.ok(Math.abs(world.yaw + .035) < 1e-10);
  pointer('pointerup', 1, 60);
  pointer('pointermove', 1, 300);
  assert.ok(Math.abs(world.yaw + .035) < 1e-10);
  assert.equal(world.dragging, false);
});

test('cancelled, paused and cleared pointer gestures cannot leave stale look or pinch input', () => {
  for (const name of ['pointercancel', 'lostpointercapture']) {
    const { world, pointer } = fixture();
    pointer('pointerdown', 1, 100); pointer(name, 1, 100); pointer('pointermove', 1, 400);
    assert.equal(world.yaw, 0); assert.equal(world.dragging, false);
  }
  const { world, camera, pointer, clear } = fixture();
  pointer('pointerdown', 1, 100); pointer('pointerdown', 2, 100);
  pointer('pointermove', 2, 200); assert.equal(camera.fov, DEFAULT_FOV);
  world.paused = true; pointer('pointermove', 1, 50);
  world.paused = false; pointer('pointermove', 2, 500);
  assert.equal(camera.fov, DEFAULT_FOV);
  pointer('pointerdown', 1, 100); clear(); pointer('pointermove', 1, 400);
  assert.equal(world.yaw, 0); assert.equal(world.dragging, false);
});
