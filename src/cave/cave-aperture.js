import { Vector3, Matrix3, Matrix4, Plane } from 'three';
import { insideScannedCave } from './cave-volume.js';
import { nearestRoute } from './cave-space.js';

const scannedMountain = name => ['capture-grounded-rock', 'native-mountain', 'coastal-cliff-04-native-capture'].includes(name);

export function limitMountainToExit(root, mouth, { nativeCliff = false } = {}) {
  const normal = new Vector3(...mouth.outward).normalize(), center = new Vector3(...mouth.floorCenter).addScaledVector(normal, -.02);
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (nativeCliff && scannedMountain(mesh.name)) {
      const copy = material => {
        const clone = material.clone();
        clone.onBeforeCompile = material.onBeforeCompile; clone.customProgramCacheKey = material.customProgramCacheKey;
        clone.userData = material.userData; clone.clippingPlanes = []; clone.needsUpdate = true;
        return clone;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
      return;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.clippingPlanes = [plane]; material.clipShadows = true; material.needsUpdate = true;
    }
  });
  return plane;
}

export function clipMountainAperture(root, worldToCave, volume, mouths, { nativeCliff = false, outwardDepth = 0, floorHandoff = null, geometryCache = null, floorHeight = null, insideBody = null } = {}) {
  if (!volume?.route?.length || mouths?.length !== 2) throw new TypeError('Mountain aperture requires scanned cave profiles');
  if (!Number.isFinite(outwardDepth) || outwardDepth < 0) throw new RangeError('Invalid mountain opening depth');
  root.updateMatrixWorld(true);
  const centroid = new Vector3(), vertex = new Vector3(), matrix = new Matrix4(), normalMatrix = new Matrix3(), normal = new Vector3(), edge = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3(), end = mouths[1];
  let removed = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh || !(nativeCliff ? scannedMountain(mesh.name) : ['capture-grounded-rock', 'native-mountain'].includes(mesh.name))) return;
    const geometry = mesh.geometry, p = geometry.attributes.position, index = geometry.index, keep = [];
    matrix.multiplyMatrices(worldToCave, mesh.matrixWorld);
    const key = matrix.elements.join(','), cached = geometryCache?.get(geometry)?.get(key);
    if (cached) { mesh.geometry = cached.geometry; removed += cached.removed; return; }
    const before = removed;
    normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
      centroid.set(0, 0, 0);
      for (const id of ids) centroid.add(vertex.fromBufferAttribute(p, id));
      centroid.multiplyScalar(1 / 3).applyMatrix4(matrix);
      const depth = (centroid.x - end.floorCenter[0]) * end.outward[0] + (centroid.z - end.floorCenter[2]) * end.outward[2];
      a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).applyNormalMatrix(normalMatrix);
      const lateral = (centroid.x - end.floorCenter[0]) * end.outward[2] - (centroid.z - end.floorCenter[2]) * end.outward[0];
      const handoffOverlap = floorHandoff && nativeCliff && depth > -5.25 && depth < outwardDepth && Math.abs(centroid.y - end.floorCenter[1]) < .4 && [a, b, c].some(v => { vertex.copy(v).applyMatrix4(matrix); return nearestRoute(vertex.x, vertex.z, volume.route).along >= floorHandoff.along; });
      const floorOverlap = depth > -.6 || (nativeCliff && depth > -5.25 && (Math.abs(lateral) > .7 || [a, b, c].some(v => { vertex.copy(v).applyMatrix4(matrix); return nearestRoute(vertex.x, vertex.z, volume.route).distance > .7; }) || handoffOverlap));
      let thresholdFloor = Math.abs(centroid.y - end.floorCenter[1]) < .4 && (floorOverlap && Math.abs(normal.y) > .6 || nativeCliff && depth > -5.25 && handoffOverlap);
      if (thresholdFloor && floorHeight) {
        const bodyHeight = floorHeight(centroid.x, centroid.z);
        if (bodyHeight != null && centroid.y > bodyHeight + .003 && (!floorHandoff || nearestRoute(centroid.x, centroid.z, volume.route).along < floorHandoff.rampStart) && [a, b, c].every(v => { vertex.copy(v).applyMatrix4(matrix); return floorHeight(vertex.x, vertex.z) != null; })) thresholdFloor = false;
      }
      if (depth < outwardDepth && !thresholdFloor && (insideScannedCave(centroid.toArray(), volume, mouths) || depth < -5.25 && insideBody && (insideBody(centroid) || [a, b, c].some(v => insideBody(vertex.copy(v).applyMatrix4(matrix)))))) removed++;
      else keep.push(...ids);
    }
    if (keep.length !== (index?.count ?? p.count)) {
      mesh.geometry = geometry.clone(); mesh.geometry.setIndex(keep);
    }
    if (geometryCache) {
      if (!geometryCache.has(geometry)) geometryCache.set(geometry, new Map());
      geometryCache.get(geometry).set(key, { geometry: mesh.geometry, removed: removed - before });
    }
  });
  return removed;
}
