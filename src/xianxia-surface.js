import * as THREE from 'three';
import {read} from 'three/addons/libs/ktx-parse.module.js';
import {photographicSurfaceGLSL} from './xianxia-surface-glsl.js';
import {TRAIL,BRANCH} from './xianxia-route.js';

export function ensureSurfaceNormals(geometry){
  if(!geometry.attributes.normal)geometry.computeVertexNormals();
  return geometry;
}

export function nativeGroundTexture(buffer,row){
  const container=read(new Uint8Array(buffer));
  if(container.supercompressionScheme!==0||container.vkFormat!==row.vkFormat||container.pixelWidth!==row.width||container.pixelHeight!==row.height||container.faceCount!==1||container.layerCount!==0)throw new Error('Unexpected native ground texture');
  const format={'etc-rgb':THREE.RGB_ETC2_Format,'etc-rgba':THREE.RGBA_ETC2_EAC_Format,bc1:THREE.RGB_S3TC_DXT1_Format,bc3:THREE.RGBA_S3TC_DXT5_Format}[row.encoding];
  if(!format)throw new Error('Unsupported native ground format');
  const mipmaps=container.levels.map((level,i)=>({data:level.levelData,width:Math.max(1,row.width>>i),height:Math.max(1,row.height>>i)}));
  const texture=new THREE.CompressedTexture(mipmaps,row.width,row.height,format);texture.needsUpdate=true;return texture;
}

export function nativeGroundVariant(extensions){
  if(extensions.has('WEBGL_compressed_texture_etc'))return 'etc2';
  if(extensions.has('WEBGL_compressed_texture_s3tc')&&extensions.has('WEBGL_compressed_texture_s3tc_srgb'))return 's3tc';
  return null;
}

export async function loadPhotographicGround(renderer,{walls=false}={}){
  if(renderer.capabilities.maxTextureSize<4096)throw new Error('Photographic ground requires 4096px texture support');
  const variant=nativeGroundVariant(renderer.extensions);
  if(!variant)throw new Error('Photographic ground requires ETC2 or S3TC with sRGB support');
  const root='/xianxia/surface/',response=await fetch(`${root}manifest.json`);
  if(!response.ok)throw new Error('Photographic ground manifest unavailable');
  const source=await response.json();
  const manifest={...source,...source.variants[variant],variant};
  const textures=Object.fromEntries(await Promise.all(Object.entries(manifest.textures).filter(([id])=>walls||id.startsWith('ground')).map(async([id,row])=>{
    const response=await fetch(root+row.file);if(!response.ok)throw new Error(`Ground texture unavailable: ${id}`);
    const texture=nativeGroundTexture(await response.arrayBuffer(),row);
    texture.colorSpace=id.endsWith('Color')?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=false;
    return [id,texture];
  })));
  return {manifest,textures};
}

