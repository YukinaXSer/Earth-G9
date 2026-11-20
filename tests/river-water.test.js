import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { createRiverWater } from '../src/river-water.js';
import { RIVER_LEVEL } from '../src/data.js';

test('reflective water retains its world-space surface, physical depth and upward mirror plane', () => {
  for (const lowDetail of [true, false]) {
    const geometry = new THREE.PlaneGeometry(14, 40).rotateX(-Math.PI / 2).translate(24, RIVER_LEVEL, 0);
    const original = geometry.attributes.position.clone();
    geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(new Float32Array(original.count).fill(.5), 1));
    const water = createRiverWater(geometry, new THREE.Texture(), lowDetail);
    water.updateMatrixWorld();
    for (let i = 0; i < original.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(water.matrixWorld);
      assert.ok(p.distanceTo(new THREE.Vector3().fromBufferAttribute(original, i)) < 1e-6);
    }
    assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(water.matrixWorld).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
    assert.equal(geometry.attributes.waterDepth.getX(0), .5);
    assert.equal(water.material.transparent, true);
    assert.equal(water.material.depthWrite, false);
    assert.match(water.material.fragmentShader, /float rf0 = 0.02;/);
    assert.match(water.material.fragmentShader, /exp\(-max\(vWaterDepth/);
    assert.match(water.material.fragmentShader, /texture2D\(normalSampler/);
    assert.match(water.material.fragmentShader, /vec3\( 0.2, 1.0, 0.2 \)/);
    assert.match(water.material.fragmentShader, /radiance \/ \(1\. \+ luminance\)/);
    assert.doesNotMatch(water.material.fragmentShader, /reflectionSample \* specularLight/);
    assert.equal(water.userData.reflectionMode, lowDetail ? 'photographic-environment' : 'local-planar');
    if (lowDetail) {
      const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 2, 20); camera.updateMatrixWorld();
      water.onBeforeRender({}, new THREE.Scene(), camera);
      assert.equal(water.material.uniforms.sceneReflection.value, 0);
      assert.ok(water.material.uniforms.eye.value.equals(camera.position));
    }
  }
});

test('water normals and their redistribution license are local and small', () => {
  const normal = new URL('../public/textures/water-normals.jpg', import.meta.url);
  assert.ok(statSync(normal).size < 300000);
  assert.equal(readFileSync(normal).readUInt16BE(0), 0xffd8);
  assert.match(readFileSync(new URL('../public/THREE-LICENSE.txt', import.meta.url), 'utf8'), /The MIT License[\s\S]+Permission is hereby granted/);
});
