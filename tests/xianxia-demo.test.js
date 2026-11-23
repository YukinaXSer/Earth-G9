import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { XianxiaDemoRuntime } from '../src/xianxia-demo-runtime.js';

function explorer(){
  return Object.assign(Object.create(XianxiaDemoRuntime.prototype),{
    position:new THREE.Vector3(0,0,-104),yaw:0,active:true,paused:false,keys:new Set(['KeyW']),colliders:[],
    worldLink:{owns:(x,z)=>z<-105,groundHeight:()=>0,canWalk:()=>true},
  });
}
test('standalone copy consistently marks the cave closed instead of promising a rainforest connection',()=>{
  const source=readFileSync(new URL('../src/xianxia-main.js',import.meta.url),'utf8');
  for(const text of ['山洞尚未开放，当前可沿山径探索。','山洞尚未开放，暂不连接雨林。','当前为独立山境，山洞尚未开放。沿山径前行，听松看云。','两界洞 · 尚未开放','独立山境试玩 · 山洞尚未开放'])assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/回身穿洞|即可往返雨林|可穿过两界洞|两界相连，循径可返|从雨林洞口出发|青岚境与雨林连续山境/);
  assert.match(source,/nearOnly:true/);
  assert.match(source,/\$\('#forest-start'\)\.hidden=true/);
});
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
test('demo waits for the initial real-frame GPU upload before enabling entry',async t=>{
  const calls=[],fence={},statuses=[1,2],previous=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=callback=>queueMicrotask(callback);
  t.after(()=>{if(previous)globalThis.requestAnimationFrame=previous;else delete globalThis.requestAnimationFrame;});
  const gl={SYNC_GPU_COMMANDS_COMPLETE:0,ALREADY_SIGNALED:3,CONDITION_SATISFIED:2,WAIT_FAILED:4,
    fenceSync:()=>{calls.push('fence');return fence;},flush:()=>calls.push('flush'),
    clientWaitSync:()=>statuses.shift(),deleteSync:value=>{assert.equal(value,fence);calls.push('delete');}};
  const world=explorer();world.renderer={compileAsync:async()=>calls.push('compile'),render:()=>calls.push('render'),getContext:()=>gl};
  await world.prepareDemo({});
  assert.deepEqual(calls,['compile','render','fence','flush','delete']);
});
test('demo reports a failed GPU fence and releases it',async()=>{
  const world=explorer();let deleted=false;
  world.renderer={compileAsync:async()=>{},render:()=>{},getContext:()=>({
    fenceSync:()=>({}),flush:()=>{},clientWaitSync:()=>4,WAIT_FAILED:4,
    deleteSync:()=>{deleted=true;}
  })};
  await assert.rejects(world.prepareDemo({}),/GPU upload/);assert.equal(deleted,true);
});
