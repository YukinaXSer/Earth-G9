import test from 'node:test';
import assert from 'node:assert/strict';
import {needleSprays,pineSprayAlpha,pineTree01AtlasPart,pineTwigParts,pineNeedlePhotoColor} from '../scripts/pine-needle-sprays.mjs';

test('photographic needle color balance leaves brown stems, neutral wood and alpha untouched',()=>{
  const source=new Uint8Array([90,55,25,255,60,60,60,255,30,65,20,200,0,0,0,0]),before=source.slice();
  const balanced=pineNeedlePhotoColor(source);
  assert.deepEqual(source,before);assert.deepEqual(balanced.slice(0,8),source.slice(0,8));
  assert.ok(balanced[8]<source[8]);assert.ok(balanced[9]>source[9]);
  assert.equal(balanced[11],200);assert.deepEqual(balanced.slice(12),source.slice(12));
});

test('Pine Tree 01 retains its photographed woody fork but excludes needle islands and cones from that region',()=>{
  for(const [u,v]of [[.1,.65],[.3,.75],[.58,.8],[.1,.95]])assert.equal(pineTree01AtlasPart(u,v),'wood');
  for(const [u,v]of [[.1,.2],[.85,.8],[.63,.7],[.52,.95]])assert.equal(pineTree01AtlasPart(u,v),'needles');
  assert.equal(pineTree01AtlasPart(.6,.15),'cones');
  assert.equal(pineTree01AtlasPart(1.3,-.25),'wood');
});

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
  assert.equal(a.needleMask.length,p.length/3);assert.ok(a.needleMask.every(n=>n===1));
  assert.equal(a.indices.length,a.clusters*36);assert.equal(a.position.length,a.normal.length);
  for(let n=0;n<a.position.length;n++)assert.ok(Number.isFinite(a.position[n])&&a.position[n]>=a.bounds.min[n%3]-1e-6&&a.position[n]<=a.bounds.max[n%3]+1e-6);
  for(let n=0;n<a.normal.length;n+=3)assert.ok(Math.abs(Math.hypot(...a.normal.subarray(n,n+3))-1)<1e-6);
  assert.ok([...a.indices].every(index=>index<a.position.length/3));
  assert.ok(a.position.some((n,index)=>index%3===0&&Math.abs(n-a.position[0])>.001));
  for(let n=0;n<a.position.length;n+=24)for(let k=0;k<3;k++)assert.ok(Math.abs(a.position[n+k]+a.position[n+6+k]-a.position[n+3+k]-a.position[n+9+k])<1e-6,'bounds fitting must preserve each photograph plane, not shear individual corners');
  assert.throws(()=>needleSprays(p,i,t,{acceptUV:()=>false}),/No photographed/);
  assert.throws(()=>needleSprays(p,i,t,{cellSize:0}),/Invalid/);
});

test('spray replacement leaves every non-slender original twig surface available for retention, regardless of atlas island',()=>{
  const position=new Float32Array([0,0,0,.1,0,0,.1,.002,0,0,.002,0, .2,0,0,.6,0,0,.6,.3,0,.2,.3,0]);
  const indices=new Uint32Array([0,1,2,0,2,3,4,5,6,4,6,7]),uv=new Float32Array(16).fill(.8);
  const before=position.slice(),result=needleSprays(position,indices,uv);
  assert.deepEqual([...result.needleMask],[1,1,1,1,0,0,0,0]);
  assert.deepEqual(pineTwigParts(indices,uv,result.needleMask),{wood:[],cones:[],needles:[4,5,6,4,6,7]});
  assert.deepEqual(position,before);
});

test('native non-slender needle-region surfaces cannot consume the woody-fork simplification budget',()=>{
  const indices=new Uint32Array([0,1,2,3,4,5,6,7,8,9,10,11]),mask=new Uint8Array(12),uv=[];
  for(const [u,v]of [[.1,.65],[.6,.15],[.8,.8],[.8,.8]])for(let i=0;i<3;i++)uv.push(u,v);
  mask.fill(1,9);
  assert.deepEqual(pineTwigParts(indices,new Float32Array(uv),mask),{wood:[0,1,2],cones:[3,4,5],needles:[6,7,8]});
});
