import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CaveFloorIndex } from '../src/cave/cave-space.js';
import { routePointAt } from '../src/cave/cave-floor-handoff.js';
import { pruneFaces } from './prune-cave-shards.mjs';

export function connectedFragments(positions, indices, seeds, maximumArea = 2) {
  if (positions.length % 3 || indices.length % 3 || !Number.isFinite(maximumArea) || maximumArea <= 0) throw new TypeError('Expected triangle positions, indices and an area limit');
  if (seeds.some(i => !Number.isInteger(i) || i < 0 || i >= indices.length / 3)) throw new RangeError('Invalid fragment seed');
  const faces = Array.from({ length: indices.length / 3 }, (_, face) => {
    const ids = Array.from(indices.slice(face * 3, face * 3 + 3)), [a, b, c] = ids.map(i => new Vector3().fromArray(positions, i * 3));
    return { ids, area: b.sub(a).cross(c.sub(a)).length() / 2 };
  }), edges = new Map(), neighbours = faces.map(() => []), remove = new Set(seeds);
  faces.forEach(({ ids }, face) => {
    for (let j = 0; j < 3; j++) {
      const key = [ids[j], ids[(j + 1) % 3]].sort((a, b) => a - b).join(',');
      if (!edges.has(key)) edges.set(key, []);
      for (const other of edges.get(key)) { neighbours[face].push(other); neighbours[other].push(face); }
      edges.get(key).push(face);
    }
  });
  let changed;
  do {
    changed = false;
    const seen = new Set();
    for (let start = 0; start < faces.length; start++) {
      if (remove.has(start) || seen.has(start)) continue;
      const stack = [start], component = []; let area = 0, touches = false; seen.add(start);
      while (stack.length) {
        const face = stack.pop(); component.push(face); area += faces[face].area;
        for (const next of neighbours[face]) {
          if (remove.has(next)) { touches = true; continue; }
          if (!seen.has(next)) { seen.add(next); stack.push(next); }
        }
      }
      if (touches && area < maximumArea) { for (const face of component) remove.add(face); changed = true; }
    }
  } while (changed);
  return [...remove].sort((a, b) => a - b);
}

async function main() {
  const input = await readFile(process.argv[2] ?? new URL('../public/cave/cave-fitted.glb', import.meta.url)), selection = JSON.parse(await readFile(new URL('../src/cave/cave-mountain-fragments.json', import.meta.url), 'utf8'));
  const { scene } = await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), ''); scene.updateMatrixWorld(true);
  const mesh = scene.getObjectByProperty('isMesh', true), p = mesh.geometry.attributes.position, positions = new Float32Array(p.count * 3), v = new Vector3();
  for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
  const indices = mesh.geometry.index.array, remove = connectedFragments(positions, indices, selection.bodySeeds, selection.maximumConnectedArea);
  const output = pruneFaces(input, remove, selection.bodySourceSha256), removed = new Set(remove), kept = Array.from(indices).filter((_, i) => !removed.has(Math.floor(i / 3)));
  const data = JSON.parse(await readFile(new URL('../src/cave/cave-data.json', import.meta.url), 'utf8')), geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
  const before = new CaveFloorIndex(geometry.clone().setIndex(Array.from(indices)), data.route), after = new CaveFloorIndex(geometry.setIndex(kept), data.route), length = data.route.slice(1).reduce((sum, p, i) => sum + new Vector3(...p).distanceTo(new Vector3(...data.route[i])), 0);
  for (let along = length - 8; along <= length; along += .05) {
    const point = routePointAt(data.route, along), next = routePointAt(data.route, Math.min(length, along + .01)), side = new Vector3(next.z - point.z, 0, point.x - next.x).normalize();
    for (const lateral of [-.6, -.4, -.2, 0, .2, .4, .6]) {
      const q = point.clone().addScaledVector(side, lateral), a = before.heightAt(q.x, q.z), b = after.heightAt(q.x, q.z);
      if (a !== b) throw new Error(`Fragment deletion changes walking support at ${along}, ${lateral}: ${a} / ${b}`);
    }
  }
  const fitPath = new URL('../public/cave/mouth-fit.json', import.meta.url), fit = JSON.parse(await readFile(fitPath, 'utf8'));
  fit.mouths[1].lastFragmentCleanup = { sourceSha256: selection.bodySourceSha256, seeds: selection.bodySeeds.length, removedTriangles: remove.length, connectedAreaLimit: selection.maximumConnectedArea, createdFaces: 0 };
  fit.mouths[1].tubeTrianglesAfterRecess = kept.length / 3; fit.mouths[0].bodyReduction.webTriangles = kept.length / 3;
  await writeFile(new URL('../public/cave/cave-fitted.glb', import.meta.url), output); await writeFile(fitPath, JSON.stringify(fit));
  console.log(`Removed ${remove.length} whole body triangles; protected walking support unchanged over the final 8 m.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
