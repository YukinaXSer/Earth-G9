import { BOUNDS, START, SPECIES, PLANT_SITES, VIEWPOINTS, distanceToTrail, riverX, groundHeight, RIVER_LEVEL } from './data.js';

const landmarks = [...SPECIES, ...PLANT_SITES, ...VIEWPOINTS];
const margin = 22;

export const ENTRANCE_FOREST = {
  trees: [
    { x: 4.5, z: 25, scale: 2, angle: 1 },
    { x: 7.7, z: 22, scale: 2.2, angle: 1.26 },
    { x: 4.4, z: 19.8, scale: 1.8, angle: 3.1 },
  ],
  plants: [
    { key: 'sapling', x: 5.6, z: 23.4, height: 1.5, angle: 2.1, variant: 3 },
    { key: 'sapling', x: 3.3, z: 22.5, height: 1.6, angle: .8, variant: 3 },
    { key: 'sapling', x: 7, z: 25.3, height: 1.8, angle: 4.6, variant: 3 },
    { key: 'fern', x: 3, z: 25, spread: 1.35, angle: 1.7, variant: 0 },
    { key: 'broadleaf', x: 3.4, z: 23.6, spread: 1, angle: 3.2, variant: 0 },
    { key: 'fern', x: 2.8, z: 21, spread: 1.3, angle: 4.9, variant: 0 },
    { key: 'fern', x: 4.5, z: 23, spread: 1.6, angle: .4, variant: 0 },
    { key: 'broadleaf', x: 6.3, z: 23.4, spread: 1.1, angle: 2.6, variant: 0 },
    { key: 'broadleaf', x: 7.4, z: 24, spread: 1, angle: 5.1, variant: 0 },
    { key: 'fern', x: 8, z: 20.5, spread: 1.4, angle: 3.5, variant: 0 },
    { key: 'broadleaf', x: 5.8, z: 20.3, spread: 1.1, angle: 1.2, variant: 0 },
    { key: 'fern', x: 5.4, z: 26.5, spread: 1.4, angle: 5.7, variant: 0 },
    { key: 'fern', x: 7.4, z: 27, spread: 1.4, angle: 2.9, variant: 0 },
    { key: 'broadleaf', x: 3.2, z: 27.5, spread: .95, angle: 4.3, variant: 0 },
    { key: 'fern', x: 2.8, z: 19, spread: 1.3, angle: .7, variant: 0 },
    { key: 'broadleaf', x: 5.7, z: 18.5, spread: 1, angle: 3.8, variant: 0 },
    { key: 'groundcover', x: 4.1, z: 21.3, height: .45, angle: 2.4, variant: 0 },
    { key: 'groundcover', x: 6.6, z: 22, height: .5, angle: 5.4, variant: 0 },
    { key: 'groundcover', x: 6, z: 25, height: .4, angle: 1.1, variant: 0 },
    { key: 'groundcover', x: 8, z: 25.8, height: .45, angle: 4.1, variant: 0 },
  ],
};

export function entranceForestContains(x, z) {
  return Math.hypot(x - 5.2, z - 23) < 6.5;
}

export function vegetationAllowed(x, z, layer) {
  const woody = layer !== 'understory' && layer !== 'riparian';
  if (Math.abs(x - riverX(z)) < (layer === 'riparian' ? 5.5 : woody ? 7 : 6.2)) return false;
  if (distanceToTrail(x, z) < (layer === 'canopy' ? 7 : woody ? 2.8 : 1.8)) return false;
  if (landmarks.some(point => Math.hypot(point.x - x, point.z - z) < (woody ? 3.2 : 2.2))) return false;
  return !woody || Math.hypot(x - START.x, z - START.z) >= 14;
}

function layerGrid(step, seed, layer, makePlant, padding = margin) {
  const rand = (min, max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return min + seed / 4294967296 * (max - min);
  };
  const plants = [];
  for (let z = BOUNDS.minZ - padding + step / 2; z < BOUNDS.maxZ + padding; z += step) {
    for (let x = BOUNDS.minX - padding + step / 2; x < BOUNDS.maxX + padding; x += step) {
      const px = x + rand(-.36, .36) * step, pz = z + rand(-.36, .36) * step;
      if (!vegetationAllowed(px, pz, layer)) continue;
      plants.push({ x: px, z: pz, angle: rand(0, Math.PI * 2), ...makePlant(rand, plants.length) });
    }
  }
  return plants;
}

