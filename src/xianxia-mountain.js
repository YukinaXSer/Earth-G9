import * as THREE from 'three';
import {XianxiaWorld} from './xianxia-world.js';

export const MOUNTAIN_ENTRANCE=Object.freeze({
  position:Object.freeze({x:100.5,y:.49862106783051635,z:-115.1}),
  forward:Object.freeze({x:1,y:0,z:0}),
  yaw:-Math.PI/2,
  approach:Object.freeze({length:8,width:1.2,endX:108.5,endZ:-115.1,endY:.90559662697416,grade:(.90559662697416-.49862106783051635)/8,flat:true})
});

// This is the host rainforest's shared lighting contract, not a second rig.
export const MOUNTAIN_LIGHTING=Object.freeze({
  outputColorSpace:THREE.SRGBColorSpace,toneMapping:THREE.ACESFilmicToneMapping,exposure:.96,
  environment:Object.freeze({url:'/textures/rainforest-light.hdr',sunny:.85,rainy:.45}),
  sun:Object.freeze({color:'#fff0ce',sunny:3,rainy:.75,offset:Object.freeze([-24,30,12])}),
  hemisphere:Object.freeze({sky:'#b8cda4',ground:'#65503b',low:1.35,high:.85}),
  ambient:Object.freeze({color:'#dbe2d3',low:1.1,high:0}),
  fog:Object.freeze({sunnyColor:'#8ca18c',rainyColor:'#65776d',sunnyDensity:.0045,rainyDensity:.007,moistureDensity:.006}),
  background:Object.freeze({sunny:'/textures/sunny-sky.hdr',rainy:'/textures/overcast-sky.hdr',sunnyIntensity:1,rainyIntensity:.45,sunnyRotation:-2.083,rainyRotation:1.7})
});

export class XianxiaMountain {
  constructor({renderer,quality='high',renderHorizon=false,onProgress=()=>{}}={}){
    this.renderHorizon=renderHorizon;
    this.world=new XianxiaWorld(new THREE.Group(),{renderer,quality,nearOnly:true,renderHorizon:false,onProgress});
    this.group=this.world.root;
    this.group.removeFromParent();
    this.inverse=new THREE.Matrix4();this.origin=new THREE.Vector3();
    this.from=new THREE.Vector3();this.to=new THREE.Vector3();
  }
  load(){
    this.loading??=this.world.load().then(()=>{
      if(this.renderHorizon)this.loadHorizon();
      return this;
    });
    return this.loading;
  }
  loadHorizon(){
    this.horizonLoading??=this.load().then(async()=>{
      const {loadMountainHorizon}=await import('./xianxia-mountain-horizon.js');
      this.horizon=await loadMountainHorizon(this);return this.horizon;
    });
    this.horizonLoading.catch(error=>{this.horizonError=error;});
    return this.horizonLoading;
  }
  async prepare(camera){
    await this.load();await this.world.prepareMountain?.(camera);return this;
  }
  frame(){
    this.group.updateWorldMatrix(true,false);
    this.origin.setFromMatrixPosition(this.group.matrixWorld);
    this.inverse.copy(this.group.matrixWorld).invert();
  }
  groundHeight(x,z){
    if(!this.world.floorIndex)return null;
    this.frame();this.to.set(x,this.origin.y,z).applyMatrix4(this.inverse);
    const height=this.world.floorIndex.heightAt(this.to.x,this.to.z);
    if(height==null)return null;
    return this.to.setY(height).applyMatrix4(this.group.matrixWorld).y;
  }
  canMove(fromX,fromZ,toX,toZ){
    if(!this.world.floorIndex)return false;
    this.frame();
    this.from.set(fromX,this.origin.y,fromZ).applyMatrix4(this.inverse);
    this.to.set(toX,this.origin.y,toZ).applyMatrix4(this.inverse);
    if(this.world.floorIndex.heightAt(this.from.x,this.from.z)!=null)this.world.updateMountain?.(this.from.x,this.from.z);
    return this.world.floorIndex.canMove(this.from.x,this.from.z,this.to.x,this.to.z);
  }
}
