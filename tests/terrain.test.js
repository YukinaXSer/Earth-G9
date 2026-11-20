import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rainforest } from '../src/world.js';
import { groundHeight, riverX, RIVER_LEVEL, BOUNDS, FORDS, VIEWPOINTS, WALKING_ROUTES, distanceToTrail, isWalkableGround, mapProjection, loadView } from '../src/data.js';
import { TERRAIN } from '../src/ground-relief.js';

test('river and captured terrain extend beyond every playable boundary through the camera view distance', () => {
  assert.ok(TERRAIN.width / 2 + BOUNDS.minX >= 220);
  assert.ok(TERRAIN.width / 2 - BOUNDS.maxX >= 220);
  assert.ok(BOUNDS.minZ - (TERRAIN.centerZ - TERRAIN.depth / 2) >= 220);
  assert.ok(TERRAIN.centerZ + TERRAIN.depth / 2 - BOUNDS.maxZ >= 220);
  const world = { lowDetail: true, scene: new THREE.Scene(), rand: (min, max) => (min + max) / 2, floorMap: null, floorNormal: null, floorRoughness: null };
  Rainforest.prototype.makeTerrain.call(world);
  assert.equal(world.ground.material.envMapIntensity, .22);
  const water = world.scene.children.find(node => node.material === world.waterMaterial);
  const bounds = new THREE.Box3().setFromObject(water);
  assert.equal(bounds.min.z, TERRAIN.centerZ - TERRAIN.depth / 2);
  assert.equal(bounds.max.z, TERRAIN.centerZ + TERRAIN.depth / 2);
  const positions = world.ground.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 137) {
    assert.ok(Math.abs(positions.getY(i) - groundHeight(positions.getX(i), positions.getZ(i))) < 1e-6);
  }
});

test('expanded forest has connected dry routes and shallow crossings without permitting deep-water walking', () => {
  assert.equal(BOUNDS.maxX - BOUNDS.minX, 312);
  assert.equal(BOUNDS.maxZ - BOUNDS.minZ, 486);
  for (const ford of FORDS) for (const dz of [-2, 0, 2]) {
    const z = ford.z + dz;
    for (let x = riverX(z) - 14; x <= riverX(z) + 14; x += .25) assert.ok(isWalkableGround(x, z), `blocked ford at ${x},${z}`);
  }
  for (const z of [-240, -100, 0, 60, 190]) assert.ok(!isWalkableGround(riverX(z), z));
  for (const route of WALKING_ROUTES) for (let i = 1; i < route.points.length; i++) {
    const [ax, az] = route.points[i - 1], [bx, bz] = route.points[i];
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let j = 0; j <= steps; j++) {
      const x = ax + (bx - ax) * j / steps, z = az + (bz - az) * j / steps;
      assert.ok(isWalkableGround(x, z));
      assert.ok(distanceToTrail(x, z) < .1);
    }
  }
  for (const point of VIEWPOINTS) {
    assert.ok(point.x > BOUNDS.minX && point.x < BOUNDS.maxX && point.z > BOUNDS.minZ && point.z < BOUNDS.maxZ);
    assert.ok(distanceToTrail(point.x, point.z) < .1);
    assert.ok(isWalkableGround(point.x, point.z));
    assert.ok(Math.abs(point.x) > 52 || point.z < -111 || point.z > 51);
  }
});

test('map projection preserves physical aspect ratio and includes new edges, trails and east-bank saved views', () => {
  for (const [w, h] of [[540, 560], [300, 500]]) {
    const { project, scale } = mapProjection(w, h);
    for (const x of [BOUNDS.minX, BOUNDS.maxX]) for (const z of [BOUNDS.minZ, BOUNDS.maxZ]) {
      const p = project(x, z); assert.ok(p.x >= 24 && p.x <= w - 24 && p.y >= 24 && p.y <= h - 24);
    }
    assert.ok(Math.abs((project(10, 0).x - project(0, 0).x) - (project(0, 10).y - project(0, 0).y)) < 1e-10);
    assert.ok(scale > 0);
  }
  const view = { x: 105, z: -218, yaw: .3, pitch: .1 };
  assert.deepEqual(loadView({ getItem: () => JSON.stringify(view) }), view);
});

