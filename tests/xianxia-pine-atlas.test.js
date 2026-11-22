import test from 'node:test';
import assert from 'node:assert/strict';
import {padOpaqueAtlas} from '../scripts/pad-opaque-atlas.mjs';

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
