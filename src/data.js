import { capturedRelief, TERRAIN } from './ground-relief.js';

export const SPECIES = [
  { id: 'fern', name: '林下蕨类', latin: 'Polypodiopsida', type: '蕨类植物', x: -3, z: 17, color: '#b7d997', mark: '01', description: '羽状叶片在潮湿的林下舒展。蕨类不靠花朵和种子繁殖，而是借助细小的孢子。', fact: '观察提示：小径左侧，寻找层层展开的细碎羽叶。', icon: 'fern' },
  { id: 'flower', name: '花烛', latin: 'Anthurium sp.', type: '开花植物', x: 7, z: -8, color: '#ed9277', mark: '02', description: '热带林下的大叶植物。醒目的佛焰苞衬托着肉穗花序，真正的小花密集排列在花序上。', fact: '观察提示：在林下阔叶之间寻找花序。', icon: 'flower' },
  { id: 'butterfly', name: '蓝闪蝶', latin: 'Morpho sp.', type: '雨林昆虫', x: -6, z: -31, color: '#92cde1', mark: '03', description: '翅膀的蓝色主要来自鳞片的微观结构，而非蓝色色素。反面呈褐色，停歇时折起双翼，林间的蓝色便暂时藏了起来。', fact: '观察提示：除了飞舞的蓝色身影，阔叶上还有一只停歇的闪蝶，可以靠近看。', icon: 'butterfly' },
  { id: 'tree', name: '热带乔木', latin: 'Jacaranda mimosifolia', type: '乔木', x: -11, z: -62, color: '#d8c79a', mark: '04', description: '蓝花楹原生于南美洲。细密的复叶与不规则的枝干，在小径上方形成斑驳树影。此处使用专业植被资产呈现树形。', fact: '观察提示：向上看，寻找层层分叉的树冠。', icon: 'tree' },
  { id: 'mushroom', name: '石上苔藓', latin: 'Bryophyta', type: '苔藓植物', x: 4, z: -88, color: '#e6c996', mark: '05', description: '贴着岩石生长的绿色世界。苔藓能够暂存水分，为微小生物留下湿润的栖息之处。', fact: '观察提示：潮湿倒木旁，留意岩石表面的绿色绒毯。', icon: 'fern' },
];

export const PLANT_SITES = [
  { id: 'seed-1', name: '第一株新生', x: 3, z: 3 },
  { id: 'seed-2', name: '溪畔的新绿', x: -3, z: -46 },
  { id: 'seed-3', name: '森林的未来', x: 2, z: -74 },
];

export const START = { x: 0, z: 35 };
export function formatCoordinates(position) {
  const north = START.z - position.z;
  return `${Math.abs(north).toFixed(1)} ${north < 0 ? 'S' : 'N'}   ${Math.abs(position.x).toFixed(1)} ${position.x < 0 ? 'W' : 'E'}`;
}
export const BOUNDS = { minX: -52, maxX: 52, minZ: -111, maxZ: 51 };
export const RIVER_LEVEL = -.12;
export function riverX(z) { return 24 + Math.sin(z * 0.036) * 8; }
export function groundHeight(x, z) {
  const step = TERRAIN.step;
  const x0 = Math.floor((x + TERRAIN.width / 2) / step) * step - TERRAIN.width / 2;
  const z0 = Math.floor((z - TERRAIN.centerZ + TERRAIN.depth / 2) / step) * step + TERRAIN.centerZ - TERRAIN.depth / 2;
  const fx = (x - x0) / step, fz = (z - z0) / step;
  const a = terrainVertexHeight(x0, z0);
  if (!fx && !fz) return a;
  const b = terrainVertexHeight(x0, z0 + step), d = terrainVertexHeight(x0 + step, z0);
  if (fx + fz <= 1) return a + (d - a) * fx + (b - a) * fz;
  const c = terrainVertexHeight(x0 + step, z0 + step);
  return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
}
function terrainVertexHeight(x, z) {
  const distance = Math.abs(x - riverX(z));
  const bank = Math.min(1, Math.max(0, (distance - 4.8) / 5));
  const offTrail = Math.min(1, Math.abs(x - Math.sin(z * .06) * 1.4) / 3);
  const height = -0.42 + bank * (0.68 + Math.sin(x * 0.09) * Math.cos(z * 0.065) * 0.65 + capturedRelief(x, z) * offTrail);
  if (distance >= 14) return height;
  const rise = Math.min(1, Math.max(0, (distance - 4.8) / 3.8));
  const fade = Math.min(1, Math.max(0, (distance - 10) / 4));
  const bankFloor = -.42 + .75 * rise * rise * (3 - 2 * rise);
  return height + Math.max(0, bankFloor - height) * (1 - fade * fade * (3 - 2 * fade));
}
export function nearestPoint(position, points, radius = 5.5) {
  return points.map(point => ({ ...point, distance: Math.hypot(point.x - position.x, point.z - position.z) }))
    .filter(point => point.distance < radius).sort((a, b) => a.distance - b.distance)[0] ?? null;
}
export function sanitizeProgress(value) {
  return {
    discovered: [...new Set(Array.isArray(value?.discovered) ? value.discovered.filter(id => SPECIES.some(s => s.id === id)) : [])],
    planted: [...new Set(Array.isArray(value?.planted) ? value.planted.filter(id => PLANT_SITES.some(s => s.id === id)) : [])],
  };
}
export function loadProgress(storage) {
  try { return sanitizeProgress(JSON.parse(storage.getItem('earth2-progress'))); }
  catch { return sanitizeProgress(null); }
}
export function saveProgress(storage, progress) {
  try { storage.setItem('earth2-progress', JSON.stringify(sanitizeProgress(progress))); return true; }
  catch { return false; }
}
export function getCompletion(progress) { return Math.round((progress.discovered.length + progress.planted.length) / 8 * 100); }

export function loadView(storage) {
  try {
    const view = JSON.parse(storage.getItem('earth2-view'));
    if (!view || !['x', 'z', 'yaw', 'pitch'].every(k => Number.isFinite(view[k]))) return null;
    const z = Math.max(BOUNDS.minZ, Math.min(view.z, BOUNDS.maxZ));
    return { x: Math.max(BOUNDS.minX, Math.min(view.x, BOUNDS.maxX, riverX(z) - 5.3)), z, yaw: view.yaw % (Math.PI * 2), pitch: Math.max(-1.05, Math.min(1.05, view.pitch)) };
  } catch { return null; }
}

export function saveView(storage, view) {
  try { storage.setItem('earth2-view', JSON.stringify(view)); return true; }
  catch { return false; }
}

export function loadSettings(storage) {
  try {
    const settings = JSON.parse(storage.getItem('earth2-settings'));
    return { rainy: settings?.rainy === true, sound: settings?.sound === true };
  } catch { return { rainy: false, sound: false }; }
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem('earth2-settings', JSON.stringify({ rainy: settings.rainy === true, sound: settings.sound === true }));
    return true;
  } catch { return false; }
}