export function addPhotographicCapture(material,uniforms){
  uniforms.captureWorldToLocal??={value:new THREE.Matrix4()};
  uniforms.captureNormalToWorld??={value:new THREE.Matrix3()};
  uniforms.captureUseGroundCover??={value:false};
  uniforms.captureReflectance??={value:new THREE.Vector2(.45,.38)};
  uniforms.captureGroundProfile??={value:null};uniforms.captureUseProfile??={value:false};uniforms.captureProfileSize??={value:1};uniforms.captureCorridorOrigin??={value:new THREE.Vector2()};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='attribute float groundCover; varying float photoGroundCover; uniform mat4 captureWorldToLocal; uniform vec3 patchOrigin; varying vec3 posM; varying vec3 normM;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      photoGroundCover=groundCover;
      mat4 photoModelMatrix=modelMatrix;
      #ifdef USE_BATCHING
        photoModelMatrix*=batchingMatrix;
      #endif
      #ifdef USE_INSTANCING
        photoModelMatrix*=instanceMatrix;
      #endif
      posM=(captureWorldToLocal*photoModelMatrix*vec4(position,1.)).xyz-patchOrigin;
      normM=mat3(captureWorldToLocal*photoModelMatrix)*normal;`);
    shader.fragmentShader='varying float photoGroundCover; uniform bool captureUseGroundCover; uniform mat3 captureNormalToWorld; uniform vec2 captureReflectance; uniform sampler2D captureGroundProfile; uniform bool captureUseProfile; uniform float captureProfileSize; uniform vec2 captureCorridorOrigin;\n'+photographicSurfaceGLSL+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 photoDx=dFdx(posM),photoDy=dFdy(posM);
      vec3 photoG=normalize(normM);if(!gl_FrontFacing)photoG=-photoG;
      vec3 faceG=normalize(cross(photoDx,photoDy));if(dot(faceG,photoG)<0.)faceG=-faceG;
      if(dot(faceG,photoG)<.7071)photoG=faceG;
      vec3 photoW=pow(abs(photoG),vec3(6.));photoW/=dot(photoW,vec3(1.));
      float region=dot(vec4(posM,1.),groundRegion);
      if(captureUseProfile&&!captureUseGroundCover){
        float station=mod(posM.x+captureCorridorOrigin.x,132.);if(station>66.)station=132.-station;
        float u=station<2.?station*station*.25:station>64.?64.-(66.-station)*(66.-station)*.25:station-1.;
        vec2 edges=texture2D(captureGroundProfile,vec2((u/64.*(captureProfileSize-1.)+.5)/captureProfileSize,.5)).rg*32.-16.;
        float lateral=mod(posM.z-captureCorridorOrigin.y+16.,64.);if(lateral>32.)lateral=64.-lateral;lateral-=16.;
        region=min(lateral-edges.x,edges.y-lateral);
      }
      float mask=captureUseGroundCover?clamp(photoGroundCover,0.,1.):smoothstep(-groundMixWidth*.5,groundMixWidth*.5,region);if(forceMaterial>=0.)mask=forceMaterial;
      Surface photoSurface;
      if(mask>=.99999){photoSurface=projectSurface(groundColor,groundNormal,groundMesoColor,groundMesoNormal,groundMean,photoG,photoW,posM,photoDx,photoDy,true);photoSurface.c*=captureReflectance.x;}
      else if(mask<=.00001){photoSurface=projectSurface(wallColor,wallNormal,wallMesoColor,wallMesoNormal,wallMean,photoG,photoW,posM,photoDx,photoDy,false);photoSurface.c*=captureReflectance.y;}
      else{
        Surface a=projectSurface(groundColor,groundNormal,groundMesoColor,groundMesoNormal,groundMean,photoG,photoW,posM,photoDx,photoDy,true);
        Surface b=projectSurface(wallColor,wallNormal,wallMesoColor,wallMesoNormal,wallMean,photoG,photoW,posM,photoDx,photoDy,false);
        photoSurface.c=mix(b.c*captureReflectance.y,a.c*captureReflectance.x,mask);photoSurface.n=normalize(mix(b.n,a.n,mask));photoSurface.r=mix(b.r,a.r,mask);
      }
      diffuseColor.rgb*=photoSurface.c;
    `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(photoSurface.r,.22,1.);')
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=normalize(mat3(viewMatrix)*captureNormalToWorld*photoSurface.n);');
  };
  material.customProgramCacheKey=()=> 'xianxia-native-photo-shared-pbr-v5';material.needsUpdate=true;return material;
}

export function addPhotographicGround(material,{manifest,textures}){
  const vertices=[...TRAIL,...BRANCH],edges=[];
  for(const route of [TRAIL,BRANCH])for(let i=0;i<route.length-1;i++)edges.push([vertices.indexOf(route[i]),vertices.indexOf(route[i+1])]);
  const uniform={stochastic:{value:true},microMeters:{value:new THREE.Vector2(.25,.25)},groundMean:{value:new THREE.Vector3(...manifest.groundMean)},photoRoute:{value:vertices.map(p=>new THREE.Vector4(p[0],p[2],p[3],0))}};
  for(const [key,texture]of Object.entries(textures))uniform[key]={value:texture};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniform);
    shader.vertexShader='varying vec3 posM; varying vec3 normM;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nposM=position;normM=normal;');
    const mask=`uniform vec4 photoRoute[${vertices.length}];
float photoPath(vec2 p){
  float coverage=0.;
  ${edges.map(([a,b])=>`{vec4 a=photoRoute[${a}],b=photoRoute[${b}];vec2 v=b.xy-a.xy;float t=clamp(dot(p-a.xy,v)/max(dot(v,v),.0001),0.,1.);float width=mix(a.z,b.z,t)+1.;coverage=max(coverage,1.-smoothstep(width,width+.8,length(p-a.xy-v*t)));}`).join('\n')}
  return coverage;
}\n`;
    shader.fragmentShader=photographicSurfaceGLSL+mask+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 photoG=dot(normM,normM)>.000001?normalize(normM):vec3(0.,1.,0.);
      if(!gl_FrontFacing)photoG=-photoG;
      vec3 photoW=pow(abs(photoG),vec3(6.));photoW/=max(.000001,dot(photoW,vec3(1.)));
      vec3 photoDx=dFdx(posM),photoDy=dFdy(posM);
      float photoMask=photoPath(posM.xz)*step(.55,abs(photoG.y))*(1.-smoothstep(40.,65.,length(vViewPosition)));
      Surface photoSurface;photoSurface.c=diffuseColor.rgb;photoSurface.n=photoG;photoSurface.r=1.;
      if(photoMask>.0001)photoSurface=projectSurface(groundColor,groundNormal,groundMesoColor,groundMesoNormal,groundMean,photoG,photoW,posM,photoDx,photoDy,true);
      diffuseColor.rgb=mix(diffuseColor.rgb,photoSurface.c,photoMask);
    `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,photoSurface.r,photoMask);')
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=normalize(mix(normal,mat3(viewMatrix)*photoSurface.n,photoMask));');
  };
  material.customProgramCacheKey=()=> 'xianxia-full-photo-plus-grain-v1';
  material.needsUpdate=true;return material;
}
