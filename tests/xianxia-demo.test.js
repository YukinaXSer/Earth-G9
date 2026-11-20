import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { XianxiaDemoRuntime } from '../src/xianxia-demo-runtime.js';

function explorer(){
  return Object.assign(Object.create(XianxiaDemoRuntime.prototype),{
    position:new THREE.Vector3(0,0,-104),yaw:0,active:true,paused:false,keys:new Set(['KeyW']),colliders:[],
    worldLink:{owns:(x,z)=>z<-105,groundHeight:()=>0,canWalk:()=>true},
  });
}
test('demo walks beyond native bounds on linked ground without replacing its shared player',()=>{
  const world=explorer(),position=world.position;
  for(let i=0;i<32;i++)world.moveDemo(.25);
  assert.equal(world.position,position);assert.ok(position.z<-138);assert.equal(world.yaw,0);
});
test('demo respects linked collision instead of clamping the player into a cave wall',()=>{
  const world=explorer();world.worldLink.canWalk=()=>false;
  for(let i=0;i<32;i++)world.moveDemo(.25);
  assert.ok(world.position.z>=-105);assert.ok(world.position.z<-104);
});
test('demo pause stops both key and touch movement',()=>{
  const world=explorer();world.paused=true;world.touchMove={x:1,y:1};
  assert.equal(world.moveDemo(.5),false);assert.equal(world.position.z,-104);assert.equal(world.position.x,0);
});
test('demo normalizes keyboard and touch input speed',()=>{
  const world=explorer();world.position.set(0,0,0);world.keys.add('KeyD');world.touchMove={x:1,y:1};
  world.moveDemo(.5);assert.ok(Math.abs(Math.hypot(world.position.x,world.position.z)-2.15)<1e-6);
});
