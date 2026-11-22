import * as T from 'three';
import data from './cave-data.json' with { type: 'json' };
import { loadCaveAssets, warmCaveAssets, attachCaveRoute } from './cave-assets.js';
import { CaveFloorIndex, FOREST_MOUTH, nearestRoute, placeMountain, mouthDistance } from './cave-space.js';
import { XianxiaMountain, MOUNTAIN_ENTRANCE, MOUNTAIN_LIGHTING } from '../xianxia-mountain.js';
import { BOUNDS, groundHeight, isWalkableGround } from '../data.js';
import { createColliderIndex } from '../captured-collisions.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainCutWriter } from './cave-terrain.js';
import { clipMountainAperture, limitMountainToExit } from './cave-aperture.js';
import { warmMountainHorizon } from './cave-horizon.js';
import { prepareForestLOD, useCapturedForestLOD, useLowMountainMaterials, useLowTextureFiltering } from './cave-low-tier.js';
import { enableCaveShadows } from './cave-shadows.js';
import { clipForestSurface, createMouthForest } from './cave-forest.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const insideForest = (x, z) => x >= BOUNDS.minX && x <= BOUNDS.maxX && z >= BOUNDS.minZ && z <= BOUNDS.maxZ;
export class CaveLink {
  constructor(host) {
    this.host = host; this.ready = false; this.state = 'loading-cave';
    this.transform = new T.Matrix4().makeRotationY(FOREST_MOUTH.yaw).setPosition(FOREST_MOUTH.x, groundHeight(FOREST_MOUTH.x, FOREST_MOUTH.z), FOREST_MOUTH.z);
    const vector = p => new T.Vector3(...p).applyMatrix4(this.transform).toArray();
    this.route = data.route.map(vector);
    this.bounds = new T.Box3().setFromPoints(this.route.map(p => new T.Vector3(...p))).expandByScalar(24);
    this.mouths = data.mouths.map(m => ({ ...m, floorCenter: vector(m.floorCenter), center: vector(m.center), outward: new T.Vector3(...m.outward).transformDirection(this.transform).toArray() }));
    this.length = data.routeLength; this.bends = data.bends.map(b => b.distance);
    this.mountain = new XianxiaMountain({ renderer: host.renderer, quality: host.lowDetail ? 'low' : 'high' });
    placeMountain(this.mountain.group, MOUNTAIN_ENTRANCE.position, new T.Vector3(...this.mouths[1].floorCenter), new T.Vector3(...this.mouths[1].outward));
    this.mountain.group.visible = false;
    this.lighting = { blend: 0, brightness: 1, mountain: MOUNTAIN_LIGHTING };
    this.frustum = new T.Frustum(); this.matrix = new T.Matrix4();
    this.forestGroups = host.scene.children.filter(o => !o.isLight && o !== host.ground && o !== host.water);
    if (new URLSearchParams(globalThis.location?.search ?? '').has('cave-check')) globalThis.__caveHost = host;
  }
  async start() {
    try {
      const host = this.host;
      if (host.lowDetail) {
        useCapturedForestLOD(host.habitat);
        try {
          const { scene: root } = await new GLTFLoader().loadAsync('/cave/forest-low.glb');
          const apply = prepareForestLOD(host.habitat, root);
          await warmCaveAssets({ root, textures: [] }, host.renderer, host.camera, host.scene, { waitForIdle: () => this.waitIdle() });
          await this.waitHidden();
          apply();
        } catch (error) { console.warn('Low-tier forest geometry unavailable:', error); }
      }
      this.assets = await loadCaveAssets({ renderer: host.renderer, data });
      if (host.lowDetail) useLowTextureFiltering(this.assets.textures);
      this.assets.root.updateMatrixWorld(true);
      const mesh = this.assets.root.getObjectByProperty('isMesh', true);
      const geometry = mesh.geometry.clone();
      const positions = new Float32Array(geometry.getAttribute('position').count * 3), v = new T.Vector3();
      for (let i = 0; i < positions.length / 3; i++) v.fromBufferAttribute(geometry.getAttribute('position'), i).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.transform).toArray(positions, i * 3);
      const worker = new Worker(new URL('./cave-physics-worker.js', import.meta.url), { type: 'module' });
      const physical = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data: result }) => result.error ? reject(new Error(result.error)) : resolve(result);
        worker.onerror = reject;
        worker.postMessage({ positions, indices: new Uint32Array(geometry.index.array), route: this.route, mouths: this.mouths, grade: MOUNTAIN_ENTRANCE.approach.grade, prepared: true });
      }).finally(() => worker.terminate());
      geometry.setAttribute('position', new T.BufferAttribute(physical.positions, 3));
      geometry.setAttribute('normal', new T.BufferAttribute(physical.normals, 3));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      mesh.geometry = geometry; mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.setScalar(1); mesh.updateMatrix();
      mesh.receiveShadow = true; mesh.castShadow = true;
      enableCaveShadows(host);
      this.floor = Object.assign(Object.create(CaveFloorIndex.prototype), physical.floor);
      this.phase = 'upload-cave';
      await warmCaveAssets(this.assets, host.renderer, host.camera, host.scene, { waitForIdle: () => this.waitIdle() });
      this.phase = 'dress-mouths';
      await this.dress();
      await this.waitHidden();
      host.ground.geometry = this.preparedTerrain;
      clipForestSurface(host.water.geometry, this.route, this.mouths);
      this.clearEntrance();
      host.colliders.push(...this.forestDressing.userData.colliders);
      host.colliderIndex = createColliderIndex(host.colliders);
      host.scene.add(this.assets.root, this.dressing); this.caveAttached = true; this.addMouthLights(); this.state = 'loading-mountain';
      await frame(); await this.mountain.load();
      await this.mountain.prepare(host.camera);
      if (host.lowDetail) useLowMountainMaterials(this.mountain.group, Object.values(this.mountain.world.photographicGround.textures));
      host.renderer.localClippingEnabled = true;
      limitMountainToExit(this.mountain.group, this.mouths[1]);
      const response = await fetch('/cave/mouth-fit.json');
      if (!response.ok) throw new Error('Missing scanned mouth profiles');
      const fit = await response.json();
      this.nativeApertureTriangles = clipMountainAperture(this.mountain.group, this.transform.clone().invert(), fit.volume, data.mouths);
      this.phase = 'upload-mountain';
      const textures = new Set(Object.values(this.mountain.world.photographicGround.textures));
      this.mountain.group.traverse(m => { if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value); });
      await warmCaveAssets({ root: this.mountain.group, textures: [...textures] }, host.renderer, host.camera, host.scene, { waitForIdle: () => this.waitIdle() });
      await this.waitHidden();
      this.mountain.group.visible = false; host.scene.add(this.mountain.group);
      this.ready = true; this.state = 'ready';
      this.horizonLoading = warmMountainHorizon(this.mountain, horizon => warmCaveAssets({ root: horizon, textures: [horizon.material.map] }, host.renderer, host.camera, host.scene, { waitForIdle: () => this.waitIdle() }))
        .catch(error => { this.horizonError = error; console.warn('Mountain horizon unavailable:', error); return null; });
    } catch (error) { this.state = 'failed'; this.error = error; console.error('Cave streaming failed:', error); }
  }
  async waitIdle() {
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'];
    while (this.host.active && (keys.some(key => this.host.keys.has(key)) || Math.hypot(this.host.touchMove?.x ?? 0, this.host.touchMove?.y ?? 0) > .01)) await frame();
  }
  async waitHidden() {
    const mouth = new T.Vector3(...this.mouths[0].center);
    while (true) {
      this.host.camera.updateMatrixWorld(); this.matrix.multiplyMatrices(this.host.camera.projectionMatrix, this.host.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.matrix);
      if (mouth.distanceTo(this.host.camera.position) > 60 || !this.frustum.intersectsSphere(new T.Sphere(mouth, 12))) return;
      await frame();
    }
  }
  async dress() {
    this.dressing = new T.Group(); this.dressing.name = 'Scanned cave mouth outcrops';
    const { scene: forest } = await new GLTFLoader().loadAsync('/cave/mouth-forest.glb');
    attachCaveRoute(forest, data.route);
    forest.applyMatrix4(this.transform);
    forest.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.material.dispose(); mesh.material = this.assets.material; mesh.receiveShadow = true; mesh.castShadow = true;
      mesh.geometry.setAttribute('caveWallOnly', new T.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(1), 1));
    });
    forest.userData.caveEnd = 0; this.dressing.add(forest);
    const { scene: mountain } = await new GLTFLoader().loadAsync('/cave/mouth-mountain.glb');
    attachCaveRoute(mountain, data.route); mountain.applyMatrix4(this.transform); mountain.userData.caveEnd = 1;
    mountain.traverse(mesh => { if (mesh.isMesh) { mesh.material.dispose(); mesh.material = this.assets.material; mesh.receiveShadow = true; mesh.castShadow = true; mesh.geometry.setAttribute('caveWallOnly', new T.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(1), 1)); mesh.geometry.setAttribute('caveGranite', new T.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(1), 1)); } });
    this.dressing.add(mountain);
    await this.waitIdle();
    const obstacles = [], v = new T.Vector3(); this.dressing.updateMatrixWorld(true);
    this.dressing.traverse(mesh => {
      if (!mesh.isMesh) return;
      const g = mesh.geometry, p = g.getAttribute('position'), index = g.index;
      for (let i = 0; i < (index?.count ?? p.count); i += 3) {
        const triangle = [0, 1, 2].map(j => v.fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld).clone());
        if (Math.min(...triangle.map(p => p.y)) > this.mouths[0].floorCenter[1] + 3) continue;
        for (const point of triangle) obstacles.push(point.x, point.y, point.z);
      }
    });
    this.dressingIndex = new CaveFloorIndex(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(obstacles, 3)), this.route);
    for (const [key, triangles] of this.dressingIndex.cells) {
      const floors = triangles.filter(triangle => triangle.floor);
      if (!floors.length) continue;
      if (!this.floor.cells.has(key)) this.floor.cells.set(key, []);
      this.floor.cells.get(key).push(...floors);
    }
    this.preparedTerrain = this.host.ground.geometry.clone();
    this.openTerrain(this.preparedTerrain);
    this.forestDressing = await createMouthForest(this.host.habitat.models, forest, this.mouths[0], this.route, frame);
    this.dressing.add(this.forestDressing);
    await warmCaveAssets({ root: this.dressing, textures: [] }, this.host.renderer, this.host.camera, this.host.scene, { waitForIdle: () => this.waitIdle() });
  }
  addMouthLights() {
    this.spills = this.mouths.map((m, i) => {
      const light = this.host.mouthLights[i]; light.color.set(i ? '#d5e0ed' : '#d5e5a3'); light.intensity = 35;
      light.position.fromArray(m.floorCenter).add(new T.Vector3(0, 2.5, 0)).addScaledVector(new T.Vector3(...m.outward), 1);
      light.target.position.fromArray(m.floorCenter).addScaledVector(new T.Vector3(...m.outward), -8); light.target.position.y += 1;
      return light;
    });
  }
  openTerrain(g = this.host.ground.geometry) {
    const p = g.getAttribute('position'), index = g.index, keep = [];
    const contact = terrainCutWriter(g);
    const box = new T.Box3().setFromPoints(this.route.map(p => new T.Vector3(...p))).expandByScalar(26);
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)], x = ids.reduce((s, k) => s + p.getX(k), 0) / 3, z = ids.reduce((s, k) => s + p.getZ(k), 0) / 3;
      if (contact.records.has(i / 3)) {
        for (const weights of contact.records.get(i / 3)) keep.push(contact.append(ids, weights));
        continue;
      }
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) {
        const near = nearestRoute(x, z, this.route);
        if (near.distance < 9 && mouthDistance({ x, z }, this.mouths[0]) < 0 && mouthDistance({ x, z }, this.mouths[1]) < -.4) continue;
      }
      keep.push(...ids);
    }
    contact.finish();
    g.setIndex(keep);
    clipForestSurface(g, this.route, this.mouths);
  }
  clearEntrance() {
    const h = this.host, mouth = new T.Vector3(...this.mouths[0].floorCenter);
    h.colliders = h.colliders.filter(c => Math.hypot(c.x - mouth.x, c.z - mouth.z) > 12 + (c.radius ?? 1));
    h.colliderIndex = createColliderIndex(h.colliders);
    h.habitat.lodTrees = h.habitat.lodTrees.filter(tree => {
      if (Math.hypot(tree.x - mouth.x, tree.z - mouth.z) > 12) return true;
      tree.group?.removeFromParent();
      for (const part of tree.parts) { part.batch.mesh.setMatrixAt(part.index, h.habitat.hiddenMatrix); part.batch.mesh.instanceMatrix.needsUpdate = true; }
      return false;
    });
    const matrix = new T.Matrix4(), point = new T.Vector3(), hidden = new T.Matrix4().makeScale(0, 0, 0);
    for (const cell of h.habitat.cells) if (cell.isInstancedMesh) {
      for (let i = 0; i < cell.count; i++) { cell.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix); if (point.distanceTo(mouth) < 10) cell.setMatrixAt(i, hidden); }
      cell.instanceMatrix.needsUpdate = true;
    }
  }
  regionAt(x, z) {
    const inCorridor = x >= this.bounds.min.x && x <= this.bounds.max.x && z >= this.bounds.min.z && z <= this.bounds.max.z;
    const point = { x, z }, forest = mouthDistance(point, this.mouths[0]), mountain = mouthDistance(point, this.mouths[1]);
    if (inCorridor && forest <= .03 && mountain <= .03) return 'cave';
    if ((!insideForest(x, z) || !isWalkableGround(x, z)) && this.mountain.groundHeight(x, z) != null) return 'mountain';
    if (!inCorridor) return 'forest';
    if (mountain > -.03 && this.mountain.groundHeight(x, z) != null) return 'mountain';
    return 'forest';
  }
  locate(x, z) {
    return { region: this.regionAt(x, z), ...nearestRoute(x, z, this.route) };
  }
  groundHeight(x, z) {
    const region = this.regionAt(x, z);
    if (region === 'cave') {
      const height = this.floor?.heightAt(x, z);
      if (height != null) return height;
      if (mouthDistance({ x, z }, this.mouths[0]) > -.08) return groundHeight(x, z);
      if (mouthDistance({ x, z }, this.mouths[1]) > -.08) return this.mountain.groundHeight(x, z);
      return null;
    }
    if (region === 'mountain') return this.mountain.groundHeight(x, z);
    return groundHeight(x, z);
  }
  canMove(ax, az, x, z) {
    const next = this.regionAt(x, z), previous = this.regionAt(ax, az);
    const nearDressing = this.dressingIndex && [[0, 0], [.4, 0], [-.4, 0], [0, .4], [0, -.4]].some(([dx, dz]) => this.dressingIndex.triangles(x + dx, z + dz).length);
    if (this.caveAttached && nearDressing && !this.dressingIndex.canMove(ax, az, x, z, .4, (x, z) => this.groundHeight(x, z))) return false;
    if (next === 'forest') return insideForest(x, z) && isWalkableGround(x, z) ? null : false;
    if (!this.caveAttached || !this.floor || (!this.ready && nearestRoute(x, z, this.route).along > this.bends[0] - 1)) return false;
    const before = this.groundHeight(ax, az), after = this.groundHeight(x, z);
    if (before == null || after == null || Math.abs(before - after) > .4) return false;
    if (next !== previous) return Math.abs(before - after) < .08;
    if (next === 'mountain') return this.ready && [[0, 0], [.05, 0], [-.05, 0], [0, .05], [0, -.05]].every(([dx, dz]) => this.mountain.canMove(ax + dx, az + dz, x + dx, z + dz));
    return this.floor.canMove(ax, az, x, z, .4, (x, z) => this.groundHeight(x, z));
  }
  update(dt) {
    if (this.host.lowDetail && this.ready) useLowMountainMaterials(this.mountain.group);
    const near = this.locate(this.host.position.x, this.host.position.z), t = near.region === 'mountain' ? 1 : near.region === 'forest' ? 0 : near.along / this.length;
    this.region = near.region === 'mountain' ? '青岚境' : near.region === 'cave' ? '山腹石径' : null;
    const depth = Math.sin(Math.PI * T.MathUtils.smoothstep(t, 0, 1));
    this.lighting.blend = t; this.lighting.brightness = 1 - .67 * depth;
    if (this.ready && near.region === 'cave' && near.along > this.bends[0] + 1 && near.along < this.bends[1] - 1) {
      this.mountain.group.visible = this.host.lowDetail ? near.along > this.bends[1] - 8 : t > .23;
      this.forestHidden = this.host.lowDetail ? near.along > this.bends[0] + 2 : t > .75;
    }
    if (near.region !== 'cave') this.forestHidden = near.region === 'mountain';
    for (const group of this.dressing?.children ?? []) if (group.userData.caveEnd === 1) group.visible = this.ready && this.mountain.group.visible;
    if (this.forestHidden) {
      if (!this.wasForestHidden) this.forestVisibility = new Map(this.forestGroups.map(group => [group, group.visible]));
      for (const group of this.forestGroups) group.visible = false;
    } else if (this.wasForestHidden) {
      for (const [group, visible] of this.forestVisibility) group.visible = visible;
      this.host.habitat?.updateVisibility(this.host.camera.position);
      this.host.rain.visible = this.host.rainy;
    }
    this.wasForestHidden = this.forestHidden;
    if (this.assets?.material) this.assets.material.userData.viewerBrightness.value = this.lighting.brightness;
    if (this.host.ground) this.host.ground.visible = !this.forestHidden;
    if (this.host.water) this.host.water.visible = !this.forestHidden;
    if (this.forestDressing) this.forestDressing.visible = !this.forestHidden;
    this.host.camera.far = 220; this.host.camera.updateProjectionMatrix();
    for (const light of this.spills ?? []) light.intensity = this.host.rainy ? 22 : 35;
  }
}

export function streamCave(host) { const link = new CaveLink(host); host.worldLink = link; link.start(); return link; }
