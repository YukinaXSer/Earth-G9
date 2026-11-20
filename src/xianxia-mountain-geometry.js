import * as THREE from 'three';

export const MOUNTAIN_PERIOD=66;
export const MOUNTAIN_BASE_X=97;
export const MOUNTAIN_BASE_Z=-108.96188612599644;

export function mountainStation(u){
  return u<1?2*Math.sqrt(Math.max(0,u)):u>63?66-2*Math.sqrt(Math.max(0,64-u)):u+1;
}

export function decodeMountainGeometry(buffer){
  const view=new DataView(buffer);
  if(buffer.byteLength<36||view.getUint32(0,true)!==0x314e544d)throw new Error('Invalid mountain geometry header');
  const count=view.getUint32(4,true),length=view.getUint32(8,true),end=36+count*9;
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
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
