import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CaveFloorIndex, nearestRoute } from '../src/cave/cave-space.js';
import { pruneFaces } from './prune-cave-shards.mjs';

export function mountainFloorFaces(positions, indices, route, mouth, flatSeeds = []) {
  if (!Array.isArray(route) || route.length < 2 || !mouth?.floorCenter || !mouth?.outward || positions.length % 3 || indices.length % 3) throw new TypeError('Expected a scanned body, route and mountain seam');
  const center = new Vector3(...mouth.floorCenter), forward = new Vector3(...mouth.outward), side = new Vector3(forward.z, 0, -forward.x);
  const distanceSquared = (p, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, run = dx * dx + dz * dz, t = run ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / run)) : 0;
    return (p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2;
  };
  const orient = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const segments = route.slice(1).map((b, i) => [new Vector3(...route[i]), new Vector3(...b)]);
  const touchesCorridor = triangle => {
    for (const [a, b] of segments) {
      if (Math.max(a.x, b.x) < Math.min(...triangle.map(v => v.x)) - .7 || Math.min(a.x, b.x) > Math.max(...triangle.map(v => v.x)) + .7 || Math.max(a.z, b.z) < Math.min(...triangle.map(v => v.z)) - .7 || Math.min(a.z, b.z) > Math.max(...triangle.map(v => v.z)) + .7) continue;
      const signs = triangle.map((v, j) => orient(v, triangle[(j + 1) % 3], a));
      if (signs.every(x => x >= 0) || signs.every(x => x <= 0)) return true;
      for (let j = 0; j < 3; j++) {
        const c = triangle[j], d = triangle[(j + 1) % 3];
        if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
        if (Math.min(distanceSquared(a, c, d), distanceSquared(b, c, d), distanceSquared(c, a, b), distanceSquared(d, a, b)) <= .7 ** 2) return true;
      }
    }
    return false;
  };
  if (flatSeeds.some(face => !Number.isInteger(face) || face < 0 || face >= indices.length / 3)) throw new RangeError('Invalid reviewed floor face');
  const vertices = [new Vector3(), new Vector3(), new Vector3()], normal = new Vector3(), edge = new Vector3(), relative = new Vector3(), faces = new Set(), cache = new Map();
  const floorGeometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3)); floorGeometry.setIndex(new BufferAttribute(indices, 1));
  const walkFloor = new CaveFloorIndex(floorGeometry, route), routePoint = new Vector3(), floorCache = new Map();
  const localFloor = near => {
    if (floorCache.has(near.along)) return floorCache.get(near.along);
    let total = 0;
    for (let i = 1; i < route.length; i++) {
      const a = new Vector3(...route[i - 1]), b = new Vector3(...route[i]), length = a.distanceTo(b);
      if (total + length >= near.along || i === route.length - 1) {
        routePoint.copy(a).lerp(b, length ? Math.max(0, Math.min(1, (near.along - total) / length)) : 0);
        const height = walkFloor.heightAt(routePoint.x, routePoint.z) ?? near.height;
        floorCache.set(near.along, height); return height;
      }
      total += length;
    }
  };
  const classify = face => {
    if (cache.has(face)) return cache.get(face);
    const i = face * 3;
    vertices.forEach((v, j) => v.fromArray(positions, indices[i + j] * 3));
    const depth = vertices.map(v => relative.copy(v).sub(center).dot(forward));
    normal.subVectors(vertices[1], vertices[0]).cross(edge.subVectors(vertices[2], vertices[0])).normalize();
    const near = vertices.map(v => nearestRoute(v.x, v.z, route));
    const floor = normal.y > .5 && vertices.every((v, j) => v.y < localFloor(near[j]) + 1.2);
    const lateral = vertices.map(v => relative.copy(v).sub(center).dot(side));
    const centroid = vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3);
    const walkable = normal.y > .2 && Math.abs(centroid.y - nearestRoute(centroid.x, centroid.z, route).height) < 1.3;
    const protectedStrip = normal.y > .2 && touchesCorridor(vertices);
    const corridorFloor = walkable && protectedStrip;
    const outsideStrip = !protectedStrip && (lateral.every(x => x > 0) || lateral.every(x => x < 0));
    const result = { depth: Math.max(...depth), floor, outsideStrip, corridorFloor };
    cache.set(face, result); return result;
  };
  for (let face = 0; face < indices.length / 3; face++) {
    const { depth, floor, outsideStrip, corridorFloor } = classify(face);
    if (depth >= -3 && ((depth > 0 && !corridorFloor) || (floor && outsideStrip))) faces.add(face);
  }
  if (flatSeeds.length) {
    const attached = new Map();
    for (let i = 0; i < indices.length; i++) { const vertex = indices[i]; if (!attached.has(vertex)) attached.set(vertex, []); attached.get(vertex).push(Math.floor(i / 3)); }
    let frontier = flatSeeds;
    const seen = new Set();
    for (let ring = 0; ring <= 2; ring++) {
      const next = new Set();
      for (const face of frontier) {
        if (seen.has(face)) continue;
        seen.add(face);
        const { depth, floor, outsideStrip } = classify(face);
        if (depth < -5.25 || !floor || !outsideStrip) continue;
        faces.add(face);
        for (let j = 0; j < 3; j++) for (const neighbour of attached.get(indices[face * 3 + j])) next.add(neighbour);
      }
      frontier = [...next];
    }
  }
  floorGeometry.dispose();
  return [...faces].sort((a, b) => a - b);
}

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/trim-mountain-floor.mjs <original cave-fitted.glb> [reviewed-flat-faces.json]');
  const input = await readFile(resolve(process.argv[2])), data = JSON.parse(await readFile(new URL('../src/cave/cave-data.json', import.meta.url), 'utf8'));
  const { scene } = await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '');
  scene.updateMatrixWorld(true);
  const mesh = scene.getObjectByProperty('isMesh', true), p = mesh.geometry.attributes.position, positions = new Float32Array(p.count * 3), v = new Vector3();
  for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
  const review = process.argv[3] ? JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')) : { faces: [] };
  const faces = mountainFloorFaces(positions, mesh.geometry.index.array, data.route, data.mouths[1], review.faces), output = pruneFaces(input, faces, review.sourceSha256);
  const fitPath = new URL('../public/cave/mouth-fit.json', import.meta.url), fit = JSON.parse(await readFile(fitPath, 'utf8'));
  const triangles = mesh.geometry.index.count / 3 - faces.length;
  fit.mouths[1].floorEdgeTrim = { sourceSha256: createHash('sha256').update(input).digest('hex'), inwardBandMetres: 3, corridorHalfWidthMetres: .7, maxFloorHeightMetres: 1.2, minNormalY: .5, removedTriangles: faces.length, createdFaces: 0 };
  if (review.faces.length) fit.mouths[1].floorEdgeTrim.reviewedFlatNeighbours = { seeds: review.faces, rings: 2, maximumInwardMetres: 5.25 };
  fit.mouths[1].tubeTrianglesAfterRecess = triangles; fit.mouths[0].bodyReduction.webTriangles = triangles;
  await writeFile(new URL('../public/cave/cave-fitted.glb', import.meta.url), output);
  await writeFile(fitPath, JSON.stringify(fit));
  console.log(`Deleted ${faces.length} mountain floor-edge triangles; ${triangles} remain; source vertex attributes unchanged.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
