import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), start = source.indexOf('async function enterWorld()');
const enter = source.slice(start, source.indexOf('\n}', start) + 2).replace('async function enterWorld()', 'async function actualEnterWorld()').replace("await import('./cave/cave-view.js')", 'await loadSavedView()');

async function click(button, saved, fail = false) {
  const state = { position: 'start', restores: 0, resets: 0 }, world = { canvas: { focus() {} }, resetPosition() { state.position = 'start'; state.resets++; } };
  const handler = source.match(new RegExp(`case '${button}': (.*?) break;`))[1];
  await runInNewContext(`(async()=>{
    let entered=false,entering=false,savedView=saved,navigationTarget=null,pending;
    const settings={sound:false},show=()=>{},toast=()=>{},updateTrailGuide=()=>{},document={body:{classList:{add(){}}}};
    ${enter}
    function enterWorld(){pending=actualEnterWorld();return pending}
    ${handler}
    await pending;
  })()`, { world, saved, loadSavedView: async () => {
    if (fail) throw new Error('Unavailable saved world');
    return { restoreCaveView() { state.restores++; state.position = saved.region; } };
  } });
  return state;
}

test('trail-start entrance discards saved cave and mountain views before asynchronous restoration', async () => {
  for (const region of ['cave', 'mountain']) assert.deepEqual(await click('enter-trail', { region }), { position: 'start', restores: 0, resets: 1 });
});
test('trail-start works with no saved view and bypasses unavailable saved worlds', async () => {
  assert.equal((await click('enter-trail', null)).position, 'start');
  assert.equal((await click('enter-trail', { region: 'mountain' }, true)).position, 'start');
});
test('continue still restores the saved world', async () => {
  assert.deepEqual(await click('enter', { region: 'mountain' }), { position: 'mountain', restores: 1, resets: 0 });
});
