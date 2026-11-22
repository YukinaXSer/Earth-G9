import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO,VertexLayout} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {cloneDocument,dequantize,transformPrimitive,simplifyPrimitive,prune,quantize,textureCompress,reorder} from '@gltf-transform/functions';
import {MeshoptSimplifier,MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';
import {padOpaqueAtlas} from './pad-opaque-atlas.mjs';
import {needleComponents,restoreNeedleCoverage} from './pine-needle-components.mjs';

const input=process.argv[2];
if(!input)throw new Error('Usage: node prepare-xianxia-mid-pine.mjs /path/to/pine-medium.glb [output-directory]');
const output=process.argv[3]??fileURLToPath(new URL('../public/xianxia/surface/',import.meta.url));
await Promise.all([MeshoptSimplifier.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE),source=await io.read(input);
await source.transform(dequantize());
for(const node of source.getRoot().listNodes())if(node.getMesh()){
  for(const p of node.getMesh().listPrimitives())transformPrimitive(p,node.getWorldMatrix());
  node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
}
for(const p of source.getRoot().listMeshes().flatMap(m=>m.listPrimitives()))for(const name of p.listSemantics())if(!['POSITION','NORMAL','TEXCOORD_0'].includes(name))p.setAttribute(name,null);
for(const m of source.getRoot().listMaterials()){
  m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(.85);
  if(!m.getName().includes('twig')||m.getAlphaMode()!=='OPAQUE')continue;
  const texture=m.getBaseColorTexture(),{data,info}=await sharp(texture.getImage()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  texture.setImage(await sharp(padOpaqueAtlas(data,info.width,info.height,info.channels),{raw:info}).png().toBuffer()).setMimeType('image/png');
}
for(const [lod,ratio]of [['near',.2],['far',.12]]){
  const doc=cloneDocument(source);
  for(const p of doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives())){
    const twig=p.getMaterial().getName().includes('twig'),target=twig?needleComponents(p.getAttribute('POSITION').getArray(),p.getIndices().getArray()).projected:0;
    simplifyPrimitive(p,{simplifier:MeshoptSimplifier,ratio:twig?ratio:lod==='near'?.6:.15,error:lod==='near'?.002:.003,lockBorder:false});
    if(twig&&target)console.log(lod,restoreNeedleCoverage(p.getAttribute('POSITION').getArray(),p.getIndices().getArray(),target,lod==='near'?.02:.03));
  }
  if(lod==='far')for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null);
  await doc.transform(prune(),quantize({quantizePosition:16,quantizeNormal:8,quantizeTexcoord:12}),textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:88}),reorder({encoder:MeshoptEncoder,target:'size'}));
  const path=resolve(output,'pine-mid-v1-'+lod+'.glb');await io.write(path,doc);writeFileSync(path+'.gz',gzipSync(readFileSync(path),{level:9}));console.log('OUTPUT',path,statSync(path).size,'gzip',statSync(path+'.gz').size);
}
