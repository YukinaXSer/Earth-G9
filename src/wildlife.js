import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundHeight, SPECIES, riverX, RIVER_LEVEL } from './data.js';

export function findBirdPerch(world) {
  const geometries = new Set(world.habitat.models.get('banyan').flatMap(model => model.children.map(mesh => mesh.geometry)));
  const supports = world.habitat.cells.filter(mesh => geometries.has(mesh.geometry));
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  world.scene.updateMatrixWorld(true);
  for (const [x, z] of [[2.67891, 25.69545], [3.04562, 25.31482], [3.53133, 25.69349]]) {
    const floor = groundHeight(x, z);
    ray.set(new THREE.Vector3(x, floor + 1.8, z), down);
    const hit = ray.intersectObjects(supports, false).find(hit => hit.point.y > floor + 1.3 && hit.face.normal.y > .65);
    if (hit) return hit.point.clone();
  }
  return null;
}

export function crabBank(z) {
  for (let distance = 5.5; distance <= 12; distance += .2) {
    const x = riverX(z) - distance;
    if (groundHeight(x, z) > RIVER_LEVEL + .09) return { x: x - .2, z };
  }
  return { x: riverX(z) - 12, z };
}

export function poseButterfly(butterfly, time, perch) {
  const { group, wings, seed, resting, x, z } = butterfly;
  if (resting) {
    group.position.copy(perch ?? new THREE.Vector3(x, groundHeight(x, z) + 1.2, z));
    group.rotation.set(0, .7, 0);
  } else {
    const phase = time * .65 + seed;
    group.position.set(x + Math.sin(phase) * .85, groundHeight(x, z) + 1.65 + Math.sin(time * 1.3 + seed) * .25, z + Math.cos(phase) * .65);
    group.rotation.set(Math.sin(phase) * .12, Math.atan2(-.85 * Math.cos(phase), .65 * Math.sin(phase)), Math.sin(phase * 1.4) * .15);
  }
  for (const wing of wings) {
    const angle = resting ? .6 + Math.sin(time * .8 + seed) * .4 : .12 + Math.sin(time * 18 + seed) * 1.05;
    wing.rotation.z = angle * (wing.name.includes('right') ? 1 : -1);
  }
}

export class Wildlife {
  constructor(world) {
    this.world = world;
    this.butterflies = [];
  }

  async load() {
    const { scene } = await new GLTFLoader(this.world.loadingManager).loadAsync('/models/morpho-butterfly.glb');
    const point = SPECIES.find(species => species.id === 'butterfly');
    const locations = [[point.x, point.z, true], [-6.5, -31.5], [-5, -30], [-7, -33], [-1.8, 29], [5, -8]];
    for (let i = 0; i < locations.length; i++) {
      const [x, z, resting = false] = locations[i], group = scene.clone();
      const wings = [];
      group.traverse(node => { if (node.name.startsWith('wing-')) wings.push(node); });
      group.scale.setScalar(resting ? 1 : .8 + i % 3 * .1);
      this.butterflies.push({ group, wings, x, z, resting, seed: i * 1.739 });
      this.world.scene.add(group);
    }
  }

  startAdditional() {
    if (this.extraReady) return this.extraReady;
    this.extraReady = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
      const { loadCritters } = await import('./ground-critters.js');
      const perch = findBirdPerch(this.world);
      const placements = [
        { kind: 'beetle', x: -1.4, z: 27.5, scale: 1.4 },
        { kind: 'beetle', x: -1.5, z: -27, scale: 1.3 },
        { kind: 'iguana', x: -1.9, z: 30, scale: 1, heading: .65, groundOffset: -.04 },
        { kind: 'frog', x: -1.6, z: 25, scale: 1.25 },
        { kind: 'frog', x: 1.7, z: -9, scale: 1.2 },
        { kind: 'crab', ...crabBank(-12), scale: 1.3, heading: .8 },
        { kind: 'crab', ...crabBank(-48), scale: 1.3, heading: -.4 },
      ];
      if (perch) placements.push({ kind: 'tanager', x: perch.x, z: perch.z, perch, scale: 1.2, heading: -1.2 });
      else console.warn('No supported bird perch found');
      this.critters = await loadCritters(this.world.scene, placements);
      this.extraStartedAt = this.world.elapsed;
      this.world.addCollider({ x: -1.9, z: 30, radius: .2 });
      return this.critters;
    }).catch(error => { this.extraError = String(error); console.warn('Additional wildlife unavailable:', error); });
    return this.extraReady;
  }

  update(time) {
    this.critters?.update(time - this.extraStartedAt);
    for (const butterfly of this.butterflies) poseButterfly(butterfly, time, this.world.butterflyPerch);
  }
}
