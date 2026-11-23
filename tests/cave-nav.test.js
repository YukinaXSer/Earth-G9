import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('top navigation follows the location region and retains its number span', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const body = main.match(/const mountainRegion =[^;]+;\s*\$\('#region-world'\)[^;]+;\s*\$\('#nav-world'\)\.firstChild\.textContent =[^;]+;/)?.[0];
  assert.ok(body);
  const update = new Function('world', '$', body);
  const label = { textContent: '' }, number = { textContent: '01' }, nav = { firstChild: { textContent: '' }, lastChild: number };
  for (const [world, location, navigation] of [
    [{ worldLink: { region: '青岚境' } }, '青岚境', '青岚境 '],
    [{ worldLink: { region: '原生雨林' } }, '原生雨林', '雨林之境 '],
    [{ worldLink: { region: null } }, '原生雨林', '雨林之境 '],
    [{}, '原生雨林', '雨林之境 '],
    [undefined, '原生雨林', '雨林之境 '],
  ]) {
    update(world, id => id === '#region-world' ? label : nav);
    assert.equal(label.textContent, location); assert.equal(nav.firstChild.textContent, navigation);
    assert.equal(nav.lastChild, number); assert.equal(number.textContent, '01');
  }
});
