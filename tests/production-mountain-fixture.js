import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { limitMountainToExit, clipMountainAperture } from '../src/cave/cave-aperture.js';
import { CaveRayIndex } from '../src/cave/cave-rays.js';
import { createMountainHandoffFloor } from '../src/cave/cave-floor-handoff.js';

export async function loadProductionMountain(link, fit, mouths, { clipAperture = true } = {}) {
  const fetchMock = mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(`../public${url}`, import.meta.url))));
  const parse = GLTFLoader.prototype.parseAsync;
  const geometryOnly = async (bytes, path = '') => {
    const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + length));
    document.materials = document.materials?.map(({ name, alphaMode, alphaCutoff, doubleSided }) => ({ name, alphaMode, alphaCutoff, doubleSided }));
    delete document.images; delete document.textures;
    const json = Buffer.from(JSON.stringify(document)), padding = (4 - json.length % 4) % 4;
    const header = Buffer.alloc(20), binary = bytes.subarray(20 + length);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + json.length + padding + binary.length, 8);
    header.writeUInt32LE(json.length + padding, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const glb = Buffer.concat([header, json, Buffer.alloc(padding, 32), binary]);
    return parse.call(new GLTFLoader(), glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), path);
  };
  const parserMock = mock.method(GLTFLoader.prototype, 'parseAsync', async (data, path) => geometryOnly(Buffer.from(data), path));
  const loaderMock = mock.method(GLTFLoader.prototype, 'loadAsync', async url => geometryOnly(readFileSync(new URL(`../public${url}`, import.meta.url))));
  link.mountain.world.renderer = {
    capabilities: { maxTextureSize: 4096, getMaxAnisotropy: () => 8 },
    extensions: { has: name => name === 'WEBGL_compressed_texture_etc' },
  };
  await link.mountain.load();
  const options = { nativeCliff: true, outwardDepth: fit.mouths[1].nativeOpeningExtensionMetres, floorHandoff: fit.mouths[1].floorHandoff };
  limitMountainToExit(link.mountain.group, link.mouths[1], options);
  if (clipAperture) clipMountainAperture(link.mountain.group, link.transform.clone().invert(), fit.volume, mouths, options);
  link.mountain.group.updateMatrixWorld(true);
  link.nativeFloor = createMountainHandoffFloor(link.mountain.group, link.route, fit.mouths[1].floorHandoff);
  const parts = [], cache = new Map(), instance = new T.Matrix4(), matrix = new T.Matrix4();
  const bounds = new T.Box3().setFromPoints(link.mouths.map(m => new T.Vector3(...m.floorCenter))).expandByScalar(link.length + 40);
  function append(mesh, transform, start = 0, count = mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (material.transparent || material.alphaTest > 0) return;
    const geometry = mesh.geometry, p = geometry.attributes.position, index = geometry.index;
    const box = new T.Box3().setFromBufferAttribute(p).applyMatrix4(transform);
    if (!box.intersectsBox(bounds)) return;
    const key = geometry.uuid + ':' + start + ':' + count;
    if (!cache.has(key)) {
      const faces = [];
      for (let i = start; i < start + count; i += 3) faces.push({ vertices: [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j)) });
      cache.set(key, new CaveRayIndex([{ cells: new Map([[0, faces]]) }]));
    }
    const inverse = transform.clone().invert();
    parts.push({ index: cache.get(key), matrix: transform.clone(), inverse, box,
      clippingPlanes: material.clippingPlanes?.map(plane => plane.clone().applyMatrix4(inverse)) ?? [] });
  }
  link.mountain.group.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible) return;
    if (mesh.isBatchedMesh) {
      for (let i = 0; i < mesh.instanceCount; i++) {
        if (!mesh.getVisibleAt(i)) continue;
        mesh.getMatrixAt(i, instance); matrix.multiplyMatrices(mesh.matrixWorld, instance);
        const range = mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i));
        append(mesh, matrix, range.indexStart, range.indexCount);
      }
    } else if (mesh.isInstancedMesh) {
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, instance); append(mesh, matrix.multiplyMatrices(mesh.matrixWorld, instance)); }
    } else append(mesh, mesh.matrixWorld);
  });
  const ray = new T.Ray(), localRay = new T.Ray(), hit = new T.Vector3();
  return {
    parts: parts.length,
    cast(origin, direction, maximum) {
      let nearest = Infinity;
      ray.set(origin, direction);
      for (const part of parts) {
        if (!part.box.containsPoint(origin) && (!ray.intersectBox(part.box, hit) || hit.distanceTo(origin) > Math.min(maximum, nearest))) continue;
        localRay.copy(ray).applyMatrix4(part.inverse);
        const scale = hit.copy(origin).add(direction).applyMatrix4(part.inverse).distanceTo(localRay.origin);
        const distance = part.index.cast(localRay.origin, localRay.direction, Math.min(maximum, nearest) * scale, part.clippingPlanes, .0005 * scale);
        if (Number.isFinite(distance)) nearest = Math.min(nearest, localRay.at(distance, hit).applyMatrix4(part.matrix).distanceTo(origin));
      }
      return nearest;
    },
    dispose: () => { loaderMock.mock.restore(); parserMock.mock.restore(); fetchMock.mock.restore(); },
  };
}
