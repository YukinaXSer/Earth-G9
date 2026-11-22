import { Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mountainMaterials = new WeakMap();
const mergedGroups = new WeakSet();

export function prepareForestLOD(habitat, root) {
  if (!habitat?.models || !Array.isArray(habitat.cells) || !root?.isObject3D) throw new TypeError('Forest LOD requires loaded habitat and geometry');
  const replacements = new Map(), templates = [];
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const match = /^(\w+)__(\d+)__(\d+)$/.exec(mesh.name);
    const template = match && habitat.models.get(match[1])?.[Number(match[2])]?.children[Number(match[3])];
    if (!template?.isMesh) return;
    for (const name of ['position', 'normal', 'uv', 'color']) if (template.geometry.hasAttribute(name) && !mesh.geometry.hasAttribute(name)) throw new TypeError(`Forest LOD missing ${name}: ${mesh.name}`);
    template.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere = template.geometry.boundingSphere.clone();
    replacements.set(template.geometry, mesh.geometry);
    templates.push(template);
    mesh.material.dispose(); mesh.material = template.material;
  });
  return () => {
    let changed = 0;
    for (const mesh of [...habitat.cells, ...templates]) {
      const geometry = replacements.get(mesh.geometry);
      if (!geometry) continue;
      mesh.geometry = geometry; changed++;
    }
    return changed;
  };
}

export function useLowTextureFiltering(textures = []) {
  for (const texture of textures) if (texture?.isTexture && texture.anisotropy !== 1) {
    texture.anisotropy = 1;
    texture.needsUpdate = true;
  }
}

export function useCapturedForestLOD(habitat) {
  const near = habitat?.models.get('rooted'), far = habitat?.models.get('rooted-far');
  if (!near?.length || !far?.length) return 0;
  const geometries = new Map(near[0].children.map((mesh, i) => [mesh.geometry, far[0].children[i]?.geometry]));
  let changed = 0;
  for (const mesh of habitat.cells) {
    const geometry = geometries.get(mesh.geometry);
    if (!geometry) continue;
    mesh.geometry = geometry;
    changed++;
  }
  return changed;
}

export function useLowMountainMaterials(root, textures = []) {
  useLowTextureFiltering(textures);
  const convert = (original, distant) => {
    if (!original.isMeshStandardMaterial) return original;
    let pair = mountainMaterials.get(original);
    if (!pair) { pair = []; mountainMaterials.set(original, pair); }
    const index = distant ? 1 : 0;
    if (pair[index]) return pair[index];
    const keys = ['color', 'map', 'alphaMap', 'alphaTest', 'side', 'vertexColors', 'transparent', 'opacity', 'depthTest', 'depthWrite', 'clippingPlanes', 'clipShadows'];
    if (!distant) keys.push('normalMap', 'normalScale', 'emissive', 'emissiveMap', 'aoMap', 'aoMapIntensity');
    const Material = distant ? MeshBasicMaterial : MeshLambertMaterial;
    const material = new Material(Object.fromEntries(keys.map(key => [key, original[key]])));
    material.name = `${original.name} cave low ${distant ? 'backdrop' : 'diffuse'}`;
    const compile = original.onBeforeCompile, key = original.customProgramCacheKey();
    material.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        'float detailFade=1.-smoothstep(.0125,.04,max(length(px),length(py)));',
        'float detailFade=0.;'
      );
    };
    material.customProgramCacheKey = () => `${key}-cave-low-${index}`;
    pair[index] = material;
    return material;
  };
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material => convert(material, mesh.name === 'native-mountain-far')) : convert(mesh.material, mesh.name === 'native-mountain-far');
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) useLowTextureFiltering([material.map, material.normalMap, material.alphaMap, material.aoMap]);
  });
  const groups = [];
  root.traverse(group => { if (group.isGroup && group.children.length >= 16 && !mergedGroups.has(group)) groups.push(group); });
  for (const group of groups) {
    mergedGroups.add(group);
    const materials = new Map();
    for (const mesh of group.children) {
      if (!mesh.isMesh || mesh.isBatchedMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || mesh.onBeforeRender !== Mesh.prototype.onBeforeRender) continue;
      const key = `${mesh.material.uuid}:${Object.keys(mesh.geometry.attributes).sort().join(',')}:${!!mesh.geometry.index}`;
      if (!materials.has(key)) materials.set(key, []);
      materials.get(key).push(mesh);
    }
    for (const meshes of materials.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map(mesh => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix); });
      const geometry = mergeGeometries(geometries);
      geometries.forEach(geometry => geometry.dispose());
      if (!geometry) continue;
      const batch = new Mesh(geometry, meshes[0].material);
      batch.name = 'Low-tier merged photographed vegetation'; batch.receiveShadow = meshes[0].receiveShadow;
      for (const mesh of meshes) group.remove(mesh);
      group.add(batch);
    }
  }
}
