import * as THREE from 'three';
import data from './xianxia-terrain-data.json' with {type:'json'};

export const TERRAIN_STEP=12;
export const TERRAIN_SOURCE=data;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cubic=(a,b,c,d,t)=>b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
const at=(x,z)=>data.heights[clamp(z,0,data.height-1)*data.width+clamp(x,0,data.width-1)];

export function surveyedElevation(x,z){
  const u=(x-data.x0)/data.step,v=(z-data.z0)/data.step,ix=Math.floor(u),iz=Math.floor(v),rows=[];
  for(let k=-1;k<=2;k++)rows.push(cubic(at(ix-1,iz+k),at(ix,iz+k),at(ix+1,iz+k),at(ix+2,iz+k),u-ix));
  return clamp(cubic(...rows,v-iz),Math.min(...rows),Math.max(...rows));
}

export const TERRAIN_DATUM=surveyedElevation(0,0)-7;
const vertex=(x,z)=>surveyedElevation(x,z)-TERRAIN_DATUM;

export function measuredTerrainHeight(x,z){
  const step=TERRAIN_STEP,x0=Math.floor(x/step)*step,z0=Math.floor(z/step)*step,u=(x-x0)/step,v=(z-z0)/step;
  const a=vertex(x0,z0),b=vertex(x0+step,z0),c=vertex(x0,z0+step),d=vertex(x0+step,z0+step);
  return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}

export function measuredTerrainGeometry(omit=()=>false){
  const step=TERRAIN_STEP,minX=Math.ceil(data.x0/step)*step,minZ=Math.ceil(data.z0/step)*step;
  const columns=Math.floor((data.x0+(data.width-1)*data.step-minX)/step),rows=Math.floor((data.z0+(data.height-1)*data.step-minZ)/step);
  const positions=[],uv=[],indices=[],photo=data.satellite;
  for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
    const x=minX+i*step,z=minZ+j*step;positions.push(x,vertex(x,z),z);uv.push((x-photo.x0)/photo.size,1-(z-photo.z0)/photo.size);
    if(i<columns&&j<rows&&!omit(x+step/2,z+step/2)){
      const a=j*(columns+1)+i,b=a+1,c=a+columns+1,d=c+1;indices.push(a,c,b,b,c,d);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
