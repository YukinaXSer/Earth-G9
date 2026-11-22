import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mountainHorizonGeometry,loadMountainHorizon,MOUNTAIN_HORIZON_VIEW} from '../src/xianxia-mountain-horizon.js';
import {TERRAIN_SOURCE,surveyedElevation} from '../src/xianxia-terrain.js';
import {XianxiaMountain} from '../src/xianxia-mountain.js';
import {XianxiaWorld} from '../src/xianxia-world.js';

test('standalone near-only loading starts the same optional backdrop after near readiness without awaiting it',()=>{
  const world=new XianxiaWorld(new THREE.Scene(),{nearOnly:true});
  assert.equal(world.renderHorizon,true);
  const branch=XianxiaWorld.prototype.load.toString().split('this.photographicGround=')[0];
  assert.match(branch,/await loadMountainField\(this\)/);
  assert.match(branch,/if\(this\.renderHorizon\)this\.loadHorizon\(\)/);
  assert.doesNotMatch(branch,/await this\.loadHorizon/);
  assert.ok(branch.indexOf('await loadMountainField')<branch.indexOf('this.loadHorizon()'));
});

test('standalone backdrop loads once and records background failure without changing near support',async t=>{
  let requests=0;
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async()=>{requests++;return new THREE.Texture();});
  const world=new XianxiaWorld(new THREE.Scene(),{nearOnly:true}),support={heightAt:()=>2};world.floorIndex=support;
  const pending=world.loadHorizon();assert.equal(world.loadHorizon(),pending);
  const mesh=await pending;
  assert.equal(world.horizon,mesh);assert.equal(mesh.parent,world.root);
  assert.equal(world.floorIndex,support);assert.equal(requests,1);
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async()=>{throw new Error('background download unavailable');});
  const failure=new XianxiaWorld(new THREE.Scene(),{nearOnly:true});failure.floorIndex=support;
  await assert.rejects(failure.loadHorizon(),/background download unavailable/);
  assert.match(failure.horizonError.message,/background download unavailable/);assert.equal(failure.floorIndex,support);
});

test('distant backdrop retains measured elevation and photographic coordinates from a physically distant viewpoint',()=>{
  const g=mountainHorizonGeometry(),data=TERRAIN_SOURCE,p=g.attributes.position,angle=g.userData.yaw,view=MOUNTAIN_HORIZON_VIEW;
  assert.equal(p.count,data.width*data.height);assert.ok(g.index.count<110000);
  for(let j=0;j<data.height;j+=7)for(let i=0;i<data.width;i+=9){
    const id=j*data.width+i,x=data.x0+i*data.step,z=data.z0+j*data.step;
    assert.ok(Math.abs(p.getY(id)-(data.heights[id]-surveyedElevation(view.x,view.z)-1.85))<.001);
    assert.ok(Math.abs(p.getX(id)-(Math.cos(angle)*(x-view.x)+Math.sin(angle)*(z-view.z)))<.001);
    assert.ok(Math.abs(g.attributes.uv.getX(id)-(x-data.satellite.x0)/data.satellite.size)<1e-6);
  }
  for(let i=0;i<data.width;i++)assert.equal(g.attributes.horizonFade.getX(i),0);
  let peak=-Infinity,visible=0;
  for(let i=0;i<p.count;i++)if(g.attributes.horizonFade.getX(i)>.001){
    const r=Math.hypot(p.getX(i),p.getZ(i));assert.ok(r>view.near-.001);
    peak=Math.max(peak,Math.atan2(p.getY(i),r));visible++;
  }
  assert.ok(visible>1000&&peak>5*Math.PI/180&&peak<15*Math.PI/180);
});

test('deferred distant mesh leaves host sky, fog, camera and lighting untouched under parent translation/yaw',async t=>{
  const requests=[];
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{requests.push(url);return new THREE.Texture();});
  const mountain=new XianxiaMountain(),host=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1.7,.1,220);
  const renderer={toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:.96,outputColorSpace:THREE.SRGBColorSpace};
  host.background=new THREE.Color('#8ca18c');host.environment=new THREE.Texture();host.fog=new THREE.FogExp2('#8ca18c',.0045);
  const background=host.background,environment=host.environment,fog=host.fog,projection=camera.projectionMatrix.clone();
  host.add(mountain.group);mountain.group.position.set(200.415,-.385,-428.606);mountain.group.rotation.y=2.8613;
  host.add(camera);camera.position.set(80,2,-400);
  const mesh=await loadMountainHorizon(mountain);host.updateMatrixWorld(true);mesh.onBeforeRender(renderer,host,camera);
  assert.deepEqual(requests,['/xianxia/textures/huangshan-satellite.webp']);
  assert.equal(mesh.parent,mountain.group);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.toneMapped,true);
  assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.side,THREE.FrontSide);
  assert.equal(mesh.material.map.colorSpace,THREE.SRGBColorSpace);assert.equal(mesh.frustumCulled,false);
  assert.ok(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(camera.getWorldPosition(new THREE.Vector3()))<1e-6);
  assert.equal(host.background,background);assert.equal(host.environment,environment);assert.equal(host.fog,fog);
  assert.deepEqual(camera.projectionMatrix,projection);assert.equal(camera.far,220);
  assert.equal(mountain.world.floorIndex,undefined);
  const shader={vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
  mesh.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/gl_Position.z=gl_Position.w/);
  assert.match(shader.fragmentShader,/mix\(fogColor,gl_FragColor.rgb,distantFade\)/);
  assert.doesNotMatch(shader.fragmentShader,/diffuseColor.a\*=distantFade/);
});

test('near readiness does not await or fail with the optional horizon',async()=>{
  const mountain=new XianxiaMountain({renderHorizon:true});
  let resolveNear,resolveHorizon,started=false;
  mountain.world.load=()=>new Promise(resolve=>{resolveNear=resolve;});
  mountain.loadHorizon=()=>{started=true;return new Promise(resolve=>{resolveHorizon=resolve;});};
  const near=mountain.load();assert.equal(started,false);
  resolveNear();assert.equal(await near,mountain);assert.equal(started,true);
  resolveHorizon();
  const failure=new XianxiaMountain();failure.world.load=async()=>{};
  failure.loading=Promise.reject(new Error('near load failed'));
  await assert.rejects(failure.loadHorizon(),/near load failed/);assert.match(failure.horizonError.message,/near load failed/);
});
