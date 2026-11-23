import {needleComponents} from './pine-needle-components.mjs';

export function pineTree01AtlasPart(u,v){
  u-=Math.floor(u);v-=Math.floor(v);
  if(u>.25&&v<.33)return 'cones';
  if(u<.6&&v>.35&&(v<.86||u<.32))return 'wood';
  return 'needles';
}

export function pineTwigParts(indices,uv,needleMask){
  const wood=[],cones=[],needles=[];
  for(let i=0;i<indices.length;i+=3){
    const u=(uv[indices[i]*2]+uv[indices[i+1]*2]+uv[indices[i+2]*2])/3;
    const v=(uv[indices[i]*2+1]+uv[indices[i+1]*2+1]+uv[indices[i+2]*2+1])/3;
    const part=pineTree01AtlasPart(u,v);
    if(part!=='needles'||!needleMask[indices[i]])(part==='cones'?cones:part==='wood'?wood:needles).push(indices[i],indices[i+1],indices[i+2]);
  }
  return {wood,cones,needles};
}

export function pineNeedlePhotoColor(rgba){
  const out=new Uint8Array(rgba),gain=[.9,1.5,1.05];
  for(let i=0;i<out.length;i+=4){
    const green=Math.max(0,Math.min(1,Math.min(rgba[i+1]-rgba[i],rgba[i+1]-rgba[i+2])/9));
    if(!green)continue;
    for(let k=0;k<3;k++){
      const c=rgba[i+k]/255,linear=c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
      const value=Math.min(1,linear*(1+(gain[k]-1)*green));
      out[i+k]=Math.round((value<=.0031308?value*12.92:1.055*value**(1/2.4)-.055)*255);
    }
  }
  return out;
}

const dot=(a,b)=>a.reduce((sum,n,k)=>sum+n*b[k],0);
const unit=v=>{const length=Math.hypot(...v);return length>1e-9?v.map(n=>n/length):[0,1,0];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

export function needleSprays(position,indices,uv,{cellSize=.35,aspect=.6,acceptUV=()=>true}={}){
  if(!(cellSize>0)||!Number.isFinite(cellSize)||!(aspect>0)||!Number.isFinite(aspect))throw new Error('Invalid pine spray dimensions');
  const needles=needleComponents(position,indices),cells=new Map(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],crown=[0,0,0];
  let accepted=0;
  for(const group of needles.groups){
    const tex=[0,0];for(const i of group.vertices)for(let k=0;k<2;k++)tex[k]+=uv[i*2+k]/group.vertices.length;
    if(!acceptUV(...tex))continue;
    const key=group.center.map(n=>Math.floor(n/cellSize)).join(':');
    if(!cells.has(key))cells.set(key,[]);cells.get(key).push(group);accepted++;
    for(let k=0;k<3;k++)crown[k]+=group.center[k];
    for(const i of group.vertices)for(let k=0;k<3;k++){min[k]=Math.min(min[k],position[i*3+k]);max[k]=Math.max(max[k],position[i*3+k]);}
  }
  if(!accepted)throw new Error('No photographed green needles found');
  for(let k=0;k<3;k++)crown[k]/=accepted;
  const output=[],normals=[],texcoords=[],triangles=[];
  for(const groups of cells.values()){
    const center=[0,0,0];
    for(const group of groups){
      for(let k=0;k<3;k++)center[k]+=group.center[k]/groups.length;
    }
    const covariance=Array.from({length:3},()=>[0,0,0]);
    for(const group of groups){const delta=group.center.map((n,k)=>n-center[k]);for(let j=0;j<3;j++)for(let k=0;k<3;k++)covariance[j][k]+=delta[j]*delta[k];}
    let axis=groups[0].axis;
    for(let i=0;i<12;i++){const next=covariance.map(row=>dot(row,axis));if(Math.hypot(...next)<1e-9)break;axis=unit(next);}
    const outward=[center[0]-crown[0],.7,center[2]-crown[2]];
    if(dot(axis,outward)<0)axis=axis.map(n=>-n);
    const first=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0])),second=cross(axis,first);
    let start=Infinity,end=-Infinity;
    for(const group of groups)for(const i of group.vertices){
      const along=axis.reduce((s,n,k)=>s+n*(position[i*3+k]-center[k]),0);
      start=Math.min(start,along);end=Math.max(end,along);
    }
    const height=Math.min(.4,Math.max(.1,(end-start)*1.1)),width=height*aspect;
    // Bend the ensemble normal around the canopy, not the flat photograph.
    const normal=unit([outward[0],Math.hypot(outward[0],outward[2])*.7+.7,outward[2]]);
    const rotation=center[0]*1.71+center[2]*.93;
    for(let plane=0;plane<3;plane++){
      const angle=rotation+plane*Math.PI/3,across=first.map((n,k)=>n*Math.cos(angle)+second[k]*Math.sin(angle)),base=output.length/3;
      const faceNormal=cross(across,axis),shootAxis=unit(axis.map((n,k)=>n+faceNormal[k]*.25));
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
      const offsets=corners.map(([x,y])=>across.map((n,k)=>n*x*width/2+shootAxis[k]*y*height/2));
      for(let k=0;k<3;k++)if(max[k]===min[k])for(const offset of offsets)offset[k]=0;
      let fit=1;
      for(const offset of offsets)for(let k=0;k<3;k++)if(offset[k])fit=Math.min(fit,((offset[k]>0?max[k]:min[k])-center[k])/offset[k]);
      for(let face=0;face<2;face++)for(let i=0;i<corners.length;i++){
        for(let k=0;k<3;k++)output.push(center[k]+offsets[i][k]*fit);
        normals.push(...normal);texcoords.push((corners[i][0]+1)/2,(1-corners[i][1])/2);
      }
      triangles.push(base,base+1,base+2,base,base+2,base+3,base+4,base+6,base+5,base+4,base+7,base+6);
    }
  }
  return {position:new Float32Array(output),normal:new Float32Array(normals),uv:new Float32Array(texcoords),indices:new Uint32Array(triangles),needleMask:needles.mask,accepted,clusters:cells.size,bounds:{min,max}};
}

export function pineSprayAlpha(pixels,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||pixels.length!==width*height*4||width<1||height<1)throw new Error('Invalid pine photograph');
  const output=new Uint8Array(pixels);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,brightness=Math.max(...pixels.subarray(i,i+3)),edge=Math.min(x,y,width-1-x,height-1-y)/3;
    output[i+3]=Math.round(pixels[i+3]*Math.min(1,Math.max(0,(brightness-12)/12))*Math.min(1,edge));
  }
  const labels=new Int32Array(width*height).fill(-1),queue=new Uint32Array(labels.length),sizes=[];
  for(let start=0;start<labels.length;start++){
    if(labels[start]!==-1||!output[start*4+3])continue;
    const label=sizes.length;let head=0,tail=1;queue[0]=start;labels[start]=label;
    while(head<tail){
      const i=queue[head++],x=i%width,y=Math.floor(i/width);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy,n=yy*width+xx;
        if(xx<0||yy<0||xx>=width||yy>=height||labels[n]!==-1||!output[n*4+3])continue;
        labels[n]=label;queue[tail++]=n;
      }
    }
    sizes.push(tail);
  }
  const largest=sizes.reduce((best,size,i)=>best<0||size>sizes[best]?i:best,-1);
  for(let i=0;i<labels.length;i++)if(labels[i]!==largest||!output[i*4+3])output.fill(0,i*4,i*4+4);
  return output;
}
