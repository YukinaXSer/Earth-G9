import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Vector3, Triangle, Line3 } from 'three';

const [sourcePath, outputPath = 'public/models/near-forest-trunk.glb'] = process.argv.slice(2);
if (!sourcePath) throw new Error('Usage: node scripts/build-near-trunk.mjs <original island_tree_02.gltf> [output.glb]');
async function read(file) {
  const raw = await fs.readFile(file);
  if (path.extname(file) !== '.glb') {
    const json = JSON.parse(raw); return { json, bin: await fs.readFile(path.resolve(path.dirname(file), json.buffers[0].uri)) };
  }
  const length = raw.readUInt32LE(12);
  return { json: JSON.parse(raw.subarray(20, 20 + length).toString()), bin: raw.subarray(28 + length) };
}
function accessor(doc, index) {
  const a = doc.json.accessors[index], v = doc.json.bufferViews[a.bufferView];
  const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const [bytes, getter, max] = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 4294967295], 5126: [4, 'getFloat32', 1] }[a.componentType];
  const data = new DataView(doc.bin.buffer, doc.bin.byteOffset, doc.bin.byteLength), result = [];
  for (let i = 0; i < a.count; i++) {
    const row = [];
    for (let j = 0; j < count; j++) {
      let n = data[getter]((v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? count * bytes) + j * bytes, true);
      if (a.normalized) n = Math.max(-1, n / max);
      row.push(n);
    }
    result.push(row);
  }
  return result;
}
function wood(doc) {
  return doc.json.meshes.flatMap(m => m.primitives).find(p => doc.json.materials[p.material].name === 'island_tree_02');
}
const high = await read(sourcePath), low = await read('public/models/forest-tree.glb');
const h = wood(high), l = wood(low);
const positions = accessor(high, h.attributes.POSITION), normals = accessor(high, h.attributes.NORMAL), indices = accessor(high, h.indices).flat();
const lp = accessor(low, l.attributes.POSITION), ln = accessor(low, l.attributes.NORMAL), lu = accessor(low, l.attributes.TEXCOORD_0), li = accessor(low, l.indices).flat();
const allLow = low.json.meshes.flatMap(m => m.primitives).flatMap(p => accessor(low, p.attributes.POSITION));
const bottom = Math.min(...allLow.map(p => p[1]));
const feet = allLow.filter(p => p[1] < bottom + .04);
const foot = [0, bottom, 0];
for (const k of [0, 2]) foot[k] = (Math.min(...feet.map(p => p[k])) + Math.max(...feet.map(p => p[k]))) / 2;
const triangles = [];
for (let i = 0; i < li.length; i += 3) {
  const ids = li.slice(i, i + 3);
  const triangle = new Triangle(...ids.map(k => new Vector3(...lp[k])));
  const entry = { ids, triangle };
  if (triangle.getArea() <= 1e-10) {
    const vs = [triangle.a, triangle.b, triangle.c];
    entry.edge = [[0, 1], [1, 2], [2, 0]].sort((a, b) => vs[b[0]].distanceToSquared(vs[b[1]]) - vs[a[0]].distanceToSquared(vs[a[1]]))[0];
    entry.line = new Line3(vs[entry.edge[0]], vs[entry.edge[1]]);
  }
  triangles.push(entry);
}

