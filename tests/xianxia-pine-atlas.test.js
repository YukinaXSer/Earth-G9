import test from 'node:test';
import assert from 'node:assert/strict';
import {padOpaqueAtlas} from '../scripts/pad-opaque-atlas.mjs';
import {needleComponents,needleProjection,restoreNeedleCoverage} from '../scripts/pine-needle-components.mjs';

test('opaque needle atlas padding preserves photographed texels and alpha while removing unused black bleed',()=>{
  const pixels=new Uint8Array([0,0,0,255,45,95,34,255,0,0,0,128,0,0,0,255,0,0,0,255,0,0,0,255]);
  const padded=padOpaqueAtlas(pixels,3,2);
  for(let i=0;i<6;i++)assert.deepEqual(Array.from(padded.slice(i*4,i*4+3)),[45,95,34]);
  assert.deepEqual(Array.from(padded.filter((_,i)=>i%4===3)),[255,255,128,255,255,255]);
  assert.deepEqual(Array.from(pixels.slice(0,4)),[0,0,0,255]);
  assert.deepEqual(padOpaqueAtlas(padded,3,2),padded);
  const buffer=Buffer.from(pixels);padOpaqueAtlas(buffer,3,2);assert.deepEqual(buffer,Buffer.from(pixels));
});

test('atlas padding keeps valid brown cone texels, handles RGB and empty atlases, and rejects malformed sizes',()=>{
  const pixels=new Uint8Array([0,0,0,80,60,40,0,0,0,30,90,20]);
  assert.deepEqual(Array.from(padOpaqueAtlas(pixels,4,1,3)),[80,60,40,80,60,40,80,60,40,30,90,20]);
  assert.deepEqual(padOpaqueAtlas(new Uint8Array(12),2,2,3),new Uint8Array(12));
  assert.throws(()=>padOpaqueAtlas(pixels,3,3),/dimensions/);
});

test('coverage compensation selects slender needles, never small rounded cones',()=>{
  const positions=new Float32Array([0,0,0,.1,0,0,.1,.002,0,0,.002,0,1,0,0,1.1,0,0,1,.1,0,1,0,.1]);
  const indices=new Uint32Array([0,1,2,0,2,3,4,5,6,4,6,7,4,7,5,5,7,6]);
  const before=positions.slice(),needles=needleComponents(positions,indices);
  assert.equal(needles.groups.length,1);
  assert.deepEqual([...needles.mask],[1,1,1,1,0,0,0,0]);
  assert.ok(needles.projected>0);
  assert.equal(needles.projected,needleProjection(positions,indices,needles.mask));
  assert.deepEqual(positions,before);
  const coverage=restoreNeedleCoverage(positions,indices,needles.projected*2);
  assert.ok(coverage.after>coverage.before*1.9);
  assert.deepEqual(positions.slice(12),before.slice(12));
});

test('degenerate foliage components have no compensatable coverage',()=>{
  const needles=needleComponents(new Float32Array(9),new Uint32Array([0,1,2]));
  assert.equal(needles.groups.length,0);assert.equal(needles.projected,0);
});
