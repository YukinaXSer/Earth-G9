import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {XianxiaMountain,MOUNTAIN_ENTRANCE,MOUNTAIN_LIGHTING} from '../src/xianxia-mountain.js';
import {captureGeometry,gradeCaptureApproach} from '../src/xianxia-near.js';
import {createFloorIndex} from '../src/xianxia-world.js';

function capture(){
  const b=readFileSync(new URL('../public/xianxia/surface/capture.bin',import.meta.url));
  return captureGeometry(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
}

test('mountain queries the visible triangles in the host frame, including parent translation and yaw',()=>{
  const mountain=new XianxiaMountain(),geometry=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2).translate(0,2,0);
  mountain.world.floorIndex=createFloorIndex([geometry],2);
  mountain.group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));
  const host=new THREE.Group();host.position.set(1000,20,-500);host.rotation.y=.3;
  mountain.group.position.set(10,7,-20);mountain.group.rotation.y=.7;host.add(mountain.group);host.updateMatrixWorld(true);
  const p=new THREE.Vector3(1,2,2).applyMatrix4(mountain.group.matrixWorld);
  const q=new THREE.Vector3(1.1,2,2).applyMatrix4(mountain.group.matrixWorld);
  assert.ok(Math.abs(mountain.groundHeight(p.x,p.z)-p.y)<1e-6);
  assert.ok(mountain.canMove(p.x,p.z,q.x,q.z));
  assert.equal(mountain.groundHeight(1e6,1e6),null);
  assert.equal(mountain.canMove(p.x,p.z,1e6,1e6),false);
});

test('eight-metre forecourt is graded in the visible scan, not a second support plane',()=>{
  const mountain=new XianxiaMountain(),geometry=capture(),indices=geometry.index;
  assert.equal(gradeCaptureApproach(geometry),geometry);assert.equal(geometry.index,indices);
  mountain.world.floorIndex=createFloorIndex([geometry],2);
  const {position,approach,forward}=MOUNTAIN_ENTRANCE;
  assert.ok(Math.abs(mountain.groundHeight(position.x,position.z)-position.y)<1e-6);
  assert.deepEqual(forward,{x:1,y:0,z:0});assert.equal(approach.flat,true);
  for(let dx=0;dx<=approach.length;dx+=.25)for(const dz of [-.6,-.3,0,.3,.6]){
    const x=position.x+dx,z=position.z+dz;
    assert.ok(Math.abs(mountain.groundHeight(x,z)-(position.y+dx*approach.grade))<1e-5);
    assert.ok(mountain.canMove(x,z,x+.04,z),`support at ${x}, ${z}`);
  }
  assert.ok(Math.abs(mountain.groundHeight(approach.endX,approach.endZ)-position.y)<.45);
});

