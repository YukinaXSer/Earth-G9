import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeMountainGeometry,MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z,MOUNTAIN_PERIOD,MOUNTAIN_WIDTH,mountainStation} from '../src/xianxia-mountain-geometry.js';
import {gradeCaptureApproach} from '../src/xianxia-near.js';
import {createFloorIndex} from '../src/xianxia-world.js';
import {MountainTileSurface} from '../src/xianxia-mountain-surface.js';
import {mountainFernPlacement,mountainPinePlacements} from '../src/xianxia-mountain-field.js';
import {mountainPathDistance} from '../src/xianxia-mountain-route.js';

function load(phase,lod){
  const b=readFileSync(new URL('../public/xianxia/surface/v3/tile-'+phase+'-'+lod+'.bin',import.meta.url));
  const geometry=decodeMountainGeometry(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  return phase?geometry:gradeCaptureApproach(geometry);
}

test('mature pine groves belong to their streamed phase and keep the walking line open',()=>{
  const placements=Array.from({length:4},(_,phase)=>{
    const points=mountainPinePlacements(phase);
    assert.deepEqual(points,mountainPinePlacements(phase));
    for(const {x,z}of points){
      assert.ok(x>=MOUNTAIN_BASE_X+mountainStation(phase*16));
      assert.ok(x<MOUNTAIN_BASE_X+mountainStation((phase+1)*16));
      assert.ok(mountainPathDistance(x,z)>=1.7);
      assert.ok(Math.abs(z-MOUNTAIN_BASE_Z)<MOUNTAIN_WIDTH/2);
    }
    return points;
  }).flat();
  assert.ok(placements.length>=8);
  assert.ok(new Set(placements.map(p=>p.i)).size===placements.length);
});

test('mature pine LODs stay within the replaced sapling download and use native glTF geometry',()=>{
  let total=0;
  for(const lod of ['near','far']){
    const bytes=readFileSync(new URL('../public/xianxia/surface/pine-mature-'+lod+'.glb',import.meta.url));total+=bytes.length;
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert.ok(!json.extensionsRequired?.some(name=>/draco|meshopt|basisu/i.test(name)));
    assert.equal(json.nodes.filter(n=>n.mesh!==undefined).length,1);
    if(lod==='far'){
      assert.equal(json.images?.length??0,0);
      assert.ok(json.materials.some(m=>m.name.includes('twig')));
      assert.ok(json.materials.some(m=>m.name.includes('trunk')));
    }
  }
  assert.ok(total<=readFileSync(new URL('../public/xianxia/surface/pine-medium.glb',import.meta.url)).length);
});

test('native scanned entrance keeps the whole fixed eight-metre forecourt walkable',()=>{
  const surface=new MountainTileSurface();
  for(let p=0;p<4;p++){const index=createFloorIndex([load(p,'near')],2);for(let b=0;b<3;b++)surface.set(b,p,[index]);}
  for(let dx=0;dx<=8;dx+=.25)for(const dz of [-.6,0,.6]){
    const tolerance=dz===0?.002:.006;
    assert.ok(Math.abs(surface.heightAt(100.5+dx,-115.1+dz)-(.49862106783051635+dx*.05087194464370546))<tolerance,JSON.stringify({dx,dz,height:surface.heightAt(100.5+dx,-115.1+dz)}));
    assert.ok(surface.canMove(100.5+dx,-115.1+dz,100.55+dx,-115.1+dz));
  }
  assert.ok(surface.canMove(108.5,-115.1,108.65,-115.1));
});

test('visible near and far terrain support the full lateral field and mirrored cells',()=>{
  for(const lod of ['near','far']){
    const surface=new MountainTileSurface();
    for(let phase=0;phase<4;phase++){
      const index=createFloorIndex([load(phase,lod)],2);
      for(let block=-1;block<=2;block++)for(let band=-1;band<=1;band++)surface.set(block,phase,[index],band);
    }
    for(let x=MOUNTAIN_BASE_X-32.5;x<MOUNTAIN_BASE_X+MOUNTAIN_PERIOD*2+32;x+=5.5){
      for(let z=MOUNTAIN_BASE_Z-MOUNTAIN_WIDTH*1.5+.1;z<MOUNTAIN_BASE_Z+MOUNTAIN_WIDTH*1.5;z+=2.9){
        assert.ok(Number.isFinite(surface.heightAt(x,z)),JSON.stringify({lod,x,z}));
      }
    }
  }
});

test('near and far surface heights retain common clipped tile rims',()=>{
  for(let phase=0;phase<4;phase++){
    const near=createFloorIndex([load(phase,'near')],2),far=createFloorIndex([load(phase,'far')],2);
    for(const u of [phase*16,(phase+1)*16]){
      const x=MOUNTAIN_BASE_X+mountainStation(u);
      for(let dz=-15.75;dz<16;dz+=.5){
        const z=MOUNTAIN_BASE_Z+dz,a=near.heightAt(x,z),b=far.heightAt(x,z);
        assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<.002,JSON.stringify({phase,x,z,near:a,far:b}));
      }
    }
  }
});

test('fern patches repeat deterministically when streamed, with mixed sizes and irregular lateral clusters',()=>{
  for(let phase=0;phase<4;phase++){
    const samples=Array.from({length:225},(_,i)=>mountainFernPlacement(phase,i,45));
    assert.deepEqual(samples,Array.from({length:225},(_,i)=>mountainFernPlacement(phase,i,45)));
    assert.ok(Math.min(...samples.map(p=>p.scale))<.6);
    assert.ok(Math.max(...samples.map(p=>p.scale))>1.1);
    assert.ok(Math.max(...samples.map(p=>p.z))-Math.min(...samples.map(p=>p.z))>20);
    for(const p of samples){
      assert.ok(p.scale>=.55&&p.scale<1.15);
      assert.ok(p.rotation>=0&&p.rotation<Math.PI*2&&p.variant>=0&&p.variant<1);
      assert.ok(p.x>MOUNTAIN_BASE_X+mountainStation(phase*16)&&p.x<MOUNTAIN_BASE_X+mountainStation((phase+1)*16));
      assert.ok(Math.abs(p.z-MOUNTAIN_BASE_Z)<MOUNTAIN_WIDTH/2);
    }
  }
  const patch=Array.from({length:9},(_,i)=>mountainFernPlacement(1,25+i,25));
  for(const a of patch)for(const b of patch)assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<2.71);
  const contact=mountainFernPlacement(2,29,25,[[139,-100]]);
  assert.equal(contact.x,139);assert.equal(contact.z,-100);
});
