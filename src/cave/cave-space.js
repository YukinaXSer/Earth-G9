import * as T from 'three';

export const FOREST_MOUTH = Object.freeze({ x: 72, z: -250, yaw: Math.PI });
export const PLAYER_RADIUS = .4;
const clamp = T.MathUtils.clamp;

export function nearestRoute(x, z, route) {
  let best = { distance: Infinity, along: 0, height: 0, tangent: [0, 0, 1] }, total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dx = b[0] - a[0], dz = b[2] - a[2], run = dx * dx + dz * dz;
    const t = run ? clamp(((x - a[0]) * dx + (z - a[2]) * dz) / run, 0, 1) : 0;
    const distance = Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz), length = Math.hypot(dx, b[1] - a[1], dz);
    if (distance < best.distance) best = { distance, along: total + length * t, height: a[1] + (b[1] - a[1]) * t, tangent: [dx / Math.sqrt(run), 0, dz / Math.sqrt(run)] };
    total += length;
  }
  return best;
}

export function placeMountain(group, entrance, mouth, outward) {
  group.rotation.set(0, Math.atan2(-outward.z, outward.x), 0); group.scale.setScalar(1);
  group.position.set(0, 0, 0); group.updateMatrixWorld(true);
  group.position.copy(mouth).sub(new T.Vector3(entrance.x, entrance.y, entrance.z).applyMatrix4(group.matrixWorld));
  group.updateMatrixWorld(true);
}

export function mouthDistance(point, mouth) {
  return (point.x - mouth.floorCenter[0]) * mouth.outward[0] + (point.z - mouth.floorCenter[2]) * mouth.outward[2];
}

export function placeScannedCliff(source, position, yaw) {
  const cliff = source.clone();
  cliff.position.copy(position); cliff.rotation.set(0, yaw, 0);
  cliff.updateMatrixWorld(true);
  return cliff;
}

export function fitCaveMouthCliffs(source, mouths) {
  return mouths.flatMap((mouth, end) => {
    const outward = new T.Vector3(...mouth.outward), side = new T.Vector3(-outward.z, 0, outward.x);
    const yaw = Math.atan2(-outward.x, -outward.z) + .537;
    return [0, .12].map(offset => {
      const position = new T.Vector3(...mouth.floorCenter).addScaledVector(outward, 4 + offset).addScaledVector(side, offset);
      const facing = placeScannedCliff(source, position, yaw + (offset ? .15 : 0)); facing.userData.caveEnd = end;
      if (end) facing.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.geometry = mesh.geometry.clone();
        mesh.geometry.setAttribute('caveRoute', new T.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(1), 1));
      });
      return facing;
    });
  });
}

export class CaveFloorIndex {
  constructor(geometry, route, size = 2) {
    this.route = route; this.size = size; this.cells = new Map();
    const p = geometry.getAttribute('position'), index = geometry.index;
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3();
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const vertices = [a, b, c].map((v, k) => v.fromBufferAttribute(p, index ? index.getX(i + k) : i + k).clone());
      n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3), near = nearestRoute(center.x, center.z, route);
      const tri = { vertices, floor: n.y > .2 && Math.abs(center.y - near.height) < 1.3 };
      for (let x = Math.floor(Math.min(a.x, b.x, c.x) / size); x <= Math.floor(Math.max(a.x, b.x, c.x) / size); x++) {
        for (let z = Math.floor(Math.min(a.z, b.z, c.z) / size); z <= Math.floor(Math.max(a.z, b.z, c.z) / size); z++) {
          const key = `${x},${z}`; if (!this.cells.has(key)) this.cells.set(key, []); this.cells.get(key).push(tri);
        }
      }
    }
  }
  triangles(x, z) { return this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`) ?? []; }
  heightAt(x, z) {
    let height = -Infinity;
    for (const { vertices: [a, b, c], floor } of this.triangles(x, z)) {
      if (!floor) continue;
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d, v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      if (u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5) height = Math.max(height, u * a.y + v * b.y + (1 - u - v) * c.y);
    }
    return Number.isFinite(height) ? height : null;
  }
  canMove(ax, az, x, z, radius = PLAYER_RADIUS, heightAt = (x, z) => this.heightAt(x, z)) {
    const h = heightAt(x, z), previous = heightAt(ax, az);
    if (h == null || previous == null || h - previous > .4 || previous - h > .65) return false;
    for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      const support = heightAt(x + dx, z + dz); if (support == null || Math.abs(support - h) > .65) return false;
    }
    const clip = (polygon, y, above) => polygon.flatMap((a, i) => {
      const b = polygon[(i + 1) % polygon.length], inside = above ? a.y >= y : a.y <= y, next = above ? b.y >= y : b.y <= y, out = inside ? [a] : [];
      if (inside !== next) out.push(new T.Vector3(a.x, a.y, a.z).lerp(b, (y - a.y) / (b.y - a.y))); return out;
    });
    const candidates = new Set();
    for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) for (const tri of this.triangles(x + dx, z + dz)) candidates.add(tri);
    for (const { vertices } of candidates) {
      const [a, b, c] = vertices;
      if (Math.max(a.y, b.y, c.y) < h + .4 || Math.min(a.y, b.y, c.y) > h + 2 ||
          Math.max(a.x, b.x, c.x) < x - radius || Math.min(a.x, b.x, c.x) > x + radius ||
          Math.max(a.z, b.z, c.z) < z - radius || Math.min(a.z, b.z, c.z) > z + radius) continue;
      const polygon = clip(clip(vertices, h + .4, true), h + 2, false);
      let inside = false;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
        const t = l ? clamp(((x - a.x) * dx + (z - a.z) * dz) / l, 0, 1) : 0;
        if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < radius) return false;
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
      }
      if (inside) return false;
    }
    return true;
  }
}
