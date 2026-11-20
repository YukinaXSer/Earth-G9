import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundHeight, riverX, SPECIES, PLANT_SITES, BOUNDS, START } from './data.js';
import { createForestLayout, createBackdropLayout } from './forest-layout.js';
import { capturedCollider, colliderContains } from './captured-collisions.js';

const FILES = { banyan: 'captured-banyan', tree: 'canopy-tree', fern: 'fern', broadleaf: 'calathea', sapling: 'pachira', flower: 'anthurium', log: 'fallen-trunk', rock: 'moss-rock', groundcover: 'shrub-03', creeper: 'shrub-04', forest: 'forest-tree', distant: 'forest-distant', horizon: 'forest-horizon' };
const SOIL_SKIRT_DEPTH = { forest: .14, distant: .14, horizon: .14, rooted: 1.3 };
const SOIL_SKIRT_RADIUS = { forest: .45, distant: .45, horizon: .45, rooted: 4.5 };

export function modelVariantId(key, name) {
  return key === 'rock' ? name : /_([a-f])$/.exec(name)?.[1] ?? 'main';
}

export class Habitat {
  constructor(world) {
    this.world = world;
    this.models = new Map();
    this.materials = new Set();
    this.batches = new Map();
    this.cells = [];
    this.treeMaterials = new Map();
    this.lodTrees = [];
    this.groundOccluders = [];
    this.hiddenMatrix = new THREE.Matrix4().makeScale(.000001, .000001, .000001);
    this.dummy = new THREE.Object3D();
  }

