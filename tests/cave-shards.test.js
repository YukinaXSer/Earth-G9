import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pruneFaces } from '../scripts/prune-cave-shards.mjs';

function fixture(componentType = 5123) {
  const width = componentType === 5125 ? 4 : 2, blob = Buffer.alloc(36 + 6 * width, 71);
  [0, 1, 2, 2, 1, 0].forEach((value, i) => componentType === 5125 ? blob.writeUInt32LE(value, 36 + i * width) : blob.writeUInt16LE(value, 36 + i * width));
  const document = { asset: { version: '2.0' }, meshes: [{ primitives: [{ indices: 0 }] }],
    accessors: [{ bufferView: 0, componentType, count: 6, type: 'SCALAR' }], bufferViews: [{ byteOffset: 36, byteLength: 6 * width }] };
  let header = Buffer.from(JSON.stringify(document));
  header = Buffer.concat([header, Buffer.alloc((-header.length >>> 0) % 4, 32)]);
  const prefix = Buffer.alloc(20), binary = Buffer.alloc(8);
  [0x46546c67, 2, 28 + header.length + blob.length, header.length, 0x4e4f534a].forEach((value, i) => prefix.writeUInt32LE(value, 4 * i));
  binary.writeUInt32LE(blob.length); binary.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([prefix, header, binary, blob]);
}

for (const componentType of [5123, 5125]) test(`shard pruning deletes whole triangles and preserves vertex bytes (${componentType})`, () => {
  const input = fixture(componentType), before = Buffer.from(input), output = pruneFaces(input, [0]);
  const length = output.readUInt32LE(12), document = JSON.parse(output.subarray(20, 20 + length)), blob = output.subarray(28 + length);
  assert.equal(document.accessors[0].count, 3);
  assert.deepEqual(blob.subarray(0, 36), Buffer.alloc(36, 71));
  const width = componentType === 5125 ? 4 : 2;
  assert.deepEqual([0, 1, 2].map(i => componentType === 5125 ? blob.readUInt32LE(36 + i * width) : blob.readUInt16LE(36 + i * width)), [2, 1, 0]);
  assert.deepEqual(input, before);
});

test('empty shard selection preserves the entire GLB', () => assert.deepEqual(pruneFaces(fixture(), []), fixture()));
test('shard pruning rejects stale assets and invalid face selections', () => {
  const input = fixture();
  assert.throws(() => pruneFaces(input, [0], 'stale'), /checksum/);
  const hash = createHash('sha256').update(input).digest('hex');
  assert.doesNotThrow(() => pruneFaces(input, [0], hash));
  for (const faces of [[-1], [2], [.5], [1, 1]]) assert.throws(() => pruneFaces(input, faces), /Invalid shard/);
  assert.throws(() => pruneFaces(Buffer.alloc(28), [0]), /Invalid GLB/);
});
