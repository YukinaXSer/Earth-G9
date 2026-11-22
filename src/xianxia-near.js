import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFloorIndex} from './xianxia-world.js';
import {loadPhotographicGround,ensureSurfaceNormals,addPhotographicCapture} from './xianxia-surface.js';
import {MOUNTAIN_ENTRANCE} from './xianxia-mountain.js';

export const CAPTURE_START=new THREE.Vector3(-34,.8390662814617365,.7618861259964369);
export const CAPTURE_SHIFT=new THREE.Vector3(104-CAPTURE_START.x,0,-115.2-CAPTURE_START.z);

export function captureGeometry(bytes){
  const [count,length]=new Uint32Array(bytes,0,2),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(bytes,8,count*3),3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(bytes,8+count*12,count*3),3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(bytes,8+count*24,length),1));
  geometry.translate(CAPTURE_SHIFT.x,CAPTURE_SHIFT.y,CAPTURE_SHIFT.z);geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

export function gradeCaptureApproach(geometry){
  const {position:entry,approach}=MOUNTAIN_ENTRANCE,positions=geometry.attributes.position,normals=geometry.attributes.normal,cover=geometry.attributes.groundCover;
  const normal=new THREE.Vector3(),targetNormal=new THREE.Vector3(-approach.grade,1,0).normalize();
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i),y=positions.getY(i);
    const distance=Math.max((entry.x-.45-x)/3,(x-approach.endX-.45)/3,Math.abs(z-entry.z)-approach.width/2-.45);
    const target=entry.y+(x-entry.x)*approach.grade;
    const blend=(1-THREE.MathUtils.smoothstep(distance,0,.6))*(1-THREE.MathUtils.smoothstep(Math.abs(y-target),.6,1.6));
    if(blend<=0)continue;
    positions.setY(i,THREE.MathUtils.lerp(y,target,blend));
    normal.fromBufferAttribute(normals,i).lerp(targetNormal,blend).normalize();normals.setXYZ(i,normal.x,normal.y,normal.z);
    if(cover)cover.setX(i,THREE.MathUtils.lerp(cover.getX(i),1,blend));
  }
  positions.needsUpdate=true;normals.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

export function groundPropMatrix(geometry,index,x,z,rotation,{sink=.025,scale=1}={}){
  if(!Number.isFinite(scale)||scale<=0)throw new Error('Invalid grounded prop scale');
  geometry.computeBoundingBox();
  const box=geometry.boundingBox,positions=geometry.attributes.position,threshold=box.min.y+(box.max.y-box.min.y)*.2;
  const c=Math.cos(rotation),s=Math.sin(rotation);
  let height=Infinity,samples=0;
  for(let i=0;i<positions.count;i++){
    if(positions.getY(i)>threshold)continue;
    const px=positions.getX(i)*scale,pz=positions.getZ(i)*scale;
    const floor=index.heightAt(x+c*px+s*pz,z-s*px+c*pz);if(floor==null)return null;
    height=Math.min(height,floor-positions.getY(i)*scale);samples++;
  }
  if(!samples)return null;
  return new THREE.Matrix4().makeRotationY(rotation).scale(new THREE.Vector3(scale,scale,scale)).setPosition(x,height-sink,z);
}

export function groundProp(geometry,index,x,z,rotation,options){
  const matrix=groundPropMatrix(geometry,index,x,z,rotation,options);if(!matrix)return null;
  geometry.applyMatrix4(matrix);geometry.computeBoundingBox();return geometry;
}

