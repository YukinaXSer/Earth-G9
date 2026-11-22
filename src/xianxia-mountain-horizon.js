import * as THREE from 'three';
export const MOUNTAIN_HORIZON_CAPTURE=Object.freeze({
  texture:'/xianxia/textures/mountain-distant-ring-v6.webp',width:3072,height:432,
  lowTexture:'/xianxia/textures/mountain-distant-ring-v6-low.webp',
  radius:1500,angle:2*Math.PI,eye:.65,
});

export function mountainHorizonGeometry(){
  const capture=MOUNTAIN_HORIZON_CAPTURE,columns=128,rows=16,positions=[],uv=[],faces=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
    const u=i/columns,v=j/rows,angle=(u-.5)*capture.angle;
    const elevation=(capture.eye-v)*capture.angle*capture.height/capture.width;
    positions.push(capture.radius*Math.cos(angle),capture.radius*Math.tan(elevation),capture.radius*Math.sin(angle));
    uv.push(u,1-v);
    if(i<columns&&j<rows){
      const a=j*(columns+1)+i,b=a+1,c=a+columns+1,d=c+1;faces.push(a,c,b,b,c,d);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(faces);
  geometry.userData.source='Shudu Lake — Alex Radosnov / CC0; Environment of huangshan — François Philipp / CC BY 2.0';
  geometry.computeBoundingSphere();return geometry;
}

export async function loadMountainHorizon({world,group}){
  const map=await new THREE.TextureLoader().loadAsync(world.quality==='low'?MOUNTAIN_HORIZON_CAPTURE.lowTexture:MOUNTAIN_HORIZON_CAPTURE.texture);
  map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=THREE.RepeatWrapping;
  map.anisotropy=Math.min(4,world.renderer?.capabilities?.getMaxAnisotropy?.()??1);
  // A closed, sky-free ring; no polar image or overlapping transparent meshes.
  const material=new THREE.MeshBasicMaterial({map,transparent:true,alphaTest:.001,depthWrite:false,fog:true});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n gl_Position.z=gl_Position.w;');
    // The photograph already contains haze; residual weather fog is invariant under mouse-look.
    shader.vertexShader=shader.vertexShader.replace('#include <fog_vertex>','#include <fog_vertex>\n #ifdef USE_FOG\n vFogDepth=length(mvPosition.xyz)*.1;\n #endif');
  };
  material.customProgramCacheKey=()=> 'xianxia-photographic-distant-backdrop-v3';
  const mesh=new THREE.Mesh(mountainHorizonGeometry(),material),cameraPosition=new THREE.Vector3(),inverse=new THREE.Matrix4();
  mesh.name='Photographed circumferential mountain country';mesh.renderOrder=-1000;mesh.frustumCulled=false;mesh.raycast=()=>{};
  mesh.userData.collision=false;group.add(mesh);
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{
    group.updateWorldMatrix(true,false);inverse.copy(group.matrixWorld).invert();
    camera.getWorldPosition(cameraPosition).applyMatrix4(inverse);
    mesh.position.copy(cameraPosition);mesh.updateWorldMatrix(false,false);
  };
  return mesh;
}
