import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundHeight } from './data.js';

// Real-specimen scans, re-oriented: metres, +Y up, +Z = head/facing, feet at y=0.
export const CRITTERS = {
  beetle: { url: '/models/rainforest-beetle.glb', roam: .22, gait: 'crawl' },
  crab: { url: '/models/river-crab.glb', roam: .18, gait: 'scuttle' },
  frog: { url: '/models/golden-poison-frog.glb', roam: .3, gait: 'hop' },
  tanager: { url: '/models/scarlet-tanager.glb', roam: .12, gait: 'perch' },
  iguana: { url: '/models/green-iguana.glb', roam: 0, gait: 'bask' },
};

const smooth = t => t * t * (3 - 2 * t);
const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

// Bursts of movement between still pauses, the way small animals actually move.
function burst(time, seed, period, active) {
  const cycle = Math.floor(time / period + seed), local = time / period + seed - cycle;
  return { cycle, moving: local < active, t: Math.min(1, local / active) };
}

export function poseCritter(critter, time) {
  const { group, kind, x, z, heading = 0, seed = 0, scale = 1, perch } = critter, { roam, gait } = CRITTERS[kind];
  let px = x, pz = z, yaw = heading, lift = 0, pitch = 0;
  if (gait === 'crawl') {
    const { cycle, t } = burst(time, seed, 5.5, .55), a0 = hash(cycle + seed) * 6.283, a1 = hash(cycle + 1 + seed) * 6.283;
    const a = a0 + (a1 - a0) * smooth(t);
    px += Math.sin(a) * roam; pz += Math.cos(a) * roam;
    yaw = a + Math.PI / 2 + Math.sin(time * 9 + seed) * .04 * (t < 1 ? 1 : 0);
  } else if (gait === 'scuttle') {
    const { cycle, t } = burst(time, seed, 4.2, .18), s0 = (hash(cycle + seed) * 2 - 1) * roam, s1 = (hash(cycle + 1 + seed) * 2 - 1) * roam;
    const side = s0 + (s1 - s0) * smooth(t);
    px += Math.cos(heading) * side; pz -= Math.sin(heading) * side;
  } else if (gait === 'hop') {
    const { cycle, moving, t } = burst(time, seed, 3.7, .12);
    const p = (c) => { const r = hash(c + seed) * roam, a = hash(c * 1.7 + seed) * 6.283; return [Math.sin(a) * r, Math.cos(a) * r]; };
    const [ax, az] = p(cycle), [bx, bz] = p(cycle + 1);
    const k = moving ? smooth(t) : 1;
    px += ax + (bx - ax) * k; pz += az + (bz - az) * k;
    yaw = Math.atan2(bx - ax, bz - az);
    lift = moving ? Math.sin(Math.PI * t) * .06 * scale : 0;
    pitch = moving ? -Math.sin(Math.PI * t) * .35 : 0;
  } else if (gait === 'bask') {
    yaw = heading;
  } else {
    const { cycle, moving, t } = burst(time, seed, 2.6, .08);
    const y0 = heading + (hash(cycle + seed) - .5) * 2.2, y1 = heading + (hash(cycle + 1 + seed) - .5) * 2.2;
    yaw = moving ? y0 + (y1 - y0) * smooth(t) : y1;
    lift = moving ? Math.sin(Math.PI * t) * .025 * scale : 0;
    pitch = Math.sin(time * 1.3 + seed) * .03;
  }
  const base = perch ? perch.y : groundHeight(px, pz);
  if (perch) { px = perch.x; pz = perch.z; }
  group.position.set(px, base + lift + (critter.groundOffset ?? .002 * scale), pz);
  group.rotation.set(pitch, yaw, 0, 'YXZ');
  group.scale.setScalar(scale);
}

// Lazy: call after the first screen is ready; uses its own loader so it never holds the progress bar.
export async function loadCritters(scene, placements) {
  const loader = new GLTFLoader(), sources = {}, critters = [];
  await Promise.all([...new Set(placements.map(p => p.kind))].map(async kind => { sources[kind] = (await loader.loadAsync(CRITTERS[kind].url)).scene; }));
  placements.forEach((p, i) => {
    const group = sources[p.kind].clone();
    group.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    const critter = { group, seed: i * 2.31 + .17, ...p };
    critters.push(critter); scene.add(group); poseCritter(critter, 0);
  });
  return { critters, update: time => critters.forEach(c => poseCritter(c, time)) };
}
