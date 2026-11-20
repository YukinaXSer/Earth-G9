import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createFloorIndex,XianxiaWorld} from '../src/xianxia-world.js';
import {addPhotographicGround,ensureSurfaceNormals,nativeGroundTexture,nativeGroundVariant,loadPhotographicGround} from '../src/xianxia-surface.js';

const manifest=JSON.parse(readFileSync(new URL('../public/xianxia/surface/manifest.json',import.meta.url)));
const textures=Object.fromEntries(Object.keys(manifest.textures).map(id=>[id,new THREE.Texture()]));

test('native variant requires sRGB S3TC for color and regular S3TC for normal uploads',async()=>{
  const ext=(...available)=>({has:name=>available.includes(name)}),s3tc='WEBGL_compressed_texture_s3tc',srgb='WEBGL_compressed_texture_s3tc_srgb';
  assert.equal(nativeGroundVariant(ext('WEBGL_compressed_texture_etc',s3tc,srgb)),'etc2');
  assert.equal(nativeGroundVariant(ext(s3tc,srgb)),'s3tc');
  for(const extensions of [ext(s3tc),ext(srgb),ext()]){
    assert.equal(nativeGroundVariant(extensions),null);
    await assert.rejects(loadPhotographicGround({capabilities:{maxTextureSize:4096},extensions}),/S3TC with sRGB support/);
  }
});

test('ground keeps the whole 2m photograph and native quarter-metre detail within its real transfer payload',()=>{
  let bytes=0;
  for(const [id,row]of Object.entries(manifest.textures)){
    const data=readFileSync(new URL(`../public/xianxia/surface/${row.file}`,import.meta.url));
    assert.equal(data.subarray(0,12).toString('hex'),'ab4b5458203230bb0d0a1a0a');
    assert.equal(data.readUInt32LE(20),row.width);assert.equal(data.readUInt32LE(24),row.height);
    assert.equal(data.readUInt32LE(40),Math.log2(row.width)+1);assert.equal(data.length,row.bytes);bytes+=data.length;
    assert.notEqual(data.readUInt32LE(12),0);assert.equal(data.readUInt32LE(44),0);
    assert.equal(row.physicalTileMeters,id.startsWith('ground')?(id.includes('Meso')?2:.25):(id.includes('Meso')?1.8:.225));
  }
  assert.equal(bytes,manifest.variants.etc2.textureFileBytes);assert.ok(bytes<30e6);
  assert.equal(manifest.textures.groundMesoColor.width,4096);
});

test('both GPU variants parse without Basis workers, WASM or dynamic code, preserving every mip and roughness alpha',()=>{
  for(const [variant,set]of Object.entries(manifest.variants))for(const [id,row]of Object.entries(set.textures)){
    const data=readFileSync(new URL(`../public/xianxia/surface/${row.file}`,import.meta.url));
    const texture=nativeGroundTexture(data,row);assert.equal(texture.mipmaps.length,Math.log2(row.width)+1);
    assert.equal(texture.image.width,row.width);assert.equal(texture.flipY,false);
    assert.equal(texture.format,variant==='etc2'?(id.endsWith('Color')?THREE.RGB_ETC2_Format:THREE.RGBA_ETC2_EAC_Format):(id.endsWith('Color')?THREE.RGB_S3TC_DXT1_Format:THREE.RGBA_S3TC_DXT5_Format));
  }
});

test('a capture without normal attributes gains finite unit normals without altering its triangles',()=>{
  const geometry=new THREE.BoxGeometry();geometry.deleteAttribute('normal');
  const original=geometry.attributes.position.array.slice(),indices=geometry.index.array.slice();
  ensureSurfaceNormals(geometry);
  assert.deepEqual(geometry.attributes.position.array,original);assert.deepEqual(geometry.index.array,indices);
  for(let i=0;i<geometry.attributes.normal.count;i++)assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,i).length()-1)<1e-6);
});

test('standard lighting receives photographic color, roughness and correctly view-transformed normals',()=>{
  const material=addPhotographicGround(new THREE.MeshStandardMaterial(),{manifest,textures});
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader,/Surface photoSurface/);assert.match(shader.fragmentShader,/mat3\(viewMatrix\)\*photoSurface.n/);
  assert.match(shader.fragmentShader,/roughnessFactor=mix/);assert.match(shader.fragmentShader,/textureGrad\(mc/);
  assert.equal(shader.uniforms.groundMesoColor.value,textures.groundMesoColor);
});

test('walking uses the visible terrain triangles, rejects walls, overhead rock and unsupported capture edges',()=>{
  const floor=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2);
  const wall=new THREE.BoxGeometry(.1,3,3).translate(2,1.5,0);
  const overhead=new THREE.PlaneGeometry(2,2).rotateX(-Math.PI/2).translate(-3,1.7,0);
  const index=createFloorIndex([floor,wall,overhead],2);
  assert.equal(index.geometries[0],floor);
  assert.equal(index.canMove(0,0,.2,0),true);
  assert.equal(index.canMove(1.4,0,1.7,0),false);
  assert.equal(index.canMove(-1.5,0,-2.2,0),false);
  assert.equal(index.canMove(9.4,0,9.8,0),false);
  const world=Object.assign(Object.create(XianxiaWorld.prototype),{floorIndex:index});
  assert.equal(world.canWalkGround(1.7,0,1.4,0),false);
});
