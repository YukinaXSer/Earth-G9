import * as THREE from 'three';
import {foregroundHeight,blendedTerrainHeight} from './xianxia-foreground.js';
import caveCaptures from './xianxia-cave-captures.json' with {type:'json'};
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIL,CAVE,CAVE_LENGTH,BRANCH,LOCATIONS,sampleMountain,sampleRoute,caveAmount } from './xianxia-route.js';
import { measuredTerrainGeometry,TERRAIN_SOURCE } from './xianxia-terrain.js';
import {loadPhotographicGround,addPhotographicGround,ensureSurfaceNormals} from './xianxia-surface.js';

const clamp=THREE.MathUtils.clamp;
const seeded=(seed)=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
const asset=p=>`/xianxia/${p}`;

export function addCapturedRockDetail(material,color,height){
  material.onBeforeCompile=shader=>{
    shader.uniforms.captureRockColor={value:color};shader.uniforms.captureRockHeight={value:height};
    shader.vertexShader='varying vec3 vCapturePoint; varying vec3 vCaptureNormal;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCapturePoint=position; vCaptureNormal=normal;');
    shader.fragmentShader=`uniform sampler2D captureRockColor;
uniform sampler2D captureRockHeight;
varying vec3 vCapturePoint; varying vec3 vCaptureNormal;
`+shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 captureWeights=pow(abs(vCaptureNormal),vec3(4.));
      float captureWeightSum=dot(captureWeights,vec3(1.));
      captureWeights=captureWeightSum>.000001?captureWeights/captureWeightSum:vec3(0.,1.,0.);
      vec3 capturePoint=vCapturePoint*.5;
      vec3 captureGrain=texture2D(captureRockColor,capturePoint.yz).rgb*captureWeights.x
        +texture2D(captureRockColor,capturePoint.xz).rgb*captureWeights.y
        +texture2D(captureRockColor,capturePoint.xy).rgb*captureWeights.z;
      float captureNativeLuminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      float captureGreen=(diffuseColor.g-max(diffuseColor.r,diffuseColor.b))/max(.03,captureNativeLuminance);
      float captureDetail=1.-smoothstep(.1,.4,captureGreen);
      float captureOcclusion=mix(.45,1.,smoothstep(.015,.12,captureNativeLuminance));
      float captureWall=1.-smoothstep(.6,.9,vCaptureNormal.y);
      diffuseColor.rgb=mix(diffuseColor.rgb,captureGrain*captureOcclusion,captureDetail*captureWall);
      float captureGround=smoothstep(.3,.6,vCaptureNormal.y)*(1.-smoothstep(.4,.7,vCapturePoint.y));
      diffuseColor.a*=mix(1.,smoothstep(0.,1.5,-vCapturePoint.z),captureGround);
      float captureHeight=(texture2D(captureRockHeight,capturePoint.yz).r*captureWeights.x
        +texture2D(captureRockHeight,capturePoint.xz).r*captureWeights.y
        +texture2D(captureRockHeight,capturePoint.xy).r*captureWeights.z)*.035*captureDetail;
`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 captureDx=dFdx(-vViewPosition),captureDy=dFdy(-vViewPosition);
      vec3 captureR1=cross(captureDy,normal),captureR2=cross(normal,captureDx);
      float captureDet=dot(captureDx,captureR1)*faceDirection;
      vec3 captureGradient=sign(captureDet)*(dFdx(captureHeight)*captureR1+dFdy(captureHeight)*captureR2);
      normal=normalize(abs(captureDet)*normal-captureGradient);
`);
  };
  material.transparent=true;material.alphaTest=.01;
  material.customProgramCacheKey=()=> 'captured-rock-photographic-detail-v1';material.needsUpdate=true;
}

export function photographicHorizonGeometry(){
  const geometry=new THREE.SphereGeometry(2000,96,48),uv=geometry.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setY(i,(uv.getY(i)-.5)*4.3+.64);
  return geometry;
}

