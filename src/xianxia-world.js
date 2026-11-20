import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIL,CAVE,BRANCH,LOCATIONS,sampleMountain,sampleRoute,caveAmount } from './xianxia-route.js';
import { measuredTerrainHeight,measuredTerrainGeometry,TERRAIN_SOURCE } from './xianxia-terrain.js';

const clamp=THREE.MathUtils.clamp;
const seeded=(seed)=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
const asset=p=>`/xianxia/${p}`;

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

export function createFloorIndex(geometries){
  const cells=new Map(),size=12;
  for(const geometry of geometries){
    const p=geometry.attributes.position,index=geometry.index,count=index?index.count:p.count;
    for(let i=0;i<count;i+=3){
      const tri=[0,1,2].map(j=>{const k=index?index.getX(i+j):i+j;return{x:p.getX(k),y:p.getY(k),z:p.getZ(k)};});
      for(let x=Math.floor(Math.min(...tri.map(v=>v.x))/size);x<=Math.floor(Math.max(...tri.map(v=>v.x))/size);x++)for(let z=Math.floor(Math.min(...tri.map(v=>v.z))/size);z<=Math.floor(Math.max(...tri.map(v=>v.z))/size);z++){
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(tri);
      }
    }
  }
  return{heightAt(x,z){
    let height=-Infinity;
    for(const[a,b,c]of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)??[]){
      const denominator=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(denominator)<1e-9)continue;
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/denominator,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/denominator;
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1+1e-5)height=Math.max(height,a.y*u+b.y*v+c.y*(1-u-v));
    }
    return Number.isFinite(height)?height:null;
  }};
}


