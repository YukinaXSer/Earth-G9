import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeMountainGeometry,mountainStation,MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z} from '../src/xianxia-mountain-geometry.js';

function sample(){
  const buffer=new ArrayBuffer(66),view=new DataView(buffer);view.setUint32(0,0x314e544d,true);view.setUint32(4,3,true);view.setUint32(8,3,true);
  [0,-4,-16,16,16,32].forEach((n,i)=>view.setFloat32(12+i*4,n,true));
  new Uint16Array(buffer,36,9).set([0,16384,32768,65535,16384,32768,65535,16384,65535]);
  new Int8Array(buffer,54,9).set([0,127,0,0,127,0,0,127,0]);new Uint8Array(buffer,63,3).set([0,2,2]);return buffer;
}

test('native quantized geometry needs no runtime decoder and retains metre scale',()=>{
  const geometry=decodeMountainGeometry(sample());assert.equal(geometry.index.count,3);assert.equal(geometry.attributes.position.count,3);
  assert.equal(geometry.attributes.position.getX(0),MOUNTAIN_BASE_X);
  assert.equal(geometry.attributes.position.getX(1),MOUNTAIN_BASE_X+17);
  assert.ok(Math.abs(geometry.attributes.position.getZ(0)-MOUNTAIN_BASE_Z)<.00025);
  assert.equal(geometry.attributes.normal.getY(0),1);
});

test('captured period keeps its interior rigid and removes derivative jumps only in one-metre end bands',()=>{
  for(let u=1;u<=63;u+=.25)assert.equal(mountainStation(u),u+1);
  assert.equal(mountainStation(0),0);assert.equal(mountainStation(64),66);
  assert.equal(mountainStation(.25),1);assert.equal(mountainStation(63.75),65);
});

test('malformed geometry cannot allocate arbitrary buffers or read outside the payload',()=>{
  assert.throws(()=>decodeMountainGeometry(new ArrayBuffer(0)));
  const size=sample();new DataView(size).setUint32(4,0xffffffff,true);assert.throws(()=>decodeMountainGeometry(size),/size/);
  const index=sample();new Uint8Array(index)[65]=126;assert.throws(()=>decodeMountainGeometry(index),/out of bounds/);
  const truncated=sample().slice(0,65);assert.throws(()=>decodeMountainGeometry(truncated));
});
