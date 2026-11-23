import { BufferAttribute, Group, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace,
  TextureLoader, Vector3, WebGLRenderTarget } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAVE_TEXTURE_SETS, createCaveMaterial } from './cave-material.js';

export function routeParameter(point, route) {
  if (!Array.isArray(route) || route.length < 2) throw new RangeError('Cave route needs at least two points');
  let best = Infinity, nearest = 0, total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dx = b[0] - a[0], dz = b[2] - a[2], run = dx * dx + dz * dz;
    const length = Math.hypot(dx, b[1] - a[1], dz);
    const t = run ? Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.z - a[2]) * dz) / run)) : 0;
    const d = (point.x - a[0] - t * dx) ** 2 + (point.z - a[2] - t * dz) ** 2;
    if (d < best) { best = d; nearest = total + t * length; }
    total += length;
  }
  if (!total) throw new RangeError('Cave route has zero length');
  return nearest / total;
}

export function attachCaveRoute(root, route) {
  if (!Array.isArray(route) || route.length < 2) throw new RangeError('Cave route needs at least two points');
  root.updateMatrixWorld(true);
  const point = new Vector3();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const shade = mesh.geometry.getAttribute('_cave_shade');
    if (shade) mesh.geometry.setAttribute('caveShade', shade);
    const baked = mesh.geometry.getAttribute('_cave_route');
    if (baked) { mesh.geometry.setAttribute('caveRoute', baked); return; }
    const positions = mesh.geometry.getAttribute('position'), parameters = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      parameters[i] = routeParameter(point, route);
    }
    mesh.geometry.setAttribute('caveRoute', new BufferAttribute(parameters, 1));
  });
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

// Importing this module performs no fetches. The caller starts it after the first scene frame.
export async function loadCaveAssets({ base = '/cave/', renderer, data } = {}) {
  if (!renderer || !Array.isArray(data?.route) || data.route.length < 2) throw new TypeError('Cave loading requires renderer and route data');
  const textures = [], geometry = [];
  let material;
  const textureLoader = new TextureLoader(), gltfLoader = new GLTFLoader();
  const dispose = () => {
    textures.forEach(t => t.dispose()); geometry.forEach(g => g.dispose()); material?.dispose();
  };
  const jobs = CAVE_TEXTURE_SETS.flatMap(id => ['color', 'normal', 'roughness'].map(async key => {
    const texture = await textureLoader.loadAsync(base + id + '-' + key + '.webp');
    textures.push(texture);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (key === 'color') texture.colorSpace = SRGBColorSpace;
    return texture;
  }));
  const meshJob = gltfLoader.loadAsync(base + 'cave-fitted.glb').then(gltf => {
    gltf.scene.traverse(mesh => { if (mesh.isMesh) { geometry.push(mesh.geometry); mesh.material.dispose(); } });
    return gltf.scene;
  });
  const results = await Promise.allSettled([...jobs, meshJob]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) { dispose(); throw failure.reason; }
  try {
    const sets = CAVE_TEXTURE_SETS.map((_, i) => ({ color: results[i * 3].value,
      normal: results[i * 3 + 1].value, roughness: results[i * 3 + 2].value }));
    material = createCaveMaterial(sets, { routeLength: data.routeLength });
    const root = results.at(-1).value;
    attachCaveRoute(root, data.route);
    root.traverse(mesh => { if (mesh.isMesh) mesh.material = material; });
    return { root, material, textures, dispose };
  } catch (error) { dispose(); throw error; }
}

export async function warmCaveAssets(assets, renderer, camera, lightingScene, { waitForIdle = async () => {} } = {}) {
  if (!assets?.root || assets.root.parent) throw new Error('Warm cave off-scene before attaching it');
  if (!lightingScene?.isScene) throw new TypeError('Warm cave with its destination lighting scene');
  for (const texture of assets.textures) { await nextFrame(); await waitForIdle(); renderer.initTexture(texture); }
  lightingScene.updateMatrixWorld(true);
  const visibility = [];
  const hidden = [];
  assets.root.traverse(object => { hidden.push([object, object.visible]); object.visible = true; });
  assets.root.traverse(mesh => { if (mesh.isMesh) { visibility.push([mesh, mesh.frustumCulled]); mesh.frustumCulled = false; } });
  const staging = new Group(), lights = [];
  lightingScene.traverseVisible(light => {
    if (!light.isLight) return;
    const copy = light.clone(); lights.push(copy); staging.add(copy);
    if (copy.target) staging.add(copy.target);
  });
  staging.add(assets.root);
  const target = new WebGLRenderTarget(1, 1), previous = renderer.getRenderTarget();
  try {
    await nextFrame();
    await waitForIdle();
    renderer.setRenderTarget(target); renderer.render(staging, camera);
    const uploaded = renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1, new Uint8Array(4));
    renderer.setRenderTarget(previous);
    await uploaded;
    await waitForIdle();
    staging.remove(assets.root);
    await renderer.compileAsync(assets.root, camera, lightingScene);
  } finally {
    staging.remove(assets.root);
    for (const light of lights) light.shadow?.dispose();
    renderer.setRenderTarget(previous); target.dispose();
    visibility.forEach(([mesh, culled]) => { mesh.frustumCulled = culled; });
    hidden.forEach(([object, visible]) => { object.visible = visible; });
  }
  return assets;
}