test('mountain load is idempotent, scene-neutral and does not request a panorama or cave',async t=>{
  const requested=[];
  t.mock.method(globalThis,'fetch',async url=>{
    requested.push(url);
    return new Response(readFileSync(new URL(`../public${url}`,import.meta.url)));
  });
  t.mock.method(GLTFLoader.prototype,'loadAsync',async()=>{
    const scene=new THREE.Group();
    for(let i=0;i<3;i++){
      const geometry=new THREE.BoxGeometry(.1,.1,.1);
      if(i===1){
        const data=new THREE.InterleavedBuffer(geometry.attributes.position.array.slice(),3);
        geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(data,3,0));
      }
      scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));
    }
    return {scene};
  });
  const renderer={capabilities:{maxTextureSize:4096,getMaxAnisotropy:()=>8},extensions:{has:name=>name==='WEBGL_compressed_texture_etc'},toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:.96,outputColorSpace:THREE.SRGBColorSpace};
  const original={...renderer},host=new THREE.Scene(),sun=new THREE.DirectionalLight();host.add(sun);
  host.background=new THREE.Color('#8ca18c');host.environment=new THREE.Texture();host.fog=new THREE.FogExp2('#8ca18c',.0045);
  const background=host.background,environment=host.environment,fog=host.fog;
  const mountain=new XianxiaMountain({renderer});host.add(mountain.group);mountain.group.position.set(500,10,-500);mountain.group.rotation.y=.8;
  const first=mountain.load();assert.equal(mountain.load(),first);assert.equal(await first,mountain);
  assert.equal(mountain.group.parent,host);assert.equal(host.children.length,2);
  assert.equal(host.background,background);assert.equal(host.environment,environment);assert.equal(host.fog,fog);
  assert.deepEqual(renderer,original);assert.equal(mountain.world.horizon,undefined);
  assert.ok(requested.every(url=>url.startsWith('/xianxia/surface/')));
  assert.equal(requested.filter(url=>url.endsWith('-near.bin')).length,2);
  assert.equal(requested.filter(url=>url.endsWith('-far.bin')).length,4);
  assert.equal(mountain.groundHeight(1e6,1e6),null);
  const mesh=mountain.world.ground;host.updateMatrixWorld(true);mesh.onBeforeRender();
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  mesh.material.onBeforeCompile(shader);
  assert.deepEqual(shader.uniforms.captureReflectance.value.toArray(),[.35,.38]);
  assert.equal(shader.uniforms.captureUseGroundCover.value,true);
  assert.equal(mesh.geometry.attributes.groundCover.normalized,true);
  const ferns=[];mountain.group.traverse(object=>{if(object.name==='grounded-mountain-ferns')ferns.push(object);});
  assert.ok(ferns.length>0&&ferns.length<=12);assert.ok(ferns.every(mesh=>mesh.isInstancedMesh));
  const inverse=shader.uniforms.captureWorldToLocal.value;
  const point=new THREE.Vector3(104,1,-115.2),worldPoint=point.clone().applyMatrix4(mesh.matrixWorld);
  assert.ok(worldPoint.applyMatrix4(inverse).distanceTo(point)<1e-6);
  assert.match(shader.vertexShader,/captureWorldToLocal\*photoModelMatrix/);
  assert.match(shader.vertexShader,/photoModelMatrix\*=batchingMatrix/);
  assert.match(shader.vertexShader,/photoModelMatrix\*=instanceMatrix/);
  assert.match(shader.fragmentShader,/captureNormalToWorld\*photoSurface.n/);
  const batches=[];mountain.group.traverse(object=>{if(object.isBatchedMesh)batches.push(object);});
  assert.equal(batches.length,16);
  for(const batch of batches){
    const matrix=new THREE.Matrix4();batch.getMatrixAt(0,matrix);
    assert.equal(matrix.determinant(),1);
    assert.ok(batch.perObjectFrustumCulled);
  }
  assert.notEqual(mountain.world.floorIndex.heightAt(151.147,-85),null);
  const count=requested.length;
  assert.equal(mountain.world.floorIndex.heightAt(798,-110.9),null);
  await mountain.world.updateMountain(798);
  assert.equal(requested.filter(url=>url.endsWith('-near.bin')).length,4);
  assert.ok(mountain.world.floorIndex.canMove(798,-110.9,798.05,-110.9));
  const restoredCount=requested.length;
  await mountain.world.updateMountain(100.5);
  assert.equal(requested.length,restoredCount);
  assert.ok(count<restoredCount);
  await mountain.world.updateMountain(135);
  assert.equal(requested.filter(url=>url.endsWith('-near.bin')).length,4);
  await assert.rejects(mountain.world.updateMountain(1e100),/Invalid mountain position/);
  await assert.rejects(mountain.world.updateMountain(100.5,1e100),/Invalid mountain position/);
  await mountain.world.updateMountain(798,4000);
  assert.notEqual(mountain.world.floorIndex.heightAt(798,4000),null);
  assert.equal(mountain.world.floorIndex.heightAt(798,-110.9),null);
  await mountain.world.updateMountain(798);
  const resident=mountain.world.floorIndex.tiles.size;
  await mountain.world.updateMountain(4000);
  assert.ok(mountain.world.floorIndex.tiles.size<=resident);
  assert.equal(mountain.world.floorIndex.heightAt(100.5,-115.1),null);
  assert.ok(mountain.world.floorIndex.heightAt(4000,-115.1)!=null);
  assert.equal(requested.filter(url=>url.endsWith('-near.bin')).length,4);
});

test('lighting export follows the live rainforest HDR/ACES contract',()=>{
  assert.equal(MOUNTAIN_LIGHTING.outputColorSpace,THREE.SRGBColorSpace);
  assert.equal(MOUNTAIN_LIGHTING.toneMapping,THREE.ACESFilmicToneMapping);
  assert.equal(MOUNTAIN_LIGHTING.exposure,.96);
  assert.equal(MOUNTAIN_LIGHTING.environment.url,'/textures/rainforest-light.hdr');
  assert.deepEqual(MOUNTAIN_LIGHTING.sun.offset,[-24,30,12]);
});
