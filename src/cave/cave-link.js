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
import { clipForestSurface, createMouthForest, cullForestInCave } from './cave-forest.js';
import { createMountainFloorSeal, createMountainRockCover } from './cave-rock-cover.js';
import { createMountainHandoffFloor, floorHandoffHeight, useMountainFloorMaterial } from './cave-floor-handoff.js';

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
    this.mountainGeometry = new WeakMap();
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
          await warmCaveAssets({ root, textures: [] }, host.renderer, host.camera, host.scene);
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
      await warmCaveAssets(this.assets, host.renderer, host.camera, host.scene);
      this.phase = 'dress-mouths';
      await this.dress();
      await this.clearEntrance();
      this.attachCave();
      await frame(); await this.mountain.load();
      await this.mountain.prepare(host.camera);
      this.mountain.group.updateMatrixWorld(true);
      if (host.lowDetail) useLowMountainMaterials(this.mountain.group, Object.values(this.mountain.world.photographicGround.textures));
      host.renderer.localClippingEnabled = true;
      this.prepareMountainMeshes(this.mountain.group);
      this.nativeFloor = createMountainHandoffFloor(this.mountain.group, this.route, this.floorHandoff);
      const nativeFloor = this.mountain.group.getObjectByName('native-mountain');
      useMountainFloorMaterial(mesh, this.floorHandoff, Array.isArray(nativeFloor.material) ? nativeFloor.material[0] : nativeFloor.material);
      await warmCaveAssets({ root: mesh.clone(false), textures: [] }, host.renderer, host.camera, host.scene);
      const cover = createMountainRockCover(host.habitat.models, this.mouths[1], this.route, (x, z) => this.mountain.groundHeight(x, z), this.assets.material);
      await warmCaveAssets({ root: cover, textures: [] }, host.renderer, host.camera, host.scene);
      cover.visible = false; this.dressing.add(cover);
      const floorRock = createMountainFloorSeal(host.habitat.models, this.mouths[1], this.route, (x, z) => this.floor.heightAt(x, z) ?? this.mountain.groundHeight(x, z), this.assets.material);
      await warmCaveAssets({ root: floorRock, textures: [] }, host.renderer, host.camera, host.scene);
      floorRock.visible = false; this.dressing.add(floorRock);
      this.phase = 'upload-mountain';
      const textures = new Set(Object.values(this.mountain.world.photographicGround.textures));
      this.mountain.group.traverse(m => { if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value); });
      await warmCaveAssets({ root: this.mountain.group, textures: [...textures] }, host.renderer, host.camera, host.scene);
      this.attachMountain();
    } catch (error) { this.state = 'failed'; this.error = error; console.error('Cave streaming failed:', error); }
  }
  attachMountain() {
    const host = this.host;
    host.scene.add(this.mountain.group);
    this.mountain.group.visible = true; this.ready = true; this.state = 'ready';
    this.horizonLoading = warmMountainHorizon(this.mountain, horizon => warmCaveAssets({ root: horizon, textures: [horizon.material.map] }, host.renderer, host.camera, host.scene))
      .catch(error => { this.horizonError = error; console.warn('Optional mountain horizon unavailable:', error); return null; });
  }
  attachCave() {
    if (this.caveAttached) return;
    if (!this.assets?.root || !this.dressing || !this.preparedTerrain || !this.forestDressing) throw new Error('Cave attachment requires prepared geometry');
    const host = this.host;
    host.ground.geometry = this.preparedTerrain;
    clipForestSurface(host.water.geometry, this.route, this.mouths);
    host.colliders.push(...this.forestDressing.userData.colliders);
    host.colliderIndex = createColliderIndex(host.colliders);
    host.scene.add(this.assets.root, this.dressing);
    this.caveAttached = true; this.addMouthLights(); this.state = 'loading-mountain';
  }
  prepareMountainMeshes(root) {
    if (root === this.mountain.group && !this.mountainWatching) {
      this.mountainWatching = true;
      root.addEventListener('childadded', ({ child }) => this.prepareMountainMeshes(child));
    }
    root.updateWorldMatrix(true, true);
    const nativeCliff = this.fit.mouths[1].strategy === 'native-cliff';
    limitMountainToExit(root, this.mouths[1], { nativeCliff });
    this.nativeApertureTriangles = (this.nativeApertureTriangles ?? 0) + clipMountainAperture(root, this.transform.clone().invert(), this.fit.volume, data.mouths,
      { nativeCliff, outwardDepth: nativeCliff ? this.fit.mouths[1].nativeOpeningExtensionMetres : 0, floorHandoff: this.floorHandoff, geometryCache: this.mountainGeometry });
    if (this.host.lowDetail) useLowMountainMaterials(root);
  }
  async dress() {
    const response = await fetch('/cave/mouth-fit.json');
    if (!response.ok) throw new Error('Missing scanned mouth profiles');
    this.fit = await response.json();
    this.floorHandoff = this.fit.mouths[1].floorHandoff;
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
    await warmCaveAssets({ root: this.dressing, textures: [] }, this.host.renderer, this.host.camera, this.host.scene);
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
  async clearEntrance() {
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
    await cullForestInCave(h.habitat, this.forestDressing, this.transform.clone().invert(), this.fit.volume, data.mouths, frame);
  }
  regionAt(x, z) {
    const inCorridor = x >= this.bounds.min.x && x <= this.bounds.max.x && z >= this.bounds.min.z && z <= this.bounds.max.z;
    const point = { x, z }, forest = mouthDistance(point, this.mouths[0]), mountain = mouthDistance(point, this.mouths[1]);
    if (inCorridor && forest <= .03 && mountain <= .03) return 'cave';
    if (mountain > -.03 && (!insideForest(x, z) || !isWalkableGround(x, z)) && this.mountain.groundHeight(x, z) != null) return 'mountain';
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
      if (this.ready && this.floorHandoff && mouthDistance({ x, z }, this.mouths[1]) > -this.floorHandoff.band - 1) {
        const renderedNative = this.nativeFloor?.heightAt(x, z);
        const support = floorHandoffHeight(this.floorHandoff, this.route, x, z, height, this.mountain.groundHeight(x, z), renderedNative);
        if (support != null) return support;
      }
      if (height != null) return height;
      if (mouthDistance({ x, z }, this.mouths[0]) > -.08) return groundHeight(x, z);
      if (mouthDistance({ x, z }, this.mouths[1]) > -.08) return this.mountain.groundHeight(x, z);
      return null;
    }
    if (region === 'mountain') return this.mountain.groundHeight(x, z);
    return groundHeight(x, z);
  }
  canMove(ax, az, x, z) {
    const entrance = this.mouths[0].floorCenter;
    if (!this.caveAttached && Math.hypot(x - entrance[0], z - entrance[2]) < 120 && Math.hypot(x - entrance[0], z - entrance[2]) < Math.hypot(ax - entrance[0], az - entrance[2])) return false;
    const next = this.regionAt(x, z), previous = this.regionAt(ax, az);
    const nearDressing = this.dressingIndex && [[0, 0], [.4, 0], [-.4, 0], [0, .4], [0, -.4]].some(([dx, dz]) => this.dressingIndex.triangles(x + dx, z + dz).length);
    if (this.caveAttached && nearDressing && !this.dressingIndex.canMove(ax, az, x, z, .4, (x, z) => this.groundHeight(x, z))) return false;
    if (next === 'forest') return insideForest(x, z) && isWalkableGround(x, z) ? null : false;
    if (!this.caveAttached || !this.floor || (!this.ready && nearestRoute(x, z, this.route).along > this.bends[0] - 1)) return false;
    const before = this.groundHeight(ax, az), after = this.groundHeight(x, z);
    if (before == null || after == null || Math.abs(before - after) > .4) return false;
    if (next === 'cave' && this.floorHandoff && this.ready && mouthDistance({ x, z }, this.mouths[1]) > -this.floorHandoff.band - 1) {
      const near = nearestRoute(x, z, this.route);
      if (near.along >= this.floorHandoff.along && near.distance <= 1.2 && !this.mountain.canMove(ax, az, x, z)) return false;
    }
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
    this.mountain.group.visible = this.ready;
    this.forestHidden = false;
    for (const group of this.dressing?.children ?? []) if (group.userData.caveEnd === 1) group.visible = this.ready;
    if (this.assets?.material) this.assets.material.userData.viewerBrightness.value = this.lighting.brightness;
    if (this.host.ground) this.host.ground.visible = true;
    if (this.host.water) this.host.water.visible = true;
    if (this.forestDressing) this.forestDressing.visible = true;
    if (this.host.rain) this.host.rain.visible = this.host.rainy;
    this.host.camera.far = 220; this.host.camera.updateProjectionMatrix();
    for (const light of this.spills ?? []) light.intensity = this.host.rainy ? 22 : 35;
  }
}

export function streamCave(host) { const link = new CaveLink(host); host.worldLink = link; link.loading = link.start(); return link; }
