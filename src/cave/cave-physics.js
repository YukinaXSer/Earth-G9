import * as T from 'three';
import { CaveFloorIndex, nearestRoute, mouthDistance } from './cave-space.js';
import { groundHeight } from '../data.js';

export function fitCaveFloor(positions, route, mouths, grade) {
    const p = new T.Vector3();
    const length = nearestRoute(route.at(-1)[0], route.at(-1)[2], route).along;
    for (let i = 0; i < positions.length; i += 3) {
      p.fromArray(positions, i); const near = nearestRoute(p.x, p.z, route);
      if (Math.abs(p.y - near.height) > 1.1) continue;
      const end = mouthDistance(p, mouths[1]), start = mouthDistance(p, mouths[0]);
      if (near.along > length - 5 && end > -4) {
        const blend = T.MathUtils.smoothstep(end, -4, -.3);
        positions[i + 1] = T.MathUtils.lerp(p.y, mouths[1].floorCenter[1] + grade * end, blend);
      } else if (near.along < 4 && start > -3) {
        positions[i + 1] = T.MathUtils.lerp(p.y, groundHeight(p.x, p.z), T.MathUtils.smoothstep(start, -3, -.2));
      }
    }
}

export function prepareCavePhysics(data) {
    const { positions, indices, route, mouths, grade } = data;
    if (!data.prepared) fitCaveFloor(positions, route, mouths, grade);
    const geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setIndex(new T.BufferAttribute(indices, 1)); geometry.computeVertexNormals();
    const floor = new CaveFloorIndex(geometry, route);
    return { positions, normals: geometry.getAttribute('normal').array, floor: { cells: floor.cells, route, size: floor.size } };
}
