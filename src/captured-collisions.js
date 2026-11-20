import * as THREE from 'three';

const templates = new WeakMap(), surfaces = new WeakMap(), refined = new WeakMap(), STEP = .2, SURFACE_CELL = .4;

function clipHeight(polygon, height, above) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const insideA = above ? a.y >= height : a.y <= height;
    const insideB = above ? b.y >= height : b.y <= height;
    if (insideA) result.push(a);
    if (insideA !== insideB) result.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)));
  }
  return result;
}

function surfaceTemplate(variant) {
  if (surfaces.has(variant)) return surfaces.get(variant);
  const triangles = [], heights = [], cells = new Map(), bounds = new THREE.Box3();
  for (const mesh of variant.children ?? []) {
    const { position } = mesh.geometry.attributes, indices = mesh.geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      const vertices = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + j)));
      const id = triangles.length / 9, box = new THREE.Box3().setFromPoints(vertices);
      for (const vertex of vertices) triangles.push(vertex.x, vertex.y, vertex.z);
      heights.push(box.min.y, box.max.y);
      bounds.union(box);
      for (let z = Math.floor(box.min.z / SURFACE_CELL); z <= Math.floor(box.max.z / SURFACE_CELL); z++) {
        for (let x = Math.floor(box.min.x / SURFACE_CELL); x <= Math.floor(box.max.x / SURFACE_CELL); x++) {
          const key = `${x}:${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(id);
        }
      }
    }
  }
  const template = { triangles: new Float32Array(triangles), heights: new Float32Array(heights), cells, bounds };
  surfaces.set(variant, template);
  return template;
}

function polygonContains(polygon, x, z, radius) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
    if ((x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 < radius * radius) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function surfaceContains(surface, x, z, margin, groundY) {
  const minY = groundY + .45, maxY = groundY + 2.05, box = new THREE.Box3(), point = new THREE.Vector3();
  for (const px of [x - margin, x + margin]) for (const pz of [z - margin, z + margin]) for (const py of [minY, maxY]) {
    box.expandByPoint(point.set(px, py, pz).applyMatrix4(surface.inverse));
  }
  const candidates = new Set(), { triangles, heights, cells } = surface.template, e = surface.matrix.elements;
  for (let cz = Math.floor(box.min.z / SURFACE_CELL); cz <= Math.floor(box.max.z / SURFACE_CELL); cz++) {
    for (let cx = Math.floor(box.min.x / SURFACE_CELL); cx <= Math.floor(box.max.x / SURFACE_CELL); cx++) {
      for (const id of cells.get(`${cx}:${cz}`) ?? []) candidates.add(id);
    }
  }
  for (const id of candidates) {
    if (e[1] === 0 && e[9] === 0) {
      const a = heights[id * 2] * e[5] + e[13], b = heights[id * 2 + 1] * e[5] + e[13];
      if (Math.max(a, b) < minY || Math.min(a, b) > maxY) continue;
    }
    const polygon = [0, 1, 2].map(j => new THREE.Vector3().fromArray(triangles, id * 9 + j * 3).applyMatrix4(surface.matrix));
    if (polygonContains(clipHeight(clipHeight(polygon, minY, true), maxY, false), x, z, margin)) return true;
  }
  return false;
}

export function refineCollider(collider, variant, matrix) {
  const template = surfaceTemplate(variant), bounds = template.bounds.clone().applyMatrix4(matrix);
  const previous = refined.get(collider), broadMinY = previous ? previous.broadMinY : collider.minY, broadMaxY = previous ? previous.broadMaxY : collider.maxY;
  collider.minY = bounds.min.y;
  collider.maxY = bounds.max.y;
  refined.set(collider, { template, matrix: matrix.clone(), inverse: matrix.clone().invert(), broadMinY, broadMaxY });
  return collider;
}

function woodColumns(variant) {
  if (templates.has(variant)) return templates.get(variant);
  const cells = new Map();
  for (const mesh of variant.children ?? []) {
    const { position } = mesh.geometry.attributes, indices = mesh.geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      let polygon = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + j)));
      if (Math.max(...polygon.map(p => p.y)) < 1.1 || Math.min(...polygon.map(p => p.y)) > 5.5) continue;
      polygon = clipHeight(clipHeight(polygon, 1.1, true), 5.5, false);
      for (let t = 1; t + 1 < polygon.length; t++) {
        const a = polygon[0], b = polygon[t], c = polygon[t + 1];
        const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / .15));
        for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
          const point = a.clone().multiplyScalar(1 - (u + v) / steps).addScaledVector(b, u / steps).addScaledVector(c, v / steps);
          const x = Math.round(point.x / STEP), z = Math.round(point.z / STEP), y = Math.round(point.y / STEP), key = `${x}:${z}`;
          if (!cells.has(key)) cells.set(key, { x: x * STEP, z: z * STEP, heights: new Set() });
          cells.get(key).heights.add(y);
        }
      }
    }
  }
  const columns = [];
  for (const { x, z, heights } of cells.values()) {
    const sorted = [...heights].sort((a, b) => a - b);
    let start = sorted[0], end = start;
    for (const y of [...sorted.slice(1), Infinity]) {
      if (y > end + 1) { columns.push({ x, z, minY: (start - .75) * STEP, maxY: (end + .75) * STEP }); start = y; }
      end = y;
    }
  }
  templates.set(variant, columns);
  return columns;
}

export function capturedCollider(variant, matrix) {
  const center = new THREE.Vector3().setFromMatrixPosition(matrix), scale = new THREE.Vector3().setFromMatrixScale(matrix);
  const radius = .17 * Math.max(scale.x, scale.z), point = new THREE.Vector3();
  const parts = woodColumns(variant).map(column => {
    point.set(column.x, 0, column.z).applyMatrix4(matrix);
    return { x: point.x, z: point.z, radius, minY: center.y + column.minY * scale.y, maxY: center.y + column.maxY * scale.y };
  });
  return refineCollider({ x: center.x, z: center.z, radius: Math.max(0, ...parts.map(p => Math.hypot(p.x - center.x, p.z - center.z) + radius)), parts }, variant, matrix);
}

export function colliderBoundsContain(collider, x, z, margin = .4, groundY) {
  if (Math.hypot(x - collider.x, z - collider.z) >= collider.radius + margin) return false;
  if (collider.parts) return collider.parts.some(part => colliderBoundsContain(part, x, z, margin, groundY));
  const surface = refined.get(collider), minY = surface ? surface.broadMinY : collider.minY, maxY = surface ? surface.broadMaxY : collider.maxY;
  return groundY === undefined || minY === undefined || maxY >= groundY + .45 && minY <= groundY + 2.05;
}

export function colliderContains(collider, x, z, margin = .4, groundY) {
  if (!colliderBoundsContain(collider, x, z, margin, groundY)) return false;
  if (groundY !== undefined && collider.minY !== undefined && (collider.maxY < groundY + .45 || collider.minY > groundY + 2.05)) return false;
  const surface = refined.get(collider);
  return !surface || groundY === undefined || surfaceContains(surface, x, z, margin, groundY);
}

export function createColliderIndex(colliders, cellSize = 16) {
  const cells = new Map(), cell = value => Math.floor(value / cellSize);
  for (const collider of colliders) {
    const radius = collider.radius ?? 0;
    for (let z = cell(collider.z - radius); z <= cell(collider.z + radius); z++) {
      for (let x = cell(collider.x - radius); x <= cell(collider.x + radius); x++) {
        const key = `${x}:${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(collider);
      }
    }
  }
  return {
    query(x, z, radius = .4) {
      const x0 = cell(x - radius), x1 = cell(x + radius), z0 = cell(z - radius), z1 = cell(z + radius);
      if (x0 === x1 && z0 === z1) return cells.get(`${x0}:${z0}`) ?? [];
      const nearby = new Set();
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        for (const collider of cells.get(`${cx}:${cz}`) ?? []) nearby.add(collider);
      }
      return [...nearby];
    },
  };
}
