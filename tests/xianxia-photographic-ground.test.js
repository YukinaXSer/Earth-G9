import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createFloorIndex,XianxiaWorld} from '../src/xianxia-world.js';
import {addPhotographicGround,ensureSurfaceNormals,nativeGroundTexture,nativeGroundVariant,loadPhotographicGround} from '../src/xianxia-surface.js';
import {photographicSurfaceGLSL} from '../src/xianxia-surface-glsl.js';

const manifest=JSON.parse(readFileSync(new URL('../public/xianxia/surface/manifest.json',import.meta.url)));
const highManifest=JSON.parse(readFileSync(new URL('../public/xianxia/surface/manifest-high.json',import.meta.url)));
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

for(const [quality,source]of [['low',manifest],['high',highManifest]])test(quality+' ground keeps full photographs and native detail crops within their transfer payload',()=>{
  const manifest=source;
  let bytes=0;
  for(const [id,row]of Object.entries(manifest.textures)){
    const data=readFileSync(new URL(`../public/xianxia/surface/${row.file}`,import.meta.url));
    assert.equal(data.subarray(0,12).toString('hex'),'ab4b5458203230bb0d0a1a0a');
    assert.equal(data.readUInt32LE(20),row.width);assert.equal(data.readUInt32LE(24),row.height);
    assert.equal(data.readUInt32LE(40),Math.log2(row.width)+1);assert.equal(data.length,row.bytes);bytes+=data.length;
    assert.notEqual(data.readUInt32LE(12),0);assert.equal(data.readUInt32LE(44),0);
    const meters=id.startsWith('ground')?(id.includes('Meso')&&quality==='high'?3.0009725093841553:2.1399996280670166):1.8;
    assert.ok(Math.abs(row.physicalTileMeters-meters/(id.includes('Meso')?1:8))<1e-8);
  }
  assert.equal(bytes,manifest.variants.etc2.textureFileBytes);assert.ok(bytes<30e6);
  assert.equal(manifest.textures.groundMesoColor.width,2048);
  for(const key of ['groundMesoColor','groundMesoNormal']){
    assert.equal(manifest.textures[key].source,quality==='high'?'forest_leaves_02':'forest_floor');
    assert.equal(manifest.textures[key].physicalTileMeters,manifest.textures[key].sourcePhysicalMeters);
  }
});

test('High selects its moss capture without changing Low assets or either upload allocation',async t=>{
  const urls=[],renderer={capabilities:{maxTextureSize:4096,getMaxAnisotropy:()=>8},extensions:{has:name=>name==='WEBGL_compressed_texture_etc'}};
  t.mock.method(globalThis,'fetch',async url=>{
    urls.push(url);
    if(url.endsWith('manifest.json')||url.endsWith('manifest-high.json'))return {ok:true,json:async()=>url.endsWith('manifest-high.json')?highManifest:manifest};
    const bytes=readFileSync(new URL('../public'+url,import.meta.url));
    return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  });
  const low=await loadPhotographicGround(renderer);
  assert.equal(urls[0],'/xianxia/surface/manifest.json');assert.ok(!urls.some(url=>url.includes('forest-leaves-02')));
  urls.length=0;
  const high=await loadPhotographicGround(renderer,{quality:'high'});
  assert.equal(urls[0],'/xianxia/surface/manifest-high.json');assert.ok(urls.some(url=>url.includes('forest-leaves-02')));
  for(const [id,row]of Object.entries(low.manifest.textures)){
    const other=high.manifest.textures[id];
    assert.deepEqual([row.width,row.height,row.bytes],[other.width,other.height,other.bytes]);
    if(!id.startsWith('groundMeso'))assert.deepEqual(row,other);
  }
});

test('both GPU variants parse without Basis workers, WASM or dynamic code, preserving every mip and roughness alpha',()=>{
  for(const source of [manifest,highManifest])for(const [variant,set]of Object.entries(source.variants))for(const [id,row]of Object.entries(set.textures)){
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

test('the taller pine uses three-dimensional wood and needle geometry, not whole-tree cards',()=>{
  const data=readFileSync(new URL('../public/xianxia/surface/pine-medium.glb',import.meta.url));
  const source=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  assert.ok(source.materials.some(m=>m.name.includes('bark')));
  assert.ok(source.materials.some(m=>m.name.includes('twig')));
  const foliage=source.meshes.flatMap(mesh=>mesh.primitives).filter(p=>source.materials[p.material].name.includes('twig'));
  assert.ok(foliage.reduce((count,p)=>count+source.accessors[p.indices].count/3,0)>200000);
  assert.ok(source.materials.every(m=>!m.alphaMode||m.alphaMode==='OPAQUE'));
  assert.ok(data.byteLength<10000000);
  for(const mesh of source.meshes)for(const primitive of mesh.primitives){
    const p=source.accessors[primitive.attributes.POSITION];
    assert.ok(p.max.every((value,i)=>value>p.min[i]));
  }
  assert.ok(!source.extensionsUsed.includes('EXT_meshopt_compression'));
});

test('standard lighting receives photographic color, roughness and correctly view-transformed normals',()=>{
  const material=addPhotographicGround(new THREE.MeshStandardMaterial(),{manifest,textures});
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader,/Surface photoSurface/);assert.match(shader.fragmentShader,/mat3\(viewMatrix\)\*photoSurface.n/);
  assert.match(shader.fragmentShader,/roughnessFactor=mix/);assert.match(shader.fragmentShader,/textureGrad\(mc/);
  assert.match(shader.fragmentShader,/detailFade=1.-smoothstep\(\.0125,\.04,max\(length\(px\),length\(py\)\)\)/);
  assert.match(shader.fragmentShader,/if\(detailFade>\.001\)/);
  assert.equal(shader.uniforms.groundMesoColor.value,textures.groundMesoColor);
  assert.deepEqual(shader.uniforms.mesoMeters.value.toArray(),[manifest.textures.groundMesoColor.physicalTileMeters,1.8]);
});

test('ground scatters the full photograph with matching rotated normals instead of a fixed leaf grid',()=>{
  assert.match(photographicSurfaceGLSL,/if\(isGround\)medium=photoPatch\(mc,mn,uv\*mediumScale,meanColor,dx\*mediumScale,dy\*mediumScale,true,true\)/);
  assert.match(photographicSurfaceGLSL,/mediumMeters>0\.\?\(isGround\?microMeters\.x:microMeters\.y\)\/mediumMeters:\.125/);
  assert.match(photographicSurfaceGLSL,/if\(!meso\)\{/);
  assert.match(photographicSurfaceGLSL,/v\.xy=transpose\(R\)\*v\.xy/);
  assert.match(photographicSurfaceGLSL,/detail=photoPatch\(c,n,uv,meanColor,dx,dy,!isGround,false\)/);
  assert.match(photographicSurfaceGLSL,/macroColor\+=medium\.c\*w\[axis\]/);
  assert.match(photographicSurfaceGLSL,/o\.r\+=medium\.r\*w\[axis\]/);
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