function riparianUnderstory(lowDetail) {
  const clumps = layerGrid(lowDetail ? 2.8 : 2.4, 684913, 'riparian', rand => ({
    variant: Math.floor(rand(0, 1000)), height: rand(.55, .95),
  })).filter(p => Math.abs(p.x - riverX(p.z)) < 13.5 && groundHeight(p.x, p.z) > RIVER_LEVEL + .04);
  const plants = [];
  for (const clump of clumps) {
    plants.push({ ...clump, key: 'fern', variant: lowDetail ? 2 + clump.variant % 2 : clump.variant });
    const x = clump.x + Math.cos(clump.angle) * .85, z = clump.z + Math.sin(clump.angle) * .85;
    if (vegetationAllowed(x, z, 'riparian') && Math.abs(x - riverX(z)) < 13.5 && groundHeight(x, z) > RIVER_LEVEL + .04) {
      plants.push({ ...clump, key: 'broadleaf', x, z, height: clump.height * .85 });
    }
  }
  let seed = 684915;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let z = BOUNDS.minZ - margin; z <= BOUNDS.maxZ + margin; z += lowDetail ? 2.4 : 2) {
    for (const side of [-1, 1]) {
      const pz = z + (random() - .5) * .9, bank = riverBankX(pz, side);
      if (bank === null) continue;
      for (const [offset, key, height] of [[.4, 'fern', .9], [1.4, 'broadleaf', .95], [2.4, 'fern', .8]]) {
        const x = bank + side * (offset + (random() - .5) * .45), plantZ = pz + (random() - .5) * .45;
        if (!vegetationAllowed(x, plantZ, 'riparian') || groundHeight(x, plantZ) <= RIVER_LEVEL + .04) continue;
        const variant = key === 'fern' && lowDetail ? 2 + Math.floor(random() * 2) : Math.floor(random() * 1000);
        plants.push({ x, z: plantZ, key, height: height * (.9 + random() * .1), variant, angle: random() * Math.PI * 2 });
      }
    }
  }
  return plants;
}

export function riverBankX(z, side) {
  for (let offset = 5.5; offset < 11.5; offset += .2) {
    const x = riverX(z) + side * offset;
    if (groundHeight(x, z) > RIVER_LEVEL + .08) return x;
  }
  return null;
}

function understoryClusters(lowDetail) {
  let seed = 157943;
  const rand = (min, max) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return min + seed / 4294967296 * (max - min);
  };
  const plants = [], keys = ['broadleaf', 'fern', 'broadleaf', 'sapling', 'groundcover', 'broadleaf', 'fern', 'creeper'];
  const groups = layerGrid(lowDetail ? 3.2 : 2.8, 51273, 'understory', () => ({}));
  for (const group of groups) {
    for (let i = 0; i < (lowDetail ? 6 : 7); i++) {
      const angle = rand(0, Math.PI * 2), radius = i ? Math.sqrt(rand(0, 1)) * 1.7 : 0;
      const x = group.x + Math.cos(angle) * radius, z = group.z + Math.sin(angle) * radius;
      if (!vegetationAllowed(x, z, 'understory')) continue;
      const key = keys[plants.length % keys.length];
      const variant = key === 'fern' && lowDetail ? 2 + Math.floor(rand(0, 2)) : Math.floor(rand(0, 1000));
      const size = key === 'sapling' || key === 'groundcover'
        ? { height: key === 'sapling' ? rand(1.5, 2.8) : rand(1, 1.8) }
        : { spread: key === 'fern' ? rand(1.8, 2.8) : rand(1.4, 2.4) };
      plants.push({ key, x, z, angle: rand(0, Math.PI * 2), variant, ...size });
    }
  }
  const colonies = layerGrid(lowDetail ? 2 : 1.8, 918372, 'understory', rand => ({
    key: rand(0, 1) < .7 ? 'fern' : 'creeper', variant: lowDetail ? 2 + Math.floor(rand(0, 2)) : Math.floor(rand(0, 4)), spread: rand(1.6, 2.3),
  }));
  plants.push(...colonies);
  return plants;
}

export function createBackdropLayout() {
  const outside = p => p.x < BOUNDS.minX - 16 || p.x > BOUNDS.maxX + 16 || p.z < BOUNDS.minZ - 16 || p.z > BOUNDS.maxZ + 16;
  return {
    canopy: layerGrid(14, 65213, 'canopy', rand => ({ scale: rand(4, 6) }), 240).filter(outside),
    subcanopy: layerGrid(6.8, 85629, 'subcanopy', rand => ({ scale: rand(.7, 1.6) }), 100).filter(outside),
  };
}

export function createForestLayout(lowDetail = false) {
  return {
    emergent: layerGrid(19.5, 813713, 'emergent', rand => ({ scale: rand(.95, 1.25) })),
    canopy: layerGrid(11.5, 39592, 'canopy', rand => ({ scale: rand(3.5, 5.2) })),
    subcanopy: layerGrid(7.2, 71385, 'subcanopy', (rand, index) => ({
      key: index % 3 === 0 ? 'forest' : 'sapling',
      scale: index % 3 === 0 ? rand(1.25, 2.2) : rand(3.5, 5.5),
      variant: 3,
    })),
    understory: understoryClusters(lowDetail),
    riparian: riparianUnderstory(lowDetail),
    debris: [...layerGrid(5.5, 176831, 'debris', (rand, index) => ({
      key: index % 12 === 0 ? 'rock' : 'log', scale: index % 12 === 0 ? rand(.3, .65) : index % 4 === 0 ? rand(.7, 1.3) : rand(.12, .35), variant: index,
    })),
      { key: 'log', x: -128, z: -89, scale: 1.3, angle: .7, variant: 0 },
      { key: 'log', x: -117, z: -80, scale: 1.1, angle: 2.8, variant: 0 },
      { key: 'rock', x: -127, z: -79, scale: .8, angle: 1.1, variant: 2 },
      { key: 'rock', x: 17.8, z: 178, scale: .7, angle: 1.5, variant: 3 },
      { key: 'log', x: 112, z: -220, scale: 1.2, angle: 2, variant: 0 },
    ],
  };
}
