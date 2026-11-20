import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundHeight, SPECIES } from './data.js';

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

  update(time) {
    for (const butterfly of this.butterflies) poseButterfly(butterfly, time, this.world.butterflyPerch);
  }
}
