// The same two-scale photographic sampling functions used by the independent preflight.
export const photographicSurfaceGLSL = `
varying vec3 posM;
varying vec3 normM;
uniform sampler2D groundColor, groundNormal, wallColor, wallNormal,groundMesoColor,groundMesoNormal,wallMesoColor,wallMesoNormal;
uniform vec3 groundMean,wallMean;
uniform vec2 microMeters,mesoMeters;
uniform vec4 groundRegion;
uniform float groundMixWidth;
uniform float forceMaterial;
uniform bool stochastic;
struct Surface {vec3 c;vec3 n;float r;};
vec3 photoProjectionWeights(vec3 shadingNormal,vec3 dx,vec3 dy){
  vec3 area=cross(dx,dy);
  vec3 slope=dot(area,area)>1e-20?normalize(area):shadingNormal;
  vec3 w=pow(abs(slope),vec3(6.));
  return w/max(dot(w,vec3(1.)),.000001);
}
vec3 faceRotate(vec3 v,vec3 from,vec3 to){
  vec3 k=cross(from,to);
  return v+cross(k,v)+cross(k,cross(k,v))/(1.+dot(from,to));
}
vec2 photoOffset(vec2 id){
  return fract(sin(vec2(dot(id,vec2(127.1,311.7)),dot(id,vec2(269.5,183.3))))*43758.5453);
}
Surface photoPatch(sampler2D c,sampler2D n,vec2 uv,vec3 meanColor,vec2 dx,vec2 dy,bool randomize,bool meso){
  bool varied=stochastic&&randomize;
  vec2 skew=vec2(uv.x-uv.y*.577350269,uv.y*1.154700538);
  vec2 base=floor(skew),f=fract(skew),a,b,d;
  vec3 w;
  if(f.x+f.y<1.){a=base;b=base+vec2(1,0);d=base+vec2(0,1);w=vec3(1.-f.x-f.y,f.x,f.y);}
  else{a=base+vec2(1,1);b=base+vec2(0,1);d=base+vec2(1,0);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}
  w=pow(max(w,vec3(0.)),vec3(4.));w/=dot(w,vec3(1.));
  if(!varied)w=vec3(1,0,0);
  Surface o;o.c=vec3(0);o.n=vec3(0);o.r=0.;
  for(int i=0;i<3;i++){
    if(w[i]<.0001)continue;
    vec2 id=i==0?a:i==1?b:d;
    vec2 rnd=varied?photoOffset(id):vec2(0);
    float angle=varied?floor(rnd.x*4.)*1.570796327:0.;
    mat2 R=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));
    vec2 q=R*uv+(varied?photoOffset(id+vec2(31,47)):vec2(0));
    vec4 nr=textureGrad(n,q,R*dx,R*dy);
    vec3 v=nr.xyz*2.-1.;
    v.xy=transpose(R)*v.xy;
    o.c+=textureGrad(c,q,R*dx,R*dy).rgb*w[i];
    o.n+=v*w[i];o.r+=nr.a*w[i];
  }
  if(!meso){
    float variance=sqrt(dot(w,w));
    o.c=clamp((o.c-meanColor)/variance+meanColor,0.,1.);
    o.n.xy*=.72/variance;
  }
  o.n=normalize(o.n);
  return o;
}
Surface projectSurface(sampler2D c,sampler2D n,sampler2D mc,sampler2D mn,vec3 meanColor,vec3 g,vec3 w,vec3 p,vec3 px,vec3 py,bool isGround){
  vec3 s=mix(vec3(-1.),vec3(1.),step(vec3(0.),g));
  float repeats=1./(isGround?microMeters.x:microMeters.y);
  float mediumMeters=isGround?mesoMeters.x:mesoMeters.y;
  float mediumScale=mediumMeters>0.?(isGround?microMeters.x:microMeters.y)/mediumMeters:.125;
  vec2 ux=vec2(p.y,s.x*p.z)*repeats,uy=vec2(p.x,-s.y*p.z)*repeats,uz=vec2(p.x,s.z*p.y)*repeats;
  vec2 xx=vec2(px.y,s.x*px.z)*repeats,xy=vec2(py.y,s.x*py.z)*repeats;
  vec2 yx=vec2(px.x,-s.y*px.z)*repeats,yy=vec2(py.x,-s.y*py.z)*repeats;
  vec2 zx=vec2(px.x,s.z*px.y)*repeats,zy=vec2(py.x,s.z*py.y)*repeats;
  Surface o;o.c=vec3(0);o.n=vec3(0);o.r=0.;
  vec3 macroColor=vec3(0),macroNormal=vec3(0);
  float detailFade=1.-smoothstep(.0125,.04,max(length(px),length(py)));
  for(int axis=0;axis<3;axis++){
    if(w[axis]<.0001)continue;
    vec2 uv=axis==0?ux:axis==1?uy:uz,dx=axis==0?xx:axis==1?yx:zx,dy=axis==0?xy:axis==1?yy:zy;
    Surface detail;detail.c=meanColor;detail.n=vec3(0,0,1);detail.r=1.;
    if(detailFade>.001){
      detail=photoPatch(c,n,uv,meanColor,dx,dy,!isGround,false);
      detail.c=mix(meanColor,detail.c,detailFade);
      detail.n=normalize(mix(vec3(0,0,1),detail.n,detailFade));
    }
    Surface medium;
    if(isGround)medium=photoPatch(mc,mn,uv*mediumScale,meanColor,dx*mediumScale,dy*mediumScale,true,true);
    else{
      vec4 nr=textureGrad(mn,uv*mediumScale,dx*mediumScale,dy*mediumScale);
      medium.c=textureGrad(mc,uv*mediumScale,dx*mediumScale,dy*mediumScale).rgb;
      medium.n=normalize(nr.xyz*2.-1.);medium.r=nr.a;
    }
    vec3 m=medium.n;
    vec3 basis=axis==0?vec3(s.x,0,0):axis==1?vec3(0,s.y,0):vec3(0,0,s.z);
    vec3 detailN=axis==0?vec3(s.x*detail.n.z,detail.n.x,s.x*detail.n.y):axis==1?vec3(detail.n.x,s.y*detail.n.z,-s.y*detail.n.y):vec3(detail.n.x,s.z*detail.n.y,s.z*detail.n.z);
    vec3 macroN=axis==0?vec3(s.x*m.z,m.x,s.x*m.y):axis==1?vec3(m.x,s.y*m.z,-s.y*m.y):vec3(m.x,s.z*m.y,s.z*m.z);
    o.c+=detail.c*w[axis];o.n+=faceRotate(detailN,basis,g)*w[axis];
    macroColor+=medium.c*w[axis];
    macroNormal+=faceRotate(macroN,basis,g)*w[axis];o.r+=medium.r*w[axis];
  }
  float grain=dot(o.c,vec3(.2126,.7152,.0722))/max(.001,dot(meanColor,vec3(.2126,.7152,.0722)));
  o.c=macroColor*pow(clamp(grain,.65,1.5),.25);
  o.n=normalize(faceRotate(normalize(o.n),g,normalize(macroNormal)));
  return o;
}
`;