test('water reaches the terrain-defined shoreline and fades with physical depth instead of a narrow ribbon edge', () => {
  const world = { lowDetail: true, scene: new THREE.Scene(), rand: (min, max) => (min + max) / 2, floorMap: null, floorNormal: null, floorRoughness: null };
  Rainforest.prototype.makeTerrain.call(world);
  const water = world.scene.children.find(node => node.material === world.waterMaterial);
  const positions = water.geometry.attributes.position, depth = water.geometry.attributes.waterDepth;
  water.updateMatrixWorld();
  for (let i = 0; i < positions.count; i += 37) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(water.matrixWorld);
    const x = p.x, z = p.z;
    assert.ok(Math.abs(p.y - RIVER_LEVEL) < 1e-6);
    assert.ok(Math.abs(depth.getX(i) - (RIVER_LEVEL - groundHeight(x, z))) < 1e-5);
  }
  for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 2) for (const side of [-1, 1]) {
    assert.ok(groundHeight(riverX(z) + side * 9, z) > RIVER_LEVEL + .2);
  }
  assert.match(world.waterMaterial.fragmentShader, /smoothstep\(0\., \.14, vWaterDepth\)/);
});

test('wet litter keeps roughness variation and applies canopy occlusion to reflections', () => {
  const original = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }) }) }) };
  try {
    for (const lowDetail of [true, false]) {
      const world = { lowDetail, ground: { material: new THREE.MeshStandardMaterial() }, colliders: [], habitat: { groundOccluders: [] } };
      Rainforest.prototype.makeGroundShadows.call(world);
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      world.ground.material.onBeforeCompile(shader);
      assert.match(shader.fragmentShader, /forestOcclusion = clamp\(texture2D\(forestShade, vForestUv\)\.r, 0\.55, 1\.0\)/);
      assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= forestOcclusion/);
      assert.match(shader.fragmentShader, /clamp\(roughnessFactor \* \.85, \.62, \.85\)/);
      assert.match(shader.fragmentShader, /reflectedLight\.indirectSpecular \*= forestOcclusion/);
      assert.equal(shader.fragmentShader.includes('reflectedLight.directSpecular *= forestOcclusion;'), lowDetail);
      assert.ok(shader.fragmentShader.indexOf('float forestOcclusion') < shader.fragmentShader.indexOf('roughnessFactor = mix'));
      assert.ok(shader.fragmentShader.indexOf('roughnessFactor = mix') < shader.fragmentShader.indexOf('reflectedLight.indirectSpecular *= forestOcclusion'));
      shader.uniforms.forestShade.value.dispose();
      world.ground.material.dispose();
    }
  } finally { globalThis.document = original; }
});

test('object and player floor heights match actual terrain triangles between vertices in either quality', () => {
  for (const lowDetail of [true, false]) {
    const world = { lowDetail, scene: new THREE.Scene(), rand: (min, max) => (min + max) / 2, floorMap: null, floorNormal: null, floorRoughness: null };
    Rainforest.prototype.makeTerrain.call(world);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const [x, z] of [[32.2978, -4.016], [29.1818, -4.013], [31.062, -7.815], [32.968, .284], [-46.3, 40.5], [-45.2, -106.7], [.7, 15.3]]) {
      ray.ray.origin.set(x, 10, z);
      const [hit] = ray.intersectObject(world.ground);
      assert.ok(hit && Math.abs(hit.point.y - groundHeight(x, z)) < 1e-6, `floating/buried placement at ${x},${z} in ${lowDetail ? 'low' : 'high'} quality`);
    }
    world.ground.geometry.dispose();
    world.ground.material.dispose();
  }
});
