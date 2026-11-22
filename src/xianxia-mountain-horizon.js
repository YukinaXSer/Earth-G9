import * as THREE from 'three';
import {TERRAIN_SOURCE,surveyedElevation} from './xianxia-terrain.js';

const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export const MOUNTAIN_HORIZON_VIEW=Object.freeze({x:1517,z:298,near:1400,full:1800});

export function mountainHorizonGeometry(){
  const data=TERRAIN_SOURCE,view=MOUNTAIN_HORIZON_VIEW,eye=surveyedElevation(view.x,view.z)+1.85,positions=[],uv=[],fade=[],faces=[];
  let angle=0,best=-Infinity;
  for(let j=0;j<data.height;j++)for(let i=0;i<data.width;i++){
    const sourceX=data.x0+i*data.step,sourceZ=data.z0+j*data.step;
    const x=sourceX-view.x,z=sourceZ-view.z,y=data.heights[j*data.width+i]-eye,r=Math.hypot(x,z);
    positions.push(x,y,z);uv.push((sourceX-data.satellite.x0)/data.satellite.size,1-(sourceZ-data.satellite.z0)/data.satellite.size);
    const edge=Math.min(i,j,data.width-1-i,data.height-1-j)*data.step;
    fade.push(smooth(view.near,view.full,r)*smooth(0,250,edge));
    if(r>view.full&&edge>250&&y/r>best){best=y/r;angle=Math.atan2(z,x);}
    if(i<data.width-1&&j<data.height-1){
      const a=j*data.width+i,b=a+1,c=a+data.width,d=c+1;faces.push([a,c,b],[b,c,d]);
    }
  }
  // This is a distant backdrop: preserve its source shape and paint hidden
  // layers first without writing over the host's terrain depth.
  const radius=id=>positions[id*3]**2+positions[id*3+1]**2+positions[id*3+2]**2;
  faces.sort((a,b)=>b.reduce((s,i)=>s+radius(i),0)-a.reduce((s,i)=>s+radius(i),0));
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('horizonFade',new THREE.Float32BufferAttribute(fade,1));
  geometry.setIndex(faces.flat());geometry.rotateY(angle);
  geometry.userData.source='Huangshan SRTM / Sentinel-2';geometry.userData.yaw=angle;
  geometry.computeBoundingSphere();return geometry;
}

export async function loadMountainHorizon({world,group}){
  const map=await new THREE.TextureLoader().loadAsync('/xianxia/textures/huangshan-satellite.webp');
  map.colorSpace=THREE.SRGBColorSpace;
  map.anisotropy=Math.min(4,world.renderer?.capabilities?.getMaxAnisotropy?.()??1);
  const material=new THREE.MeshBasicMaterial({map,depthWrite:false,fog:true});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float horizonFade; varying float distantFade;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n distantFade=horizonFade; gl_Position.z=gl_Position.w;');
    shader.vertexShader=shader.vertexShader.replace('#include <fog_vertex>','#include <fog_vertex>\n #ifdef USE_FOG\n vFogDepth*=.15;\n #endif');
    shader.fragmentShader='varying float distantFade;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n if(distantFade<.001)discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`
      #ifdef USE_FOG
      gl_FragColor.rgb=mix(fogColor,gl_FragColor.rgb,distantFade);
      #endif
      #include <fog_fragment>
    `);
  };
  material.customProgramCacheKey=()=> 'xianxia-surveyed-distant-backdrop-v2';
  const mesh=new THREE.Mesh(mountainHorizonGeometry(),material),cameraPosition=new THREE.Vector3(),inverse=new THREE.Matrix4();
  mesh.name='Huangshan distant captured backdrop';mesh.renderOrder=-1000;mesh.frustumCulled=false;mesh.raycast=()=>{};
  mesh.userData.collision=false;group.add(mesh);
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{
    group.updateWorldMatrix(true,false);inverse.copy(group.matrixWorld).invert();
    camera.getWorldPosition(cameraPosition).applyMatrix4(inverse);
    mesh.position.copy(cameraPosition);mesh.updateWorldMatrix(false,false);
  };
  return mesh;
}
