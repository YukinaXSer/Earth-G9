import * as THREE from 'three';

export const MOUNTAIN_PERIOD=66;
export const MOUNTAIN_BASE_X=97;
// Reflected cell anchors must share the decoded vertices' Float32 grid.
export const MOUNTAIN_BASE_Z=Math.fround(-108.96188612599644);
export const MOUNTAIN_WIDTH=32;

export function mountainCell(block,band=0){
  const scaleX=Math.abs(block%2)===1?-1:1,scaleZ=Math.abs(band%2)===1?-1:1;
  return {
    scaleX,scaleZ,
    x:block*MOUNTAIN_PERIOD+(scaleX<0?2*MOUNTAIN_BASE_X+MOUNTAIN_PERIOD:0),
    z:band*MOUNTAIN_WIDTH+(1-scaleZ)*MOUNTAIN_BASE_Z,
  };
}

export function mountainStation(u){
  return u<1?2*Math.sqrt(Math.max(0,u)):u>63?66-2*Math.sqrt(Math.max(0,64-u)):u+1;
}

export function distantMountainGeometry(source,step=.5){
  if(!Number.isFinite(step)||step<=0)throw new Error('Invalid distant mesh spacing');
  source.computeBoundingBox();const {min,max}=source.boundingBox;
  const p=source.attributes.position,n=source.attributes.normal,g=source.attributes.groundCover,vertices=[],normals=[],cover=[],counts=[],remap=new Uint32Array(p.count),cells=new Map();
  for(let i=0;i<p.count;i++){
    const px=p.getX(i),py=p.getY(i),pz=p.getZ(i),rim=Math.min(Math.abs(px-min.x),Math.abs(px-max.x),Math.abs(pz-min.z),Math.abs(pz-max.z))<.001;
    const x=rim?px:Math.round(px/step)*step,y=rim?py:Math.round(py/step)*step,z=rim?pz:Math.round((pz-MOUNTAIN_BASE_Z)/step)*step+MOUNTAIN_BASE_Z,key=x+':'+y+':'+z;
    let id=cells.get(key);
    if(id==null){id=vertices.length/3;cells.set(key,id);vertices.push(x,y,z);normals.push(0,0,0);cover.push(0);counts.push(0);}
    remap[i]=id;for(let a=0;a<3;a++)normals[id*3+a]+=n.getComponent(i,a);
    if(g)cover[id]+=g.getX(i);counts[id]++;
  }
  for(let i=0;i<normals.length;i+=3)if(Math.hypot(normals[i],normals[i+1],normals[i+2])<1e-6)normals[i+1]=1;
  const triangles=[],seen=new Set(),indices=source.index;
  for(let i=0;i<indices.count;i+=3){
    const a=remap[indices.getX(i)],b=remap[indices.getX(i+1)],c=remap[indices.getX(i+2)];
    if(a===b||b===c||a===c)continue;
    const key=[a,b,c].sort((a,b)=>a-b).join(':');if(seen.has(key))continue;
    seen.add(key);triangles.push(a,b,c);
  }
  if(!triangles.length||triangles.length>=indices.count)return source;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.normalizeNormals();
  if(g)geometry.setAttribute('groundCover',new THREE.Uint8BufferAttribute(cover.map((v,i)=>Math.round(v/counts[i]*255)),1,true));
  geometry.setIndex(triangles);geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}

export function decodeMountainGeometry(buffer){
  const view=new DataView(buffer);
  if(buffer.byteLength<36)throw new Error('Invalid mountain geometry header');
  const version=view.getUint32(0,true),covered=version===0x324e544d;
  if(version!==0x314e544d&&!covered)throw new Error('Invalid mountain geometry header');
  const count=view.getUint32(4,true),length=view.getUint32(8,true),end=36+count*(covered?10:9);
  if(!count||count>2000000||!length||length%3||length>12000000||end+length>buffer.byteLength)throw new Error('Invalid mountain geometry size');
  const lo=[12,16,20].map(o=>view.getFloat32(o,true)),span=[24,28,32].map(o=>view.getFloat32(o,true));
  if(lo.some(n=>!Number.isFinite(n))||span.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Invalid mountain geometry bounds');
  const positions=new Float32Array(count*3),normals=new Float32Array(count*3),indices=new Uint32Array(length);
  const q=new Uint16Array(buffer,36,count*3),n=new Int8Array(buffer,36+count*6,count*3);
  for(let i=0;i<count;i++){
    const k=i*3,u=lo[0]+q[k]/65535*span[0];
    positions[k]=MOUNTAIN_BASE_X+mountainStation(u);positions[k+1]=lo[1]+q[k+1]/65535*span[1];positions[k+2]=MOUNTAIN_BASE_Z+lo[2]+q[k+2]/65535*span[2];
    const dx=u<1?Math.sqrt(Math.max(0,u)):u>63?Math.sqrt(Math.max(0,64-u)):1;
    const nx=n[k]*dx,ny=n[k+1],nz=n[k+2],size=Math.hypot(nx,ny,nz);
    normals[k]=size?nx/size:0;normals[k+1]=size?ny/size:1;normals[k+2]=size?nz/size:0;
  }
  const bytes=new Uint8Array(buffer);let cursor=end,previous=0;
  for(let i=0;i<length;i++){
    let value=0,shift=0,byte;
    do{
      if(cursor>=bytes.length||shift>28)throw new Error('Invalid mountain index encoding');
      byte=bytes[cursor++];value+=(byte&127)*2**shift;shift+=7;
    }while(byte&128);
    previous+=value%2?-(value+1)/2:value/2;
    if(previous<0||previous>=count)throw new Error('Mountain index out of bounds');
    indices[i]=previous;
  }
  if(cursor!==bytes.length)throw new Error('Unexpected mountain geometry trailing data');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));
  if(covered)geometry.setAttribute('groundCover',new THREE.Uint8BufferAttribute(new Uint8Array(buffer,36+count*9,count).slice(),1,true));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
