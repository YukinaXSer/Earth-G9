import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTXLoader } from 'three/addons/loaders/KTXLoader.js';

export const NEAR_TRUNK_LIMIT = 2;
export const NEAR_TRUNK_DISTANCE = 12;

export function trunkBlend(distance) {
  return 1 - THREE.MathUtils.smoothstep(distance, 6, NEAR_TRUNK_DISTANCE);
}

export function treeDetailDistance(tree, position) {
  const box = tree.detailBounds;
  return box ? Math.hypot(Math.max(box.min.x - position.x, 0, position.x - box.max.x),
    Math.max(box.min.z - position.z, 0, position.z - box.max.z)) : Math.hypot(tree.x - position.x, tree.z - position.z);
}

export function nearTrunkMaterial(source, assets, scale, grainMean) {
  const captured = source.isMeshBasicMaterial;
  const octahedralNormal = captured && assets.normal.format === THREE.RGBA_ETC2_EAC_Format;
  const material = captured ? new THREE.MeshLambertMaterial({ color: source.color, map: source.map, side: source.side,
    opacity: source.opacity, transparent: source.transparent, alphaTest: source.alphaTest, depthWrite: source.depthWrite }) : source.clone();
  if (captured) material.userData = { ...source.userData };
  const blend = { value: 0 };
  for (const [key, value] of Object.entries(source.userData)) if (value?.isColor) material.userData[key] = value.clone();
  material.normalMap = assets.normal.clone();
  material.normalMap.channel = 1;
  material.normalMap.repeat.set(scale, scale);
  material.normalScale.set(captured ? .12 : .4, captured ? .12 : .4);
  material.customProgramCacheKey = () => captured ? `source-scan-near-trunk-v8-capture-${octahedralNormal}` : 'source-scan-near-trunk-v2';
  material.onBeforeCompile = shader => {
    shader.uniforms.trunkBlend = blend;
    shader.uniforms.trunkColor = { value: assets.color };
    if (captured) shader.uniforms.trunkGrainMean = { value: grainMean };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float trunkBlend;
attribute vec3 trunkLodPosition;
attribute vec3 trunkLodNormal;
varying float vTrunkHeight;
${captured ? 'attribute float captureWeight;\nvarying float vCaptureWeight;' : ''}
`).replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = normalize(mix(trunkLodNormal, objectNormal, trunkBlend));
`).replace('#include <begin_vertex>', `#include <begin_vertex>
vTrunkHeight = position.y;
${captured ? 'vCaptureWeight = captureWeight;' : ''}
transformed = mix(trunkLodPosition, transformed, trunkBlend);
`);
    const normalMaps = octahedralNormal ? THREE.ShaderChunk.normal_fragment_maps.replace(
      'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
      `vec2 trunkOct = texture2D( normalMap, vNormalMapUv ).ag * 2.0 - 1.0;
vec3 mapN = vec3(trunkOct, max(1.0 - abs(trunkOct.x) - abs(trunkOct.y), .0001));`) : '#include <normal_fragment_maps>';
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float trunkBlend;
uniform sampler2D trunkColor;
varying float vTrunkHeight;
${captured ? 'varying float vCaptureWeight;\nuniform vec3 trunkGrainMean;' : ''}
`).replace('#include <map_fragment>', `#include <map_fragment>
float trunkSurface = trunkBlend * ${captured ? 'clamp(vCaptureWeight, 0.0, 1.0)' : '(1.0 - smoothstep(1.6, 1.9, vTrunkHeight))'};
${captured ? `vec3 trunkCaptureColor = diffuseColor.rgb;
diffuseColor.rgb = trunkCaptureColor * texture2D(trunkColor, vNormalMapUv).rgb / trunkGrainMean;`
    : 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(trunkColor, vNormalMapUv).rgb, trunkSurface);'}
`).replace('#include <normal_fragment_maps>', `vec3 trunkOriginalNormal = normal;
${normalMaps}
normal = normalize(mix(trunkOriginalNormal, normal, trunkSurface));
`);
    if (captured) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_fragment>', `
vec3 trunkReferenceLight;
{
  vec3 normal = trunkOriginalNormal;
  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  #include <lights_lambert_fragment>
  material.diffuseColor = vec3(1.0);
  #include <lights_fragment_begin>
  #include <lights_fragment_maps>
  #include <lights_fragment_end>
  trunkReferenceLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
}
#include <lights_lambert_fragment>
`).replace('#include <opaque_fragment>', `
// The capture already contains lighting; retain only the detail-normal response.
outgoingLight = mix(trunkCaptureColor,
  (outgoingLight + diffuseColor.rgb * .0001) / (trunkReferenceLight + vec3(.0001)), trunkSurface);
#include <opaque_fragment>`);
  };
  return { material, blend };
}

