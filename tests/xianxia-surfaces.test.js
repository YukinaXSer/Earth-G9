import test from 'node:test';
import {blendedTerrainHeight,FOREGROUND_SOURCE} from '../src/xianxia-foreground.js';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { photographicHorizonGeometry,routeRibbonGeometry,createFloorIndex,XianxiaWorld } from '../src/xianxia-world.js';
import { TRAIL,BRANCH,sampleMountain,canWalkMountain } from '../src/xianxia-route.js';
import { measuredTerrainHeight,measuredTerrainGeometry,surveyedElevation,TERRAIN_SOURCE,TERRAIN_DATUM } from '../src/xianxia-terrain.js';

test('photographic background is closed in every normal viewing direction, including below the path',()=>{
  const mesh=new THREE.Mesh(photographicHorizonGeometry(),new THREE.MeshBasicMaterial({side:THREE.BackSide}));mesh.updateMatrixWorld(true);
  for(let angle=.013;angle<Math.PI*2;angle+=.15)for(const pitch of [-1.37,-.51,.017,.51,1.37]){
    const direction=new THREE.Vector3(Math.cos(angle)*Math.cos(pitch),Math.sin(pitch),Math.sin(angle)*Math.cos(pitch));
    assert.ok(new THREE.Raycaster(new THREE.Vector3(0,1.85,0),direction,0,2800).intersectObject(mesh).length);
  }
});
test('continuous road ribbons cover the walkable path through bends and the flared cave mouth',()=>{
  const index=createFloorIndex([TRAIL,BRANCH].map(route=>routeRibbonGeometry(route,(x,z)=>sampleMountain(x,z).height,p=>p.width+1.6+Math.max(0,1+p.z/12)*7)));
  for(const route of [TRAIL,BRANCH])for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1],length=Math.hypot(b[0]-a[0],b[2]-a[2]),nx=-(b[2]-a[2])/length,nz=(b[0]-a[0])/length;
    for(let d=0;d<=length;d+=2)for(const side of [-1,0,1]){
      const t=d/length,w=a[3]+(b[3]-a[3])*t,x=a[0]+(b[0]-a[0])*t+nx*(w-.6)*side,z=a[2]+(b[2]-a[2])*t+nz*(w-.6)*side;
      assert.notEqual(index.heightAt(x,z),null,`missing road at ${x},${z}`);
    }
  }
  for(let x=-9;x<=9;x++)for(let z=-10;z<0;z++)if(canWalkMountain(x,z))assert.notEqual(index.heightAt(x,z),null);
});
test('player feet use the visible road triangles, not an unrelated source-height approximation',()=>{
  const geometry=routeRibbonGeometry([[0,0,0,3],[0,0,-20,3]],(x,z)=>x*.2+Math.sin(z*.2)*.3),index=createFloorIndex([geometry]);
  const world=Object.assign(Object.create(XianxiaWorld.prototype),{floorIndex:index,sourceHeight:()=>999});
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);
  for(let z=-.5;z>-19;z-=1.3)for(const x of [-2.1,0,2.1]){
    const hit=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];
    assert.ok(hit);assert.ok(Math.abs(world.groundHeight(x,z)-hit.point.y)<1e-5);
  }
});
test('hills follow measured terrain, not a fabricated downhill profile around the route',()=>{
  const world=Object.assign(Object.create(XianxiaWorld.prototype),{});
  for(const [x,z]of [[0,-20],[105,-20],[-105,-20],[600,-900]]){
    assert.equal(world.supportHeight(x,z),blendedTerrainHeight(x,z));
    assert.equal(world.sourceHeight(x,z),blendedTerrainHeight(x,z));
  }
  assert.ok(Math.abs(world.supportHeight(105,-20)-world.supportHeight(-105,-20))>10);
});

test('Huangshan source samples retain real measured elevations and auditable public tile provenance',()=>{
  const d=TERRAIN_SOURCE;
  assert.ok(d.heights.length===d.width*d.height&&d.heights.length>15000);
  assert.ok(d.step>30&&d.step<35);assert.ok(d.origin.latitude>30&&d.origin.latitude<31);
  for(let z=1;z<d.height-1;z+=11)for(let x=1;x<d.width-1;x+=13)assert.ok(Math.abs(surveyedElevation(d.x0+x*d.step,d.z0+z*d.step)-d.heights[z*d.width+x])<1e-6);
  assert.equal(measuredTerrainHeight(0,0),7);
  assert.ok(TERRAIN_DATUM>1000&&TERRAIN_DATUM<1800);
  assert.equal(d.provenance.sources.length,13);
  for(const s of d.provenance.sources){assert.match(s.url,/^https:\/\/(s3.amazonaws.com\/elevation-tiles-prod|tiles.maps.eox.at)/);assert.match(s.sha256,/^[a-f0-9]{64}$/);}
});

test('landscape vertices and off-vertex foot heights share the measured terrain triangles',()=>{
  const geometry=measuredTerrainGeometry(),positions=geometry.attributes.position,mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);
  assert.ok(positions.count>100000);
  for(let i=0;i<positions.count;i+=1879)assert.ok(Math.abs(positions.getY(i)-measuredTerrainHeight(positions.getX(i),positions.getZ(i)))<.001);
  for(const [x,z]of [[.7,-2.9],[104.2,-190.4],[799.3,-976.7],[-100.2,-400.1]]){
    const hit=new THREE.Raycaster(new THREE.Vector3(x,2000,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];assert.ok(hit);
    assert.ok(Math.abs(hit.point.y-measuredTerrainHeight(x,z))<.001);
  }
});