export async function loadNearCapture(world){
  const root='/xianxia/surface/',[resources,response]=await Promise.all([loadPhotographicGround(world.renderer,{walls:true}),fetch(root+'capture.bin')]);
  if(!response.ok)throw new Error('Captured near ground unavailable');
  const geometry=gradeCaptureApproach(captureGeometry(await response.arrayBuffer()));
  const uniforms={patchOrigin:{value:CAPTURE_SHIFT.clone()},captureWorldToLocal:{value:new THREE.Matrix4()},captureNormalToWorld:{value:new THREE.Matrix3()},forceMaterial:{value:-1},stochastic:{value:true},microMeters:{value:new THREE.Vector2(.25,.225)},groundMean:{value:new THREE.Vector3(...resources.manifest.groundMean)},wallMean:{value:new THREE.Vector3(...resources.manifest.wallMean)},groundRegion:{value:new THREE.Vector4(0,0,1,1.7)},groundMixWidth:{value:.05}};
  const updateFrame=()=>{uniforms.captureWorldToLocal.value.copy(world.root.matrixWorld).invert();uniforms.captureNormalToWorld.value.getNormalMatrix(world.root.matrixWorld);};
  for(const [key,value]of Object.entries(resources.textures))uniforms[key]={value};
  const material=addPhotographicCapture(new THREE.MeshStandardMaterial({side:THREE.DoubleSide,roughness:1,envMapIntensity:.22}),uniforms);
  const mesh=new THREE.Mesh(geometry,material);mesh.name='coastal-cliff-04-native-capture';mesh.receiveShadow=true;mesh.castShadow=true;mesh.onBeforeRender=updateFrame;world.root.add(mesh);
  world.ground=mesh;world.foreground=mesh;world.surfaceMeshes=[mesh];world.terrainIndex=createFloorIndex([geometry],2);world.photographicGround=resources;
  const physical=[geometry];world.propMeshes=[];world.propSupport=[];
  const loader=new GLTFLoader();
  const files=['boulders','stone_01','rock_07','fern'];
  const sources=await Promise.all(files.map(async file=>{
    const {scene}=await loader.loadAsync(root+file+'.glb'),parts=[];scene.updateMatrixWorld(true);
    scene.traverse(child=>{
      if(!child.isMesh)return;
      const geo=ensureSurfaceNormals(child.geometry.clone().applyMatrix4(child.matrixWorld));geo.computeBoundingBox();
      const center=geo.boundingBox.getCenter(new THREE.Vector3());geo.translate(-center.x,-geo.boundingBox.min.y,-center.z);
      parts.push({geometry:geo,material:child.material});
    });return parts;
  }));
  const rockMaterial=addPhotographicCapture(material.clone(),{...uniforms,forceMaterial:{value:0}});
  function place(template,x,z,rotation,rock=true){
    const geo=groundProp(template.geometry.clone(),world.terrainIndex,x+CAPTURE_SHIFT.x,z+CAPTURE_SHIFT.z,rotation,{sink:rock?.04:.012});if(!geo)return;
    const prop=new THREE.Mesh(geo,rock?rockMaterial:template.material);prop.name=rock?'capture-grounded-rock':'capture-grounded-fern';prop.receiveShadow=true;prop.castShadow=true;prop.onBeforeRender=updateFrame;
    world.root.add(prop);world.propMeshes.push(prop);
    if(rock)physical.push(geo);
    world.propSupport.push({mesh:prop,scale:1});
  }
  place(sources[0][0],-36.5,-1.6,.7);place(sources[0][2],-31.15,-2.4,2.1);
  for(let i=0;i<26;i++){
    const x=-36.6+i*.22,z=-1.68+Math.sin(i*2.399)*.28;
    if(Math.hypot(x+34,z+2.043)<.45||Math.hypot(x+34,z+1.383)<.35)continue;
    place(sources[i%3?1:2][0],x,z,i*2.399);
  }
  [[-35.1,-1.55,1.1],[-34.2,-1.65,2.4],[-33.3,-1.6,.4],[-32.5,-1.8,3.7]].forEach(([x,z,ry],i)=>place(sources[3][i%sources[3].length],x,z,ry,false));
  world.foregroundIndex=world.terrainIndex;world.floorIndex=createFloorIndex(physical,2);world.floorIndex.meshes=[mesh,...world.propMeshes.filter(m=>m.name==='capture-grounded-rock')];
  if(world.renderHorizon){
    world.panorama=await world.textureLoader.loadAsync('/xianxia/textures/huangshan.webp');world.panorama.colorSpace=THREE.SRGBColorSpace;
    world.makeHorizon();world.horizon.position.set(104,-110,-115.2);
  }
  world.onProgress(1);
  return world;
}
