export function needleProjection(position,indices,mask){
  let area=0;
  for(let i=0;i<indices.length;i+=3){
    if(!mask[indices[i]])continue;
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const u=[position[b]-position[a],position[b+1]-position[a+1],position[b+2]-position[a+2]],v=[position[c]-position[a],position[c+1]-position[a+1],position[c+2]-position[a+2]];
    area+=(Math.abs(u[1]*v[2]-u[2]*v[1])+Math.abs(u[2]*v[0]-u[0]*v[2])+Math.abs(u[0]*v[1]-u[1]*v[0]))/6;
  }
  return area;
}

export function needleComponents(position,indices){
  const count=position.length/3,parent=Int32Array.from({length:count},(_,i)=>i);
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<indices.length;i+=3){const r=root(indices[i]);parent[root(indices[i+1])]=r;parent[root(indices[i+2])]=r;}
  const connected=new Map();
  for(const i of indices){const r=root(i);if(!connected.has(r))connected.set(r,new Set());connected.get(r).add(i);}
  const groups=[],mask=new Uint8Array(count);
  for(const set of connected.values()){
    const vertices=[...set],center=[0,0,0];
    for(const i of vertices)for(let k=0;k<3;k++)center[k]+=position[i*3+k]/vertices.length;
    let size=0,axis;
    for(const i of vertices){const delta=center.map((c,k)=>position[i*3+k]-c),length=Math.hypot(...delta);if(length>size){size=length;axis=delta.map(n=>n/length);}}
    if(!axis||size>.225||size<.004)continue;
    let radial=0;
    for(const i of vertices){const delta=center.map((c,k)=>position[i*3+k]-c),along=delta.reduce((sum,n,k)=>sum+n*axis[k],0);radial=Math.max(radial,Math.hypot(...delta.map((n,k)=>n-along*axis[k])));}
    if(radial>size/6)continue;
    for(const i of vertices)mask[i]=1;
    groups.push({vertices,center,axis,radial});
  }
  return {groups,mask,projected:needleProjection(position,indices,mask)};
}

export function restoreNeedleCoverage(position,indices,target,maxRadius=.02){
  const needles=needleComponents(position,indices);
  if(!needles.projected)throw new Error('No slender pine needles found');
  const gain=Math.min(10,Math.max(1,target/needles.projected));
  for(const {vertices,center,axis,radial}of needles.groups){
    const widthGain=Math.max(1,Math.min(gain,maxRadius/Math.max(radial,1e-6)));
    for(const i of vertices){const delta=center.map((c,k)=>position[i*3+k]-c),along=delta.reduce((sum,n,k)=>sum+n*axis[k],0);for(let k=0;k<3;k++)position[i*3+k]=center[k]+along*axis[k]+(delta[k]-along*axis[k])*widthGain;}
  }
  return {gain,groups:needles.groups.length,target,before:needles.projected,after:needleProjection(position,indices,needles.mask)};
}
