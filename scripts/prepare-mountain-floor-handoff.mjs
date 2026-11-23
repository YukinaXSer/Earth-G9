import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CaveLink } from '../src/cave/cave-link.js';
import { CaveFloorIndex, nearestRoute } from '../src/cave/cave-space.js';
import { findFloorHandoff } from '../src/cave/cave-floor-handoff.js';
import { loadProductionMountain } from '../tests/production-mountain-fixture.js';
import data from '../src/cave/cave-data.json' with { type: 'json' };
import { pruneFaces } from './prune-cave-shards.mjs';
import { mountainFloorFaces } from './trim-mountain-floor.mjs';

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-mountain-floor-handoff.mjs <original cave-fitted.glb>');
  const input = await readFile(resolve(process.argv[2])), fitPath = new URL('../public/cave/mouth-fit.json', import.meta.url), fit = JSON.parse(await readFile(fitPath, 'utf8'));
  const root = (await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '')).scene;
  const link = new CaveLink({ scene: new T.Scene() }); root.applyMatrix4(link.transform); root.updateMatrixWorld(true);
  const mesh = root.getObjectByProperty('isMesh', true), p = mesh.geometry.attributes.position, positions = new Float32Array(p.count * 3), v = new T.Vector3();
  for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
  const floor = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)).setIndex(mesh.geometry.index), link.route);
  const native = await loadProductionMountain(link, fit, data.mouths, { clipAperture: false });
  try {
    const height = (x, z) => link.mountain.groundHeight(x, z), plan = findFloorHandoff(link.route, (x, z) => floor.heightAt(x, z), height);
    if (!plan) throw new Error('No continuously supported native floor in the last 3 m');
    const indices = mesh.geometry.index.array, remove = [], selected = new Set(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3();
    for (let i = 0; i < indices.length; i += 3) {
      const ids = [indices[i], indices[i + 1], indices[i + 2]], vertices = [a, b, c]; vertices.forEach((v, j) => v.fromArray(positions, ids[j] * 3));
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3), near = nearestRoute(center.x, center.z, link.route);
      if (n.y <= .5 || vertices.some(v => Math.abs(v.y - nearestRoute(v.x, v.z, link.route).height) >= .6) || near.along < plan.along - 2 || near.distance > 1.2) continue;
      const matches = vertices.every(v => { const local = nearestRoute(v.x, v.z, link.route), h = height(v.x, v.z); return local.along >= plan.along && Number.isFinite(h) && Math.abs(v.y - h) <= .10; });
      if (matches) remove.push(i / 3);
      else for (const id of ids) selected.add(id);
    }
    let output = pruneFaces(input, remove);
    const jsonLength = output.readUInt32LE(12), document = JSON.parse(output.subarray(20, 20 + jsonLength)), primitive = document.meshes[0].primitives[0], accessor = document.accessors[primitive.attributes.POSITION], view = document.bufferViews[accessor.bufferView];
    if (accessor.componentType !== 5123 || !accessor.normalized) throw new Error('Expected normalized scanned position buffer');
    const inverse = mesh.matrixWorld.clone().invert(); let adjusted = 0;
    for (const id of selected) {
      v.fromArray(positions, id * 3); const near = nearestRoute(v.x, v.z, link.route), h = height(v.x, v.z);
      if (!Number.isFinite(h)) continue;
      const t = T.MathUtils.smoothstep(near.along, plan.rampStart, plan.along), edge = T.MathUtils.smoothstep(near.distance, .6, .7);
      if (!t && !edge) continue;
      v.y = T.MathUtils.lerp(v.y, h - .002, t); v.y = T.MathUtils.lerp(v.y, Math.min(v.y, h - .025), edge); v.applyMatrix4(inverse);
      const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + id * (view.byteStride ?? 6) + 2;
      output.writeUInt16LE(Math.round(T.MathUtils.clamp(v.y, 0, 1) * 65535), offset); adjusted++;
    }
    const mask = Buffer.alloc((p.count + 3) & ~3), dressedVertices = new Set();
    const binary = Buffer.concat([output.subarray(28 + jsonLength), mask]);
    document.bufferViews.push({ buffer: 0, byteOffset: output.length - 28 - jsonLength, byteLength: p.count });
    document.accessors.push({ bufferView: document.bufferViews.length - 1, componentType: 5121, count: p.count, type: 'SCALAR', min: [0], max: [1] });
    primitive.attributes._CAVE_NATIVE_FLOOR = document.accessors.length - 1; document.buffers[0].byteLength = binary.length;
    let json = Buffer.from(JSON.stringify(document)); json = Buffer.concat([json, Buffer.alloc((-json.length >>> 0) % 4, 32)]);
    const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
    [0x46546c67, 2, 28 + json.length + binary.length, json.length, 0x4e4f534a].forEach((value, i) => header.writeUInt32LE(value, i * 4));
    binaryHeader.writeUInt32LE(binary.length); binaryHeader.writeUInt32LE(0x004e4942, 4); output = Buffer.concat([header, json, binaryHeader, binary]);
    const dressed = (await new GLTFLoader().parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), '')).scene;
    dressed.updateMatrixWorld(true);
    const dressedMesh = dressed.getObjectByProperty('isMesh', true), local = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) v.fromBufferAttribute(dressedMesh.geometry.attributes.position, i).applyMatrix4(dressedMesh.matrixWorld).toArray(local, i * 3);
    const dressedIndices = dressedMesh.geometry.index.array;
    for (let i = 0; i < dressedIndices.length; i += 3) {
      const ids = [dressedIndices[i], dressedIndices[i + 1], dressedIndices[i + 2]], vertices = [a, b, c]; vertices.forEach((v, j) => v.fromArray(local, ids[j] * 3));
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3), near = nearestRoute(center.x, center.z, data.route);
      if (n.y > .2 && Math.abs(center.y - near.height) < 1.3 && vertices.some(v => nearestRoute(v.x, v.z, data.route).along >= plan.along - 2)) for (const id of ids) dressedVertices.add(id);
    }
    for (const id of dressedVertices) output[28 + json.length + document.bufferViews.at(-1).byteOffset + id] = 1;
    const edgeFaces = mountainFloorFaces(local, dressedMesh.geometry.index.array, data.route, data.mouths[1]);
    output = pruneFaces(output, edgeFaces);
    fit.mouths[1].floorHandoff = { ...plan, sourceSha256: createHash('sha256').update(input).digest('hex'), removedTriangles: remove.length, remainingSheetCleanupTriangles: edgeFaces.length, adjustedVertices: adjusted, nativeFloorVertices: dressedVertices.size, createdFaces: 0 };
    fit.mouths[1].tubeTrianglesAfterRecess = document.accessors[primitive.indices].count / 3 - edgeFaces.length;
    fit.mouths[0].bodyReduction.webTriangles = fit.mouths[1].tubeTrianglesAfterRecess;
    await writeFile(new URL('../public/cave/cave-fitted.glb', import.meta.url), output); await writeFile(fitPath, JSON.stringify(fit));
    console.log(JSON.stringify({ handoffInsideMetres: plan.length - plan.along, rampInsideMetres: plan.length - plan.rampStart, removedTriangles: remove.length, remainingSheetCleanupTriangles: edgeFaces.length, adjustedVertices: adjusted }));
  } finally { native.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
