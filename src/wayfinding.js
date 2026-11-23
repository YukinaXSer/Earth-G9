import { START, mainTrailX } from './data.js';

export const ENTRANCE_PATH = Array.from({ length: 10 }, (_, i) => {
  const z = 41 - i * 6;
  return { x: mainTrailX(z), z };
});
export const ENTRANCE_YAW = Math.atan2(-ENTRANCE_PATH[2].x + START.x, START.z - ENTRANCE_PATH[2].z);

export function coversEntrancePath(x, z, radius = 0) {
  return ENTRANCE_PATH.slice(1).some((b, i) => {
    const a = ENTRANCE_PATH[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < 1.3 + radius;
  });
}

export function entranceGuidance(position) {
  if (position.z < -13 || position.z > 50 || Math.abs(position.x) > 14) return null;
  const onPath = Math.abs(position.x - mainTrailX(position.z)) < 1.3;
  const z = onPath ? Math.max(-13, position.z - 7) : Math.max(-13, Math.min(41, position.z));
  const target = { x: mainTrailX(z), z };
  const bearing = Math.atan2(target.x - position.x, position.z - target.z) + position.yaw;
  const angle = Math.atan2(Math.sin(bearing), Math.cos(bearing));
  const direction = Math.abs(angle) > 2.35 ? '转身回到小径' : angle > .2 ? '向右转' : angle < -.2 ? '向左转' : '向前走';
  const remaining = Math.ceil(position.z + 13 + (onPath ? 0 : Math.abs(target.x - position.x)));
  return { target, angle, direction, remaining, onPath };
}
