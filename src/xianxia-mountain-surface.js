import * as THREE from 'three';
import {MOUNTAIN_BASE_X,MOUNTAIN_BASE_Z,MOUNTAIN_PERIOD,MOUNTAIN_WIDTH,mountainCell} from './xianxia-mountain-geometry.js';

export class MountainTileSurface {
  constructor(){this.tiles=new Map();}
  set(block,phase,indices,band=0){
    const cell=mountainCell(block,band);
    const toLocal=x=>(x-cell.x)*cell.scaleX,toWorld=x=>x*cell.scaleX+cell.x;
    const localZ=z=>(z-cell.z)*cell.scaleZ,worldZ=z=>z*cell.scaleZ+cell.z;
    const bounds=new THREE.Box3();
    for(const index of indices)for(const geometry of index.geometries){if(!geometry.boundingBox)geometry.computeBoundingBox();bounds.union(geometry.boundingBox);}
    const x0=toWorld(bounds.min.x),x1=toWorld(bounds.max.x),z0=worldZ(bounds.min.z),z1=worldZ(bounds.max.z);
    this.tiles.set(`${block}:${band}:${phase}`,{indices,toLocal,toWorld,localZ,worldZ,minX:Math.min(x0,x1),maxX:Math.max(x0,x1),minZ:Math.min(z0,z1),maxZ:Math.max(z0,z1)});
  }
  delete(block,phase,band=0){this.tiles.delete(`${block}:${band}:${phase}`);}
  *near(x,z){
    const block=Math.floor((x-MOUNTAIN_BASE_X)/MOUNTAIN_PERIOD),band=Math.floor((z-MOUNTAIN_BASE_Z+MOUNTAIN_WIDTH/2)/MOUNTAIN_WIDTH);
    if(!Number.isSafeInteger(block)||!Number.isSafeInteger(band))return;
    for(let b=block-1;b<=block+1;b++)for(let r=band-1;r<=band+1;r++)for(let p=0;p<4;p++){
      const tile=this.tiles.get(`${b}:${r}:${p}`);if(tile)yield tile;
    }
  }
  heightAt(x,z){
    let height=-Infinity;
    for(const tile of this.near(x,z)){
      if(x<tile.minX-1e-5||x>tile.maxX+1e-5||z<tile.minZ-1e-5||z>tile.maxZ+1e-5)continue;
      const localX=tile.toLocal(x);
      for(const index of tile.indices){const h=index.heightAt(localX,tile.localZ(z));if(h!=null)height=Math.max(height,h);}
    }
    return Number.isFinite(height)?height:null;
  }
  canMove(fromX,fromZ,x,z,radius=.35){
    if(this.heightAt(fromX,fromZ)==null||this.heightAt(x,z)==null)return false;
    for(const tile of this.near(x,z)){
      if(x+radius<tile.minX||x-radius>tile.maxX||z+radius<tile.minZ||z-radius>tile.maxZ)continue;
      const height=(localX,localZ)=>this.heightAt(tile.toWorld(localX),tile.worldZ(localZ));
      for(const index of tile.indices)if(!index.canMove(tile.toLocal(fromX),tile.localZ(fromZ),tile.toLocal(x),tile.localZ(z),radius,height))return false;
    }
    return true;
  }
}
