import * as THREE from 'three';
import { XianxiaWorld,createFloorIndex } from './xianxia-world.js';
import { sampleRoute,CAVE,CAVE_LENGTH,canWalkMountain,caveAmount } from './xianxia-route.js';

export class XianxiaLink {
  constructor(forest,{anchor={x:72,y:.20866,z:-230},clearApproach=true,nearOnly=false,onProgress=()=>{}}={}) {
    this.nearOnly=nearOnly;
    this.forest=forest;this.anchor=anchor;
    this.forestLights=[];forest.scene.traverse(o=>{if(o.isLight)this.forestLights.push(o);});
    this.offset=new THREE.Vector3(anchor.x,anchor.y,anchor.z-CAVE_LENGTH);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#c1d0cc');
    this.scene.fog=new THREE.FogExp2('#becac0',.0017);
    this.skyLight=new THREE.HemisphereLight('#e2f0e9','#575b45',2.5);this.scene.add(this.skyLight);
    this.sun=new THREE.DirectionalLight('#fff1d6',2.5);this.sun.position.set(200,350,-100);this.scene.add(this.sun);
    this.scene.environment=forest.scene.environment;this.scene.environmentIntensity=.75;
    this.world=new XianxiaWorld(this.scene,{offset:this.offset,quality:forest.lowDetail?'low':'high',renderer:forest.renderer,nearOnly,onProgress});
    this.ready=this.world.load().then(async()=>{
      await forest.environmentReady;
      this.scene.environment=forest.scene.environment;
      if(nearOnly){
        this.scene.remove(this.skyLight,this.sun);this.scene.fog=forest.scene.fog.clone();
        this.scene.environment=forest.scene.environment;this.scene.environmentIntensity=forest.scene.environmentIntensity;
        for(const source of this.forestLights){const light=source.clone();this.scene.add(light);if(source===forest.sun){this.sun=light;this.scene.add(light.target);}}
        return this;
      }
      this.forestCave=this.world.cave.clone(true);this.forestCave.position.add(this.offset);forest.scene.add(this.forestCave);
      this.forestCave.visible=false;
      this.entrance={x:anchor.x,z:anchor.z+48};
      if(clearApproach)this.prepareApproach();
      return this;
    });
  }
  local(x,z){return {x:x-this.offset.x,z:z-this.offset.z};}
  inApproach(x,z,width=14){
    const p=this.local(x,z);
    return p.z>CAVE_LENGTH/2-2&&p.z<CAVE_LENGTH+56&&(p.z>=CAVE_LENGTH?Math.abs(p.x):sampleRoute(CAVE,p.x,p.z).distance)<(p.z>CAVE_LENGTH+24?Math.min(width,7):width);
  }
  prepareApproach(){
    const habitat=this.forest.habitat,matrix=new THREE.Matrix4(),point=new THREE.Vector3(),zero=new THREE.Vector3();
    for(const mesh of habitat?.cells??[]){
      let changed=false;
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
        if(!this.inApproach(point.x,point.z))continue;
        matrix.scale(zero);mesh.setMatrixAt(i,matrix);changed=true;
      }
      if(changed){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
    }
    if(habitat)habitat.lodTrees=habitat.lodTrees.filter(tree=>{
      if(!this.inApproach(tree.x,tree.z))return true;
      if(tree.group)tree.group.visible=false;
      for(const part of tree.parts){matrix.copy(part.matrix).scale(zero);part.batch.mesh.setMatrixAt(part.index,matrix);part.batch.mesh.instanceMatrix.needsUpdate=true;}
      return false;
    });
    const removed=new Set((this.forest.colliders??[]).filter(c=>this.inApproach(c.x,c.z))),index=this.forest.colliderIndex;
    this.forest.colliders=(this.forest.colliders??[]).filter(c=>!removed.has(c));
    this.forest.colliderIndex={query:(...args)=>(index?index.query(...args):this.forest.colliders).filter(c=>!removed.has(c))};
    if(this.forest.ground){
      const geometry=this.forest.ground.geometry=this.forest.ground.geometry.clone(),positions=geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),z=positions.getZ(i),p=this.local(x,z);
        if(!this.inApproach(x,z,14))continue;
        const contact=this.world.caveSurfaceIndex?.heightAt(p.x,Math.min(p.z,CAVE_LENGTH-.15));
        if(contact!=null&&p.z>CAVE_LENGTH-2&&p.z<CAVE_LENGTH+6){
          const blend=THREE.MathUtils.smoothstep(CAVE_LENGTH+6-p.z,0,6),depth=.04+THREE.MathUtils.smoothstep(CAVE_LENGTH-p.z-1.5,0,2)*.96;
          positions.setY(i,THREE.MathUtils.lerp(positions.getY(i),contact+this.offset.y-depth,blend));
        }else if(p.z<CAVE_LENGTH)positions.setY(i,Math.min(positions.getY(i),this.groundHeight(x,z)-1));
      }
      positions.needsUpdate=true;geometry.computeVertexNormals();
      this.approachFloorIndex=createFloorIndex([geometry],3);
    }
  }
  owns(x,z) {
    if(this.nearOnly)return true;
    const p=this.local(x,z);
    if(p.z<=0)return true;
    if(p.z>CAVE_LENGTH)return p.z<CAVE_LENGTH+14&&Math.abs(p.x)<40;
    const bounds=this.world.caveBounds;
    return bounds?p.x>bounds.min.x&&p.x<bounds.max.x:p.z<CAVE_LENGTH+7&&sampleRoute(CAVE,p.x,p.z).distance<8;
  }
  canWalk(x,z,fromX=x,fromZ=z) {const p=this.local(x,z),from=this.local(fromX,fromZ);if(this.nearOnly)return this.world.canWalkGround(p.x,p.z,from.x,from.z);return p.z>CAVE_LENGTH&&p.z<CAVE_LENGTH+14&&Math.abs(p.x)<3.5||(p.z>0&&p.z<CAVE_LENGTH&&this.world.canWalkCave?this.world.canWalkCave(p.x,p.z):canWalkMountain(p.x,p.z)&&this.world.canWalkGround(p.x,p.z,from.x,from.z));}
  groundHeight(x,z){const p=this.local(x,z);return p.z>CAVE_LENGTH&&this.approachFloorIndex?(this.approachFloorIndex.heightAt(x,z)??this.world.groundHeight(p.x,p.z)+this.offset.y):this.world.groundHeight(p.x,p.z)+this.offset.y;}
  update(position,time) {
    if(this.nearOnly){this.sun.position.copy(this.forest.sun.position);this.sun.target.position.copy(this.forest.sun.target.position);return this.scene;}
    const p=this.local(position.x,position.z),mountain=p.z<CAVE_LENGTH*.53;
    const dark=this.world.caveDarkness?this.world.caveDarkness(p.x,p.z):caveAmount(p.x,p.z);
    if(dark>0&&!this.forestState){const s=this.forest.scene;this.forestState={background:s.background,environment:s.environmentIntensity,color:s.fog.color.clone(),density:s.fog.density,lights:this.forestLights.map(light=>[light,light.intensity])};}
    if(this.forestState){const s=this.forest.scene,state=this.forestState;
      if(dark>0){s.background=new THREE.Color(.5*(1-dark),.6*(1-dark),.5*(1-dark));s.environmentIntensity=state.environment*(1-dark);s.fog.color.copy(state.color).multiplyScalar(1-dark);s.fog.density=.0045+dark*.018;for(const [light,intensity]of state.lights)light.intensity=intensity*(1-dark);}
      else{s.background=state.background;s.environmentIntensity=state.environment;s.fog.color.copy(state.color);s.fog.density=state.density;for(const [light,intensity]of state.lights)light.intensity=intensity;this.forestState=null;}
    }
    this.world.update(position,time);
    this.skyLight.intensity=2.5*(1-dark*.98);this.sun.intensity=2.5*(1-dark);
    this.scene.environmentIntensity=.75*(1-dark);
    this.scene.background.setRGB(.68*(1-dark),.76*(1-dark),.76*(1-dark));
    this.scene.fog.color.setRGB(.69*(1-dark),.75*(1-dark),.71*(1-dark));
    this.scene.fog.density=.0017+dark*.018;
    this.world.horizon.visible=dark<.999;
    if(this.forestCave)this.forestCave.visible=!mountain;
    this.forest.camera.far=mountain?2800:220;
    if(this.lastMountain!==mountain){this.forest.camera.updateProjectionMatrix();this.lastMountain=mountain;}
    return mountain?this.scene:this.forest.scene;
  }
}
