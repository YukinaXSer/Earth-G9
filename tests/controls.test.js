import test from 'node:test';
import assert from 'node:assert/strict';
import { Rainforest } from '../src/world.js';

test('movement keys leave paused, editable and modified input untouched', () => {
  const previous = globalThis.window;
  const listeners = {};
  globalThis.window = { addEventListener: (name, listener) => { listeners[name] = listener; } };
  try {
    const world = { active: true, paused: false, keys: new Set(), canvas: { addEventListener() {} } };
    Rainforest.prototype.setupControls.call(world);
    const target = { closest: () => null };
    const press = (changes = {}) => {
      let prevented = false;
      const event = { code: 'KeyW', target, preventDefault() { prevented = true; }, ...changes };
      listeners.keydown(event);
      return prevented;
    };
    assert.equal(press(), true);
    assert.equal(world.keys.has('KeyW'), true);
    listeners.keyup({ code: 'KeyW' });
    assert.equal(world.keys.size, 0);

    for (const tag of ['input', 'textarea', 'select']) {
      assert.equal(press({ target: { closest: selector => selector.split(',').includes(tag) } }), false);
    }
    assert.equal(press({ target: { isContentEditable: true } }), false);
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(press({ [modifier]: true }), false);
    assert.equal(press({ code: 'Space', target: { closest: selector => selector === 'button' } }), false);
    world.paused = true;
    assert.equal(press(), false);
    world.paused = false;
    world.active = false;
    assert.equal(press(), false);
    assert.equal(world.keys.size, 0);

    world.active = true;
    assert.equal(press({ shiftKey: true }), true);
    listeners.keyup({ code: 'KeyW' });
    assert.equal(world.keys.size, 0);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
