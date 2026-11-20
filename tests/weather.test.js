import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Rainforest } from '../src/world.js';

test('the sunny photographic sky preserves blue sky and captured solar radiance', () => {
  const file = readFileSync(new URL('../public/textures/sunny-sky.hdr', import.meta.url));
  const sky = new HDRLoader().setDataType(THREE.FloatType).parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  let blue = 0, maximum = 0;
  for (let i = 0; i < sky.data.length; i += 4) {
    if (sky.data[i + 2] > sky.data[i] * 1.4 && sky.data[i + 2] > sky.data[i + 1]) blue++;
    maximum = Math.max(maximum, sky.data[i], sky.data[i + 1], sky.data[i + 2]);
  }
  assert.ok(blue > 10000);
  assert.ok(maximum > 1000);
});

test('sunny and rainy weather select different photographic skies and light levels in either quality', () => {
  for (const lowDetail of [true, false]) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2();
    const wet = [];
    const world = {
      lowDetail, scene, moisture: 0,
      rainySky: new THREE.Texture(), sunnySky: new THREE.Texture(),
      rain: new THREE.Group(), sun: new THREE.DirectionalLight(), sunRays: new THREE.Group(),
      ground: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial()),
      waterMaterial: { uniforms: { fogColor: { value: new THREE.Color() }, rain: { value: 0 } } },
      habitat: { setWet: rainy => wet.push(rainy) },
      updateSky: Rainforest.prototype.updateSky,
    };
    Rainforest.prototype.setWeather.call(world, false);
    assert.equal(scene.background, world.sunnySky);
    assert.equal(world.rain.visible, false);
    assert.equal(world.sunRays.visible, !lowDetail);
    const sunnyFog = scene.fog.density, sunnyLight = world.sun.intensity, sunnyFill = scene.environmentIntensity;
    const sunnyRotation = scene.backgroundRotation.y;
    Rainforest.prototype.setWeather.call(world, true);
    assert.equal(scene.background, world.rainySky);
    assert.equal(world.rain.visible, true);
    assert.equal(world.sunRays.visible, false);
    assert.ok(scene.fog.density > sunnyFog);
    assert.ok(world.sun.intensity < sunnyLight && scene.environmentIntensity < sunnyFill);
    assert.notEqual(scene.backgroundRotation.y, sunnyRotation);
    Rainforest.prototype.setWeather.call(world, false);
    assert.equal(scene.background, world.sunnySky);
    assert.equal(world.sun.intensity, sunnyLight);
    assert.equal(world.moisture, 1);
    assert.deepEqual(wet, [false, true, false]);
    world.ground.geometry.dispose(); world.ground.material.dispose();
    world.sunnySky.dispose(); world.rainySky.dispose();
  }
});

test('weather chosen before sky download completion still selects the correct sky when available', () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(); scene.fog = new THREE.FogExp2('#65776d');
  const world = { scene, rainy: true };
  Rainforest.prototype.updateSky.call(world);
  assert.ok(scene.background.isColor);
  assert.ok(scene.background.equals(scene.fog.color));
  world.sunnySky = new THREE.Texture(); world.rainySky = new THREE.Texture();
  Rainforest.prototype.updateSky.call(world);
  assert.equal(scene.background, world.rainySky);
});
