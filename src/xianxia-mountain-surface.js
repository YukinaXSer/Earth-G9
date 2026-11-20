import * as THREE from 'three';
import {MOUNTAIN_BASE_X,MOUNTAIN_PERIOD} from './xianxia-mountain-geometry.js';

export class MountainTileSurface {
  constructor(){this.tiles=new Map();}
  set(block,phase,indices){
    const mirrored=Math.abs(block%2)===1,shift=block*MOUNTAIN_PERIOD,offset=mirrored?2*MOUNTAIN_BASE_X+MOUNTAIN_PERIOD+shift:shift;
    const toLocal=mirrored?x=>offset-x:x=>x-offset,toWorld=mirrored?x=>offset-x:x=>x+offset;
    const bounds=new THREE.Box3();
    for(const index of indices)for(const geometry of index.geometries){if(!geometry.boundingBox)geometry.computeBoundingBox();bounds.union(geometry.boundingBox);}
    const x0=toWorld(bounds.min.x),x1=toWorld(bounds.max.x);
    this.tiles.set(`${block}:${phase}`,{indices,toLocal,toWorld,minX:Math.min(x0,x1),maxX:Math.max(x0,x1),minZ:bounds.min.z,maxZ:bounds.max.z});
  }
  delete(block,phase){this.tiles.delete(`${block}:${phase}`);}
  heightAt(x,z){
    let height=-Infinity;
    for(const tile of this.tiles.values()){
      if(x<tile.minX-1e-5||x>tile.maxX+1e-5||z<tile.minZ-1e-5||z>tile.maxZ+1e-5)continue;
      const localX=tile.toLocal(x);
      for(const index of tile.indices){const h=index.heightAt(localX,z);if(h!=null)height=Math.max(height,h);}
    }
    return Number.isFinite(height)?height:null;
  }
  canMove(fromX,fromZ,x,z,radius=.35){
    if(this.heightAt(fromX,fromZ)==null||this.heightAt(x,z)==null)return false;
    for(const tile of this.tiles.values()){
      if(x+radius<tile.minX||x-radius>tile.maxX||z+radius<tile.minZ||z-radius>tile.maxZ)continue;
      const height=(localX,z)=>this.heightAt(tile.toWorld(localX),z);
      for(const index of tile.indices)if(!index.canMove(tile.toLocal(fromX),fromZ,tile.toLocal(x),z,radius,height))return false;
    }
    return true;
  }
}
