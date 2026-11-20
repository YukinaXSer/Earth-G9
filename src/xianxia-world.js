import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIL,CAVE,BRANCH,LOCATIONS,sampleMountain,sampleRoute,caveAmount } from './xianxia-route.js';

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

export function capturedCaveGeometry(displacement=()=>.5){
  const points=[new THREE.Vector3(0,7,-6),...CAVE.slice().reverse().map(p=>new THREE.Vector3(p[0],p[1],p[2])),new THREE.Vector3(0,0,140)];
  const curve=new THREE.CatmullRomCurve3(points),length=curve.getLength(),rows=Math.ceil(length/.7),columns=40,positions=[],uv=[],indices=[];
  for(let i=0;i<=rows;i++){
    const t=i/rows,p=curve.getPointAt(t),direction=curve.getTangentAt(t),horizontal=Math.hypot(direction.x,direction.z),nx=-direction.z/horizontal,nz=direction.x/horizontal,distance=t*length;
    for(let j=0;j<=columns;j++){
      const theta=j/columns*Math.PI,u=j/columns*3.1,v=distance/7;
      const relief=(displacement(u,v)-.5)*.8+(displacement(u*.23+3,v*.27)-.5)*1.1;
      const across=Math.cos(theta)*(6.7+relief),height=p.y-.6+Math.sin(theta)*(7.5+relief*.6);
      positions.push(p.x+nx*across,height,p.z+nz*across);uv.push(u,v);
      if(i<rows&&j<columns){const a=i*(columns+1)+j,b=a+columns+1;indices.push(a,b,a+1,a+1,b,b+1);}
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export class XianxiaWorld {
  constructor(scene,{offset=new THREE.Vector3(),quality='high',onProgress=()=>{}}={}) {
    this.scene=scene;this.offset=offset;this.quality=quality;this.onProgress=onProgress;
    this.root=new THREE.Group();this.root.name='青岚境';this.root.position.copy(offset);scene.add(this.root);
    this.sectors=[];this.colliders=[];this.loader=new GLTFLoader();this.textureLoader=new THREE.TextureLoader();
  }
  async load() {
    const files=['rock_face_01'];
    let loaded=0;
    const models=await Promise.all(files.map(async name=>{const data=await this.loader.loadAsync(asset(`models/${name}${this.quality==='low'?'-low':''}.glb`));this.onProgress(++loaded/14);return data.scene;}));
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
    this.makeGround();this.makeHorizon();this.makeScenery();this.makeCave();this.makeLandmarks();this.onProgress(1);
    return this;
  }
  capturedDisplacement(x,z) {
    if(!this.heightPixels)return 0;
    const {data,width,height}=this.heightPixels;
    const ix=((Math.floor(x*12)%width)+width)%width,iz=((Math.floor(z*12)%height)+height)%height;
    return (data[(iz*width+ix)*4]/255-.5)*.2;
  }
  vertexHeight(x,z) {return sampleMountain(x,z).height+this.capturedDisplacement(x,z);}
  sourceHeight(x,z) {
    const step=2,x0=Math.floor(x/step)*step,z0=Math.floor(z/step)*step,u=(x-x0)/step,v=(z-z0)/step;
    const a=this.vertexHeight(x0,z0),b=this.vertexHeight(x0+step,z0),c=this.vertexHeight(x0,z0+step),d=this.vertexHeight(x0+step,z0+step);
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  }
  groundHeight(x,z){return this.floorIndex?.heightAt(x,z)??this.sourceHeight(x,z);}
  supportHeight(x,z){
    const p=sampleMountain(x,z),a=p.route[p.index],b=p.route[p.index+1],length=Math.hypot(b[0]-a[0],b[2]-a[2]);
    const side=((x-p.x)*-(b[2]-a[2])+(z-p.z)*(b[0]-a[0]))/length,excess=Math.max(0,p.distance-p.width-1.6);
    const profile=side<0||z>-30?[[0,-.3],[4,3],[10,9],[18,5],[35,-40],[100,-170]]:[[0,-.3],[5,-4],[15,-28],[35,-100],[100,-170]];
    let drop=profile.at(-1)[1];
    for(let i=1;i<profile.length;i++)if(excess<=profile[i][0]){const a=profile[i-1],b=profile[i],t=THREE.MathUtils.smoothstep(excess,a[0],b[0]);drop=a[1]+(b[1]-a[1])*t;break;}
    return p.height+drop+this.capturedDisplacement(x*.3,z*.3)*5*THREE.MathUtils.smoothstep(excess,1,12);
  }
  makeGround() {
    const inside={pos:[],uv:[]};
    for(let x=-30;x<30;x+=2)for(let z=0;z<148;z+=2) {
      const p=sampleMountain(x+1,z+1);
      if(p.distance>p.width+1.2)continue;
      const a=[x,this.vertexHeight(x,z),z],b=[x+2,this.vertexHeight(x+2,z),z],c=[x,this.vertexHeight(x,z+2),z+2],d=[x+2,this.vertexHeight(x+2,z+2),z+2];
      for(const v of [a,c,b,b,c,d]){inside.pos.push(...v);inside.uv.push(v[0],v[2]);}
    }
    const material=new THREE.MeshStandardMaterial({map:this.diffuse,normalMap:this.normal,normalScale:new THREE.Vector2(.7,.7),roughness:.96,color:0xc5c4ac});
    const make=data=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.pos,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;return mesh;};
    this.ground=new THREE.Mesh(mergeGeometries([TRAIL,BRANCH].map(route=>routeRibbonGeometry(route,(x,z)=>this.sourceHeight(x,z),p=>p.width+1.6+Math.max(0,1+p.z/12)*7))),material);this.ground.name='实拍位移山径';this.root.add(this.ground);this.caveGround=make(inside);
    const wallMaps=[this.caveDiffuse,this.caveNormal,this.caveRough].map(source=>{const t=source.clone();t.repeat.set(.14,.14);return t;});
    const wallMaterial=new THREE.MeshStandardMaterial({map:wallMaps[0],normalMap:wallMaps[1],roughnessMap:wallMaps[2],roughness:1,color:0xadb1a3});
    const profiles=[-1,-.55,-.24,-.12,-.06,-.02,0,.02,.06,.12,.24,.55,1];
    this.support=new THREE.Mesh(mergeGeometries([[[0,7,20,10],...TRAIL],BRANCH].map(route=>routeRibbonGeometry(route,(x,z)=>this.supportHeight(x,z),()=>100,5,profiles))),wallMaterial);
    this.support.name='摄影岩壁材质连续山体基座';this.root.add(this.support);
    this.supportIndex=createFloorIndex([this.support.geometry]);
    const alpha=[];for(let i=0;i<this.caveGround.geometry.attributes.position.count;i++){
      const positions=this.caveGround.geometry.attributes.position,x=positions.getX(i),z=positions.getZ(i),p=sampleRoute(CAVE,x,z);
      alpha.push(z<124?1:clamp((140-z)/12,0,1)*clamp((p.width+1.2-p.distance)/1.5,0,1));
    }
    this.caveGround.geometry.setAttribute('surfaceAlpha',new THREE.Float32BufferAttribute(alpha,1));
    this.caveGround.material=material.clone();this.caveGround.material.transparent=true;this.caveGround.material.alphaTest=.02;
    this.caveGround.material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float surfaceAlpha; varying float vSurfaceAlpha;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSurfaceAlpha=surfaceAlpha;');
      shader.fragmentShader='varying float vSurfaceAlpha;\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= vSurfaceAlpha;');
    };
    this.floorIndex=createFloorIndex([this.ground.geometry,this.caveGround.geometry]);
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
          if(random()<.55){const x=cx+nx*(w+2.5),z=cz+nz*(w+2.5);record(`boulder-${Math.floor(random()*this.boulders.length)}`,{x,y:(this.supportIndex.heightAt(x,z)??this.supportHeight(x,z))-.2,z,s:.7+random()*.5,ry:random()*Math.PI*2});}
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
    const curve=new THREE.CatmullRomCurve3(CAVE.slice().reverse().map(p=>new THREE.Vector3(p[0],p[1]+3.8,p[2])));
    g.add(this.caveGround);
    const {data,width,height}=this.cavePixels;
    const displacement=(u,v)=>{const x=((Math.floor(u*width)%width)+width)%width,y=((Math.floor(v*height)%height)+height)%height;return data[(y*width+x)*4]/255;};
    const enclosure=new THREE.Mesh(capturedCaveGeometry(displacement),new THREE.MeshStandardMaterial({map:this.caveDiffuse,normalMap:this.caveNormal,normalScale:new THREE.Vector2(1.1,1.1),roughnessMap:this.caveRough,roughness:1,side:THREE.DoubleSide}));
    enclosure.name='实拍岩壁位移 · 连续洞壳';g.add(enclosure);
    const source=this.models.rock_face_01,wall=new THREE.Group();source.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(source),cx=(box.min.x+box.max.x)/2;
    source.traverse(child=>{if(!child.isMesh)return;
      const geometry=child.geometry.clone().applyMatrix4(child.matrixWorld);geometry.translate(-cx,-box.min.y,-box.max.z);
      const material=child.material.clone();material.side=THREE.DoubleSide;wall.add(new THREE.Mesh(geometry,material));
    });
    const walls=[];
    const random=seeded(11367);
    for(let i=1;i<12;i++) {
      const point=curve.getPoint(i/12),tangent=curve.getTangent(i/12),length=Math.hypot(tangent.x,tangent.z),nx=-tangent.z/length,nz=tangent.x/length;
      const side=i%2?1:-1;
      walls.push({x:point.x+nx*6.1*side,y:point.y-4.8,z:point.z+nz*6.1*side,sx:1.5+random(),sy:1.1+random()*.4,sz:.5,ry:Math.atan2(-nx*side,-nz*side)});
    }
    this.batches(wall,walls,g);
    for(const [z,y]of [[136,0],[-2,7]]){
      for(const [variant,x,base,w,h,d]of [[3,-11.5,-2,12,13,12],[1,11.5,-2,12,13,12],[5,0,5.7,22,10,14],[2,-18,-5,22,23,26],[4,18,-5,22,23,26]]){
        const rock=this.boulders[variant],size=rock.userData.size;
        this.batches(rock,[{x,y:y+base,z:z+(Math.abs(x)>15?(z>0?-10:10):0),sx:w/size.x,sy:h/size.y,sz:d/size.z}],g);
      }
    }
    this.caveLights=[];
    for(const t of [.14,.36,.59,.81]) {
      const p=curve.getPoint(t),light=new THREE.PointLight(0xa4b6a5,25,30,1.4);light.position.copy(p);g.add(light);this.caveLights.push(light);
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
    const dark=caveAmount(x,z);this.horizon.material.color.setRGB(1-dark*.98,1-dark*.98,1-dark*.98);
    this.horizon.visible=dark<.999;
    return {cave:dark,height:this.groundHeight(x,z)};
  }
}
