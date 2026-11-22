import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {captureGeometry,CAPTURE_SHIFT,CAPTURE_START,groundProp,groundPropMatrix} from '../src/xianxia-near.js';
import {createFloorIndex} from '../src/xianxia-world.js';
import {addPhotographicCapture} from '../src/xianxia-surface.js';
import {XianxiaDemoRuntime} from '../src/xianxia-demo-runtime.js';
import {Rainforest} from '../src/world.js';

test('native sample geometry keeps its original scale and triangles under one rigid translation',()=>{
  const data=readFileSync(new URL('../public/xianxia/surface/capture.bin',import.meta.url));
  const bytes=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),geometry=captureGeometry(bytes);
  assert.equal(geometry.index.count/3,151044);assert.equal(geometry.attributes.position.count,78154);
  const size=geometry.boundingBox.getSize(new THREE.Vector3());assert.ok(Math.abs(size.x-12.50318)<.001&&Math.abs(size.z-11.67169)<.001);
  const index=createFloorIndex([geometry],2),x=CAPTURE_START.x+CAPTURE_SHIFT.x,z=CAPTURE_START.z+CAPTURE_SHIFT.z;
  assert.ok(Math.abs(index.heightAt(x,z)-CAPTURE_START.y)<.00001);
  assert.ok(index.canMove(x,z,x+.01,z));assert.equal(index.geometries[0],geometry);
});

test('rock support is queried from the actual surface and sunk without changing scale',()=>{
  const floor=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),index=createFloorIndex([floor],2),rock=new THREE.BoxGeometry(1,1,1).translate(0,.5,0);
  const placed=groundProp(rock,index,1,2,.3);assert.ok(placed);assert.ok(Math.abs(placed.boundingBox.min.y+.025)<.00001);
  assert.equal(groundProp(new THREE.BoxGeometry(1,1,1),index,100,100,0),null);
});

test('near runtime inherits the live forest lighting and stops the unused base animation before starting its own',()=>{
  assert.equal(XianxiaDemoRuntime.prototype.makeLighting,Rainforest.prototype.makeLighting);
  const runtime={animate(){throw new Error('unused rainforest loop');}};
  XianxiaDemoRuntime.prototype.makeParticles.call(runtime);assert.doesNotThrow(()=>runtime.animate());
});

test('instanced ground placement preserves the same scale, foot embedding and template geometry',()=>{
  const floor=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2).rotateZ(.1),index=createFloorIndex([floor],2);
  const template=new THREE.BoxGeometry(.6,.6,.6).translate(0,.3,0),original=template.attributes.position.array.slice();
  const transform=groundPropMatrix(template,index,1,2,.7),copy=template.clone().applyMatrix4(transform),placed=groundProp(template.clone(),index,1,2,.7);
  assert.deepEqual(template.attributes.position.array,original);
  assert.ok(Math.abs(transform.determinant()-1)<1e-9);
  assert.deepEqual(copy.attributes.position.array,placed.attributes.position.array);
  assert.equal(groundPropMatrix(template,index,100,100,0),null);
});

test('different fern sizes query their scaled footprint and keep every root embedded in the visible floor',()=>{
  const floor=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2).rotateZ(.2),index=createFloorIndex([floor],2);
  const template=new THREE.BoxGeometry(.6,.8,.9).translate(0,.4,0),original=template.attributes.position.array.slice();
  for(const scale of [.55,.83,1.15]){
    const transform=groundPropMatrix(template,index,1,2,.7,{scale,sink:.02}),placed=template.clone().applyMatrix4(transform);
    assert.ok(Math.abs(transform.determinant()-scale**3)<1e-9);
    let highest=-Infinity;
    for(let i=0;i<template.attributes.position.count;i++){
      if(template.attributes.position.getY(i)>.01)continue;
      const p=new THREE.Vector3().fromBufferAttribute(placed.attributes.position,i);
      const clearance=p.y-index.heightAt(p.x,p.z);
      assert.ok(clearance<=-.019999);highest=Math.max(highest,clearance);
    }
    assert.ok(Math.abs(highest+.02)<1e-6);
  }
  assert.deepEqual(template.attributes.position.array,original);
  assert.equal(groundPropMatrix(template,index,9.5,0,0,{scale:2}),null);
  for(const scale of [0,-1,NaN,Infinity])assert.throws(()=>groundPropMatrix(template,index,1,2,0,{scale}),/Invalid grounded prop scale/);
});

test('both photographic layers feed standard PBR, retaining the shared HDR, tone map and output stages',()=>{
  const uniforms={patchOrigin:{value:new THREE.Vector3()},forceMaterial:{value:-1}},material=addPhotographicCapture(new THREE.MeshStandardMaterial({envMapIntensity:.22}),uniforms);
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  material.onBeforeCompile(shader);
  assert.equal(material.isMeshStandardMaterial,true);assert.equal(material.envMapIntensity,.22);
  assert.match(shader.vertexShader,/xyz-patchOrigin/);assert.match(shader.fragmentShader,/projectSurface\(wallColor/);
  assert.match(shader.fragmentShader,/#include <lights_fragment_begin>/);assert.match(shader.fragmentShader,/#include <tonemapping_fragment>/);
  assert.match(shader.fragmentShader,/#include <colorspace_fragment>/);assert.match(shader.fragmentShader,/roughnessFactor=clamp/);
  assert.equal(shader.uniforms.patchOrigin,uniforms.patchOrigin);
});
