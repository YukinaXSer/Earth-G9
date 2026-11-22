import test from 'node:test';
import assert from 'node:assert/strict';
import {needleSprays,pineSprayAlpha} from '../scripts/pine-needle-sprays.mjs';

test('pine photographs retain the connected shoot, not atlas padding islands or opaque image borders',()=>{
  const width=24,height=24,pixels=new Uint8Array(width*height*4);
  for(let y=3;y<21;y++)for(let x=10;x<14;x++)pixels.set([30,90,50,255],(y*width+x)*4);
  for(let y=17;y<21;y++)for(let x=2;x<5;x++)pixels.set([80,70,60,255],(y*width+x)*4);
  const before=pixels.slice(),matte=pineSprayAlpha(pixels,width,height);
  assert.deepEqual(pixels,before);
  assert.deepEqual([...matte.slice((12*width+11)*4,(12*width+11)*4+4)],[30,90,50,255]);
  assert.equal(matte[(18*width+3)*4+3],0);
  for(let x=0;x<width;x++)assert.equal(matte[x*4+3]+matte[((height-1)*width+x)*4+3],0);
  for(let y=0;y<height;y++)assert.equal(matte[y*width*4+3]+matte[(y*width+width-1)*4+3],0);
  assert.ok(pineSprayAlpha(new Uint8Array(16),2,2).every(n=>n===0));
  assert.throws(()=>pineSprayAlpha(pixels,1.5,2),/Invalid/);
});

test('pine spray geometry follows original needle clusters, stays within their bounds and never enlarges the trunk',()=>{
  const positions=[],indices=[],uv=[];
  for(let j=0;j<8;j++){
    const x=.03*j,y=.04*j,base=positions.length/3;
    positions.push(x,y,0,x+.1,y,0,x+.1,y+.002,0,x,y+.002,0);
    indices.push(base,base+1,base+2,base,base+2,base+3);uv.push(0,0,1,0,1,1,0,1);
  }
  const p=new Float32Array(positions),i=new Uint32Array(indices),t=new Float32Array(uv),before=p.slice();
  const options={cellSize:.15},a=needleSprays(p,i,t,options),b=needleSprays(p,i,t,options);
  assert.deepEqual(a,b);assert.deepEqual(p,before);assert.equal(a.accepted,8);assert.ok(a.clusters>1);
  assert.equal(a.indices.length,a.clusters*36);assert.equal(a.position.length,a.normal.length);
  for(let n=0;n<a.position.length;n++)assert.ok(Number.isFinite(a.position[n])&&a.position[n]>=a.bounds.min[n%3]-1e-6&&a.position[n]<=a.bounds.max[n%3]+1e-6);
  for(let n=0;n<a.normal.length;n+=3)assert.ok(Math.abs(Math.hypot(...a.normal.subarray(n,n+3))-1)<1e-6);
  assert.ok([...a.indices].every(index=>index<a.position.length/3));
  assert.throws(()=>needleSprays(p,i,t,{acceptUV:()=>false}),/No photographed/);
  assert.throws(()=>needleSprays(p,i,t,{cellSize:0}),/Invalid/);
});
