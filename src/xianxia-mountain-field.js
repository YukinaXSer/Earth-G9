import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFloorIndex} from './xianxia-world.js';
import {loadPhotographicGround,ensureSurfaceNormals,addPhotographicCapture} from './xianxia-surface.js';
import {CAPTURE_SHIFT,gradeCaptureApproach,groundProp,groundPropMatrix} from './xianxia-near.js';
import {MOUNTAIN_ENTRANCE} from './xianxia-mountain.js';
import {decodeMountainGeometry,distantMountainGeometry,mountainStation,MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z,MOUNTAIN_PERIOD,MOUNTAIN_WIDTH,mountainCell} from './xianxia-mountain-geometry.js';
import {MountainTileSurface} from './xianxia-mountain-surface.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mountainPathDistance} from './xianxia-mountain-route.js';
import {loadCompressedModel} from './xianxia-model.js';

const ROOT='/xianxia/surface/';
const random=n=>{const f=Math.sin(n*127.1+311.7)*43758.5453;return f-Math.floor(f);};

export function mountainFernPlacement(phase,i,basePlants,contacts=[]){
  const seed=i*31+phase*983+1021;
  let u=phase*16+.6+random(i+phase*17)*14.8;
  let z=MOUNTAIN_BASE_Z+(random(i+phase*73+207)-.5)*(MOUNTAIN_WIDTH-1);
  let grove;
  if(i>=basePlants){
    const cluster=Math.floor((i-basePlants)/9)+phase*71;
    const angle=random(seed+7)*Math.PI*2,radius=Math.sqrt(random(seed+13))*1.35;
    u=phase*16+2+random(cluster+5107)*12+Math.cos(angle)*radius;
    z=MOUNTAIN_BASE_Z+(random(cluster+6101)-.5)*(MOUNTAIN_WIDTH-3)+Math.sin(angle)*radius;
    const trees=mountainPinePlacements(phase);
    if(cluster%2===0&&trees.length){
      const tree=trees[Math.floor(cluster/2)%trees.length];
      grove=[tree.x+Math.cos(angle)*radius,tree.z+Math.sin(angle)*radius];
    }
  }
  let x=MOUNTAIN_BASE_X+mountainStation(u);
  if(grove){
    x=THREE.MathUtils.clamp(grove[0],MOUNTAIN_BASE_X+mountainStation(phase*16+.6),MOUNTAIN_BASE_X+mountainStation((phase+1)*16-.6));
    z=THREE.MathUtils.clamp(grove[1],MOUNTAIN_BASE_Z-MOUNTAIN_WIDTH/2+.7,MOUNTAIN_BASE_Z+MOUNTAIN_WIDTH/2-.7);
  }else if(i>=basePlants&&i%4===1&&contacts.length)[x,z]=contacts[Math.floor(random(seed+19)*contacts.length)];
  const scale=i>=basePlants?1+random(seed+23)*1.4:.55+random(seed+23)*.85;
  return {x,z,scale,rotation:random(seed+29)*Math.PI*2,variant:random(seed+37)};
}

async function sourceProps(){
  const loader=new GLTFLoader();
  return Promise.all(['boulders','stone_01-lod','rock_07-lod','fern'].map(async name=>{
    const {scene}=await loader.loadAsync(ROOT+name+'.glb'),parts=[];scene.updateMatrixWorld(true);
    scene.traverse(child=>{
      if(!child.isMesh)return;
      const geometry=ensureSurfaceNormals(child.geometry.clone().applyMatrix4(child.matrixWorld));geometry.computeBoundingBox();
      for(const name of ['position','normal']){
        const attribute=geometry.getAttribute(name),values=new Float32Array(attribute.count*3);
        for(let i=0;i<attribute.count;i++)values.set([attribute.getX(i),attribute.getY(i),attribute.getZ(i)],i*3);
        geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,3));
      }
      const center=geometry.boundingBox.getCenter(new THREE.Vector3());geometry.translate(-center.x,-geometry.boundingBox.min.y,-center.z);
      parts.push({geometry,material:child.material});
    });return parts;
  }));
}

