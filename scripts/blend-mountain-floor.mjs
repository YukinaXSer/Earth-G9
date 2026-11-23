import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CaveLink } from '../src/cave/cave-link.js';
import { CaveFloorIndex, nearestRoute } from '../src/cave/cave-space.js';
import { routePointAt } from '../src/cave/cave-floor-handoff.js';
import { loadProductionMountain } from '../tests/production-mountain-fixture.js';
import data from '../src/cave/cave-data.json' with { type: 'json' };
import { mountainFloorFaces } from './trim-mountain-floor.mjs';
import { pruneFaces } from './prune-cave-shards.mjs';

export function floorBlendHeight(start, end, fraction) {
  if (![start, end, fraction].every(Number.isFinite)) throw new TypeError('Floor blend requires finite heights and fraction');
  return T.MathUtils.lerp(start, end, T.MathUtils.clamp(fraction, 0, 1));
}

async function main() {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/blend-mountain-floor.mjs <source.glb> <output.glb>');
  const input = await readFile(resolve(process.argv[2])), fit = JSON.parse(await readFile(new URL('../public/cave/mouth-fit.json', import.meta.url), 'utf8'));
  const root = (await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '')).scene;
  const link = new CaveLink({ scene: new T.Scene() }), plan = fit.mouths[1].floorHandoff, metres = 4.5, start = plan.along - metres;
  root.applyMatrix4(link.transform); root.updateMatrixWorld(true);
  const mesh = root.getObjectByProperty('isMesh', true), p = mesh.geometry.attributes.position, index = mesh.geometry.index.array;
  const positions = new Float32Array(p.count * 3), v = new T.Vector3(), inverse = mesh.matrixWorld.clone().invert();
  for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
  const floor = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)).setIndex(mesh.geometry.index), link.route);
  const native = await loadProductionMountain(link, fit, data.mouths, { clipAperture: false });
  try {
    const selected = new Set(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    for (let i = 0; i < index.length; i += 3) {
      const ids = Array.from(index.slice(i, i + 3)); [a, b, c].forEach((point, j) => point.fromArray(positions, ids[j] * 3));
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(), center = a.clone().add(b).add(c).multiplyScalar(1 / 3), near = nearestRoute(center.x, center.z, link.route);
      if (normal.y <= .5 || near.distance > 1.2 || near.along < start - 1 || near.along > plan.along + .1 || [a, b, c].some(point => Math.abs(point.y - nearestRoute(point.x, point.z, link.route).height) > .7)) continue;
      for (const id of ids) selected.add(id);
    }
    const first = routePointAt(link.route, start), last = routePointAt(link.route, plan.along), firstNear = nearestRoute(first.x, first.z, link.route), lastNear = nearestRoute(last.x, last.z, link.route);
    const adjusted = new Set();
    for (const id of selected) {
      v.fromArray(positions, id * 3); const near = nearestRoute(v.x, v.z, link.route);
      if (near.along <= start || near.along > plan.along || near.distance > 1.2) continue;
      const center = routePointAt(link.route, near.along), lateral = (v.x - center.x) * near.tangent[2] - (v.z - center.z) * near.tangent[0];
      const low = floor.heightAt(first.x + firstNear.tangent[2] * lateral, first.z - firstNear.tangent[0] * lateral);
      const high = link.mountain.groundHeight(last.x + lastNear.tangent[2] * lateral, last.z - lastNear.tangent[0] * lateral);
      if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
      const grade = floorBlendHeight(low, high - .002, (near.along - start) / metres), edge = T.MathUtils.smoothstep(near.distance, .6, 1.2);
      v.y = T.MathUtils.lerp(grade, Math.min(v.y, grade - .025), edge); v.applyMatrix4(inverse); p.setXYZ(id, v.x, v.y, v.z); adjusted.add(id);
    }
    const normalVertices = new Set();
    for (let i = 0; i < index.length; i += 3) if ([index[i], index[i + 1], index[i + 2]].some(id => adjusted.has(id))) for (let j = 0; j < 3; j++) normalVertices.add(index[i + j]);
    mesh.geometry.computeVertexNormals();
    const length = input.readUInt32LE(12), document = JSON.parse(input.subarray(20, 20 + length)), primitive = document.meshes[0].primitives[0];
    let output = Buffer.from(input);
    for (const [name, attribute] of [['POSITION', p], ['NORMAL', mesh.geometry.attributes.normal]]) {
      const accessor = document.accessors[primitive.attributes[name]], view = document.bufferViews[accessor.bufferView];
      if (!accessor.normalized || ![5122, 5123].includes(accessor.componentType)) throw new TypeError('Expected quantized scan attributes');
      for (let i = 0; i < attribute.count; i++) for (let j = 0; j < 3; j++) {
        if (name === 'NORMAL' && !normalVertices.has(i)) continue;
        const value = [attribute.getX(i), attribute.getY(i), attribute.getZ(i)][j], offset = 28 + length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 6) + j * 2;
        if (accessor.componentType === 5123) output.writeUInt16LE(Math.round(T.MathUtils.clamp(value, 0, 1) * 65535), offset);
        else output.writeInt16LE(Math.round(T.MathUtils.clamp(value, -1, 1) * 32767), offset);
      }
    }
    const localPositions = new Float32Array(p.count * 3), localMatrix = link.transform.clone().invert().multiply(mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(localMatrix).toArray(localPositions, i * 3);
    const sheets = mountainFloorFaces(localPositions, index, data.route, data.mouths[1]);
    output = pruneFaces(output, sheets);
    await writeFile(resolve(process.argv[3]), output);
    await writeFile(resolve(process.argv[3]) + '.json', JSON.stringify({ start, end: plan.along, metres, adjustedVertices: adjusted.size, removedSheetTriangles: sheets.length, sourceSha256: createHash('sha256').update(input).digest('hex'), createdFaces: 0 }));
    console.log(JSON.stringify({ start, end: plan.along, metres, adjustedVertices: adjusted.size, removedSheetTriangles: sheets.length }));
  } finally { native.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
