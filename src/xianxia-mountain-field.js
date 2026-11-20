import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFloorIndex} from './xianxia-world.js';
import {loadPhotographicGround,ensureSurfaceNormals,addPhotographicCapture} from './xianxia-surface.js';
import {CAPTURE_SHIFT,gradeCaptureApproach,groundProp} from './xianxia-near.js';
import {MOUNTAIN_ENTRANCE} from './xianxia-mountain.js';
import {decodeMountainGeometry,mountainStation,MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z,MOUNTAIN_PERIOD,MOUNTAIN_WIDTH,mountainCell} from './xianxia-mountain-geometry.js';
import {MountainTileSurface} from './xianxia-mountain-surface.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mountainPathDistance} from './xianxia-mountain-route.js';

const ROOT='/xianxia/surface/';
const random=n=>{const f=Math.sin(n*127.1+311.7)*43758.5453;return f-Math.floor(f);};

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

async function pineSources(){
  const loader=new GLTFLoader(),[small,medium]=await Promise.all([loader.loadAsync(ROOT+'pine.glb'),loader.loadAsync(ROOT+'pine-medium.glb')]);
  const normalize=scene=>scene.children.map(child=>{
    const group=child.clone(true),box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),roots=[];
    group.traverse(child=>{
      if(!child.isMesh||!child.material.name.includes('bark'))return;
      const p=child.geometry.attributes.position;
      for(let i=0;i<p.count;i++)roots.push(new THREE.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(child.matrixWorld));
    });
    const minimum=roots.length?Math.min(...roots.map(p=>p.y)):box.min.y,bottom=roots.filter(p=>p.y<=minimum+.08);
    const anchor=bottom.length?bottom.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(bottom.length):center;
    group.position.sub(new THREE.Vector3(anchor.x,minimum,anchor.z));
    group.traverse(child=>{
      if(!child.isMesh)return;
      const leaf=child.material.name.includes('twig');
      child.material.envMapIntensity=leaf?1:.35;
      if(leaf)child.material.color.multiplyScalar(1.5);
    });
    const tree=new THREE.Group();tree.add(group);return tree;
  });
  return {saplings:normalize(small.scene),trees:normalize(medium.scene)};
}