export class NearTrunks {
  constructor({ anisotropy = 1, onMaterial = () => {}, captureSupported = true } = {}) {
    this.anisotropy = anisotropy;
    this.onMaterial = onMaterial;
    this.active = new Set();
    this.cache = new WeakMap();
    this.captureDisabled = !captureSupported;
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

  async loadCapture() {
    const loader = new KTXLoader();
    const [{ parser }, color, normal] = await Promise.all([
      new GLTFLoader().loadAsync('/models/near-banyan-grain.glb'),
      loader.loadAsync('/textures/near-banyan-color.ktx'),
      loader.loadAsync('/textures/near-banyan-normal.ktx'),
    ]);
    const mean = parser.json.extras?.grainMean;
    if (!Array.isArray(mean) || mean.length !== 3 || !mean.every(v => Number.isFinite(v) && v > 0 && v <= 1)) throw new Error('Missing photographic grain calibration');
    const [uv, weight] = await Promise.all([parser.getDependency('accessor', 0), parser.getDependency('accessor', 1)]);
    if (color.format !== THREE.RGB_ETC2_Format || normal.format !== THREE.RGBA_ETC2_EAC_Format) throw new Error('Unexpected photographic grain compression');
    for (const texture of [color, normal]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(4, this.anisotropy);
    }
    color.colorSpace = THREE.SRGBColorSpace;
    this.captureLayout = { uv, weight, grainMean: new THREE.Vector3(...mean), color, normal };
    this.captureGeometries = new WeakMap();
  }

  captureGeometry(source) {
    this.captureGeometries ??= new WeakMap();
    if (this.captureGeometries.has(source)) return this.captureGeometries.get(source);
    const corners = source.userData.captureCorners, { uv, weight } = this.captureLayout;
    if (!corners || corners.length !== source.index.count) throw new Error('Missing scan corner correspondence');
    const geometry = source.toNonIndexed(), data = new Float32Array(corners.length * 3);
    for (let i = 0; i < corners.length; i++) {
      const corner = corners[i];
      if (corner >= uv.count || corner >= weight.count) throw new Error('Scan grain vertex count mismatch');
      data[i * 3] = uv.getX(corner); data[i * 3 + 1] = uv.getY(corner); data[i * 3 + 2] = weight.getX(corner);
    }
    const buffer = new THREE.InterleavedBuffer(data, 3);
    geometry.setAttribute('uv1', new THREE.InterleavedBufferAttribute(buffer, 2, 0));
    geometry.setAttribute('captureWeight', new THREE.InterleavedBufferAttribute(buffer, 1, 2));
    const originalUV = geometry.attributes.uv;
    const indices = Uint32Array.from({ length: corners.length }, (_, i) => i);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('uv', geometry.attributes.uv1);
    geometry.computeTangents();
    geometry.setAttribute('uv', originalUV);
    geometry.setIndex(null);
    geometry.setAttribute('trunkLodPosition', geometry.attributes.position);
    geometry.setAttribute('trunkLodNormal', geometry.attributes.normal);
    this.captureGeometries.set(source, geometry);
    return geometry;
  }

  update(position, trees, now = performance.now() / 1000) {
    const step = Math.min(.05, Math.max(0, now - (this.updatedAt ?? now - 1 / 60))) * 3;
    this.updatedAt = now;
    const selected = trees.filter(tree => tree.near && tree.group && treeDetailDistance(tree, position) < NEAR_TRUNK_DISTANCE)
      .sort((a, b) => treeDetailDistance(a, position) - treeDetailDistance(b, position) ||
        Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z))
      .slice(0, NEAR_TRUNK_LIMIT);
    const meshes = new Map();
    for (const tree of selected) for (const mesh of tree.group.children) {
      const kind = mesh.material.userData.nearTrunk;
      if (kind && !(kind === 'capture' && this.captureDisabled)) meshes.set(mesh, treeDetailDistance(tree, position));
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
      const captured = mesh.material.userData.nearTrunk === 'capture';
      if (captured && !this.captureLayout) {
        this.captureLoading ??= this.loadCapture().catch(() => { this.captureDisabled = true; });
        continue;
      }
      let state = this.cache.get(mesh);
      if (!state) {
        mesh.updateWorldMatrix(true, false);
        const scale = mesh.getWorldScale(new THREE.Vector3()).y;
        let nearGeometry = this.assets.geometry;
        if (captured) {
          try { nearGeometry = this.captureGeometry(mesh.geometry); }
          catch { this.captureDisabled = true; continue; }
        }
        state = { geometry: mesh.geometry, nearGeometry, source: mesh.material,
          ...nearTrunkMaterial(mesh.material, captured ? this.captureLayout : this.assets, scale, this.captureLayout?.grainMean) };
        this.cache.set(mesh, state); this.onMaterial(state.material);
      }
      mesh.geometry = state.nearGeometry; mesh.material = state.material;
      state.blend.value = Math.min(trunkBlend(distance), step);
      this.active.add(mesh);
    }
  }
}
