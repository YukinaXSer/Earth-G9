import capturedCaveRoute from './xianxia-cave-route.json' with {type:'json'};

export const TRAIL = [
  [0,7,0,12],[0,8,-30,8],[22,11,-57,9],[65,15,-72,14],
  [108,18,-64,9],[153,22,-96,9],[195,27,-147,12],[184,33,-202,8],
  [121,38,-243,9],[80,42,-300,12],[105,46,-369,8],[171,52,-406,13],
  [240,58,-390,9],[284,64,-330,8],[330,69,-271,11],[382,75,-292,9],
  [449,83,-361,13],[444,92,-441,9],[370,100,-501,11],[300,108,-561,10],
  [320,118,-640,8],[400,128,-710,11],[470,139,-690,10],[500,150,-610,20]
].map(([x,y,z,width])=>[x*1.6,y,z*1.6,width*.28]);
export const CAVE = capturedCaveRoute;
export const BRANCH = [[195,27,-147,9],[240,28,-170,10],[274,30,-220,12],[245,34,-265,10],[184,33,-202,8]].map(([x,y,z,width])=>[x*1.6,y,z*1.6,width*.28]);
export const LOCATIONS = [
  {id:'cave',name:'两界洞',subtitle:'一洞隔尘世，松风入青岚',point:[0,7,0],kind:'passage'},
  {id:'pine',name:'听松崖',subtitle:'且听松风，洗却来时尘',point:[65,15,-72],kind:'meditation',verse:'松风吹解带，山月照弹琴。',author:'王维《酬张少府》',story:'雨林的潮气在洞口渐渐散去。听松崖上，只有风从针叶间穿过。按下静坐，留一息给山间。'},
  {id:'cloud',name:'望云台',subtitle:'云深不知处，行至此间歇',point:[171,52,-406],kind:'meditation',verse:'只在此山中，云深不知处。',author:'贾岛《寻隐者不遇》',story:'绕过石隙，群峰次第展开。云海没有边界，来路仍在身后。此地可静坐观云，也可沿古道继续登高。'},
  {id:'echo',name:'回响谷',subtitle:'空山不见人，但闻人语响',point:[274,30,-220],kind:'discovery',verse:'返景入深林，复照青苔上。',author:'王维《鹿柴》',story:'这条支路隐在主径东侧。谷中的回声把松涛送得更远，青苔覆盖着风化的石面。'},
  {id:'wind',name:'御风隘',subtitle:'长风过隘，群峰在足下',point:[449,83,-361],kind:'discovery',verse:'会当凌绝顶，一览众山小。',author:'杜甫《望岳》',story:'山径在这里收窄，岩壁替你挡住一侧的风。转过山口，前面便是通向高处的折返古道。'},
  {id:'summit',name:'栖霞顶',subtitle:'行到水穷处，坐看云起时',point:[500,150,-610],kind:'meditation',verse:'行到水穷处，坐看云起时。',author:'王维《终南别业》',story:'青岚境的最高处。没有传送阵，也没有捷径；穿过山洞、沿石径走来的每一步，都连在同一片天地里。'}
].map(place=>({...place,point:[place.point[0]*1.6,place.point[1],place.point[2]*1.6]}));

const smooth=t=>t*t*(3-2*t);
export function sampleRoute(points,x,z) {
  let best={distance:Infinity,height:0,width:0,x:0,z:0,index:0,t:0};
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[2]-a[2];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz)));
    const px=a[0]+dx*t,pz=a[2]+dz*t,distance=Math.hypot(x-px,z-pz);
    if(distance<best.distance)best={distance,height:a[1]+(b[1]-a[1])*smooth(t),width:a[3]+(b[3]-a[3])*t,x:px,z:pz,index:i,t};
  }
  return best;
}
export function sampleMountain(x,z) {
  const candidates=[TRAIL,CAVE,BRANCH].map(route=>({...sampleRoute(route,x,z),route}));
  return candidates.reduce((a,b)=>a.distance-a.width < b.distance-b.width?a:b);
}
export function canWalkMountain(x,z) {
  const p=sampleMountain(x,z);
  return p.distance <= p.width-.5;
}
export function caveAmount(x,z,width=12) {
  const p=sampleRoute(CAVE,x,z);
  if(p.distance>width)return 0;
  return smooth(Math.max(0,Math.min(1,(z-4)/22)))*smooth(Math.max(0,Math.min(1,(130-z)/20)));
}
export function routeLength(route) {
  return route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-route[i][0],p[1]-route[i][1],p[2]-route[i][2]),0);
}
export function nearestLocation(x,z,radius=18) {
  return LOCATIONS.find(p=>Math.hypot(x-p.point[0],z-p.point[2])<radius)??null;
}
