import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const NEAR_TRUNK_LIMIT = 2;
export const NEAR_TRUNK_DISTANCE = 12;

export function trunkBlend(distance) {
  return 1 - THREE.MathUtils.smoothstep(distance, 6, NEAR_TRUNK_DISTANCE);
}

export function nearTrunkMaterial(source, assets, scale) {
  const material = source.clone(), blend = { value: 0 };
  for (const [key, value] of Object.entries(source.userData)) if (value?.isColor) material.userData[key] = value.clone();
  material.normalMap = assets.normal.clone();
  material.normalMap.channel = 1;
  material.normalMap.repeat.set(scale, scale);
  material.normalScale.set(.4, .4);
  material.customProgramCacheKey = () => 'source-scan-near-trunk-v2';
  material.onBeforeCompile = shader => {
    shader.uniforms.trunkBlend = blend;
    shader.uniforms.trunkColor = { value: assets.color };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float trunkBlend;
attribute vec3 trunkLodPosition;
attribute vec3 trunkLodNormal;
varying float vTrunkHeight;
`).replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = normalize(mix(trunkLodNormal, objectNormal, trunkBlend));
`).replace('#include <begin_vertex>', `#include <begin_vertex>
vTrunkHeight = position.y;
transformed = mix(trunkLodPosition, transformed, trunkBlend);
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float trunkBlend;
uniform sampler2D trunkColor;
varying float vTrunkHeight;
`).replace('#include <map_fragment>', `#include <map_fragment>
float trunkSurface = trunkBlend * (1.0 - smoothstep(1.6, 1.9, vTrunkHeight));
diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(trunkColor, vNormalMapUv).rgb, trunkSurface);
`).replace('#include <normal_fragment_maps>', `vec3 trunkOriginalNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(trunkOriginalNormal, normal, trunkSurface));
`);
  };
  return { material, blend };
}

export class NearTrunks {
  constructor({ anisotropy = 1, onMaterial = () => {} } = {}) {
    this.anisotropy = anisotropy;
    this.onMaterial = onMaterial;
    this.active = new Set();
    this.cache = new WeakMap();
  }

  async load() {
    const loader = new THREE.TextureLoader();
    const [gltf, color, normal] = await Promise.all([
      new GLTFLoader().loadAsync('/models/near-forest-trunk.glb'),
      loader.loadAsync('/textures/near-trunk-color.jpg'),
      loader.loadAsync('/textures/near-trunk-normal.jpg'),
    ]);
    let geometry;
    gltf.scene.traverse(mesh => { if (mesh.isMesh) geometry = mesh.geometry; });
    if (!geometry?.getAttribute('_lod_position') || !geometry.getAttribute('_lod_normal') || !geometry.getAttribute('uv1')) throw new Error('Missing source-trunk LOD attributes');
    geometry.setAttribute('trunkLodPosition', geometry.getAttribute('_lod_position'));
    geometry.setAttribute('trunkLodNormal', geometry.getAttribute('_lod_normal'));
    geometry.computeBoundingSphere();
    for (const texture of [color, normal]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(4, this.anisotropy);
    }
    color.colorSpace = THREE.SRGBColorSpace;
    this.assets = { geometry, color, normal };
  }

  needsNearGroup(group) {
    return group?.children.some(mesh => this.active.has(mesh) && this.cache.get(mesh).blend.value > 0) ?? false;
  }

  update(position, trees, now = performance.now() / 1000) {
    const step = Math.min(.05, Math.max(0, now - (this.updatedAt ?? now - 1 / 60))) * 3;
    this.updatedAt = now;
    const selected = trees.filter(tree => tree.near && tree.group && Math.hypot(tree.x - position.x, tree.z - position.z) < NEAR_TRUNK_DISTANCE)
      .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z))
      .slice(0, NEAR_TRUNK_LIMIT);
    const meshes = new Map();
    for (const tree of selected) for (const mesh of tree.group.children) {
      if (mesh.material.userData.nearTrunk) meshes.set(mesh, Math.hypot(tree.x - position.x, tree.z - position.z));
    }
    if (this.disabled) return;
    if (!this.assets) {
      if (meshes.size) this.loading ??= this.load().catch(() => { this.disabled = true; });
      return;
    }
    for (const mesh of this.active) {
      const state = this.cache.get(mesh), wanted = meshes.has(mesh);
      const target = wanted ? trunkBlend(meshes.get(mesh)) : 0;
      state.blend.value += THREE.MathUtils.clamp(target - state.blend.value, -step, step);
      if (!wanted && state.blend.value === 0) {
        mesh.geometry = state.geometry; mesh.material = state.source;
        this.active.delete(mesh);
      }
    }
    for (const [mesh, distance] of meshes) {
      if (this.active.has(mesh)) continue;
      if (this.active.size >= NEAR_TRUNK_LIMIT) break;
      let state = this.cache.get(mesh);
      if (!state) {
        mesh.updateWorldMatrix(true, false);
        const scale = mesh.getWorldScale(new THREE.Vector3()).y;
        state = { geometry: mesh.geometry, source: mesh.material, ...nearTrunkMaterial(mesh.material, this.assets, scale) };
        this.cache.set(mesh, state); this.onMaterial(state.material);
      }
      mesh.geometry = this.assets.geometry; mesh.material = state.material;
      state.blend.value = Math.min(trunkBlend(distance), step);
      this.active.add(mesh);
    }
  }
}
