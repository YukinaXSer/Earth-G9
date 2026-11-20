import data from './xianxia-foreground-data.json' with {type:'json'};
import {measuredTerrainHeight} from './xianxia-terrain.js';

export const FOREGROUND_SOURCE=data;
const border=14,step=data.step,width=data.width+border*2,height=data.height+border*2;
const x0=data.x0-border*step,z0=data.z0-border*step,nearest=new Int32Array(width*height).fill(-1),queue=[];
for(let z=0;z<data.height;z++)for(let x=0;x<data.width;x++)if(data.heights[z*data.width+x]!=null){
  const i=(z+border)*width+x+border;nearest[i]=z*data.width+x;queue.push(i);
}
for(let head=0;head<queue.length;head++){
  const i=queue[head],x=i%width,z=Math.floor(i/width);
  for(const j of [x>0?i-1:-1,x<width-1?i+1:-1,z>0?i-width:-1,z<height-1?i+width:-1])if(j>=0&&nearest[j]<0){nearest[j]=nearest[i];queue.push(j);}
}
const corrections=new Float32Array(width*height);
for(let i=0;i<corrections.length;i++){
  const n=nearest[i];if(n<0)continue;
  const x=x0+i%width*step,z=z0+Math.floor(i/width)*step,nx=data.x0+n%data.width*step,nz=data.z0+Math.floor(n/data.width)*step;
  const t=Math.min(1,Math.hypot(x-nx,z-nz)/(border*step)),weight=1-t*t*(3-2*t);
  corrections[i]=(data.heights[n]-measuredTerrainHeight(nx,nz))*weight;
}
function sample(values,x,z,originX,originZ,columns,rows){
  const u=(x-originX)/step,v=(z-originZ)/step,ix=Math.floor(u),iz=Math.floor(v);
  if(ix<0||iz<0||ix>=columns-1||iz>=rows-1)return null;
  const ids=[iz*columns+ix,iz*columns+ix+1,(iz+1)*columns+ix,(iz+1)*columns+ix+1],p=ids.map(i=>values[i]);
  if(p.some(v=>v==null))return null;
  const a=u-ix,b=v-iz;return p[0]*(1-a)*(1-b)+p[1]*a*(1-b)+p[2]*(1-a)*b+p[3]*a*b;
}
export function foregroundHeight(x,z){return sample(data.heights,x,z,data.x0,data.z0,data.width,data.height);}
export function blendedTerrainHeight(x,z){return measuredTerrainHeight(x,z)+(sample(corrections,x,z,x0,z0,width,height)??0);}