export function mountainPinePlacements(phase){
  const trees=[];
  for(const [grove,[cx,cz]]of [[119,-109],[127,-116.5],[135,-110],[154,-97.96]].entries()){
    for(const [member,[dx,dz]]of [[0,0],[3.6,-2.3],[-4.1,2.5]].entries()){
      const x=cx+dx,z=cz+dz;
      const start=MOUNTAIN_BASE_X+mountainStation(phase*16),end=MOUNTAIN_BASE_X+mountainStation((phase+1)*16);
      if(x<start||x>=end||mountainPathDistance(x,z)<1.7)continue;
      trees.push({i:grove*3+member,x,z});
    }
  }
  for(const [grove,[cx,cz]]of [[107,-120],[120,-121],[138,-121],[153,-120],[109,-99.5],[125,-100],[141,-99],[155,-104.5]].entries()){
    for(const [member,[dx,dz]]of [[0,0],[3.2,-2.1],[-3.7,2.8]].entries()){
      const x=cx+dx,z=cz+dz;
      const start=MOUNTAIN_BASE_X+mountainStation(phase*16),end=MOUNTAIN_BASE_X+mountainStation((phase+1)*16);
      if(x<start||x>=end||mountainPathDistance(x,z)<2.2)continue;
      trees.push({i:100+grove*3+member,x,z,middle:true});
    }
  }
  return trees;
}

const pineWood=mesh=>mesh.isMesh&&/bark|trunk|dead_branches/.test(mesh.material.name);

export function mountainPineFamilies(quality){
  return quality==='low'?['pine-mature-v5','pine-mid-v3']:['pine-mature-v8','pine-mid-v6'];
}

async function pineSources(quality){
  const families=mountainPineFamilies(quality);
  const loader=new GLTFLoader(),[small,near,far,midNear,midFar]=await Promise.all([
    loader.loadAsync(ROOT+'pine.glb'),
    ...families.flatMap(family=>['near','far'].map(lod=>loadCompressedModel(loader,ROOT+family+'-'+lod+'.glb.gz',ROOT))),
  ]);
  const tunedMaterials=new WeakSet();
  const normalize=scene=>scene.children.map(child=>{
    const group=child.clone(true),box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),roots=[];
    group.traverse(child=>{
      if(!pineWood(child))return;
      const p=child.geometry.attributes.position;
      for(let i=0;i<p.count;i++)roots.push(new THREE.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(child.matrixWorld));
    });
    const minimum=roots.length?Math.min(...roots.map(p=>p.y)):box.min.y,bottom=roots.filter(p=>p.y<=minimum+.08);
    const anchor=bottom.length?bottom.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(bottom.length):center;
    group.position.sub(new THREE.Vector3(anchor.x,minimum,anchor.z));
    group.traverse(child=>{
      if(!child.isMesh)return;
      const leaf=child.material.name.includes('twig')&&!child.material.name.includes('native_fine_twigs');
      child.material.envMapIntensity=leaf?1:.35;
      if(leaf&&!child.material.userData.pinePhotographBalanced&&!tunedMaterials.has(child.material))child.material.color.multiplyScalar(1.5);
      tunedMaterials.add(child.material);
      child.castShadow=true;child.receiveShadow=true;
    });
    const tree=new THREE.Group();tree.add(group);
    tree.userData.rootContact=bottom.map(p=>[p.x-anchor.x,p.y-minimum,p.z-anchor.z]);
    return tree;
  });
  const makeLODs=(near,far,distance)=>near.map((tree,i)=>{
    const materials=new Map();tree.traverse(mesh=>{if(mesh.isMesh)materials.set(mesh.material.name,mesh.material);});
    const distant=far[i];distant.traverse(mesh=>{
      if(!mesh.isMesh)return;
      mesh.material=materials.get(mesh.material.name);mesh.userData.collision=false;
    });
    const lod=new THREE.LOD();lod.addLevel(tree,0);lod.addLevel(distant,distance,.15);
    lod.userData.rootContact=tree.userData.rootContact;return lod;
  });
  return {saplings:normalize(small.scene),trees:makeLODs(normalize(near.scene),normalize(far.scene),quality==='low'?12:25),middle:makeLODs(normalize(midNear.scene),normalize(midFar.scene),quality==='low'?6:12)};
}

