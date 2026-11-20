import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeMountainGeometry,MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z} from '../src/xianxia-mountain-geometry.js';
import {gradeCaptureApproach} from '../src/xianxia-near.js';
import {createFloorIndex} from '../src/xianxia-world.js';
import {MountainTileSurface} from '../src/xianxia-mountain-surface.js';

function load(phase,lod){
  const b=readFileSync(new URL('../public/xianxia/surface/tile-'+phase+'-'+lod+'.bin',import.meta.url));
  const geometry=decodeMountainGeometry(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  return phase?geometry:gradeCaptureApproach(geometry);
}

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
