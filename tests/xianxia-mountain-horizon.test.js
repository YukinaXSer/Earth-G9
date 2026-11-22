import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import * as THREE from 'three';
import {mountainHorizonGeometry,loadMountainHorizon,MOUNTAIN_HORIZON_CAPTURE} from '../src/xianxia-mountain-horizon.js';
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

test('captured distant ring closes azimuth without enclosing the sky or stretching a photo pole',()=>{
  const g=mountainHorizonGeometry(),p=g.attributes.position,uv=g.attributes.uv,capture=MOUNTAIN_HORIZON_CAPTURE;
  assert.ok(g.index.count/3<=4200);assert.equal(capture.angle,2*Math.PI);
  for(let i=0;i<p.count;i++){
    const radius=Math.hypot(p.getX(i),p.getZ(i)),azimuth=Math.atan2(p.getZ(i),p.getX(i));
    const elevation=Math.atan2(p.getY(i),radius);
    assert.ok(Math.abs(radius-capture.radius)<.001);
    assert.ok(Math.abs(Math.cos(azimuth)-Math.cos((uv.getX(i)-.5)*capture.angle))<1e-6);
    assert.ok(Math.abs(Math.sin(azimuth)-Math.sin((uv.getX(i)-.5)*capture.angle))<1e-6);
    assert.ok(Math.abs(elevation-(capture.eye-1+uv.getY(i))*capture.angle*capture.height/capture.width)<1e-6);
  }
  const [a,b,c]=Array.from(g.index.array.slice(0,3)).map(id=>new THREE.Vector3().fromBufferAttribute(p,id));
  assert.ok(new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).dot(a)<0);
});

test('backdrop derivative has an alpha mask and a bounded download rather than reloading the old full photograph',()=>{
  const file=readFileSync(new URL('../public'+MOUNTAIN_HORIZON_CAPTURE.texture,import.meta.url));
  assert.equal(file.toString('ascii',0,4),'RIFF');assert.equal(file.toString('ascii',8,12),'WEBP');
  assert.equal(file.toString('ascii',12,16),'VP8X');assert.ok(file[20]&16);
  assert.equal(file.readUIntLE(24,3)+1,MOUNTAIN_HORIZON_CAPTURE.width);
  assert.equal(file.readUIntLE(27,3)+1,MOUNTAIN_HORIZON_CAPTURE.height);
  assert.ok(file.length<256000);
});

test('both panorama tiers have a sky-free top and bottom, closed seam and mountain silhouette in every azimuth',async()=>{
  for(const [path,width,height]of [[MOUNTAIN_HORIZON_CAPTURE.texture,3072,432],[MOUNTAIN_HORIZON_CAPTURE.lowTexture,2048,288]]){
    const file=readFileSync(new URL('../public'+path,import.meta.url));
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,width);assert.equal(info.height,height);assert.ok(file.length<256000);
    for(let x=0;x<width;x++){
      assert.equal(data[x*4+3],0);assert.equal(data[((height-1)*width+x)*4+3],0);
      let top=height;
      for(let y=0;y<height;y++)if(data[(y*width+x)*4+3]>127){top=y;break;}
      assert.ok(top<height*MOUNTAIN_HORIZON_CAPTURE.eye,`missing positive-elevation ridge at ${path} column ${x}`);
    }
    let seam=0;
    for(let y=0;y<height;y++){
      const left=y*width*4,right=(y*width+width-1)*4;
      for(let c=0;c<3;c++)seam+=Math.abs(data[left+c]*data[left+3]-data[right+c]*data[right+3])/255;
      seam+=Math.abs(data[left+3]-data[right+3]);
    }
    assert.ok(seam/(height*4)<4);
  }
});