export function routeRibbonGeometry(route,height,width=p=>p.width+1.6,step=1.5,cross=[-1,0,1]){
  const rows=[],positions=[],uv=[],indices=[];
  for(let i=0;i<route.length-1;i++){
    const a=route[i],b=route[i+1],steps=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/step);
    for(let j=0;j<steps;j++){const t=j/steps;rows.push({x:a[0]+(b[0]-a[0])*t,z:a[2]+(b[2]-a[2])*t,width:a[3]+(b[3]-a[3])*t});}
  }
  const last=route.at(-1);rows.push({x:last[0],z:last[2],width:last[3]});
  rows.forEach((row,i)=>{
    const a=rows[Math.max(0,i-1)],b=rows[Math.min(rows.length-1,i+1)],length=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
    const before=Math.hypot(row.x-a.x,row.z-a.z)||1,after=Math.hypot(b.x-row.x,b.z-row.z)||1;
    const miter=1/Math.max(.35,Math.min(Math.abs((-nx*(row.z-a.z)+nz*(row.x-a.x))/before)||1,Math.abs((-nx*(b.z-row.z)+nz*(b.x-row.x))/after)||1));
    for(let j=0;j<cross.length;j++){
      const x=row.x+nx*cross[j]*width(row)*miter,z=row.z+nz*cross[j]*width(row)*miter;
      positions.push(x,height(x,z),z);uv.push(x,z);
      if(i<rows.length-1&&j<cross.length-1){const p=i*cross.length+j,q=p+cross.length;indices.push(p,p+1,q,p+1,q+1,q);}
    }
  });
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function createFloorIndex(geometries,size=12){
  const cells=new Map(),count=geometries.reduce((sum,g)=>sum+(g.index?.count??g.attributes.position.count)/3,0),positions=new Float32Array(count*9),barycentric=new Float64Array(count*6);
  let triangle=0;
  for(const geometry of geometries){
    const p=geometry.attributes.position,index=geometry.index,count=index?index.count:p.count;
    for(let i=0;i<count;i+=3){
      const start=triangle*9;
      for(let j=0;j<3;j++){const k=index?index.getX(i+j):i+j;positions[start+j*3]=p.getX(k);positions[start+j*3+1]=p.getY(k);positions[start+j*3+2]=p.getZ(k);}
      const ax=positions[start],az=positions[start+2],bx=positions[start+3],bz=positions[start+5],cx=positions[start+6],cz=positions[start+8];
      const denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),b=triangle*6;
      if(Math.abs(denominator)>=1e-9){
        barycentric[b]=(bz-cz)/denominator;barycentric[b+1]=(cx-bx)/denominator;barycentric[b+2]=-(barycentric[b]*cx+barycentric[b+1]*cz);
        barycentric[b+3]=(cz-az)/denominator;barycentric[b+4]=(ax-cx)/denominator;barycentric[b+5]=-(barycentric[b+3]*cx+barycentric[b+4]*cz);
      }else barycentric[b]=NaN;
      for(let x=Math.floor(Math.min(ax,bx,cx)/size);x<=Math.floor(Math.max(ax,bx,cx)/size);x++)for(let z=Math.floor(Math.min(az,bz,cz)/size);z<=Math.floor(Math.max(az,bz,cz)/size);z++){
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(triangle);
      }
      triangle++;
    }
  }
  for(const[key,ids]of cells)cells.set(key,new Uint32Array(ids));
  const clip=(polygon,height,above)=>polygon.flatMap((a,i)=>{
    const b=polygon[(i+1)%polygon.length],inside=above?a.y>=height:a.y<=height,next=above?b.y>=height:b.y<=height,out=inside?[a]:[];
    if(inside!==next){const t=(height-a.y)/(b.y-a.y);out.push({x:a.x+(b.x-a.x)*t,y:height,z:a.z+(b.z-a.z)*t});}return out;
  });
  const index={geometries,heightAt(x,z){
    let height=-Infinity;
    for(const id of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)??[]){
      const b=id*6,u=barycentric[b]*x+barycentric[b+1]*z+barycentric[b+2],v=barycentric[b+3]*x+barycentric[b+4]*z+barycentric[b+5];
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1+1e-5){const p=id*9;height=Math.max(height,positions[p+1]*u+positions[p+4]*v+positions[p+7]*(1-u-v));}
    }
    return Number.isFinite(height)?height:null;
  },canMove(fromX,fromZ,x,z,radius=.35,heightAt=index.heightAt){
    const floor=heightAt(x,z),previous=heightAt(fromX,fromZ);
    if(floor==null||previous==null||floor-previous>.35||previous-floor>.65)return false;
    for(const[dx,dz]of[[radius,0],[-radius,0],[0,radius],[0,-radius]]){
      const support=heightAt(x+dx,z+dz);if(support==null||Math.abs(support-floor)>.45)return false;
    }
    const candidates=new Set();
    for(let ix=Math.floor((x-radius)/size);ix<=Math.floor((x+radius)/size);ix++)for(let iz=Math.floor((z-radius)/size);iz<=Math.floor((z+radius)/size);iz++)for(const tri of cells.get(`${ix},${iz}`)??[])candidates.add(tri);
    for(const id of candidates){
      const p=id*9,ay=positions[p+1],by=positions[p+4],cy=positions[p+7];
      if(Math.max(ay,by,cy)<floor+.35||Math.min(ay,by,cy)>floor+1.85)continue;
      const tri=[{x:positions[p],y:ay,z:positions[p+2]},{x:positions[p+3],y:by,z:positions[p+5]},{x:positions[p+6],y:cy,z:positions[p+8]}];
      const polygon=clip(clip(tri,floor+.35,true),floor+1.85,false);if(!polygon.length)continue;
      let winding=false;
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz;
        const t=len?clamp(((x-a.x)*dx+(z-a.z)*dz)/len,0,1):0;
        if((x-a.x-dx*t)**2+(z-a.z-dz*t)**2<radius*radius)return false;
        if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)winding=!winding;
      }
      if(winding)return false;
    }
    return true;
  }};return index;
}


