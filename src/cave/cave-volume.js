export function insideScannedCave(point, volume, mouths, epsilon = 0) {
  if (!volume?.route?.length || point.some(v => !Number.isFinite(v))) return false;
  const { route, side, radius, axisHeight, clearance } = volume;
  if (!side || !radius || !mouths?.length) throw new TypeError('Missing scanned cave profiles');
  let nearest = 0, distance = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = (point[0] - route[i][0]) ** 2 + (point[2] - route[i][2]) ** 2;
    if (d < distance) { distance = d; nearest = i; }
  }
  for (let end = 0; end < mouths.length; end++) {
    const m = mouths[end];
    if (point.reduce((sum, v, k) => sum + (v - m.floorCenter[k]) * m.outward[k], 0) > 0) nearest = end ? route.length - 1 : 0;
  }
  const p = route[nearest], s = side[nearest], r = radius[nearest];
  const x = point.reduce((sum, v, k) => sum + (v - p[k]) * s[k], 0), y = point[1] - p[1] - axisHeight;
  const angle = ((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) * r.length / (Math.PI * 2);
  const a = Math.floor(angle) % r.length, f = angle % 1;
  return Math.hypot(x, y) < r[a] * (1 - f) + r[(a + 1) % r.length] * f + clearance - epsilon;
}
