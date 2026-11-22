import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {NodeIO,Accessor,VertexLayout} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {cloneDocument,dequantize,transformPrimitive,simplifyPrimitive,prune,weld,quantize,textureCompress,reorder,getBounds} from '@gltf-transform/functions';
import {MeshoptSimplifier,MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';
import {needleSprays,pineSprayAlpha,pineTree01AtlasPart} from './pine-needle-sprays.mjs';
import {padOpaqueAtlas} from './pad-opaque-atlas.mjs';

const [input,kind,output,photo]=process.argv.slice(2);
if(!input||!['mature','middle'].includes(kind)||!output||!photo)throw new Error('Usage: prepare-xianxia-pine-sprays.mjs input.gltf mature|middle output-directory unpadded-pine-twig-diffuse.jpg');
await Promise.all([MeshoptSimplifier.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE),source=await io.read(input),scene=source.getRoot().listScenes()[0];
if(kind==='mature'){
  const variant=scene.listChildren().find(n=>n.getName()==='pine_tree_01_b_LOD0');if(!variant)throw new Error('Missing mature variant B');
  for(const node of scene.listChildren())if(node!==variant)node.dispose();
}
await source.transform(prune(),dequantize());
for(const node of source.getRoot().listNodes())if(node.getMesh()){
  for(const p of node.getMesh().listPrimitives())transformPrimitive(p,node.getWorldMatrix());
  node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
}
for(const p of source.getRoot().listMeshes().flatMap(m=>m.listPrimitives()))for(const name of p.listSemantics())if(!['POSITION','NORMAL','TEXCOORD_0'].includes(name))p.setAttribute(name,null);
for(const m of source.getRoot().listMaterials())m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(.9);
const bounds=getBounds(scene);console.log('SOURCE BOUNDS',bounds);
const {width,height}=await sharp(readFileSync(photo)).metadata();
const crop={left:0,top:Math.round(height*.04),width:Math.round(width*.235),height:Math.round(height*.40)};
const {data,info}=await sharp(readFileSync(photo)).extract(crop).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const rgba=padOpaqueAtlas(pineSprayAlpha(data,info.width,info.height),info.width,info.height);
const image=await sharp(rgba,{raw:info}).png().toBuffer();
writeFileSync(resolve(output,'pine-source-shoot.png'),image);
for(const lod of ['near','far']){
  const cell=kind==='mature'?.35:.24;
  const doc=cloneDocument(source),buffer=doc.getRoot().listBuffers()[0],texture=doc.createTexture('photographed-pine-shoot').setImage(image).setMimeType('image/png');
  for(const mesh of doc.getRoot().listMeshes())for(const p of [...mesh.listPrimitives()]){
    const original=p.getMaterial(),twig=original.getName().includes('twig');
    if(!twig){simplifyPrimitive(p,{simplifier:MeshoptSimplifier,ratio:lod==='near'?.2:.08,error:lod==='near'?.0002:.0003,lockBorder:false});continue;}
    const positions=p.getAttribute('POSITION').getArray(),uv=p.getAttribute('TEXCOORD_0').getArray(),indices=p.getIndices().getArray();
    const atlas=await sharp(original.getBaseColorTexture().getImage()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const acceptUV=(u,v)=>{const x=Math.floor(((u%1)+1)%1*atlas.info.width),y=Math.floor(((v%1)+1)%1*atlas.info.height),i=(y*atlas.info.width+x)*4,[r,g,b]=atlas.data.subarray(i,i+3);return g>12&&g>=r&&g>b*1.12;};
    const sprays=needleSprays(positions,indices,uv,{cellSize:cell,aspect:info.width/info.height,acceptUV});
    console.log(kind,lod,{accepted:sprays.accepted,clusters:sprays.clusters,triangles:sprays.indices.length/3,bounds:sprays.bounds});
    const material=original.clone().setName(kind+'_twig_sprays').setBaseColorTexture(texture).setBaseColorFactor([.6,1,.7,1]).setAlphaMode('MASK').setAlphaCutoff(.18).setDoubleSided(false);
    const primitive=doc.createPrimitive().setMaterial(material);
    for(const [semantic,array,type]of [['POSITION',sprays.position,Accessor.Type.VEC3],['NORMAL',sprays.normal,Accessor.Type.VEC3],['TEXCOORD_0',sprays.uv,Accessor.Type.VEC2]])primitive.setAttribute(semantic,doc.createAccessor().setType(type).setArray(array).setBuffer(buffer));
    primitive.setIndices(doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(sprays.indices).setBuffer(buffer));mesh.addPrimitive(primitive);
    const wood=[],cones=[];
    for(let i=0;i<indices.length;i+=3){
      const u=(uv[indices[i]*2]+uv[indices[i+1]*2]+uv[indices[i+2]*2])/3,v=(uv[indices[i]*2+1]+uv[indices[i+1]*2+1]+uv[indices[i+2]*2+1])/3;
      const part=pineTree01AtlasPart(u,v);
      if(part!=='needles')(part==='cones'?cones:wood).push(indices[i],indices[i+1],indices[i+2]);
    }
    for(const [name,faces,ratio,error]of [['native_fine_twigs',wood,lod==='near'?.2:.08,lod==='near'?.0002:.0003],['pine_cones',cones,lod==='near'?.1:.02,lod==='near'?.002:.006]]){
      if(!faces.length)continue;
      const native=p.clone().setMaterial(original.clone().setName(kind+'_'+name)).setIndices(doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Uint32Array(faces)).setBuffer(buffer));
      mesh.addPrimitive(native);simplifyPrimitive(native,{simplifier:MeshoptSimplifier,ratio,error,lockBorder:false});
      console.log('RETAINED',name,lod,faces.length/3,native.getIndices().getCount()/3);
    }
    mesh.removePrimitive(p);p.dispose();
  }
  if(lod==='far')for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null);
  await doc.transform(weld(),prune({keepAttributes:true}),quantize({quantizePosition:16,quantizeNormal:8,quantizeTexcoord:12}),textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:95}),reorder({encoder:MeshoptEncoder,target:'size'}));
  const family=kind==='mature'?'pine-mature-v6':'pine-mid-v4',path=resolve(output,family+'-'+lod+'.glb');
  await io.write(path,doc);writeFileSync(path+'.gz',gzipSync(readFileSync(path),{level:9}));console.log('OUTPUT',path,statSync(path).size,'gzip',statSync(path+'.gz').size,'BOUNDS',getBounds(doc.getRoot().listScenes()[0]));
}
