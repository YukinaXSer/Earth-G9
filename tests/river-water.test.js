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
    assert.match(water.material.fragmentShader, /vec3\( 0.55, 1.0, 0.55 \)/);
    assert.match(water.material.fragmentShader, /time \* \.4/);
    assert.match(water.material.fragmentShader, /mix\(4\., 5\., rain\)/);
    assert.match(water.material.fragmentShader, /mix\(\.35, \.98, absorption\)/);
    assert.match(water.material.fragmentShader, /radiance \/ \(1\. \+ luminance\)/);
    assert.doesNotMatch(water.material.fragmentShader, /reflectionSample \* specularLight/);
    assert.equal(water.userData.reflectionMode, lowDetail ? 'local-planar-throttled' : 'local-planar');
  }
});

test('both qualities reflect the local scene with bounded render targets, distance and LOW refresh cost', () => {
  for (const lowDetail of [true, false]) {
    const water = createRiverWater(new THREE.PlaneGeometry(14, 40), new THREE.Texture(), lowDetail);
    water.updateMatrixWorld();
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 240);
    camera.position.set(0, 2, 20); camera.updateMatrixWorld();
    const scene = new THREE.Scene(), originalTarget = {}, calls = [];
    let target = originalTarget;
    const renderer = {
      xr: { enabled: true }, shadowMap: { autoUpdate: true }, autoClear: false,
      getRenderTarget: () => target,
      setRenderTarget: value => { target = value; },
      state: { buffers: { depth: { setMask: () => {} } } },
      clear() {},
      render(renderedScene, reflectedCamera) {
        calls.push({ scene: renderedScene, camera: reflectedCamera.clone(), target });
        assert.equal(water.visible, false);
        assert.equal(this.xr.enabled, false);
        assert.equal(this.shadowMap.autoUpdate, false);
      },
    };
    water.onBeforeRender(renderer, scene, camera);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scene, scene);
    assert.equal(calls[0].target.width, lowDetail ? 128 : 256);
    assert.equal(calls[0].camera.far, lowDetail ? 48 : 80);
    assert.ok(Math.abs(calls[0].camera.position.y - (2 * RIVER_LEVEL - camera.position.y)) < 1e-6);
    assert.ok(camera.position.equals(new THREE.Vector3(0, 2, 20)));
    assert.equal(target, originalTarget);
    assert.equal(water.visible, true);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.shadowMap.autoUpdate, true);
    assert.equal(water.material.uniforms.sceneReflection.value, 1);
    water.material.uniforms.time.value = .1;
    water.onBeforeRender(renderer, scene, camera);
    assert.equal(calls.length, lowDetail ? 1 : 2);
    water.material.uniforms.time.value = .21;
    water.onBeforeRender(renderer, scene, camera);
    assert.equal(calls.length, lowDetail ? 2 : 3);
    water.material.uniforms.time.value = .5;
    water.onBeforeRender(renderer, scene, camera);
    assert.equal(calls.length, lowDetail ? 2 : 4);
    water.material.uniforms.time.value = .51;
    water.onBeforeRender(renderer, scene, camera);
    assert.equal(calls.length, lowDetail ? 3 : 5);
    camera.position.x = 100; camera.updateMatrixWorld();
    water.material.uniforms.time.value = 1;
    water.onBeforeRender(renderer, scene, camera);
    assert.equal(calls.length, lowDetail ? 3 : 5);
    assert.equal(water.material.uniforms.sceneReflection.value, 0);
    assert.ok(water.material.uniforms.eye.value.equals(camera.position));
  }
});

test('water normals and their redistribution license are local and small', () => {
  const normal = new URL('../public/textures/water-normals.jpg', import.meta.url);
  assert.ok(statSync(normal).size < 300000);
  assert.equal(readFileSync(normal).readUInt16BE(0), 0xffd8);
  assert.match(readFileSync(new URL('../public/THREE-LICENSE.txt', import.meta.url), 'utf8'), /The MIT License[\s\S]+Permission is hereby granted/);
});