test('the west photographic lower fade stays below the visible horizon in both tiers',async()=>{
  const capture=MOUNTAIN_HORIZON_CAPTURE,verticalAngle=capture.angle*capture.height/capture.width;
  for(const path of [capture.texture,capture.lowTexture]){
    const {data,info}=await sharp(readFileSync(new URL('../public'+path,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const x=Math.round(.9548466043*(info.width-1));
    for(const degrees of [0,.5,1,2.540353]){
      const y=Math.round((capture.eye-degrees*Math.PI/180/verticalAngle)*(info.height-1));
      assert.ok(data[(y*info.width+x)*4+3]>250,`photographic bottom fade leaks sky at ${path} elevation ${degrees}`);
    }
  }
});

test('the documented S184 roof and retained-sky artifact do not survive in either tier',async()=>{
  for(const [path,scale]of [[MOUNTAIN_HORIZON_CAPTURE.texture,1],[MOUNTAIN_HORIZON_CAPTURE.lowTexture,2/3]]){
    const {data,info}=await sharp(readFileSync(new URL('../public'+path,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x,y)=>data.subarray((Math.round(y*scale)*info.width+Math.round(x*scale))*4,(Math.round(y*scale)*info.width+Math.round(x*scale))*4+4);
    for(const [x,y]of [[2250,116],[2249,117]])assert.ok(pixel(x,y)[3]<8,'source sky around the conifer must not become an opaque tower');
    const roof=pixel(2194,241);assert.ok(roof[3]>127&&roof[1]>roof[2]*1.05,'the source hut sector must contain actual forest photography');
  }
});

test('the hazy neutral-coloured W273 ridge remains opaque instead of leaving isolated treetop blocks',async()=>{
  for(const [path,scale]of [[MOUNTAIN_HORIZON_CAPTURE.texture,1],[MOUNTAIN_HORIZON_CAPTURE.lowTexture,2/3]]){
    const {data,info}=await sharp(readFileSync(new URL('../public'+path,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(const [x,y]of [[2970,210],[3000,230]]){
      const alpha=data[(Math.round(y*scale)*info.width+Math.round(x*scale))*4+3];
      assert.ok(alpha>248,`photographed grey ridge was mistaken for sky at ${path} ${x},${y}`);
    }
  }
});

test('the east cliff skyline has no extra forest shelf across its native sky notches',async()=>{
  for(const [path,scale]of [[MOUNTAIN_HORIZON_CAPTURE.texture,1],[MOUNTAIN_HORIZON_CAPTURE.lowTexture,2/3]]){
    const {data,info}=await sharp(readFileSync(new URL('../public'+path,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(const [x,y]of [[1210,200],[1510,200]]){
      const alpha=data[(Math.round(y*scale)*info.width+Math.round(x*scale))*4+3];
      assert.ok(alpha<16,`extra photographed ridge crosses the east cliff sky notch at ${path} ${x},${y}`);
    }
  }
});

test('Low requests only its smaller ring while keeping the same host transforms and material pipeline',async t=>{
  const requests=[];
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{requests.push(url);return new THREE.Texture();});
  const mountain=new XianxiaMountain({quality:'low'}),mesh=await loadMountainHorizon(mountain);
  assert.deepEqual(requests,[MOUNTAIN_HORIZON_CAPTURE.lowTexture]);
  assert.equal(mesh.material.map.wrapS,THREE.RepeatWrapping);
  assert.equal(mesh.material.map.colorSpace,THREE.SRGBColorSpace);assert.equal(mesh.material.toneMapped,true);
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
  assert.deepEqual(requests,[MOUNTAIN_HORIZON_CAPTURE.texture]);
  assert.equal(mesh.parent,mountain.group);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.toneMapped,true);
  assert.equal(mesh.material.transparent,true);assert.equal(mesh.material.side,THREE.FrontSide);assert.equal(mesh.material.alphaTest,.001);
  assert.equal(mesh.material.map.colorSpace,THREE.SRGBColorSpace);assert.equal(mesh.frustumCulled,false);
  assert.ok(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(camera.getWorldPosition(new THREE.Vector3()))<1e-6);
  assert.equal(host.background,background);assert.equal(host.environment,environment);assert.equal(host.fog,fog);
  assert.deepEqual(camera.projectionMatrix,projection);assert.equal(camera.far,220);
  assert.equal(mountain.world.floorIndex,undefined);
  const shader={vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
  mesh.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/gl_Position.z=gl_Position.w/);
  assert.match(shader.vertexShader,/vFogDepth=length\(mvPosition.xyz\)\*\.1/);
  assert.equal(shader.fragmentShader,THREE.ShaderLib.basic.fragmentShader);
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