export class XianxiaWorld {
  constructor(scene,{offset=new THREE.Vector3(),quality='high',renderer,nearOnly=false,renderHorizon=true,onProgress=()=>{}}={}) {
    this.nearOnly=nearOnly;this.renderHorizon=renderHorizon;
    this.scene=scene;this.offset=offset;this.quality=quality;this.renderer=renderer;this.onProgress=onProgress;
    this.root=new THREE.Group();this.root.name='青岚境';this.root.position.copy(offset);scene.add(this.root);
    this.sectors=[];this.colliders=[];this.loader=new GLTFLoader();this.textureLoader=new THREE.TextureLoader();
  }
  async load() {
    if(this.nearOnly){
      const {loadMountainField}=await import('./xianxia-mountain-field.js');
      await loadMountainField(this);
      if(this.renderHorizon)this.loadHorizon();
      return this;
    }
    this.photographicGround=await loadPhotographicGround(this.renderer);
    const files=['cave-scan','terrain-scan'];
    let loaded=0;
    const models=await Promise.all(files.map(async name=>{const data=await this.loader.loadAsync(asset(`models/${name}.glb`));this.onProgress(++loaded/15);return data.scene;}));
    this.models=Object.fromEntries(files.map((f,i)=>[f,models[i]]));
    for(const model of models)model.traverse(child=>{for(const material of Array.isArray(child.material)?child.material:[child.material])if(material?.map){material.map.anisotropy=8;material.map.needsUpdate=true;}});
    const boulders=await this.loader.loadAsync(asset('models/moss-boulders.glb'));
    this.boulders=boulders.scene.children.map(source=>{
      source.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(source),center=box.getCenter(new THREE.Vector3()),group=new THREE.Group();
      source.traverse(child=>{if(child.isMesh){const geometry=child.geometry.clone().applyMatrix4(child.matrixWorld);geometry.translate(-center.x,-box.min.y,-center.z);group.add(new THREE.Mesh(geometry,child.material));}});
      group.userData.size=box.getSize(new THREE.Vector3());return group;
    });
    const textures=await Promise.all(['rocky_trail-diff.jpg','rocky_trail-nor_gl.jpg','rocky_trail-disp.png','huangshan.webp','pine-0.png','pine-1.png','pine-2.png','cave-diff.jpg','cave-normal.jpg','cave-disp.png','cave-rough.jpg','cave-detail-color.webp','cave-detail-height.webp'].map(async name=>{
      const t=await this.textureLoader.loadAsync(asset(`textures/${name}`));this.onProgress(Math.min(1,++loaded/15));return t;
    }));
    this.caveDetailColor=textures[11];this.caveDetailHeight=textures[12];this.caveDetailColor.colorSpace=THREE.SRGBColorSpace;
    for(const texture of [this.caveDetailColor,this.caveDetailHeight]){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;}
    this.diffuse=textures[0];this.normal=textures[1];this.panorama=textures[3];
    this.pinePhotos=textures.slice(4,7);for(const photo of this.pinePhotos)photo.colorSpace=THREE.SRGBColorSpace;
    this.caveDiffuse=textures[7];this.caveNormal=textures[8];this.caveRough=textures[10];this.caveDiffuse.colorSpace=THREE.SRGBColorSpace;
    for(const texture of [this.caveDiffuse,this.caveNormal,this.caveRough]){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;}
    const caveImage=textures[9].image,caveCanvas=document.createElement('canvas');caveCanvas.width=caveImage.width;caveCanvas.height=caveImage.height;
    const caveContext=caveCanvas.getContext('2d',{willReadFrequently:true});caveContext.drawImage(caveImage,0,0);this.cavePixels=caveContext.getImageData(0,0,caveImage.width,caveImage.height);textures[9].dispose();
    this.treeDimensions=await (await fetch(asset('tree-dimensions.json'))).json();
    this.diffuse.colorSpace=THREE.SRGBColorSpace;this.panorama.colorSpace=THREE.SRGBColorSpace;
    for(const t of [this.diffuse,this.normal]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(.17,.17);t.anisotropy=4;}
    const img=textures[2].image,canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);this.heightPixels=ctx.getImageData(0,0,img.width,img.height);textures[2].dispose();
    this.satellite=await this.textureLoader.loadAsync(asset('textures/huangshan-satellite.webp'));this.satellite.colorSpace=THREE.SRGBColorSpace;this.satellite.anisotropy=4;
    this.makeCapturedTerrain();this.makeGround();this.makeHorizon();this.makeScenery();this.makeCave();this.makeLandmarks();this.onProgress(1);
    return this;
  }
  capturedDisplacement(x,z) {
    if(!this.heightPixels)return 0;
    const {data,width,height}=this.heightPixels;
    const ix=((Math.floor(x*12)%width)+width)%width,iz=((Math.floor(z*12)%height)+height)%height;
    return (data[(iz*width+ix)*4]/255-.5)*.2;
  }
  vertexHeight(x,z) {return z<=0?this.terrainHeight(x,z):sampleMountain(x,z).height+this.capturedDisplacement(x,z);}
  sourceHeight(x,z) {
    if(z<=0)return this.terrainHeight(x,z);
    const step=2,x0=Math.floor(x/step)*step,z0=Math.floor(z/step)*step,u=(x-x0)/step,v=(z-z0)/step;
    const a=this.vertexHeight(x0,z0),b=this.vertexHeight(x0+step,z0),c=this.vertexHeight(x0,z0+step),d=this.vertexHeight(x0+step,z0+step);
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  }
  caveFootHeight(x,z){
    const index=this.caveFloorIndex,height=index?.heightAt(x,z);if(height!=null)return height;
    for(const radius of [.1,.25])for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,support=index?.heightAt(x+Math.cos(angle)*radius,z+Math.sin(angle)*radius);
      if(support!=null)return support;
    }
    return null;
  }
  groundHeight(x,z){if(this.nearOnly)return this.floorIndex?.heightAt(x,z)??null;return (z>0&&z<CAVE_LENGTH?this.caveFootHeight(x,z):this.floorIndex?.heightAt(x,z))??this.sourceHeight(x,z);}
  canWalkGround(x,z,fromX=x,fromZ=z){return this.floorIndex?.canMove(fromX,fromZ,x,z)??false;}
  canWalkCave(x,z){
    if(z<=1||z>=CAVE_LENGTH-1)return sampleRoute(CAVE,x,z).distance<6;
    const floor=this.caveFootHeight(x,z),roof=this.caveCeilingIndex?.heightAt(x,z);
    return floor!=null&&(roof==null||-roof-floor>=2);
  }
  caveDarkness(x,z){return this.caveFloorIndex&&!this.canWalkCave(x,z)?0:caveAmount(x,z,this.caveBounds?Math.max(Math.abs(this.caveBounds.min.x),Math.abs(this.caveBounds.max.x))+1:12);}
  terrainHeight(x,z){return this.foregroundIndex?.heightAt(x,z)??blendedTerrainHeight(x,z);}
  supportHeight(x,z){return this.terrainHeight(x,z);}
  makeCapturedTerrain(){
    const group=this.models['terrain-scan'].clone(true);this.root.add(group);this.root.updateMatrixWorld(true);
    const inverse=new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.foreground=new THREE.Group();this.foreground.name='captured-ground-surface';this.root.add(this.foreground);this.surfaceMeshes=[];
    group.traverse(child=>{
      if(!child.isMesh)return;
      const geometry=ensureSurfaceNormals(child.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,child.matrixWorld)));
      const materials=(Array.isArray(child.material)?child.material:[child.material]).map(m=>addPhotographicGround(m.clone(),this.photographicGround));
      const mesh=new THREE.Mesh(geometry,Array.isArray(child.material)?materials:materials[0]);mesh.receiveShadow=true;
      this.foreground.add(mesh);this.surfaceMeshes.push(mesh);
    });
    this.root.remove(group);
    this.foregroundIndex=createFloorIndex(this.surfaceMeshes.map(m=>m.geometry),6);this.foregroundIndex.meshes=this.surfaceMeshes;
  }
  makeGround() {
    this.ground=this.foreground;
    const detailNormal=this.caveNormal.clone();detailNormal.repeat.set(TERRAIN_SOURCE.satellite.size*.17,TERRAIN_SOURCE.satellite.size*.17);
    const terrainMaterial=new THREE.MeshStandardMaterial({map:this.satellite,normalMap:detailNormal,normalScale:new THREE.Vector2(.6,.6),roughness:1});
    terrainMaterial.onBeforeCompile=shader=>{
      shader.uniforms.terrainDetail={value:this.caveDiffuse};
      shader.vertexShader='varying vec2 vTerrainMeters; varying float vTerrainSlope; varying float vTerrainDistance;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTerrainMeters=position.xz; vTerrainSlope=1.-abs(normal.y); vTerrainDistance=length((modelViewMatrix*vec4(position,1.)).xyz);');
      shader.fragmentShader='uniform sampler2D terrainDetail; varying vec2 vTerrainMeters; varying float vTerrainSlope; varying float vTerrainDistance;\n'+shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nvec3 stone=texture2D(terrainDetail,vTerrainMeters*.17).rgb; float nearDetail=1.-smoothstep(50.,180.,vTerrainDistance); diffuseColor.rgb=mix(diffuseColor.rgb,stone,nearDetail*(.18+.6*smoothstep(.12,.5,vTerrainSlope)));');
    };
    this.support=new THREE.Mesh(measuredTerrainGeometry((x,z)=>z>0&&z<CAVE_LENGTH+12&&Math.abs(x)<40||z<=0&&(foregroundHeight(x,z)!=null||Math.min(sampleRoute(TRAIL,x,z).distance,sampleRoute(BRANCH,x,z).distance)<50),blendedTerrainHeight),terrainMaterial);
    this.support.name='Huangshan surveyed SRTM relief';this.root.add(this.support);
    this.supportIndex={heightAt:(x,z)=>this.terrainHeight(x,z)};
    this.floorIndex=this.foregroundIndex;
  }
  loadHorizon(){
    this.horizonLoading??=import('./xianxia-mountain-horizon.js').then(async({loadMountainHorizon})=>{
      this.horizon=await loadMountainHorizon({world:this,group:this.root});return this.horizon;
    });
    this.horizonLoading.catch(error=>{this.horizonError=error;});
    return this.horizonLoading;
  }
  makeHorizon() {
    this.panorama.wrapS=THREE.MirroredRepeatWrapping;this.panorama.repeat.x=2;
    const material=new THREE.MeshBasicMaterial({map:this.panorama,side:THREE.BackSide,fog:false,toneMapped:false,depthWrite:false});
    material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.69,.75,.71)*diffuse,smoothstep(.88,1.,vMapUv.y));');};
    this.horizon=new THREE.Mesh(photographicHorizonGeometry(),material);this.horizon.renderOrder=-1;this.horizon.rotation.y=-Math.PI*.35;this.root.add(this.horizon);
  }
  batches(template,placements,parent) {
    template.updateMatrixWorld(true);
    template.traverse(child=>{
      if(!child.isMesh)return;
      const mesh=new THREE.InstancedMesh(child.geometry,child.material,placements.length),matrix=new THREE.Matrix4();
      const dummy=new THREE.Object3D();dummy.rotation.order='YXZ';
      placements.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.rx??0,p.ry??0,p.rz??0);dummy.scale.set(p.sx??p.s,p.sy??p.s,p.sz??p.s);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,child.matrixWorld);mesh.setMatrixAt(i,matrix);});
      mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh);
    });
  }
  makeScenery() {
    const random=seeded(74631),groups=new Map();
    const record=(model,p)=>{const key=`${Math.floor(p.x/100)},${Math.floor(p.z/100)}`;if(!groups.has(key))groups.set(key,{});const g=groups.get(key);(g[model]??=[]).push(p);};
    const addRoute=(route,branch=false)=>{
      for(let i=0;i<route.length-1;i++) {
        const a=route[i],b=route[i+1],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
        for(let dist=0;dist<length;dist+=this.quality==='low'?16:11) {
          const t=dist/length,cx=a[0]+dx*t,cz=a[2]+dz*t,w=a[3]+(b[3]-a[3])*t,cy=this.groundHeight(cx,cz);
          for(const side of [-1,1]) {
            const off=w+(side<0?10:4),x=cx+nx*off*side,z=cz+nz*off*side;
            if(random()<.85)record('pine',{x,y:(this.supportIndex.heightAt(x,z)??this.supportHeight(x,z))-.1,z,s:.8+random()*.4,ry:random()*Math.PI*2});
          }
          if(random()<.55){
            const x=cx+nx*(w+2.5),z=cz+nz*(w+2.5),variant=Math.floor(random()*this.boulders.length),s=.7+random()*.5,size=this.boulders[variant].userData.size,r=Math.max(size.x,size.z)*s/2;
            const y=Math.min(...[-r,0,r].flatMap(dx=>[-r,0,r].map(dz=>this.supportHeight(x+dx,z+dz))))-.25;
            record(`boulder-${variant}`,{x,y,z,s,ry:random()*Math.PI*2});
          }
        }
      }
    };
    addRoute(TRAIL);addRoute(BRANCH,true);
    const trees=this.pinePhotos.map((photo,i)=>{
      const {width,height}=this.treeDimensions[i],geometry=new THREE.PlaneGeometry(width,height);geometry.translate(0,height/2,0);
      const material=new THREE.MeshBasicMaterial({map:photo,alphaTest:.005,transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:true,toneMapped:false});
      material.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`vec4 center = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.);
        vec2 imageScale = vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
        vec4 mvPosition = vec4(center.xyz + vec3(position.xy * imageScale,0.),1.);
        gl_Position = projectionMatrix * mvPosition;`);};
      return new THREE.Mesh(geometry,material);
    });
    for(const [key,types]of groups) {
      const g=new THREE.Group();g.name=`山径景片 ${key}`;
      for(const [name,points]of Object.entries(types)) {
        if(name==='pine'){trees.forEach((tree,i)=>this.batches(tree,points.filter((_,j)=>j%trees.length===i),g));}
        else this.batches(this.boulders[Number(name.split('-')[1])],points,g);
      }
      const [x,z]=key.split(',').map(Number);this.sectors.push({group:g,center:new THREE.Vector2(x*100+50,z*100+50)});this.root.add(g);
    }
    // The distant relief retains the photographed silhouettes rather than generated peaks.
    this.root.userData.source='François Philipp, Environment of huangshan, CC BY 2.0; Poly Haven CC0 scans';
  }
  makeCave() {
    const g=new THREE.Group();g.name='两界洞 · 连续步行通道';this.root.add(g);
    this.models['cave-scan'].traverse(child=>{
      if(!child.isMesh)return;
      if(!child.geometry.attributes.normal)child.geometry.computeVertexNormals();
      for(const material of Array.isArray(child.material)?child.material:[child.material]){material.flatShading=false;addCapturedRockDetail(material,this.caveDetailColor,this.caveDetailHeight);}
    });
    for(const side of ['forest','mountain']){
      const capture=this.models['cave-scan'].clone(true);capture.applyMatrix4(new THREE.Matrix4().fromArray(caveCaptures[side].matrix));g.add(capture);
    }
    this.root.updateMatrixWorld(true);
    const inverse=new THREE.Matrix4().copy(this.root.matrixWorld).invert(),floors=[],ceilings=[],surfaces=[];
    const reference=Array.from({length:Math.ceil(CAVE_LENGTH/.025)+1},(_,i)=>sampleRoute(CAVE,0,i*.025).height);
    g.traverse(child=>{
      if(!child.isMesh)return;
      const geometry=child.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,child.matrixWorld)),p=geometry.attributes.position,index=geometry.index,positions=[],roofPositions=[],surfacePositions=[];
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
      for(let i=0;i<(index?.count??p.count);i+=3){
        a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
        normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
        const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3,y=(a.y+b.y+c.y)/3;
        const referenceHeight=reference[Math.max(0,Math.min(reference.length-1,Math.round(z/.025)))];
        if(normal.y>.3&&z>=0&&z<=CAVE_LENGTH&&y<referenceHeight+4)surfacePositions.push(...a.toArray(),...b.toArray(),...c.toArray());
        if(normal.y>.3&&z>=0&&z<=CAVE_LENGTH&&y<referenceHeight+.7)positions.push(...a.toArray(),...b.toArray(),...c.toArray());
        if(normal.y<-.3&&z>=0&&z<=CAVE_LENGTH&&y>referenceHeight+.5){for(const v of [a,b,c])roofPositions.push(v.x,-v.y,v.z);}
      }
      if(positions.length){const floor=new THREE.BufferGeometry();floor.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));floors.push(floor);}
      if(roofPositions.length){const roof=new THREE.BufferGeometry();roof.setAttribute('position',new THREE.Float32BufferAttribute(roofPositions,3));ceilings.push(roof);}
      if(surfacePositions.length){const surface=new THREE.BufferGeometry();surface.setAttribute('position',new THREE.Float32BufferAttribute(surfacePositions,3));surfaces.push(surface);}
      geometry.dispose();
    });
    this.caveFloorIndex=createFloorIndex(floors,1);for(const floor of floors)floor.dispose();
    this.caveCeilingIndex=createFloorIndex(ceilings,1);for(const roof of ceilings)roof.dispose();
    this.caveSurfaceIndex=createFloorIndex(surfaces,1);for(const surface of surfaces)surface.dispose();
    this.caveBounds=new THREE.Box3().setFromObject(g).translate(this.root.position.clone().negate());
    this.caveLights=[];
    for(const z of [.136,.364,.591,.833].map(t=>t*CAVE_LENGTH)){
      const p=sampleRoute(CAVE,0,z),light=new THREE.PointLight(0xa4b6a5,7,20,1.4);light.position.set(p.x,p.height+1.5,z);g.add(light);this.caveLights.push(light);
    }
    this.cave=g;
  }
  makeLandmarks() {
    const rock=this.boulders[0];
    for(const place of LOCATIONS.filter(p=>p.kind!=='passage')) {
      const [x,y,z]=place.point,floor=this.supportIndex.heightAt(x+7,z-4)??this.groundHeight(x+7,z-4),g=new THREE.Group();g.position.set(x+7,floor-.15,z-4);g.rotation.y=-.8;g.scale.setScalar(1.7);g.add(rock.clone());this.root.add(g);
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=1024;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#eadfb5';ctx.font='70px "Xianxia Serif","Rainforest Serif",serif';ctx.textAlign='center';place.name.split('').forEach((c,i)=>ctx.fillText(c,256,180+i*95));
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:true,transparent:true,opacity:.85}));sign.position.set(x+7,floor+2.2,z-3.7);sign.scale.set(2.2,4.4,1);this.root.add(sign);
    }
  }
  update(position,time=0) {
    if(this.nearOnly)return {cave:0,height:this.groundHeight(position.x-this.offset.x,position.z-this.offset.z)};
    const x=position.x-this.offset.x,z=position.z-this.offset.z;
    this.horizon.position.set(x,this.groundHeight(x,z)-110,z);
    this.cave.visible=z>-100&&z<180;
    for(const {group,center}of this.sectors)group.visible=Math.hypot(x-center.x,z-center.y)<(this.quality==='low'?165:230);
    const dark=this.caveDarkness(x,z);this.horizon.material.color.setRGB(1-dark*.98,1-dark*.98,1-dark*.98);
    this.horizon.visible=dark<.999;
    return {cave:dark,height:this.groundHeight(x,z)};
  }
}