export async function loadMountainField(world){
  const response=await fetch(ROOT+'mountain-v3.json');if(!response.ok)throw new Error('Mountain surface manifest unavailable');
  const manifest=await response.json();
  if(manifest.period!==MOUNTAIN_PERIOD||manifest.tiles?.length!==4||manifest.profile?.length!==257)throw new Error('Invalid mountain surface manifest');
  const [resources,sources,pines]=await Promise.all([loadPhotographicGround(world.renderer,{walls:true,quality:world.quality}),sourceProps(),pineSources(world.quality)]);
  const profileBytes=new Uint8Array(manifest.profile.length*4);
  manifest.profile.forEach(([l,r],i)=>profileBytes.set([l,r,0,255],i*4));
  const profile=new THREE.DataTexture(profileBytes,manifest.profile.length,1);
  profile.minFilter=profile.magFilter=THREE.LinearFilter;profile.needsUpdate=true;
  const uniforms={
    patchOrigin:{value:CAPTURE_SHIFT.clone()},captureWorldToLocal:{value:new THREE.Matrix4()},captureNormalToWorld:{value:new THREE.Matrix3()},
    forceMaterial:{value:-1},stochastic:{value:true},captureUseGroundCover:{value:true},microMeters:{value:new THREE.Vector2(resources.manifest.textures.groundColor.physicalTileMeters,resources.manifest.textures.wallColor.physicalTileMeters)},
    captureReflectance:{value:new THREE.Vector2(.27,.38)}
  };
  uniforms.groundMean={value:new THREE.Vector3(...resources.manifest.groundMean)};
  uniforms.mesoMeters={value:new THREE.Vector2(resources.manifest.textures.groundMesoColor.physicalTileMeters,resources.manifest.textures.wallMesoColor.physicalTileMeters)};
  uniforms.wallMean={value:new THREE.Vector3(...resources.manifest.wallMean)};
  uniforms.groundRegion={value:new THREE.Vector4(0,0,1,1.7)};
  uniforms.groundMixWidth={value:.4};
  uniforms.captureGroundProfile={value:profile};
  uniforms.captureUseProfile={value:true};
  uniforms.captureProfileSize={value:manifest.profile.length};
  uniforms.captureCorridorOrigin={value:new THREE.Vector2(CAPTURE_SHIFT.x-MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z-CAPTURE_SHIFT.z)};
  for(const [key,value]of Object.entries(resources.textures))uniforms[key]={value};
  const frame=()=>{
    uniforms.captureWorldToLocal.value.copy(world.root.matrixWorld).invert();
    uniforms.captureNormalToWorld.value.getNormalMatrix(world.root.matrixWorld);
  };
  const material=addPhotographicCapture(new THREE.MeshStandardMaterial({side:THREE.DoubleSide,roughness:1,envMapIntensity:.22}),uniforms);
  const surface=new MountainTileSurface(),cache=new Map(),native=new Map();
  world.floorIndex=world.terrainIndex=world.foregroundIndex=surface;
  world.photographicGround=resources;world.surfaceMeshes=[];world.propMeshes=[];
  const matrix=new THREE.Matrix4(),translation=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  function cellMatrix(block,band){
    const cell=mountainCell(block,band);
    return matrix.compose(translation.set(cell.x,0,cell.z),rotation,scale.set(cell.scaleX,1,cell.scaleZ));
  }
  async function tile(phase,lod){
    const key=phase+':'+lod;
    if(!cache.has(key))cache.set(key,(async()=>{
      const response=await fetch(ROOT+manifest.tiles[phase][lod]);
      if(!response.ok)throw new Error('Mountain tile unavailable: '+key);
      const geometry=decodeMountainGeometry(await response.arrayBuffer());
      if(!geometry.attributes.groundCover)throw new Error('Mountain ground-cover metadata unavailable: '+key);
      if(phase===0)gradeCaptureApproach(geometry);
      const data={phase,lod,geometry,index:createFloorIndex([geometry],2)};
      if(lod==='near'||!native.has(phase))native.set(phase,data.index);
      return data;
    })());
    return cache.get(key);
  }
  const slots=new Map();
  const rockMaterial=addPhotographicCapture(material.clone(),{...uniforms,forceMaterial:{value:0}});
  function decorate(phase,data){
    const rocks=[],trees=mountainPinePlacements(phase),contacts=[],floor={heightAt:(x,z)=>{
      const cell=mountainCell(Math.floor((x-MOUNTAIN_BASE_X)/MOUNTAIN_PERIOD),Math.floor((z-MOUNTAIN_BASE_Z+MOUNTAIN_WIDTH/2)/MOUNTAIN_WIDTH));
      x=(x-cell.x)*cell.scaleX;z=(z-cell.z)*cell.scaleZ;
      const height=data.index.heightAt(x,z);if(height!=null)return height;
      let h=-Infinity;for(const index of native.values())h=Math.max(h,index.heightAt(x,z)??-Infinity);
      return Number.isFinite(h)?h:null;
    }};
    const placeRock=(template,x,z,sink,rotation)=>{
      const box=template.boundingBox;
      const radius=Math.hypot(box.max.x-box.min.x,box.max.z-box.min.z)/2;
      if(mountainPathDistance(x,z)<radius+.85)return;
      if(x>MOUNTAIN_ENTRANCE.position.x-radius-.5&&x<MOUNTAIN_ENTRANCE.approach.endX+radius+.5&&Math.abs(z-MOUNTAIN_ENTRANCE.position.z)<1+radius)return;
      const geometry=groundProp(template.clone(),floor,x,z,rotation,{sink});
      if(geometry){
        rocks.push(geometry);
        if(radius>.35){
          const p=geometry.attributes.position,box=geometry.boundingBox,limit=box.min.y+(box.max.y-box.min.y)*.2;
          for(let i=0;i<p.count;i+=3){
            if(p.getY(i)>limit)continue;
            const px=p.getX(i),pz=p.getZ(i),height=floor.heightAt(px,pz);
            if(height==null||Math.abs(height-p.getY(i))>.12)continue;
            const d=Math.max(.01,Math.hypot(px-x,pz-z));contacts.push([px+(px-x)/d*.12,pz+(pz-z)/d*.12]);
            break;
          }
        }
      }
    };
    for(let i=0;i<24;i++){
      const u=phase*16+1.1+(i%6)*2.4+random(i+phase*41)*.7,x=MOUNTAIN_BASE_X+mountainStation(u);
      const z=MOUNTAIN_BASE_Z-2.7+Math.floor(i/6)*1.8+random(i+91)*.7;
      placeRock(sources[0][i%sources[0].length].geometry,x,z,.14,random(i+phase*19)*Math.PI*2);
    }
    if(phase===0)for(const [i,x,z]of [[1,103.4,-118.5],[2,106.2,-119]]){
      placeRock(sources[0][i%sources[0].length].geometry,x,z,.12,i*1.3);
    }
    for(let i=0;i<65;i++){
      const u=phase*16+.4+random(i+phase*43)*15.2,x=MOUNTAIN_BASE_X+mountainStation(u);
      const z=MOUNTAIN_ENTRANCE.position.z+(i%2?1:-1)*(.7+random(i+71)*6);
      placeRock(sources[1+i%2][0].geometry,x,z,.018,random(i+phase*19)*Math.PI*2);
    }
    for(let i=0;i<50;i++){
      const u=phase*16+.6+random(i+phase*71+901)*14.8,x=MOUNTAIN_BASE_X+mountainStation(u);
      const z=MOUNTAIN_BASE_Z+(random(i+phase*11+815)-.5)*(MOUNTAIN_WIDTH-2);
      const large=i%5===0;
      placeRock(large?sources[0][i%sources[0].length].geometry:sources[1+i%2][0].geometry,x,z,large?.14:.025,random(i+503)*Math.PI*2);
    }
    data.props=new THREE.Group();data.propIndices=[];
    for(const geometry of rocks){
      for(const name of Object.keys(geometry.attributes))if(!['position','normal'].includes(name))geometry.deleteAttribute(name);
      if(!geometry.index)geometry.setIndex(Array.from({length:geometry.attributes.position.count},(_,i)=>i));
    }
    if(rocks.length){
      const merged=mergeGeometries(rocks),mesh=new THREE.Mesh(merged,rockMaterial);
      mesh.onBeforeRender=frame;mesh.receiveShadow=true;mesh.castShadow=true;
      data.props.add(mesh);data.propIndices.push(createFloorIndex([merged],2));
    }
    const plantedFloor={heightAt:(x,z)=>Math.max(floor.heightAt(x,z)??-Infinity,...data.propIndices.map(index=>index.heightAt(x,z)??-Infinity))};
    const ferns=sources[3].map(()=>[]),basePlants=phase===0?(world.quality==='low'?75:125):(world.quality==='low'?60:100),plantCount=world.quality==='low'?190:900;
    for(let i=0;i<plantCount;i++){
      const {x,z,scale,rotation,variant:choice}=mountainFernPlacement(phase,i,basePlants,contacts);
      if(mountainPathDistance(x,z)<Math.max(.6,scale*.65))continue;
      if(x<MOUNTAIN_ENTRANCE.approach.endX+.5&&Math.abs(z-MOUNTAIN_ENTRANCE.position.z)<1)continue;
      if(i>=basePlants){
        const heights=[[-.2,0],[.2,0],[0,-.2],[0,.2]].map(([dx,dz])=>plantedFloor.heightAt(x+dx,z+dz));
        if(heights.some(h=>!Number.isFinite(h))||Math.max(...heights)-Math.min(...heights)>.35)continue;
      }
      const variant=Math.floor(choice*sources[3].length),template=sources[3][variant],transform=groundPropMatrix(template.geometry,plantedFloor,x,z,rotation,{sink:.02,scale});
      if(transform)ferns[variant].push(transform);
    }
    for(const [i,transforms]of ferns.entries()){
      if(!transforms.length)continue;
      const template=sources[3][i],mesh=new THREE.InstancedMesh(template.geometry,template.material,transforms.length);
      transforms.forEach((transform,i)=>mesh.setMatrixAt(i,transform));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
      mesh.name='grounded-mountain-ferns';mesh.receiveShadow=true;data.props.add(mesh);
    }
    for(let i=0;i<11;i++){
      const x=MOUNTAIN_BASE_X+mountainStation(phase*16+1+(i<7?2+i*1.7:random(i+phase*13)*14)),z=MOUNTAIN_BASE_Z+(i<7?-1+random(i+phase*13)*4:(random(i+phase*31+913)-.5)*(MOUNTAIN_WIDTH-2)),h=plantedFloor.heightAt(x,z);
      if(mountainPathDistance(x,z)<.8)continue;
      if(!Number.isFinite(h))continue;
      const tree=pines.saplings[i%pines.saplings.length].clone(true);
      tree.position.add(new THREE.Vector3(x,h-.06,z));tree.rotation.y=i*2.4;data.props.add(tree);
    }
    for(const {i,x,z,middle}of trees){
      const source=middle?pines.middle:pines.trees,tree=source[i%source.length].clone(true);
      const angle=i*1.7,c=Math.cos(angle),s=Math.sin(angle),roots=tree.userData.rootContact;
      const heights=roots.map(([px,py,pz])=>{const h=plantedFloor.heightAt(x+c*px+s*pz,z-s*px+c*pz);return h==null?null:h-py;});
      if(!heights.length||heights.some(h=>h==null||!Number.isFinite(h)))continue;
      const h=Math.min(...heights);
      tree.position.set(x,h-.08,z);tree.rotation.y=angle;
      data.props.add(tree);tree.updateMatrixWorld(true);
      const wood=[];
      tree.traverse(child=>{
        if(!pineWood(child)||child.userData.collision===false)return;
        const source=child.geometry,geometry=new THREE.BufferGeometry(),position=source.attributes.position,values=new Float32Array(position.count*3);
        for(let i=0;i<position.count;i++)values.set([position.getX(i),position.getY(i),position.getZ(i)],i*3);
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));geometry.setIndex(source.index);
        geometry.applyMatrix4(child.matrixWorld);wood.push(geometry);
      });
      if(wood.length){const index=createFloorIndex(wood,2);data.propIndices.push({geometries:wood,heightAt:()=>null,canMove:(...args)=>index.canMove(...args)});}
    }
  }
  function releaseGroup(group){
    if(!group)return;
    group.traverse(object=>{if(object.isInstancedMesh)object.dispose();});group.removeFromParent();
  }
  function show(block,band,phase,data,lod){
    const slot=slots.get(block+':'+band+':'+phase);
    if(slot.lod===lod&&slot.level===(data.level??0))return;
    if(lod==='near'&&!data.props)decorate(phase,data);
    releaseGroup(slot.group);slot.group=null;
    slot.batch.mesh.setVisibleAt(slot.id,lod==='far');
    if(lod==='far')slot.batch.mesh.setGeometryIdAt(slot.id,slot.batch.geometry[data.level??0]);
    if(lod==='near'){
      const group=new THREE.Group();group.applyMatrix4(cellMatrix(block,band));
      const mesh=new THREE.Mesh(data.geometry,material);mesh.name='native-mountain';mesh.onBeforeRender=frame;
      mesh.receiveShadow=true;mesh.castShadow=true;group.add(mesh);
      if(data.props)group.add(data.props.clone());world.root.add(group);slot.group=group;
      if(block===0&&band===0&&phase===0)world.ground=world.foreground=mesh;
    }
    slot.lod=lod;slot.level=data.level??0;surface.set(block,phase,[data.index,...(data.propIndices??[])],band);
  }
  const far=await Promise.all(manifest.tiles.map((_,phase)=>tile(phase,'far')));
  const levels=far.map(data=>{
    const geometry=distantMountainGeometry(data.geometry);
    return geometry===data.geometry?[data]:[data,{...data,geometry,index:createFloorIndex([geometry],2),level:1}];
  });
  const extentX=8,extentZ=16,batches=levels.map(tiers=>Array.from({length:4},(_,mirror)=>{
    const mesh=new THREE.BatchedMesh((extentX+1)*(extentZ+1),tiers.reduce((n,d)=>n+d.geometry.attributes.position.count,0),tiers.reduce((n,d)=>n+d.geometry.index.count,0),material);
    const geometry=tiers.map(d=>mesh.addGeometry(d.geometry)),before=mesh.onBeforeRender;
    mesh.scale.set(mirror%2?-1:1,1,mirror>=2?-1:1);
    mesh.name='native-mountain-far';mesh.frustumCulled=false;mesh.receiveShadow=true;
    mesh.onBeforeRender=function(...args){frame();before.apply(this,args);};world.root.add(mesh);
    return {mesh,geometry};
  }));
  function distance(b,r,p,x,z){
    const cell=mountainCell(b,r),cx=cell.x+cell.scaleX*(MOUNTAIN_BASE_X+mountainStation(p*16+8)),cz=cell.z+cell.scaleZ*MOUNTAIN_BASE_Z;
    return Math.max(Math.abs(cx-x),Math.max(0,Math.abs(cz-z)-MOUNTAIN_WIDTH/2));
  }
  const farAt=(p,d)=>levels[p][d>(world.quality==='low'?96:192)?levels[p].length-1:0];
  let windowBlock,windowBand;
  function windowAt(block,band,x=MOUNTAIN_ENTRANCE.position.x,z=MOUNTAIN_ENTRANCE.position.z){
    if(block===windowBlock&&band===windowBand)return;
    for(const[key,slot]of slots)if(Math.abs(slot.block-block)>extentX||Math.abs(slot.band-band)>extentZ){
      releaseGroup(slot.group);slot.batch.mesh.deleteInstance(slot.id);
      surface.delete(slot.block,slot.phase,slot.band);slots.delete(key);
    }
    for(let b=block-extentX;b<=block+extentX;b++)for(let r=band-extentZ;r<=band+extentZ;r++)for(let p=0;p<4;p++){
      const key=b+':'+r+':'+p;if(slots.has(key))continue;
      const cell=mountainCell(b,r),batch=batches[p][Math.abs(b%2)+Math.abs(r%2)*2],id=batch.mesh.addInstance(batch.geometry[0]);
      batch.mesh.setMatrixAt(id,matrix.makeTranslation(cell.x*cell.scaleX,0,cell.z*cell.scaleZ));
      slots.set(key,{block:b,band:r,phase:p,id,batch});show(b,r,p,farAt(p,distance(b,r,p,x,z)),'far');
    }
    windowBlock=block;windowBand=band;
  }
  windowAt(0,0);
  const [first,next]=await Promise.all([tile(0,'near'),tile(1,'near')]);
  show(0,0,1,next,'near');show(0,0,0,first,'near');
  show(-1,0,0,first,'near');show(-1,0,1,next,'near');
  let pending=Promise.resolve();const queued=new Set();
  world.updateMountain=(x,z=MOUNTAIN_ENTRANCE.position.z)=>{
    if(!Number.isSafeInteger(Math.round(x))||!Number.isSafeInteger(Math.round(z)))return Promise.reject(new Error('Invalid mountain position'));
    const current=Math.floor((x-MOUNTAIN_BASE_X)/MOUNTAIN_PERIOD),band=Math.floor((z-MOUNTAIN_BASE_Z+MOUNTAIN_WIDTH/2)/MOUNTAIN_WIDTH);
    windowAt(current,band,x,z);
    for(const slot of slots.values()){
      const d=distance(slot.block,slot.band,slot.phase,x,z);
      if(slot.lod==='far'||d>60)show(slot.block,slot.band,slot.phase,farAt(slot.phase,d),'far');
    }
    for(let b=current-1;b<=current+1;b++)for(let r=band-1;r<=band+1;r++)for(let p=0;p<4;p++){
      const key=b+':'+r+':'+p;
      if(distance(b,r,p,x,z)>32||slots.get(key)?.lod==='near'||queued.has(key))continue;
      queued.add(key);
      pending=pending.then(async()=>{
        const data=await tile(p,'near');await warm(data);if(slots.has(key))show(b,r,p,data,'near');
      }).catch(error=>{world.streamingError=error;}).finally(()=>queued.delete(key));
    }
    return pending;
  };
  world.prepareMountain=async camera=>{world.prewarmCamera=camera;};
  async function warm(data){
    if(data.lod==='near'&&!data.props)decorate(data.phase,data);
    if(data.warmed||!world.prewarmCamera||!world.renderer?.setRenderTarget)return;
    const renderer=world.renderer,mesh=new THREE.Mesh(data.geometry,material);
    mesh.frustumCulled=false;mesh.onBeforeRender=frame;
    if(data.props)mesh.add(data.props.clone());
    mesh.traverse(child=>{if(child.isMesh)child.frustumCulled=false;});
    let scene=world.root;while(scene.parent)scene=scene.parent;
    await renderer.compileAsync(mesh,world.prewarmCamera,scene);
    const target=new THREE.WebGLRenderTarget(1,1),previous=renderer.getRenderTarget();
    world.root.add(mesh);
    try{
      renderer.setRenderTarget(target);renderer.render(scene,world.prewarmCamera);data.warmed=true;
    }finally{renderer.setRenderTarget(previous);releaseGroup(mesh);target.dispose();}
  }
  world.onProgress(1);
  return world;
}
