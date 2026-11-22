import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function pruneFaces(input, faces, expectedHash) {
  if (expectedHash && createHash('sha256').update(input).digest('hex') !== expectedHash) throw new Error('Scan checksum mismatch');
  if (input.length < 28 || input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(8) !== input.length) throw new Error('Invalid GLB');
  const length = input.readUInt32LE(12), document = JSON.parse(input.subarray(20, 20 + length));
  const primitive = document.meshes[0].primitives[0], accessor = document.accessors[primitive.indices];
  if ((primitive.mode ?? 4) !== 4 || accessor.count % 3 || ![5123, 5125].includes(accessor.componentType)) throw new Error('Expected indexed triangles');
  const remove = new Set(faces);
  if (remove.size !== faces.length || faces.some(face => !Number.isInteger(face) || face < 0 || face >= accessor.count / 3)) throw new RangeError('Invalid shard face selection');
  if (!remove.size) return Buffer.from(input);
  const blob = input.subarray(28 + length), output = Buffer.from(blob);
  const view = document.bufferViews[accessor.bufferView], offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = accessor.componentType === 5125 ? 12 : 6;
  let count = 0;
  for (let face = 0; face < accessor.count / 3; face++) {
    if (remove.has(face)) continue;
    blob.copy(output, offset + count * stride, offset + face * stride, offset + (face + 1) * stride);
    count++;
  }
  accessor.count = count * 3;
  let header = Buffer.from(JSON.stringify(document));
  header = Buffer.concat([header, Buffer.alloc((-header.length >>> 0) % 4, 32)]);
  const prefix = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  [0x46546c67, 2, 28 + header.length + output.length, header.length, 0x4e4f534a].forEach((value, i) => prefix.writeUInt32LE(value, i * 4));
  binaryHeader.writeUInt32LE(output.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([prefix, header, binaryHeader, output]);
}

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node scripts/prune-cave-shards.mjs <original cave asset directory>');
  const selection = JSON.parse(await readFile(new URL('./cave-shard-selection.json', import.meta.url), 'utf8'));
  const target = fileURLToPath(new URL('../public/cave/', import.meta.url)), plans = [];
  for (const asset of selection.assets) {
    if (asset.file !== 'cave-fitted.glb') throw new Error('Only the reviewed body shard selection is supported');
    const input = await readFile(resolve(source, asset.file));
    plans.push({ file: asset.file, data: pruneFaces(input, asset.faces, asset.sourceSha256), removed: asset.faces.length });
  }
  const fitPath = resolve(target, 'mouth-fit.json'), fit = JSON.parse(await readFile(fitPath, 'utf8'));
  const removed = plans.reduce((sum, plan) => sum + plan.removed, 0);
  fit.mouths[1].visibleShardCleanup = { ...selection.region, sourceCommit: selection.sourceCommit, removedTriangles: removed, createdFaces: 0 };
  const body = plans.find(plan => plan.file === 'cave-fitted.glb').data;
  const document = JSON.parse(body.subarray(20, 20 + body.readUInt32LE(12)));
  const triangles = document.accessors[document.meshes[0].primitives[0].indices].count / 3;
  fit.mouths[1].tubeTrianglesAfterRecess = triangles;
  fit.mouths[0].bodyReduction.webTriangles = triangles;
  for (const plan of plans) await writeFile(resolve(target, plan.file), plan.data);
  await writeFile(fitPath, JSON.stringify(fit));
  console.log(`Deleted ${removed} reviewed shard triangles; ${triangles} body triangles remain; vertex attributes unchanged.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
