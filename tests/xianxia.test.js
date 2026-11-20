import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CAVE,CAVE_LENGTH,TRAIL,BRANCH,LOCATIONS,sampleRoute,sampleMountain,canWalkMountain,caveAmount,routeLength,nearestLocation } from '../src/xianxia-route.js';
import { XianxiaLink } from '../src/xianxia-link.js';
import { XianxiaWorld,addCapturedRockDetail } from '../src/xianxia-world.js';
import caveCaptures from '../src/xianxia-cave-captures.json' with {type:'json'};

test('the entire main trail, cave and branch are continuously walkable in either direction',()=>{
  for(const route of [TRAIL,CAVE,BRANCH])for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],length=Math.hypot(b[0]-a[0],b[2]-a[2]);
    for(let d=0;d<=length;d+=.35){const t=d/length,x=a[0]+(b[0]-a[0])*t,z=a[2]+(b[2]-a[2])*t;assert.ok(canWalkMountain(x,z),`blocked at ${x},${z}`);assert.ok(Number.isFinite(sampleMountain(x,z).height));}
  }
  assert.ok(routeLength(TRAIL)>2400);assert.ok(routeLength(CAVE)>40);
});
test('route sampling clamps endpoints and keeps falls and remote void out of walking bounds',()=>{
  assert.equal(sampleRoute([[0,0,0,4],[0,8,-10,4]],0,5).height,0);
  assert.equal(sampleRoute([[0,0,0,4],[0,8,-10,4]],0,-20).height,8);
  assert.equal(canWalkMountain(-100,-300),false);assert.equal(canWalkMountain(900,-500),false);
  assert.ok(canWalkMountain(BRANCH[2][0],BRANCH[2][2]));
});
test('the cave entrance, bend and exit share continuous route heights and darkness',()=>{
  assert.equal(sampleRoute(CAVE,0,CAVE_LENGTH).height,0);assert.equal(sampleRoute(CAVE,0,0).height,7);
  assert.equal(caveAmount(0,CAVE_LENGTH),0);assert.equal(caveAmount(0,0),0);
  assert.equal(caveAmount(10,CAVE_LENGTH/2),1);assert.equal(caveAmount(100,CAVE_LENGTH/2),0);
  for(let z=0;z<CAVE_LENGTH;z+=.25){const p=sampleRoute(CAVE,0,z);assert.ok(Math.abs(caveAmount(p.x,z+.01)-caveAmount(p.x,z))<.003);}
});
test('all six unique discoveries are on reachable routes; distant points do not trigger a location',()=>{
  assert.equal(new Set(LOCATIONS.map(p=>p.id)).size,6);
  for(const p of LOCATIONS){assert.ok(canWalkMountain(p.point[0],p.point[2]));assert.equal(nearestLocation(p.point[0],p.point[2]).id,p.id);}
  assert.equal(nearestLocation(-1000,0),null);
});
function makeLink(anchor={x:72,y:.20866,z:-230}){
  const link=Object.create(XianxiaLink.prototype);link.anchor=anchor;link.offset=new THREE.Vector3(anchor.x,anchor.y,anchor.z-CAVE_LENGTH);
  link.world={groundHeight:(x,z)=>sampleMountain(x,z).height};return link;
}
test('a configurable cave anchor maps both ends without changing player coordinates',()=>{
  for(const anchor of [{x:72,y:.20866,z:-230},{x:-30,y:12,z:200}]){
    const link=makeLink(anchor),local=link.local(anchor.x,anchor.z);assert.equal(local.x,0);assert.ok(Math.abs(local.z-CAVE_LENGTH)<1e-10);assert.ok(Math.abs(link.groundHeight(anchor.x,anchor.z)-anchor.y)<1e-10);
    assert.equal(link.groundHeight(anchor.x,anchor.z-CAVE_LENGTH),anchor.y+7);
    for(const p of CAVE){assert.equal(link.owns(p[0]+link.offset.x,p[2]+link.offset.z),true);assert.ok(link.canWalk(p[0]+link.offset.x,p[2]+link.offset.z));}
  }
});
test('link leaves the rainforest north strip alone outside its own cave corridor',()=>{
  const link=makeLink();assert.equal(link.owns(-100,-265),false);assert.equal(link.owns(72,-265),true);assert.equal(link.owns(72,-224),true);assert.equal(link.owns(72,-215),false);
});
test('ownership and walking bounds overlap continuously from the forest approach into the cave',()=>{
  const link=makeLink();
  for(let z=link.anchor.z+16;z>link.anchor.z-20;z-=.05){
    const centre=link.anchor.x+sampleRoute(CAVE,0,z-link.offset.z).x;
    for(const dx of [-.5,0,.5])if(link.owns(centre+dx,z))assert.ok(link.canWalk(centre+dx,z),`blocked ownership band at ${dx},${z}`);
  }
});
test('approach preparation clears blocking instances, LOD replacements and collision together, only near the cave',()=>{
  const link=makeLink(),geometry=new THREE.BoxGeometry(1,6,1),mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),2);
  const near=new THREE.Matrix4().makeTranslation(link.anchor.x,0,link.anchor.z+4),far=new THREE.Matrix4().makeTranslation(-30,0,40);
  mesh.setMatrixAt(0,near);mesh.setMatrixAt(1,far);
  const nearTree={x:link.anchor.x,z:link.anchor.z+4,group:new THREE.Group(),parts:[{matrix:near,batch:{mesh},index:0}]};
  const farTree={x:-30,z:40,parts:[]},nearCollider={x:nearTree.x,z:nearTree.z,radius:2},farCollider={x:-30,z:40,radius:2};
  link.forest={habitat:{cells:[mesh],lodTrees:[nearTree,farTree]},colliders:[nearCollider,farCollider]};link.prepareApproach();
  const hidden=new THREE.Matrix4(),kept=new THREE.Matrix4();mesh.getMatrixAt(0,hidden);mesh.getMatrixAt(1,kept);
  assert.equal(hidden.determinant(),0);assert.deepEqual(kept,far);assert.equal(nearTree.group.visible,false);assert.deepEqual(link.forest.habitat.lodTrees,[farTree]);
  assert.deepEqual(link.forest.colliders,[farCollider]);assert.equal(link.forest.colliderIndex.query(nearTree.x,nearTree.z).includes(nearCollider),false);
  assert.ok(link.inApproach(link.anchor.x,link.anchor.z+16));assert.equal(link.inApproach(-100,-265),false);
});
test('native forest ground is lowered only under the cave, without changing its source geometry',()=>{
  const link=makeLink(),source=new THREE.BufferGeometry(),inside=[link.anchor.x,4,link.anchor.z-10],outside=[-30,4,40];
  source.setAttribute('position',new THREE.Float32BufferAttribute([...inside,...outside,...outside],3));
  link.forest={colliders:[],ground:new THREE.Mesh(source,new THREE.MeshBasicMaterial())};link.prepareApproach();
  assert.equal(source.attributes.position.getY(0),4);assert.ok(link.forest.ground.geometry.attributes.position.getY(0)<link.groundHeight(inside[0],inside[2]));assert.equal(link.forest.ground.geometry.attributes.position.getY(1),4);
});
test('resume runs before canvas dragging and does not reset input while already playing',()=>{
  const main=readFileSync(new URL('../src/xianxia-main.js',import.meta.url),'utf8');
  assert.ok(main.includes("if(started&&world?.paused&&!currentDialog&&!meditating)pause(false);},{capture:true})"));
});
test('source capture sampling uses triangle interpolation before the render surface is ready',()=>{
  const world=Object.create(XianxiaWorld.prototype);world.vertexHeight=(x,z)=>x*z;
  assert.equal(world.groundHeight(.5,.5),0);assert.equal(world.groundHeight(1.5,1.5),2);
  for(const route of [CAVE,TRAIL,BRANCH])for(const [x,,z]of route)assert.ok(Number.isFinite(XianxiaWorld.prototype.sourceHeight.call(Object.assign(Object.create(XianxiaWorld.prototype),{vertexHeight:(x,z)=>sampleMountain(x,z).height}),x,z)));
});
test('scene selection occurs inside the dark bend and never mutates the shared player',()=>{
  const link=makeLink(),forestScene=new THREE.Scene();forestScene.background=new THREE.Color('#adbbaa');forestScene.fog=new THREE.FogExp2('#aabbcc',.0045);forestScene.environmentIntensity=.85;
  const camera=new THREE.PerspectiveCamera();link.forest={scene:forestScene,camera};link.forestLights=[];link.scene=new THREE.Scene();link.scene.background=new THREE.Color();link.scene.fog=new THREE.FogExp2();link.skyLight=new THREE.HemisphereLight();link.sun=new THREE.DirectionalLight();link.world.update=()=>{};link.world.horizon={visible:true};
  for(const localZ of [CAVE_LENGTH,CAVE_LENGTH*.7,CAVE_LENGTH*.54,CAVE_LENGTH*.52,10,0,10,CAVE_LENGTH*.52,CAVE_LENGTH*.54,CAVE_LENGTH*.7,CAVE_LENGTH]){const p=new THREE.Vector3(link.offset.x+sampleRoute(CAVE,0,localZ).x,99,link.offset.z+localZ),before=p.clone();const rendered=link.update(p,1);assert.deepEqual(p,before);assert.equal(rendered,localZ<CAVE_LENGTH*.53?link.scene:forestScene);assert.equal(camera.far,localZ<CAVE_LENGTH*.53?2800:220);}
  assert.equal(link.forestState,null);assert.equal(forestScene.environmentIntensity,.85);
});
test('both asset quality levels embed their geometry and textures locally, within transfer budgets',()=>{
  let total=0;
  for(const level of ['', '-low'])for(const name of ['rock_face_01']){
    const data=readFileSync(new URL(`../public/xianxia/models/${name}${level}.glb`,import.meta.url));total+=data.length;
    assert.equal(data.toString('ascii',0,4),'glTF');const json=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
    assert.ok(json.meshes.length>0);assert.ok(json.images.every(i=>i.bufferView!==undefined));assert.ok(json.buffers.every(b=>!b.uri));
  }
  assert.ok(total<12*1024*1024);
});
test('pine impostors retain complete detailed foliage, transparency and source dimensions',()=>{
  const dimensions=JSON.parse(readFileSync(new URL('../public/xianxia/tree-dimensions.json',import.meta.url)));
  for(let i=0;i<3;i++){const data=readFileSync(new URL(`../public/xianxia/textures/pine-${i}.png`,import.meta.url));assert.equal(data.toString('ascii',1,4),'PNG');assert.equal(data[25],6);assert.equal(data.readUInt32BE(16),1536);assert.ok(dimensions[i].height>7);assert.ok(dimensions[i].height<15);}
});
test('help is available from the header as well as the desktop-only footer',()=>{
  const source=readFileSync(new URL('../src/xianxia-main.js',import.meta.url),'utf8');
  const header=source.match(/<header[\s\S]*?<\/header>/)[0];
  assert.match(header,/<button id="help-top"[^>]*aria-label="操作说明"[^>]*>\$\{icon\('help'\)\}/);
  assert.match(source,/\$\('#help-top'\)\.onclick=\$\('#help-button'\)\.onclick/);
});
function capturedScanMeshes(name){
  const bytes=readFileSync(new URL('../public/xianxia/models/'+name+'.glb',import.meta.url)),length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+length)),bin=28+length,group=new THREE.Group();
  const attribute=(id,count)=>{
    const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],size={5126:4,5125:4,5123:2,5121:1}[a.componentType],read={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[a.componentType],values=[];
    for(let i=0;i<a.count;i++)for(let j=0;j<count;j++)values.push(bytes[read](bin+(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??size*count)+j*size));
    return values;
  };
  for(const m of gltf.meshes)for(const p of m.primitives){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(attribute(p.attributes.POSITION,3),3));if(p.indices!==undefined)g.setIndex(attribute(p.indices,1));
    group.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  }
  group.updateMatrixWorld(true);return group;
}
test('the joined captured scans, not a generated tunnel, supply roof and walls along the measured floor',()=>{
  const world=new XianxiaWorld(new THREE.Scene());world.models={'cave-scan':capturedScanMeshes('cave-scan')};world.makeCave();
  const body=world.cave;let vertices=0;body.traverse(o=>{if(o.isMesh){
    vertices+=o.geometry.attributes.position.count;
    assert.equal(o.geometry.attributes.normal.count,o.geometry.attributes.position.count,'position-only captured meshes need normals for triplanar detail');
    for(const material of Array.isArray(o.material)?o.material:[o.material])assert.equal(material.flatShading,false);
  }});assert.ok(vertices>10000);
  for(let z=caveCaptures.enclosedRange[0]+1;z<=caveCaptures.enclosedRange[1]-1;z+=1){
    const p=sampleRoute(CAVE,0,z),eye=new THREE.Vector3(p.x,p.height+1.85,z);
    for(const direction of [new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0)])assert.ok(new THREE.Raycaster(eye,direction,0,100).intersectObject(body,true).length,'uncaptured boundary at '+z+' '+direction.toArray());
  }
  const source=readFileSync(new URL('../src/xianxia-world.js',import.meta.url),'utf8');assert.doesNotMatch(source,/capturedCaveGeometry|TubeGeometry|SphereGeometry\(.*cave/);
});
test('a player-sized foot support crosses small scan seams when walking the entire cave in either direction',()=>{
  const world=new XianxiaWorld(new THREE.Scene());
  world.models={'cave-scan':capturedScanMeshes('cave-scan')};world.makeCave();
  for(const z of [119.19,4.37,117.04666666666643].map(z=>z*CAVE_LENGTH/132))assert.ok(world.canWalkCave(sampleRoute(CAVE,0,z).x,z),'scan seam blocks at '+z);
  for(const fps of [30,60,120])for(const speed of [4.3,8])for(const direction of [-1,1]){
    for(let z=direction<0?CAVE_LENGTH-.1:.1;z>0&&z<CAVE_LENGTH;z+=direction*speed/fps){
      assert.ok(world.canWalkCave(sampleRoute(CAVE,0,z).x,z),'walking stopped at '+JSON.stringify({z,x:sampleRoute(CAVE,0,z).x,floor:world.caveFootHeight(sampleRoute(CAVE,0,z).x,z),ceiling:world.caveCeilingIndex.heightAt(sampleRoute(CAVE,0,z).x,z)}));
      assert.ok(Number.isFinite(world.groundHeight(sampleRoute(CAVE,0,z).x,z)));
      assert.ok(world.caveFootHeight(sampleRoute(CAVE,0,z).x,z)-sampleRoute(CAVE,0,z).height<1,'the roof top must never become the player floor');
    }
  }
  const gap=Object.assign(Object.create(XianxiaWorld.prototype),{caveFloorIndex:{heightAt:(x,z)=>Math.abs(x)<.5&&Math.abs(z-CAVE_LENGTH/2)<.5?null:3}});
  assert.equal(gap.canWalkCave(0,CAVE_LENGTH/2),false,'larger unsupported holes remain blocked');
});
test('captured ceiling clearance blocks a player-sized head even when the floor is supported',()=>{
  const world=Object.assign(Object.create(XianxiaWorld.prototype),{caveFloorIndex:{heightAt:()=>0},caveCeilingIndex:{heightAt:()=>-1.8}});
  assert.equal(world.canWalkCave(0,CAVE_LENGTH/2),false);
  world.caveCeilingIndex.heightAt=()=>-2.3;assert.equal(world.canWalkCave(0,CAVE_LENGTH/2),true);
});
test('both full capture instances preserve one common rigid tilt and the native endpoint datums',()=>{
  assert.equal(caveCaptures.source.uid,'ce71dc2848984acfb11d8002a48a6043');
  const forest=new THREE.Matrix4().fromArray(caveCaptures.forest.matrix),mountain=new THREE.Matrix4().fromArray(caveCaptures.mountain.matrix);
  const a=new THREE.Vector3().applyMatrix4(forest),b=new THREE.Vector3().applyMatrix4(mountain);
  assert.ok(Math.abs(a.y)<1e-8&&Math.abs(a.z-CAVE_LENGTH)<1e-4);assert.ok(Math.abs(b.y-7)<1e-8&&Math.abs(b.z)<1e-8);
  for(const matrix of [forest,mountain])assert.ok(Math.abs(matrix.determinant()-1)<1e-10);
  assert.ok(new THREE.Vector3(0,1,0).transformDirection(forest).distanceTo(new THREE.Vector3(0,1,0).transformDirection(mountain))<1e-10);
});
test('foreground feet use the complete photographed terrain mesh and the capture stops at the cave exit',()=>{
  const world=new XianxiaWorld(new THREE.Scene()),terrain=capturedScanMeshes('terrain-scan');
  world.normal=new THREE.Texture();world.diffuse=new THREE.Texture();world.models={'terrain-scan':terrain};world.makeCapturedTerrain();
  assert.ok(new THREE.Box3().setFromObject(world.foreground).max.z<.01);
  for(const [x,z]of [[0,-20],[100,-200],[500,-800],[800,-976]]){
    const hit=new THREE.Raycaster(new THREE.Vector3(x,2000,z),new THREE.Vector3(0,-1,0)).intersectObject(world.foreground,true)[0];
    assert.ok(hit);assert.ok(Math.abs(world.terrainHeight(x,z)-hit.point.y)<.001);
  }
});
test('photographic rock detail preserves the captured floor and geometry while reskinning walls and roof',()=>{
  const material=new THREE.MeshStandardMaterial(),color=new THREE.Texture(),height=new THREE.Texture();addCapturedRockDetail(material,color,height);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.captureRockColor.value,color);assert.equal(shader.uniforms.captureRockHeight.value,height);
  assert.match(shader.fragmentShader,/captureGradient/);assert.match(shader.fragmentShader,/diffuseColor.a\*=mix/);
  assert.match(shader.fragmentShader,/captureWeightSum>\.000001/);
  assert.match(shader.fragmentShader,/captureDetail\*captureWall/);assert.match(shader.fragmentShader,/captureGrain\*captureOcclusion/);
  assert.doesNotMatch(shader.vertexShader,/transformed\s*[+*]=/);assert.ok(material.transparent&&material.alphaTest>0);
});
test('the graded forest contact drives the camera height without changing the original rainforest geometry',()=>{
  const source=new THREE.PlaneGeometry(20,24,20,24);source.rotateX(-Math.PI/2);
  const link=makeLink({x:0,y:0,z:0});link.forest={colliders:[],ground:new THREE.Mesh(source,new THREE.MeshBasicMaterial())};
  link.world.caveSurfaceIndex={heightAt:()=>1};link.prepareApproach();
  assert.ok(link.groundHeight(0,2)>.5);assert.ok(Math.abs(link.groundHeight(0,2)-link.approachFloorIndex.heightAt(0,2))<1e-8);
  assert.notEqual(link.forest.ground.geometry,source);assert.ok(Math.abs(source.attributes.position.getY(0))<1e-8);
});