export async function loadMountainField(world){
  const response=await fetch(ROOT+'mountain.json');if(!response.ok)throw new Error('Mountain surface manifest unavailable');
  const manifest=await response.json();
  if(manifest.period!==MOUNTAIN_PERIOD||manifest.tiles?.length!==4||manifest.profile?.length!==257)throw new Error('Invalid mountain surface manifest');
  const [resources,sources,pines]=await Promise.all([loadPhotographicGround(world.renderer,{walls:true}),sourceProps(),pineSources()]);
  const profileBytes=new Uint8Array(manifest.profile.length*4);
  manifest.profile.forEach(([l,r],i)=>profileBytes.set([l,r,0,255],i*4));
  const profile=new THREE.DataTexture(profileBytes,manifest.profile.length,1);
  profile.minFilter=profile.magFilter=THREE.LinearFilter;profile.needsUpdate=true;
  const uniforms={
    patchOrigin:{value:CAPTURE_SHIFT.clone()},captureWorldToLocal:{value:new THREE.Matrix4()},captureNormalToWorld:{value:new THREE.Matrix3()},
    forceMaterial:{value:-1},stochastic:{value:true},microMeters:{value:new THREE.Vector2(resources.manifest.textures.groundColor.physicalTileMeters,resources.manifest.textures.wallColor.physicalTileMeters)},
    captureReflectance:{value:new THREE.Vector2(.35,.38)}
  };
  uniforms.groundMean={value:new THREE.Vector3(...resources.manifest.groundMean)};
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
    const rocks=[],trees=[],floor={heightAt:(x,z)=>{
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
      if(geometry)rocks.push(geometry);
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
    if(phase===0)for(const [i,x,z]of[[0,119,-109],[1,127,-116.5],[2,135,-110]]){
      trees.push({i,x,z});
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
    for(let i=0;i<125;i++){
      const u=phase*16+.6+random(i+phase*17)*14.8,x=MOUNTAIN_BASE_X+mountainStation(u);
      const right=i%4!==0,z=right?MOUNTAIN_BASE_Z-4.4+random(i+207)*7:MOUNTAIN_ENTRANCE.position.z-1.3-random(i+207)*2.5;
      if(mountainPathDistance(x,z)<.6)continue;
      if(x<MOUNTAIN_ENTRANCE.approach.endX+.5&&Math.abs(z-MOUNTAIN_ENTRANCE.position.z)<1)continue;
      const template=sources[3][i%sources[3].length],geometry=groundProp(template.geometry.clone(),data.index,x,z,i*2.4,{sink:.02});
      if(geometry)data.props.add(new THREE.Mesh(geometry,template.material));
    }
    for(let i=0;i<7;i++){
      const x=MOUNTAIN_BASE_X+mountainStation(phase*16+3+i*1.7),z=MOUNTAIN_BASE_Z-1+random(i+phase*13)*4,h=plantedFloor.heightAt(x,z);
      if(mountainPathDistance(x,z)<.8)continue;
      if(!Number.isFinite(h))continue;
      const tree=pines.saplings[i%pines.saplings.length].clone(true);
      tree.position.add(new THREE.Vector3(x,h-.06,z));tree.rotation.y=i*2.4;data.props.add(tree);
    }
    for(const {i,x,z}of trees){
      if(mountainPathDistance(x,z)<.8)continue;
      const h=plantedFloor.heightAt(x,z);if(!Number.isFinite(h))continue;
      const tree=pines.trees[i%pines.trees.length].clone(true);
      tree.position.add(new THREE.Vector3(x,h-.12,z));tree.rotation.y=i*1.7;
      data.props.add(tree);tree.updateMatrixWorld(true);
      const wood=[];
      tree.traverse(child=>{
        if(!child.isMesh||!child.material.name.includes('bark'))return;
        const source=child.geometry,geometry=new THREE.BufferGeometry(),position=source.attributes.position,values=new Float32Array(position.count*3);
        for(let i=0;i<position.count;i++)values.set([position.getX(i),position.getY(i),position.getZ(i)],i*3);
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));geometry.setIndex(source.index);
        geometry.applyMatrix4(child.matrixWorld);wood.push(geometry);
      });
      if(wood.length){const index=createFloorIndex(wood,2);data.propIndices.push({geometries:wood,heightAt:()=>null,canMove:(...args)=>index.canMove(...args)});}
    }
  }
  function show(block,band,phase,data,lod){
    const slot=slots.get(block+':'+band+':'+phase);
    if(slot.lod===lod)return;
    if(lod==='near'&&!data.props)decorate(phase,data);
    slot.group?.removeFromParent();slot.group=null;
    slot.batch.mesh.setVisibleAt(slot.id,lod==='far');
    if(lod==='near'){
      const group=new THREE.Group();group.applyMatrix4(cellMatrix(block,band));
      const mesh=new THREE.Mesh(data.geometry,material);mesh.name='native-mountain';mesh.onBeforeRender=frame;
      mesh.receiveShadow=true;mesh.castShadow=true;group.add(mesh);
      if(data.props)group.add(data.props.clone());world.root.add(group);slot.group=group;
      if(block===0&&band===0&&phase===0)world.ground=world.foreground=mesh;
    }
    slot.lod=lod;surface.set(block,phase,[data.index,...(data.propIndices??[])],band);
  }
  const far=await Promise.all(manifest.tiles.map((_,phase)=>tile(phase,'far')));
  const extentX=8,extentZ=16,batches=far.map(data=>Array.from({length:4},(_,mirror)=>{
    const mesh=new THREE.BatchedMesh((extentX+1)*(extentZ+1),data.geometry.attributes.position.count,data.geometry.index.count,material);
    const geometry=mesh.addGeometry(data.geometry),before=mesh.onBeforeRender;
    mesh.scale.set(mirror%2?-1:1,1,mirror>=2?-1:1);
    mesh.name='native-mountain-far';mesh.frustumCulled=false;mesh.receiveShadow=true;
    mesh.onBeforeRender=function(...args){frame();before.apply(this,args);};world.root.add(mesh);
    return {mesh,geometry};
  }));
  let windowBlock,windowBand;
  function windowAt(block,band){
    if(block===windowBlock&&band===windowBand)return;
    for(const[key,slot]of slots)if(Math.abs(slot.block-block)>extentX||Math.abs(slot.band-band)>extentZ){
      slot.group?.removeFromParent();slot.batch.mesh.deleteInstance(slot.id);
      surface.delete(slot.block,slot.phase,slot.band);slots.delete(key);
    }
    for(let b=block-extentX;b<=block+extentX;b++)for(let r=band-extentZ;r<=band+extentZ;r++)for(let p=0;p<4;p++){
      const key=b+':'+r+':'+p;if(slots.has(key))continue;
      const cell=mountainCell(b,r),batch=batches[p][Math.abs(b%2)+Math.abs(r%2)*2],id=batch.mesh.addInstance(batch.geometry);
      batch.mesh.setMatrixAt(id,matrix.makeTranslation(cell.x*cell.scaleX,0,cell.z*cell.scaleZ));
      slots.set(key,{block:b,band:r,phase:p,id,batch});show(b,r,p,far[p],'far');
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
    windowAt(current,band);
    const distance=(b,r,p)=>{
      const cell=mountainCell(b,r),cx=cell.x+cell.scaleX*(MOUNTAIN_BASE_X+mountainStation(p*16+8)),cz=cell.z+cell.scaleZ*MOUNTAIN_BASE_Z;
      return Math.max(Math.abs(cx-x),Math.max(0,Math.abs(cz-z)-MOUNTAIN_WIDTH/2));
    };
    for(const slot of slots.values())if(slot.lod==='near'&&distance(slot.block,slot.band,slot.phase)>60)show(slot.block,slot.band,slot.phase,far[slot.phase],'far');
    for(let b=current-1;b<=current+1;b++)for(let r=band-1;r<=band+1;r++)for(let p=0;p<4;p++){
      const key=b+':'+r+':'+p;
      if(distance(b,r,p)>32||slots.get(key)?.lod==='near'||queued.has(key))continue;
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
    }finally{renderer.setRenderTarget(previous);mesh.removeFromParent();target.dispose();}
  }
  world.onProgress(1);
  return world;
}