  async load() {
    const loader = new GLTFLoader(this.world.loadingManager);
    await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
      const source = key === 'banyan' ? 'captured-banyan-low' : file;
      const { scene } = await loader.loadAsync(`/models/${source}.glb`);
      scene.updateMatrixWorld(true);
      const variants = new Map();
      const treeLod = ['forest', 'distant', 'horizon'].includes(key);
      const materialCache = treeLod ? this.treeMaterials : new Map();
      for (const child of scene.children) {
        const id = modelVariantId(key, child.name);
        if (!variants.has(id)) variants.set(id, new THREE.Group());
        child.traverse(mesh => {
          if (!mesh.isMesh) return;
          const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(original => {
            const materialKey = treeLod ? original.name : original;
            if (materialCache.has(materialKey)) return materialCache.get(materialKey);
            let material = original;
            if (key === 'banyan') {
              material = new THREE.MeshBasicMaterial({ map: original.map ?? original.emissiveMap });
            } else if (this.world.lowDetail && original.isMeshStandardMaterial) {
              const waxy = ['fern', 'broadleaf', 'flower', 'groundcover', 'creeper'].includes(key) || key === 'sapling' && original.name.includes('leaves');
              const Material = waxy ? THREE.MeshPhongMaterial : THREE.MeshLambertMaterial;
              material = new Material({
                color: original.color, map: original.map, alphaMap: original.alphaMap, vertexColors: original.vertexColors,
                normalMap: ['tree', 'forest', 'distant', 'horizon'].includes(key) || key === 'sapling' && !waxy ? null : original.normalMap,
                normalScale: original.normalScale, aoMap: original.aoMap, aoMapIntensity: original.aoMapIntensity,
                emissive: original.emissive, emissiveMap: original.emissiveMap,
                transparent: original.transparent, alphaTest: original.alphaTest, opacity: original.opacity,
              });
              if (waxy) { material.shininess = 32; material.specular.set('#3c4936'); }
              material.userData.foliageTint = material.color.clone();
            }
            materialCache.set(materialKey, material);
            return material;
          });
          for (const material of materials) {
            material.side = THREE.DoubleSide;
            if (material.transparent || material.alphaTest > 0) {
              material.transparent = false; material.alphaTest = .35; material.depthWrite = true;
            }
            material.userData.dryRoughness = material.roughness;
            if (key === 'banyan') {
              material.color.set('#a9b8a2');
              material.userData.captureTint = material.color.clone();
            }
            this.materials.add(material);
          }
          variants.get(id).add(new THREE.Mesh(geometry, Array.isArray(mesh.material) ? materials : materials[0]));
        });
      }
      const result = [...variants.values()];
      for (const variant of result) {
        const box = new THREE.Box3().setFromObject(variant), center = box.getCenter(new THREE.Vector3());
        if (['tree', 'forest', 'sapling', 'distant', 'horizon'].includes(key)) {
          const foot = new THREE.Box3(), vertex = new THREE.Vector3();
          for (const mesh of variant.children) {
            const positions = mesh.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              vertex.fromBufferAttribute(positions, i);
              if (vertex.y < box.min.y + .04) foot.expandByPoint(vertex);
            }
          }
          if (!foot.isEmpty()) foot.getCenter(center);
        }
        const scale = key === 'banyan' ? 12 / (box.max.y - box.min.y) : 1;
        const size = box.getSize(new THREE.Vector3());
        variant.userData.spread = Math.max(size.x, size.z) * scale;
        variant.userData.height = size.y * scale;
        variant.children.forEach(mesh => {
          mesh.geometry.translate(-center.x, -box.min.y, -center.z).scale(scale, scale, scale);
          if (key === 'banyan' && mesh.geometry.index) {
            const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index.array, kept = [];
            for (let i = 0; i < indices.length; i += 3) {
              if ([indices[i], indices[i + 1], indices[i + 2]].some(vertex => positions.getY(vertex) >= .65)) kept.push(indices[i], indices[i + 1], indices[i + 2]);
            }
            mesh.geometry.setIndex(kept);
          }
        });
      }
      this.models.set(key, result);
      if (key === 'banyan') {
        const rooted = result[0].clone();
        for (const mesh of rooted.children) {
          mesh.geometry = mesh.geometry.clone();
          const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index.array, kept = [];
          for (let i = 0; i < indices.length; i += 3) {
            if ([indices[i], indices[i + 1], indices[i + 2]].some(vertex => positions.getY(vertex) >= 1.1)) kept.push(indices[i], indices[i + 1], indices[i + 2]);
          }
          mesh.geometry.setIndex(kept);
        }
        this.models.set('rooted', [rooted]);
      }
    }));
  }

  place(key, x, z, scale = 1, angle = 0, variantIndex = 0, elevatedY) {
    const variants = this.models.get(key), variant = variants[variantIndex % variants.length];
    const embedded = (SOIL_SKIRT_DEPTH[key] ?? 0) * (Array.isArray(scale) ? scale[1] : scale);
    let floor = groundHeight(x, z);
    const radius = (SOIL_SKIRT_RADIUS[key] ?? 0) * (Array.isArray(scale) ? Math.max(scale[0], scale[2]) : scale);
    if (radius && elevatedY === undefined) {
      for (let i = 0; i < 8; i++) floor = Math.min(floor, groundHeight(x + Math.cos(i * Math.PI / 4) * radius, z + Math.sin(i * Math.PI / 4) * radius));
    }
    this.dummy.position.set(x, elevatedY ?? floor - embedded, z);
    this.dummy.rotation.set(0, angle, 0);
    if (Array.isArray(scale)) this.dummy.scale.set(...scale); else this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    const placements = [], cellSize = ['distant', 'horizon'].includes(key) ? 64 : 18;
    for (const part of variant.children) {
      const batchKey = `${part.geometry.uuid}:${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
      if (!this.batches.has(batchKey)) this.batches.set(batchKey, { part, key, matrices: [] });
      const batch = this.batches.get(batchKey), matrix = this.dummy.matrix.clone();
      placements.push({ batch, index: batch.matrices.length, matrix });
      batch.matrices.push(matrix);
    }
    return placements;
  }

  flush() {
    for (const batch of this.batches.values()) {
      const { part, key, matrices } = batch, distant = ['distant', 'horizon'].includes(key);
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = !this.world.lowDetail && !distant; mesh.receiveShadow = true;
      if (distant) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      mesh.userData.viewDistance = distant || key === 'rooted' ? 240 : ['tree', 'forest', 'sapling'].includes(key) ? 85 : this.world.lowDetail ? 32 : 44;
      batch.mesh = mesh;
      this.cells.push(mesh);
      this.world.scene.add(mesh);
    }
    this.batches.clear();
  }

  backgroundTree(x, z, scale, angle, horizon = false) {
    if (scale >= 3 && x >= BOUNDS.minX - 8 && x <= BOUNDS.maxX + 8 && z >= BOUNDS.minZ - 8 && z <= BOUNDS.maxZ + 8) {
      const nativeHeight = this.models.get('distant')[0].userData.height;
      const capturedHeight = this.models.get('rooted')[0].userData.height;
      const parts = this.place('rooted', x, z, scale * nativeHeight / capturedHeight, angle);
      if (parts?.[0]?.matrix) this.world.colliders.push(capturedCollider(this.models.get('rooted')[0], parts[0].matrix));
      return;
    }
    const parts = this.place(horizon ? 'horizon' : 'distant', x, z, scale, angle);
    this.lodTrees.push({ x, z, parts, near: false, group: null });
  }

  composeBackground() {
    const w = this.world;
    const allowed = (x, z) => Math.abs(x - riverX(z)) >= 7 && !(Math.abs(x) < 21 && z > -115 && z < 45) && ![...SPECIES, ...PLANT_SITES].some(s => Math.hypot(s.x - x, s.z - z) < 3);
    const ring = (radius, spacing, small = false) => {
      const count = Math.ceil(Math.PI * 2 * radius / spacing);
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2 + radius * .013;
        const distance = radius + w.rand(-2, 2);
        const x = START.x + Math.cos(angle) * distance, z = START.z + Math.sin(angle) * distance;
        if (!allowed(x, z)) continue;
        const scale = small ? w.rand(.9, 1.3) : w.rand(3.5, 5.5);
        this.backgroundTree(x, z, scale, w.rand(0, Math.PI * 2), small || radius > 120);
        if (x > BOUNDS.minX && x < BOUNDS.maxX && z > BOUNDS.minZ && z < BOUNDS.maxZ) w.colliders.push({ x, z, radius: .18 * scale });
      }
    };
    for (const [radius, spacing] of [[45, 12], [70, 15], [105, 20]]) ring(radius, spacing);
    for (const [radius, spacing] of [[45, 4.5], [70, 6], [105, 9]]) ring(radius, spacing, true);
    const backdrop = createBackdropLayout();
    for (const tree of [...backdrop.canopy, ...backdrop.subcanopy]) this.place('horizon', tree.x, tree.z, tree.scale, tree.angle);
    for (const tree of backdrop.canopy) this.groundOccluders.push({ x: tree.x, z: tree.z, radius: tree.scale * .8 });
  }

  composeForest() {
    const w = this.world, layout = createForestLayout(w.lowDetail);
    for (const tree of layout.emergent) {
      if (w.colliders.some(c => colliderContains(c, tree.x, tree.z, tree.scale * 1.5, groundHeight(tree.x, tree.z)))) continue;
      this.place('tree', tree.x, tree.z, tree.scale, tree.angle, 0, groundHeight(tree.x, tree.z) - .12);
      w.colliders.push({ x: tree.x, z: tree.z, radius: tree.scale * 1.5, shadeRadius: tree.scale * 4 });
    }
    for (let i = 0; i < layout.canopy.length; i++) {
      const tree = layout.canopy[i];
      if (w.colliders.some(c => !c.parts && c.radius > .6 && Math.hypot(c.x - tree.x, c.z - tree.z) < 4 + c.radius)) continue;
      this.backgroundTree(tree.x, tree.z, tree.scale, tree.angle);
      w.colliders.push({ x: tree.x, z: tree.z, radius: tree.scale * .18 });
    }
    for (const plant of layout.subcanopy) {
      if (w.colliders.some(c => !c.parts && Math.hypot(c.x - plant.x, c.z - plant.z) < c.radius + .7)) continue;
      if (plant.key === 'forest') this.backgroundTree(plant.x, plant.z, plant.scale, plant.angle);
      else this.place(plant.key, plant.x, plant.z, plant.scale, plant.angle, plant.variant);
      w.colliders.push({ x: plant.x, z: plant.z, radius: plant.key === 'forest' ? .18 * plant.scale : .18 });
    }
    for (const plant of [...layout.understory, ...layout.riparian]) {
      const variants = this.models.get(plant.key), variant = variants[plant.variant % variants.length];
      const scale = plant.spread ? plant.spread / variant.userData.spread : plant.height / variant.userData.height;
      this.place(plant.key, plant.x, plant.z, scale, plant.angle, plant.variant);
    }
    for (const item of layout.debris) {
      if (w.colliders.some(c => !c.parts && Math.hypot(c.x - item.x, c.z - item.z) < c.radius + (item.key === 'log' && item.scale < .55 ? .25 : 1.2))) continue;
      this.place(item.key, item.x, item.z, item.scale, item.angle, item.variant);
      if (item.key === 'log' && item.scale >= .55) {
        for (let i = 0; i <= 6; i++) {
          const offset = (i / 6 - .5) * 3.05 * item.scale;
          w.colliders.push({ x: item.x + Math.cos(item.angle) * offset, z: item.z - Math.sin(item.angle) * offset, radius: .18 * item.scale + .06 });
        }
      } else if (item.key === 'rock') w.colliders.push({ x: item.x, z: item.z, radius: item.scale * 1.15 });
    }
  }

  compose() {
    const w = this.world;
    const entranceTree = this.place('banyan', 5.2, 23, 1, 2.8, 0, groundHeight(5.2, 23) - .85);
    w.colliders.push(capturedCollider(this.models.get('banyan')[0], entranceTree[0].matrix));
    w.colliders.push({ x: 5.2, z: 23, radius: 2.3 });
    const trees = [[-8, 27, .9], [9, 17, .85], [-9, -12, 1.05], [12, -43, 1], [-11, -62, 1.1], [10, -86, 1]];
    for (const [x, z, scale] of trees) {
      const angle = w.rand(0, 6);
      if (z < -40 && z !== -62) this.backgroundTree(x, z, scale * 5, angle);
      else this.place('tree', x, z, scale, angle);
      w.colliders.push({ x, z, radius: scale * 1.5 });
    }
    for (const [x, z] of [[7, -15], [-22, -6]]) {
      this.place('tree', x, z, 1.1, w.rand(0, 6));
      w.colliders.push({ x, z, radius: 1.5 });
    }
    for (const z of [8, -24, -56, -92]) {
      for (const x of [-9, 5]) {
        const scale = w.rand(3.6, 4.2), angle = w.rand(0, 6);
        if (z === 8) this.place('forest', x, z, scale, angle);
        else this.backgroundTree(x, z, scale, angle);
        w.colliders.push({ x, z, radius: .8 });
      }
    }
    for (const z of [-12, -60, -100]) {
      for (const x of [-28, 28]) {
        if (Math.abs(x - riverX(z)) < 7) continue;
        const scale = w.rand(.9, 1.15), angle = w.rand(0, 6);
        if (z === -12) this.place('tree', x, z, scale, angle);
        else this.backgroundTree(x, z, scale * 5, angle);
        w.colliders.push({ x, z, radius: 1.2 });
      }
    }
    for (const z of [-8, -24, -40]) {
      for (const x of [-27, -18, 18, 27]) {
        if (Math.abs(x - riverX(z)) < 6) continue;
        const scale = w.rand(3.5, 5), angle = w.rand(0, 6);
        if (z === -8) this.place('sapling', x, z, scale, angle, 3);
        else this.backgroundTree(x, z, scale * .56, angle);
      }
    }
    for (let i = 0; i < 18; i++) {
      const z = 9 - i * 7.2, x = Math.sin(z * .06) * 1.4 + (i % 2 ? 1 : -1) * w.rand(4, 8);
      if (Math.abs(x - riverX(z)) < 6) continue;
      this.backgroundTree(x, z, w.rand(1.7, 2.8), w.rand(0, 6));
      w.colliders.push({ x, z, radius: .35 });
    }
    for (const [x, z, scale] of [[-6, 2, 2.6], [4, -4, 3.1], [-1.8, -18, 2.6]]) {
      this.place('forest', x, z, scale, w.rand(0, 6));
      w.colliders.push({ x, z, radius: .65 });
    }
    this.place('forest', 6, 15, 7, 4.3);
    w.colliders.push({ x: 6, z: 15, radius: 1.4 });
    this.place('tree', 38, -2, .9, 1.3);
    w.colliders.push({ x: 38, z: -2, radius: 1.35 });
    this.place('sapling', 19, 12, 4.5, 1.9, 3);
    for (const [x, z, scale] of [[37, -15, 5.5], [44, -9, 5], [36, -38, 6], [48, -30, 5]]) {
      this.place('sapling', x, z, scale, w.rand(0, 6), 3);
      w.colliders.push({ x, z, radius: .5 });
    }
    for (const z of [27, 16, 5]) for (const x of [-3.3, 3.7]) {
      this.place('sapling', x, z, w.rand(3.2, 3.8), w.rand(0, 6), 3);
      w.colliders.push({ x, z, radius: .3 });
    }
    this.place('broadleaf', -4.4, 24, 4.8, 2.1, 2);
    this.place('broadleaf', 4.2, 15, 4.8, 4.2, 3);
    const foreground = [
      ['fern', -1.9, 33, 4.5, 3], ['broadleaf', 3, 31, 3, 2],
      ['broadleaf', -3.2, 28, 3.2, 1], ['fern', 4.8, 29, 4.5, 3],
      ['broadleaf', -2.8, 24, 3.2, 2], ['broadleaf', 2.5, 21, 3.6, 3],
      ['fern', -4, 20, 4.5, 0], ['broadleaf', 3.8, 16, 3.6, 1],
      ['broadleaf', -1.5, 11, 2.8, 0], ['broadleaf', 4.5, 8, 3.2, 0],
      ['broadleaf', -2.3, 36, 2.5, 2], ['fern', 2.6, 35, 2.2, 3],
    ];
    for (const [key, x, z, scale, variant] of foreground) this.place(key, x, z, scale, w.rand(0, 6), variant);
    for (let z = 34; z > -110; z -= 2.2) {
      for (const side of [-1, 1]) {
        const x = Math.sin(z * .06) * 1.4 + side * w.rand(.9, 1.5);
        if ([...SPECIES, ...PLANT_SITES].some(s => Math.hypot(s.x - x, s.z - z) < 2)) continue;
        this.place('fern', x, z, w.rand(2.8, 4.5), w.rand(0, 6), 3);
      }
    }
    for (let i = 0; i < 240; i++) {
      const z = w.rand(14, 38), path = Math.sin(z * .06) * 1.4;
      const x = path + (i % 2 ? 1 : -1) * w.rand(.9, 8);
      if ([...SPECIES, ...PLANT_SITES].some(s => Math.hypot(s.x - x, s.z - z) < 1.8)) continue;
      const key = i % 3 ? 'fern' : 'broadleaf';
      this.place(key, x, z, key === 'fern' ? w.rand(2.5, 4) : w.rand(1.6, 2.4), w.rand(0, 6), i % 4);
    }
    this.place('fern', -3, 17, 1.6);
    this.place('flower', 7, -8, 1.25);
    const perch = this.place('broadleaf', -6, -31, 2.4, .7, 2);
    let highest = -Infinity;
    for (const { batch, matrix } of perch) {
      const positions = batch.part.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix);
        if (point.y <= highest) continue;
        highest = point.y;
        this.world.butterflyPerch = point.add(new THREE.Vector3(0, .023, 0));
      }
    }
    this.place('log', -7, 22, .8, .7);
    this.place('log', 5, -89, .85, -.3);
    for (const [x, z, scale, angle] of [[-7, 22, .8, .7], [5, -89, .85, -.3]]) {
      for (let i = 0; i <= 6; i++) {
        const offset = (i / 6 - .5) * 3.05 * scale;
        w.colliders.push({ x: x + Math.cos(angle) * offset, z: z - Math.sin(angle) * offset, radius: .22 });
      }
    }
    this.place('rock', 4, -88, 1.2, .4);
    for (let i = 0; i < 8; i++) {
      const z = 20 - i * 18;
      this.place('rock', riverX(z) - 5.5, z, w.rand(.7, 1.5), w.rand(0, 6), i);
      this.place('broadleaf', riverX(z) - 6.5, z, w.rand(.8, 1.3), w.rand(0, 6), i);
      this.place('fern', riverX(z) - 7, z + 3, w.rand(.8, 1.2), w.rand(0, 6), i);
    }
    this.composeBackground();
    this.composeForest();
    const captured = w.colliders.filter(c => c.parts), centers = new Set();
    for (const tree of captured) {
      const legacy = w.colliders.find(c => !c.parts && c.x === tree.x && c.z === tree.z);
      tree.shadeRadius = legacy?.radius ?? .8;
      centers.add(`${tree.x}:${tree.z}`);
    }
    w.colliders = w.colliders.filter(c => c.parts || !centers.has(`${c.x}:${c.z}`));
  }

  seedling() {
    const mesh = this.models.get('sapling')[1].clone();
    mesh.scale.setScalar(.17);
    return mesh;
  }

  updateVisibility(position) {
    for (const mesh of this.cells) mesh.visible = mesh.boundingSphere.center.distanceTo(position) - mesh.boundingSphere.radius < mesh.userData.viewDistance;
    for (const tree of this.lodTrees) {
      const near = (tree.x - position.x) ** 2 + (tree.z - position.z) ** 2 < 18 ** 2;
      if (near === tree.near) continue;
      tree.near = near;
      if (near && !tree.group) {
        tree.group = this.models.get('forest')[0].clone();
        tree.group.applyMatrix4(tree.parts[0].matrix);
        tree.group.children.forEach(mesh => { mesh.castShadow = !this.world.lowDetail; mesh.receiveShadow = true; });
        this.world.scene.add(tree.group);
      }
      if (tree.group) tree.group.visible = near;
      for (const part of tree.parts) {
        part.batch.mesh.setMatrixAt(part.index, near ? this.hiddenMatrix : part.matrix);
        part.batch.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  setWet(rainy) {
    for (const material of this.materials) {
      const dry = material.userData.dryRoughness;
      if (Number.isFinite(dry)) material.roughness = rainy ? Math.max(.3, dry * .65) : dry;
      if (material.userData.captureTint) material.color.copy(material.userData.captureTint).multiplyScalar(rainy ? .68 : 1);
      if (material.userData.foliageTint) material.color.copy(material.userData.foliageTint).multiplyScalar(rainy ? .82 : 1);
      if (material.isMeshPhongMaterial) material.shininess = rainy ? 85 : 32;
    }
  }
}
