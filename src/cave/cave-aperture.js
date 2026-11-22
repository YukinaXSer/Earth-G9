import { Vector3, Matrix3, Matrix4, Plane } from 'three';
import { insideScannedCave } from './cave-volume.js';

export function limitMountainToExit(root, mouth) {
  const normal = new Vector3(...mouth.outward).normalize(), center = new Vector3(...mouth.floorCenter).addScaledVector(normal, -.02);
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.clippingPlanes = [plane]; material.clipShadows = true; material.needsUpdate = true;
    }
  });
  return plane;
}

export function clipMountainAperture(root, worldToCave, volume, mouths) {
  if (!volume?.route?.length || mouths?.length !== 2) throw new TypeError('Mountain aperture requires scanned cave profiles');
  root.updateMatrixWorld(true);
  const centroid = new Vector3(), vertex = new Vector3(), matrix = new Matrix4(), normalMatrix = new Matrix3(), normal = new Vector3(), edge = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3(), end = mouths[1];
  let removed = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh || !['capture-grounded-rock', 'native-mountain'].includes(mesh.name)) return;
    const geometry = mesh.geometry, p = geometry.attributes.position, index = geometry.index, keep = [];
    matrix.multiplyMatrices(worldToCave, mesh.matrixWorld);
    normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
      centroid.set(0, 0, 0);
      for (const id of ids) centroid.add(vertex.fromBufferAttribute(p, id));
      centroid.multiplyScalar(1 / 3).applyMatrix4(matrix);
      const depth = (centroid.x - end.floorCenter[0]) * end.outward[0] + (centroid.z - end.floorCenter[2]) * end.outward[2];
      a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).applyNormalMatrix(normalMatrix);
      const thresholdFloor = depth > -.6 && Math.abs(centroid.y - end.floorCenter[1]) < .4 && Math.abs(normal.y) > .6;
      if (depth < 0 && !thresholdFloor && insideScannedCave(centroid.toArray(), volume, mouths)) removed++;
      else keep.push(...ids);
    }
    if (keep.length !== (index?.count ?? p.count)) {
      mesh.geometry = geometry.clone(); mesh.geometry.setIndex(keep);
    }
  });
  return removed;
}
