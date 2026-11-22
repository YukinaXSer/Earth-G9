import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MOUNTAIN_NATIVE_PATH,mountainRoute,mountainPathDistance,mountainRoutePoint} from '../src/xianxia-mountain-route.js';
import {decodeMountainGeometry} from '../src/xianxia-mountain-geometry.js';
import {gradeCaptureApproach} from '../src/xianxia-near.js';
import {createFloorIndex} from '../src/xianxia-world.js';
import {MountainTileSurface} from '../src/xianxia-mountain-surface.js';

test('the complete kilometre terrain route follows visible triangles in both mirrored directions',()=>{
  const surface=new MountainTileSurface();
  const manifest=JSON.parse(readFileSync(new URL('../public/xianxia/surface/mountain-v4.json',import.meta.url)));
  for(let phase=0;phase<4;phase++){
    const data=readFileSync(new URL('../public/xianxia/surface/'+manifest.tiles[phase].near,import.meta.url));
    const geometry=decodeMountainGeometry(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    if(!phase)gradeCaptureApproach(geometry);
    const index=createFloorIndex([geometry],2);
    for(let block=-1;block<=16;block++)surface.set(block,phase,[index]);
  }
  const route=mountainRoute();
  for(let j=1;j<route.length;j++){
    const a=route[j-1],b=route[j],count=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/.1);
    for(let i=1;i<=count;i++){
      const p=i/count,q=(i-1)/count;
      const from=[a[0]+(b[0]-a[0])*q,a[2]+(b[2]-a[2])*q],to=[a[0]+(b[0]-a[0])*p,a[2]+(b[2]-a[2])*p];
      assert.ok(surface.canMove(...from,...to),JSON.stringify({from,to,direction:'forward'}));
      assert.ok(surface.canMove(...to,...from),JSON.stringify({from,to,direction:'return'}));
      assert.ok(surface.canMove(...from,...to,.6),JSON.stringify({from,to,direction:'clearance'}));
    }
  }
});

test('mountain route leaves the fixed forecourt unchanged and navigates around the first depression',()=>{
  assert.deepEqual(MOUNTAIN_NATIVE_PATH.slice(1,3),[[100.5,-115.1],[108.5,-115.1]]);
  assert.equal(mountainPathDistance(105,-115.1),0);
  assert.ok(mountainPathDistance(112,-114.57)<.01);
  assert.ok(mountainPathDistance(112,-115.1)>.4);
  const route=mountainRoute();
  assert.deepEqual(mountainRoutePoint(route,0),[100.5,0,-115.1]);
  assert.deepEqual(mountainRoutePoint(route,1),route.at(-1).slice(0,3));
  assert.ok(route.reduce((sum,p,i)=>sum+(i?Math.hypot(p[0]-route[i-1][0],p[2]-route[i-1][2]):0),0)>1000);
});
