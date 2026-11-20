import * as THREE from 'three';

const templates = new WeakMap(), STEP = .2;

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
  return { x: center.x, z: center.z, radius: Math.max(0, ...parts.map(p => Math.hypot(p.x - center.x, p.z - center.z) + radius)), parts };
}

export function colliderContains(collider, x, z, margin = .4, groundY) {
  if (Math.hypot(x - collider.x, z - collider.z) >= collider.radius + margin) return false;
  if (collider.parts) return collider.parts.some(part => colliderContains(part, x, z, margin, groundY));
  return groundY === undefined || collider.minY === undefined || collider.maxY >= groundY + .45 && collider.minY <= groundY + 2.05;
}
