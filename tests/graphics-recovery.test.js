import test from 'node:test';
import assert from 'node:assert/strict';
import { bindGraphicsRecovery, compatibilityUrl } from '../src/graphics-recovery.js';

test('graphics failure pauses input and changes from high to compatibility mode only once', () => {
  const canvas = new EventTarget(), events = [];
  bindGraphicsRecovery(canvas, { lowDetail: false, pause: () => events.push('pause'), fallback: () => events.push('fallback'), failure: () => events.push('failure') });
  const lost = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lost);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(lost.defaultPrevented, true);
  assert.deepEqual(events, ['pause', 'fallback']);
  const url = new URL(compatibilityUrl('https://forest.example/?quality=high&demo=1#forest'));
  assert.equal(url.searchParams.get('quality'), 'low');
  assert.equal(url.searchParams.get('recovered'), '1');
  assert.equal(url.searchParams.get('demo'), '1');
  assert.equal(url.hash, '#forest');
});

test('compatibility context loss exposes retry instead of causing a reload loop', () => {
  const canvas = new EventTarget(), events = [];
  bindGraphicsRecovery(canvas, { lowDetail: true, pause: () => events.push('pause'), fallback: () => events.push('fallback'), failure: () => events.push('failure') });
  canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.deepEqual(events, ['pause', 'failure']);
});
