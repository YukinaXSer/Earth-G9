import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

function supports(data, character) {
  let cmap;
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const entry = 12 + i * 16;
    if (data.toString('ascii', entry, entry + 4) === 'cmap') cmap = data.readUInt32BE(entry + 8);
  }
  assert.ok(cmap);
  for (let i = 0; i < data.readUInt16BE(cmap + 2); i++) {
    const table = cmap + data.readUInt32BE(cmap + 8 + i * 8);
    if (data.readUInt16BE(table) !== 4) continue;
    const count = data.readUInt16BE(table + 6) / 2;
    for (let segment = 0; segment < count; segment++) {
      const end = data.readUInt16BE(table + 14 + segment * 2);
      const start = data.readUInt16BE(table + 16 + count * 2 + segment * 2);
      if (character < start || character > end) continue;
      const delta = data.readInt16BE(table + 16 + count * 4 + segment * 2);
      const offset = table + 16 + count * 6 + segment * 2;
      const range = data.readUInt16BE(offset);
      const glyph = range ? data.readUInt16BE(offset + range + (character - start) * 2) : character;
      if (glyph && ((glyph + delta) & 0xffff)) return true;
    }
  }
  return false;
}

test('both bundled fonts cover every Chinese character in application text', () => {
  const source = new URL('../src/', import.meta.url);
  const text = readdirSync(source).filter(name => /\.(js|css)$/.test(name)).map(name => readFileSync(new URL(name, source), 'utf8')).join('');
  const characters = new Set(text.match(/[\u4e00-\u9fff]/g));
  for (const name of ['noto-sans-sc', 'noto-serif-sc']) {
    const data = readFileSync(new URL(`../public/${name}.ttf`, import.meta.url));
    const missing = [...characters].filter(character => !supports(data, character.charCodeAt(0))).join('');
    assert.equal(missing, '', `${name}: missing glyphs`);
  }
});
