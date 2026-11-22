import {statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {NodeIO,VertexLayout} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld,prune,dedup,quantize,textureCompress,getBounds,reorder,simplifyPrimitive,cloneDocument} from '@gltf-transform/functions';
import {MeshoptSimplifier,MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';
import {padOpaqueAtlas} from './pad-opaque-atlas.mjs';
await Promise.all([MeshoptSimplifier.ready,MeshoptEncoder.ready]);
const input=process.argv[2];
if(!input)throw new Error('Usage: node prepare-xianxia-pine.mjs /path/to/pine_tree_01_1k.gltf [output-directory]');
const output=process.argv[3]??fileURLToPath(new URL('../public/xianxia/surface/',import.meta.url));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE),source=await io.read(input);
const scene=source.getRoot().listScenes()[0],variant=scene.listChildren().find(node=>node.getName()==='pine_tree_01_b_LOD0');
if(!variant)throw new Error('Expected Poly Haven Pine Tree 01 variant B');
for(const child of scene.listChildren())if(child!==variant)child.dispose();
for(const p of source.getRoot().listMeshes().flatMap(m=>m.listPrimitives()))for(const name of p.listSemantics())if(!['POSITION','NORMAL','TEXCOORD_0'].includes(name))p.setAttribute(name,null);
for(const m of source.getRoot().listMaterials())m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(.85);
for(const m of source.getRoot().listMaterials())if(m.getName().includes('twig')&&m.getAlphaMode()==='OPAQUE'){
 const texture=m.getBaseColorTexture(),{data,info}=await sharp(texture.getImage()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const padded=padOpaqueAtlas(data,info.width,info.height,info.channels);
 texture.setImage(await sharp(padded,{raw:info}).png().toBuffer()).setMimeType('image/png');
}
await source.transform(weld(),dedup(),prune());console.log('BOUNDS',getBounds(source.getRoot().listScenes()[0]));
const area=p=>{const pos=p.getAttribute('POSITION').getArray(),idx=p.getIndices().getArray();let sum=0,projected=0;for(let i=0;i<idx.length;i+=3){const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3,ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2],vx=pos[c]-pos[a],vy=pos[c+1]-pos[a+1],vz=pos[c+2]-pos[a+2],x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;sum+=Math.hypot(x,y,z)/2;projected+=Math.abs(x)/2;}return {triangles:idx.length/3,area:sum,projected};};
function widenNeedles(p,gain){
 const position=p.getAttribute('POSITION'),a=position.getArray(),indices=p.getIndices().getArray(),parent=new Int32Array(position.getCount());for(let i=0;i<parent.length;i++)parent[i]=i;
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let i=0;i<indices.length;i+=3){const r=root(indices[i]);parent[root(indices[i+1])]=r;parent[root(indices[i+2])]=r;}
 const groups=new Map();for(let i=0;i<parent.length;i++){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
 let widened=0;for(const group of groups.values()){
  const center=[0,0,0];for(const i of group)for(let k=0;k<3;k++)center[k]+=a[i*3+k]/group.length;
  let size=0,axis;for(const i of group){const delta=center.map((c,k)=>a[i*3+k]-c),length=Math.hypot(...delta);if(length>size){size=length;axis=delta.map(n=>n/length);}}
  if(!axis||size>.225)continue;
  for(const i of group){const delta=center.map((c,k)=>a[i*3+k]-c),along=delta.reduce((sum,n,k)=>sum+n*axis[k],0);for(let k=0;k<3;k++)a[i*3+k]=center[k]+along*axis[k]+(delta[k]-along*axis[k])*gain;}widened++;
 }
 console.log('Needle coverage LOD',gain,'components',groups.size,'widened',widened);
}
for(const [lod,ratio]of [['near',.035],['far',.009]]){
 const doc=cloneDocument(source);
 for(const p of doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives())){
  const twig=p.getMaterial().getName().includes('twig'),before=area(p);
  simplifyPrimitive(p,{simplifier:MeshoptSimplifier,ratio:twig?ratio:.2,error:twig?(lod==='near'?.002:.008):.0005,lockBorder:false});
  if(twig)widenNeedles(p,Math.min(3,before.projected/area(p).projected));
  console.log(lod,p.getMaterial().getName(),before,area(p));
 }
 if(lod==='far')for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null);
 await doc.transform(prune(),quantize({quantizePosition:16,quantizeNormal:8,quantizeTexcoord:12,quantizeColor:8}),textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:88}),reorder({encoder:MeshoptEncoder,target:'size'}));
 const path=resolve(output,'pine-mature-v2-'+lod+'.glb');await io.write(path,doc);console.log('OUTPUT',path,statSync(path).size);
}
