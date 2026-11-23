import {MOUNTAIN_BASE_X,MOUNTAIN_PERIOD} from './xianxia-mountain-geometry.js';

export const MOUNTAIN_NATIVE_PATH=Object.freeze([
  [97,-115.1],[100.5,-115.1],[108.5,-115.1],[116.75,-113.85],
  [125.25,-112.1],[127,-110.35],[132.25,-110.35],[140,-111.1],
  [145.75,-104.85],[145.75,-103.1],[146.25,-102.6],[155.25,-102.6],
  [158.5,-102.35],[163,-102.35],
].map(Object.freeze));

export function mountainPathDistance(x,z){
  let distance=Infinity;
  for(let i=1;i<MOUNTAIN_NATIVE_PATH.length;i++){
    const a=MOUNTAIN_NATIVE_PATH[i-1],b=MOUNTAIN_NATIVE_PATH[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    distance=Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }
  return distance;
}

export function mountainRoute(periods=16){
  const points=[];
  for(let block=0;block<periods;block++){
    const mirrored=block%2===1,path=mirrored?[...MOUNTAIN_NATIVE_PATH].reverse():MOUNTAIN_NATIVE_PATH;
    for(const [localX,z]of path){
      const x=mirrored?2*MOUNTAIN_BASE_X+(block+1)*MOUNTAIN_PERIOD-localX:localX+block*MOUNTAIN_PERIOD;
      if(x<100.5||points.length&&Math.hypot(x-points.at(-1)[0],z-points.at(-1)[2])<1e-6)continue;
      points.push([x,0,z,1.2]);
    }
  }
  return points;
}

export function mountainRoutePoint(route,fraction){
  const lengths=route.slice(1).map((p,i)=>Math.hypot(p[0]-route[i][0],p[2]-route[i][2]));
  let remaining=lengths.reduce((sum,n)=>sum+n,0)*fraction;
  for(let i=0;i<lengths.length;i++){
    if(remaining>lengths[i]){remaining-=lengths[i];continue;}
    const a=route[i],b=route[i+1],t=remaining/lengths[i];
    return [a[0]+(b[0]-a[0])*t,0,a[2]+(b[2]-a[2])*t];
  }
  return route.at(-1).slice(0,3);
}
