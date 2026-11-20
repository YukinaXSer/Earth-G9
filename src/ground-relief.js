import heights from './ground-relief.json' with { type: 'json' };

export const TERRAIN = { width: 620, depth: 660, centerZ: -35, step: 2 };

export function capturedRelief(x, z) {
  const size = 8, sampleStep = 4;
  const u = (((x + TERRAIN.width / 2) / sampleStep % size) + size) % size;
  const v = (((z - TERRAIN.centerZ + TERRAIN.depth / 2) / sampleStep % size) + size) % size;
  const ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
  const at = (a, b) => heights[(b % size) * size + a % size] / 255;
  const a = at(ix, iz), b = at(ix, iz + 1), c = at(ix + 1, iz + 1), d = at(ix + 1, iz);
  const height = fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  return (height - .5) * 1.1;
}
