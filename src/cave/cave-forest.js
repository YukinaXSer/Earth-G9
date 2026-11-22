import { Box3, Group, Matrix4, Raycaster, Vector3 } from 'three';
import { insideScannedCave } from './cave-volume.js';
import { BOUNDS, groundHeight } from '../data.js';
import { nearestRoute, mouthDistance } from './cave-space.js';

export function cullForestInCave(habitat, dressing, worldToCave, volume, mouths) {
  if (!Array.isArray(habitat?.cells) || !volume?.route?.length) throw new TypeError('Cave vegetation requires loaded instances and profiles');
  const radius = Math.max(...volume.radius.flat()) + volume.axisHeight + volume.clearance;
  const bounds = new Box3().setFromPoints(volume.route.map(p => new Vector3(...p))).expandByScalar(radius);
  const instance = new Matrix4(), matrix = new Matrix4(), point = new Vector3(), box = new Box3(), hidden = new Matrix4().makeScale(0, 0, 0), roots = new Set(), removed = new Map();
  const intersects = (mesh, transform) => {
    const geometry = mesh.geometry, positions = geometry.attributes.position;
    if (!positions) return false;
    geometry.computeBoundingBox(); box.copy(geometry.boundingBox).applyMatrix4(transform);
    if (!box.intersectsBox(bounds)) return false;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      if (bounds.containsPoint(point) && insideScannedCave(point.toArray(), volume, mouths)) return true;
    }
    return false;
  };
  const trees = new Set();
  for (const tree of habitat.lodTrees ?? []) {
    for (const part of tree.parts) {
      const mesh = part.batch.mesh;
      mesh.updateWorldMatrix(true, false);
      matrix.multiplyMatrices(worldToCave, mesh.matrixWorld).multiply(part.matrix);
      if (intersects(mesh, matrix)) trees.add(tree);
    }
  }
  for (const mesh of habitat.cells) if (mesh.isInstancedMesh) {
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, instance);
      if (!instance.determinant()) continue;
      matrix.multiplyMatrices(worldToCave, mesh.matrixWorld).multiply(instance);
      if (intersects(mesh, matrix)) roots.add(instance.elements.join(','));
    }
  }
  for (const mesh of habitat.cells) if (mesh.isInstancedMesh) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, instance);
      if (!roots.has(instance.elements.join(','))) continue;
      mesh.setMatrixAt(i, hidden);
      if (!removed.has(mesh)) removed.set(mesh, new Set());
      removed.get(mesh).add(i);
    }
    if (removed.has(mesh)) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
  }
  habitat.lodTrees = (habitat.lodTrees ?? []).filter(tree => {
    if (!trees.has(tree) && !tree.parts.some(part => removed.get(part.batch.mesh)?.has(part.index))) return true;
    for (const part of tree.parts) { part.batch.mesh.setMatrixAt(part.index, hidden); part.batch.mesh.instanceMatrix.needsUpdate = true; }
    tree.group?.removeFromParent(); return false;
  });
  dressing?.updateWorldMatrix(true, true);
  for (const plant of [...(dressing?.children ?? [])]) {
    let inside = false;
    plant.traverse(mesh => { if (mesh.isMesh && intersects(mesh, matrix.multiplyMatrices(worldToCave, mesh.matrixWorld))) inside = true; });
    if (!inside) continue;
    plant.removeFromParent();
    dressing.userData.colliders = dressing.userData.colliders.filter(c => Math.hypot(c.x - plant.position.x, c.z - plant.position.z) > .001);
  }
  return [...removed.values()].reduce((sum, ids) => sum + ids.size, 0);
}

export function forestSurfaceContains(x, z, route, mouths, bounds = BOUNDS, width = 12) {
  if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) return true;
  if (route.length < 2 || mouths.length !== 2) return false;
  if (mouthDistance({ x, z }, mouths[0]) > 0 || mouthDistance({ x, z }, mouths[1]) > -.4) return false;
  return nearestRoute(x, z, route).distance <= width;
}

export function clipForestSurface(geometry, route, mouths, bounds = BOUNDS) {
  const positions = geometry.getAttribute('position'), index = geometry.index, keep = [];
  if (!positions) throw new TypeError('Forest clipping requires position geometry');
  const minX = Math.min(...route.map(p => p[0])) - 12, maxX = Math.max(...route.map(p => p[0])) + 12;
  const minZ = Math.min(...route.map(p => p[2])) - 12, maxZ = Math.max(...route.map(p => p[2])) + 12;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    const x = ids.reduce((sum, id) => sum + positions.getX(id), 0) / 3;
    const z = ids.reduce((sum, id) => sum + positions.getZ(id), 0) / 3;
    if (!(x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) && (x < minX || x > maxX || z < minZ || z > maxZ)) continue;
    if (forestSurfaceContains(x, z, route, mouths, bounds)) keep.push(...ids);
  }
  geometry.setIndex(keep);
}

export async function createMouthForest(models, rock, mouth, route, yieldFrame = async () => {}) {
  const group = new Group(); group.name = 'Reused rainforest mouth vegetation';
  group.userData.colliders = [];
  const center = new Vector3(...mouth.floorCenter), forward = new Vector3(...mouth.outward), side = new Vector3(forward.z, 0, -forward.x);
  const ray = new Raycaster(), down = new Vector3(0, -1, 0), position = new Vector3();
  rock.updateMatrixWorld(true);
  let placed = 0;
  const place = async (key, lateral, depth, height, variantIndex = 0) => {
    const variants = models?.get(key);
    if (!variants?.length) return;
    position.copy(center).addScaledVector(side, lateral).addScaledVector(forward, depth);
    if (position.x < BOUNDS.minX || position.x > BOUNDS.maxX || position.z < BOUNDS.minZ || position.z > BOUNDS.maxZ) return;
    if (nearestRoute(position.x, position.z, route).distance < 4) return;
    let floor = groundHeight(position.x, position.z);
    ray.set(new Vector3(position.x, center.y + 80, position.z), down);
    const support = ray.intersectObject(rock, true).find(hit => hit.face.normal.y > .45);
    if (support) floor = Math.max(floor, support.point.y);
    const template = variants[variantIndex % variants.length], clone = template.clone();
    const scale = height / template.userData.height;
    clone.position.set(position.x, floor - .12, position.z); clone.rotation.y = placed * 2.399963229728653;
    clone.scale.setScalar(scale);
    clone.traverse(mesh => { if (mesh.isMesh) { mesh.receiveShadow = true; mesh.castShadow = ['tree', 'forest', 'rock'].includes(key); } });
    group.add(clone);
    if (['tree', 'forest', 'rock'].includes(key)) group.userData.colliders.push({ x: position.x, z: position.z, radius: key === 'rock' ? template.userData.spread * scale * .45 : height * .025, minY: floor, maxY: floor + height });
    if (++placed % 4 === 0) await yieldFrame();
  };
  for (const depth of [-10, -21]) for (const lateral of [-17, -8, 8, 17]) await place(lateral < 0 ? 'tree' : 'forest', lateral, depth, depth < -15 ? 23 : 18);
  for (const lateral of [-26, -17, -8, 8, 17, 26]) await place('distant', lateral, -26, 22);
  for (const depth of [6, 1, -5, -12, -20]) for (const lateral of [-18, -13, -8, 8, 13, 18]) {
    await place('fern', lateral, depth, .8 + (placed % 3) * .15, placed);
    await place('groundcover', lateral + 1, depth - 1.5, 1.2, placed);
    if (placed % 3 === 0) await place('rock', lateral - 1, depth + 1, .55, placed);
  }
  return group;
}
