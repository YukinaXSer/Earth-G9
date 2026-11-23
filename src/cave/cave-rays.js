import { Box3, Ray, Vector3 } from 'three';

export class CaveRayIndex {
  static async createAsync(indices, yieldFrame, budget = 4) {
    let deadline = performance.now() + budget, count = 0;
    const pause = async () => {
      if (++count % 128 || performance.now() < deadline) return;
      await yieldFrame(); deadline = performance.now() + budget;
    };
    const triangles = new Set();
    for (const index of indices) for (const cell of index.cells.values()) for (const triangle of cell) {
      triangles.add(triangle); await pause();
    }
    const build = async faces => {
      if (!faces.length) return null;
      const box = new Box3();
      for (const face of faces) {
        for (const point of face.vertices) box.expandByPoint(point);
        await pause();
      }
      if (faces.length <= 16) return { box, faces };
      const size = box.getSize(new Vector3()), axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
      const middle = (box.min[axis] + box.max[axis]) * 1.5, left = [], right = [];
      for (const face of faces) {
        (face.vertices.reduce((sum, p) => sum + p[axis], 0) < middle ? left : right).push(face);
        await pause();
      }
      if (!left.length || !right.length) {
        const half = Math.floor(faces.length / 2);
        return { box, left: await build(faces.slice(0, half)), right: await build(faces.slice(half)) };
      }
      return { box, left: await build(left), right: await build(right) };
    };
    const result = Object.create(CaveRayIndex.prototype);
    result.root = await build([...triangles]);
    return result;
  }
  constructor(indices) {
    const triangles = new Set();
    for (const index of indices) for (const cell of index.cells.values()) for (const triangle of cell) triangles.add(triangle);
    const build = faces => {
      if (!faces.length) return null;
      const box = new Box3();
      for (const face of faces) for (const point of face.vertices) box.expandByPoint(point);
      if (faces.length <= 16) return { box, faces };
      const size = box.getSize(new Vector3()), axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
      faces.sort((a, b) => a.vertices.reduce((sum, p) => sum + p[axis], 0) - b.vertices.reduce((sum, p) => sum + p[axis], 0));
      const half = Math.floor(faces.length / 2);
      return { box, left: build(faces.slice(0, half)), right: build(faces.slice(half)) };
    };
    this.root = build([...triangles]);
  }
  cast(origin, direction, maximum, clippingPlanes = [], minimum = .0005) {
    const ray = new Ray(origin, direction), hit = new Vector3();
    let nearest = maximum, found = false;
    const visit = node => {
      if (!node || (!node.box.containsPoint(origin) && (!ray.intersectBox(node.box, hit) || hit.distanceTo(origin) > nearest))) return;
      if (node.faces) {
        for (const face of node.faces) if (ray.intersectTriangle(...face.vertices, false, hit) && !clippingPlanes.some(plane => plane.distanceToPoint(hit) < 0)) {
          const distance = hit.distanceTo(origin);
          if (distance > minimum && distance <= nearest) { nearest = distance; found = true; }
        }
      } else { visit(node.left); visit(node.right); }
    };
    visit(this.root);
    return found ? nearest : Infinity;
  }
}
