import { Box3, Matrix4, Vector3 } from 'three';
import { BOUNDS, CAVE_FOREST_MOUTH } from '../data.js';
import data from './cave-data.json' with { type: 'json' };
import { mouthDistance } from './cave-space.js';

const transform = new Matrix4().makeRotationY(CAVE_FOREST_MOUTH.yaw).setPosition(CAVE_FOREST_MOUTH.x, 0, CAVE_FOREST_MOUTH.z);
const route = data.route.map(point => new Vector3(...point).applyMatrix4(transform));
const bounds = new Box3().setFromPoints(route).expandByScalar(24);
const mouths = data.mouths.map(mouth => ({
  floorCenter: new Vector3(...mouth.floorCenter).applyMatrix4(transform).toArray(),
  outward: new Vector3(...mouth.outward).transformDirection(transform).toArray(),
}));

export function restoreCaveView(host, view) {
  if (!view || !['x', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(view[key]))) return false;
  const link = host.worldLink, region = link?.regionAt(view.x, view.z);
  const linked = link?.ready && region !== 'forest' && link.canMove(view.x, view.z, view.x, view.z) === true;
  const insideForest = view.x >= BOUNDS.minX && view.x <= BOUNDS.maxX && view.z >= BOUNDS.minZ && view.z <= BOUNDS.maxZ;
  const insideCave = bounds.containsPoint(new Vector3(view.x, 0, view.z)) && mouths.every(mouth => mouthDistance(view, mouth) <= .03);
  const fallback = !linked && (!insideForest || insideCave || region === 'mountain');
  const position = fallback ? CAVE_FOREST_MOUTH : view;
  host.position.set(position.x, 0, position.z); host.yaw = view.yaw; host.pitch = view.pitch;
  if (!linked) host.recoverPosition();
  link?.update(0, { teleported: true });
  return true;
}
