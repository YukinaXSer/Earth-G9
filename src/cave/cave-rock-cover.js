import { Box3, BufferAttribute, Group, Line3, Ray, Vector3 } from 'three';

export function rockRouteClearance(box, route) {
  const footprint = box.clone(); footprint.min.y = -1; footprint.max.y = 1;
  const point = new Vector3(), a = new Vector3(), b = new Vector3(), direction = new Vector3(), ray = new Ray(), line = new Line3();
  let clearance = Infinity;
  const corners = [box.min.x, box.max.x].flatMap(x => [box.min.z, box.max.z].map(z => new Vector3(x, 0, z)));
  for (let i = 1; i < route.length; i++) {
    a.set(route[i - 1][0], 0, route[i - 1][2]); b.set(route[i][0], 0, route[i][2]);
    const length = direction.subVectors(b, a).length();
    if (!length) { clearance = Math.min(clearance, a.distanceTo(footprint.clampPoint(a, point))); continue; }
    if (length && ray.set(a, direction.normalize()).intersectBox(footprint, point) && point.distanceTo(a) <= length) return 0;
    clearance = Math.min(clearance, a.distanceTo(footprint.clampPoint(a, point)), b.distanceTo(footprint.clampPoint(b, point)));
    line.set(a, b);
    for (const corner of corners) clearance = Math.min(clearance, corner.distanceTo(line.closestPointToPoint(corner, true, point)));
  }
  return clearance;
}

export function createMountainRockCover(models, mouth, route, groundHeight, material) {
  if (!mouth?.floorCenter || !mouth?.outward || !Array.isArray(route) || route.length < 2 || typeof groundHeight !== 'function' || !material) throw new TypeError('Rock cover requires a mouth, route, terrain and material');
  const group = new Group(); group.name = 'Reused scanned mountain shard cover'; group.userData.caveEnd = 1;
  const source = models?.get('rock')?.[3];
  if (!source) return group;
  const rock = source.clone(true), forward = new Vector3(...mouth.outward), side = new Vector3(-forward.z, 0, forward.x);
  rock.position.fromArray(mouth.floorCenter).addScaledVector(forward, -1.614).addScaledVector(side, 3.072);
  rock.position.y = 0; rock.scale.setScalar(1.3); rock.rotation.set(0, Math.PI / 2, 0);
  rock.updateMatrixWorld(true);
  const box = new Box3().setFromObject(rock), clearance = rockRouteClearance(box, route);
  if (box.isEmpty() || clearance < 1.2) return group;
  const samples = [[rock.position.x, rock.position.z], ...[box.min.x, box.max.x].flatMap(x => [box.min.z, box.max.z].map(z => [x, z]))];
  const heights = samples.map(([x, z]) => groundHeight(x, z));
  if (heights.some(height => !Number.isFinite(height))) return group;
  rock.position.y = Math.min(...heights) - .35 - box.min.y;
  rock.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone(); mesh.material = material; mesh.castShadow = true; mesh.receiveShadow = true;
    const count = mesh.geometry.attributes.position.count;
    for (const name of ['caveWallOnly', 'caveGranite', 'caveRoute']) mesh.geometry.setAttribute(name, new BufferAttribute(new Float32Array(count).fill(1), 1));
    mesh.geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(.58), 3));
  });
  group.userData.routeClearance = clearance; group.userData.burialMetres = .35;
  group.add(rock);
  return group;
}