export class XianxiaWorld {
  constructor(scene,{offset=new THREE.Vector3(),quality='high',onProgress=()=>{}}={}) {
    this.scene=scene;this.offset=offset;this.quality=quality;this.onProgress=onProgress;
    this.root=new THREE.Group();this.root.name='青岚境';this.root.position.copy(offset);scene.add(this.root);
    this.sectors=[];this.colliders=[];this.loader=new GLTFLoader();this.textureLoader=new THREE.TextureLoader();
  }
  async load() {
    const files=['cave-scan','cave-mouth-scan'];
    let loaded=0;
    const models=await Promise.all(files.map(async name=>{const data=await this.loader.loadAsync(asset(`models/${name}.glb`));this.onProgress(++loaded/14);return data.scene;}));
    this.models=Object.fromEntries(files.map((f,i)=>[f,models[i]]));
    const boulders=await this.loader.loadAsync(asset('models/moss-boulders.glb'));
    this.boulders=boulders.scene.children.map(source=>{
      source.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(source),center=box.getCenter(new THREE.Vector3()),group=new THREE.Group();
      source.traverse(child=>{if(child.isMesh){const geometry=child.geometry.clone().applyMatrix4(child.matrixWorld);geometry.translate(-center.x,-box.min.y,-center.z);group.add(new THREE.Mesh(geometry,child.material));}});
      group.userData.size=box.getSize(new THREE.Vector3());return group;
    });
    const textures=await Promise.all(['rocky_trail-diff.jpg','rocky_trail-nor_gl.jpg','rocky_trail-disp.png','huangshan.webp','pine-0.png','pine-1.png','pine-2.png','cave-diff.jpg','cave-normal.jpg','cave-disp.png','cave-rough.jpg'].map(async name=>{
      const t=await this.textureLoader.loadAsync(asset(`textures/${name}`));this.onProgress(Math.min(1,++loaded/14));return t;
    }));
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
    this.makeGround();this.makeHorizon();this.makeScenery();this.makeCave();this.makeLandmarks();this.onProgress(1);
    return this;
  }
  capturedDisplacement(x,z) {
    if(!this.heightPixels)return 0;
    const {data,width,height}=this.heightPixels;
    const ix=((Math.floor(x*12)%width)+width)%width,iz=((Math.floor(z*12)%height)+height)%height;
    return (data[(iz*width+ix)*4]/255-.5)*.2;
  }
  vertexHeight(x,z) {return z<=0?measuredTerrainHeight(x,z):sampleMountain(x,z).height+this.capturedDisplacement(x,z);}
  sourceHeight(x,z) {
    if(z<=0)return measuredTerrainHeight(x,z);
    const step=2,x0=Math.floor(x/step)*step,z0=Math.floor(z/step)*step,u=(x-x0)/step,v=(z-z0)/step;
    const a=this.vertexHeight(x0,z0),b=this.vertexHeight(x0+step,z0),c=this.vertexHeight(x0,z0+step),d=this.vertexHeight(x0+step,z0+step);
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  }
  groundHeight(x,z){return (z>0&&z<132?this.caveFloorIndex?.heightAt(x,z):this.floorIndex?.heightAt(x,z))??this.sourceHeight(x,z);}
  canWalkCave(x,z){return z<=1||z>=131?sampleRoute(CAVE,x,z).distance<6:this.caveFloorIndex?.heightAt(x,z)!=null;}
  caveDarkness(x,z){return this.caveFloorIndex&&!this.canWalkCave(x,z)?0:caveAmount(x,z,this.caveBounds?Math.max(Math.abs(this.caveBounds.min.x),Math.abs(this.caveBounds.max.x))+1:12);}
  supportHeight(x,z){
    return measuredTerrainHeight(x,z);
  }
  makeGround() {
    const material=new THREE.MeshStandardMaterial({map:this.diffuse,normalMap:this.normal,normalScale:new THREE.Vector2(.7,.7),roughness:.96,color:0xc5c4ac});
    this.ground=new THREE.Mesh(mergeGeometries([TRAIL,BRANCH].map(route=>routeRibbonGeometry(route,(x,z)=>this.sourceHeight(x,z)+.04,p=>p.width+.4,1.5,[-1,-.75,-.5,-.25,0,.25,.5,.75,1]))),material);this.ground.name='实拍位移山径';this.root.add(this.ground);
    const detailNormal=this.caveNormal.clone();detailNormal.repeat.set(TERRAIN_SOURCE.satellite.size*.17,TERRAIN_SOURCE.satellite.size*.17);
    const terrainMaterial=new THREE.MeshStandardMaterial({map:this.satellite,normalMap:detailNormal,normalScale:new THREE.Vector2(.6,.6),roughness:1});
    terrainMaterial.onBeforeCompile=shader=>{
      shader.uniforms.terrainDetail={value:this.caveDiffuse};
      shader.vertexShader='varying vec2 vTerrainMeters; varying float vTerrainSlope; varying float vTerrainDistance;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTerrainMeters=position.xz; vTerrainSlope=1.-abs(normal.y); vTerrainDistance=length((modelViewMatrix*vec4(position,1.)).xyz);');
      shader.fragmentShader='uniform sampler2D terrainDetail; varying vec2 vTerrainMeters; varying float vTerrainSlope; varying float vTerrainDistance;\n'+shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nvec3 stone=texture2D(terrainDetail,vTerrainMeters*.17).rgb; float nearDetail=1.-smoothstep(50.,180.,vTerrainDistance); diffuseColor.rgb=mix(diffuseColor.rgb,stone,nearDetail*(.18+.6*smoothstep(.12,.5,vTerrainSlope)));');
    };
    this.support=new THREE.Mesh(measuredTerrainGeometry((x,z)=>z>0&&sampleRoute(CAVE,x,z).distance<sampleRoute(CAVE,x,z).width+4),terrainMaterial);
    this.support.name='Huangshan surveyed SRTM relief';this.root.add(this.support);
    this.supportIndex={heightAt:measuredTerrainHeight};
    this.floorIndex=createFloorIndex([this.ground.geometry]);
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
    g.add(this.models['cave-scan'].clone(true),this.models['cave-mouth-scan'].clone(true));
    const exit=this.models['cave-mouth-scan'].clone(true);exit.rotation.y=Math.PI;exit.position.set(0,7,132);g.add(exit);
    this.root.updateMatrixWorld(true);
    const inverse=new THREE.Matrix4().copy(this.root.matrixWorld).invert(),floors=[];
    g.traverse(child=>{
      if(!child.isMesh)return;
      const geometry=child.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,child.matrixWorld)),p=geometry.attributes.position,index=geometry.index,positions=[];
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
      for(let i=0;i<(index?.count??p.count);i+=3){
        a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
        normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
        const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3,y=(a.y+b.y+c.y)/3;
        if(normal.y>.3&&z>=0&&z<=132&&y<sampleRoute(CAVE,x,z).height+3)positions.push(...a.toArray(),...b.toArray(),...c.toArray());
      }
      if(positions.length){const floor=new THREE.BufferGeometry();floor.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));floors.push(floor);}
      geometry.dispose();
    });
    this.caveFloorIndex=createFloorIndex(floors);for(const floor of floors)floor.dispose();
    this.caveBounds=new THREE.Box3().setFromObject(g).translate(this.root.position.clone().negate());
    this.caveLights=[];
    for(const z of [18,48,78,110]){
      const p=sampleRoute(CAVE,0,z),light=new THREE.PointLight(0xa4b6a5,25,35,1.4);light.position.set(p.x,p.height+3.8,z);g.add(light);this.caveLights.push(light);
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
    const x=position.x-this.offset.x,z=position.z-this.offset.z;
    this.horizon.position.set(x,this.groundHeight(x,z)-110,z);
    this.cave.visible=z>-100&&z<180;
    for(const {group,center}of this.sectors)group.visible=Math.hypot(x-center.x,z-center.y)<(this.quality==='low'?165:230);
    const dark=this.caveDarkness(x,z);this.horizon.material.color.setRGB(1-dark*.98,1-dark*.98,1-dark*.98);
    this.horizon.visible=dark<.999;
    return {cave:dark,height:this.groundHeight(x,z)};
  }
}