const layout = JSON.parse(execFileSync(process.env.PYTHON ?? 'python3', [fileURLToPath(new URL('./map-trunk-grain.py', import.meta.url)), sourcePath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
const barkUV = layout.uvs;
if (barkUV.length !== positions.length) throw new Error('Branch chart vertex count mismatch');
const lodPosition = [], lodNormal = [], originalUV = [];
const closest = new Vector3(), query = new Vector3(), bary = new Vector3();
for (const p of positions) {
  query.fromArray(p); let best = Infinity, target, coordinates;
  for (const candidate of triangles) {
    if (candidate.line) {
      if (candidate.line.distanceSq() < 1e-20) closest.copy(candidate.line.start);
      else candidate.line.closestPointToPoint(query, true, closest);
    } else candidate.triangle.closestPointToPoint(query, closest);
    const distance = closest.distanceToSquared(query);
    if (!Number.isFinite(distance) || distance >= best) continue;
    best = distance; target = candidate; coordinates = closest.toArray();
  }
  if (target.line) {
    const t = target.line.distanceSq() < 1e-20 ? 0 : target.line.closestPointToPointParameter(new Vector3(...coordinates), true);
    bary.set(0, 0, 0).setComponent(target.edge[0], 1 - t).setComponent(target.edge[1], t);
  } else target.triangle.getBarycoord(new Vector3(...coordinates), bary);
  const weights = bary.toArray(), blend = (values, count) => Array.from({ length: count }, (_, k) => target.ids.reduce((sum, id, j) => sum + values[id][k] * weights[j], 0));
  lodPosition.push(coordinates); lodNormal.push(new Vector3(...blend(ln, 3)).normalize().toArray()); originalUV.push(blend(lu, 2));
}
const streams = { POSITION: [], NORMAL: [], TEXCOORD_0: [], TEXCOORD_1: [], _LOD_POSITION: [], _LOD_NORMAL: [] }, remap = new Map(), outIndices = [];
for (let i = 0; i < indices.length; i += 3) {
  const ids = indices.slice(i, i + 3);
  for (const id of ids) {
    const key = id;
    if (!remap.has(key)) {
      remap.set(key, streams.POSITION.length / 3);
      streams.POSITION.push(...positions[id].map((v, k) => v - foot[k])); streams.NORMAL.push(...normals[id]);
      streams.TEXCOORD_0.push(...originalUV[id]); streams.TEXCOORD_1.push(...barkUV[id]);
      streams._LOD_POSITION.push(...lodPosition[id].map((v, k) => v - foot[k])); streams._LOD_NORMAL.push(...lodNormal[id]);
    }
    outIndices.push(remap.get(key));
  }
}
const json = { asset: { version: '2.0', generator: 'Earth-G9 scan-only near trunk', copyright: 'Island Tree 02, Rob Tuytel / Rico Cilliers, Poly Haven, CC0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: {}, mode: 4 }] }], buffers: [], bufferViews: [], accessors: [] };
const buffers = []; let offset = 0;
function append(values, size, indices = false) {
  const array = indices ? new Uint16Array(values) : new Float32Array(values), raw = Buffer.from(array.buffer), padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4); raw.copy(padded);
  const view = json.bufferViews.length; json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: raw.length, target: indices ? 34963 : 34962 });
  buffers.push(padded); offset += padded.length;
  const a = { bufferView: view, componentType: indices ? 5123 : 5126, count: values.length / size, type: size === 1 ? 'SCALAR' : `VEC${size}` };
  if (size === 3) { a.min = [0, 1, 2].map(k => Math.min(...values.filter((_, i) => i % 3 === k))); a.max = [0, 1, 2].map(k => Math.max(...values.filter((_, i) => i % 3 === k))); }
  json.accessors.push(a); return json.accessors.length - 1;
}
if (remap.size >= 65536) throw new Error('Unexpected scan vertex count');
for (const [name, values] of Object.entries(streams)) json.meshes[0].primitives[0].attributes[name] = append(values, name.startsWith('TEXCOORD') ? 2 : 3);
json.meshes[0].primitives[0].indices = append(outIndices, 1, true); json.buffers.push({ byteLength: offset });
const text = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(jsonChunk);
const bin = Buffer.concat(buffers), result = Buffer.alloc(28 + jsonChunk.length + bin.length);
result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
result.writeUInt32LE(jsonChunk.length, 12); result.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(result, 20);
result.writeUInt32LE(bin.length, 20 + jsonChunk.length); result.writeUInt32LE(0x004e4942, 24 + jsonChunk.length); bin.copy(result, 28 + jsonChunk.length);
await fs.writeFile(outputPath, result);
console.log(JSON.stringify({ sourceTriangles: indices.length / 3, originalLowTriangles: li.length / 3, vertices: remap.size, bytes: result.length, branchCharts: layout.charts.length, foot, maxMorphDistance: Math.max(...positions.map((p, i) => new Vector3(...p).distanceTo(new Vector3(...lodPosition[i])))) }, null, 2));
