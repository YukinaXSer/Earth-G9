// The same two-scale photographic sampling functions used by the independent preflight.
export const photographicSurfaceGLSL = `
varying vec3 posM;
varying vec3 normM;
uniform sampler2D groundColor, groundNormal, wallColor, wallNormal,groundMesoColor,groundMesoNormal,wallMesoColor,wallMesoNormal;
uniform vec3 groundMean,wallMean;
uniform vec2 microMeters;
uniform vec4 groundRegion;
uniform float groundMixWidth;
uniform float forceMaterial;
uniform bool stochastic;
struct Surface {vec3 c;vec3 n;float r;};
vec3 faceRotate(vec3 v,vec3 from,vec3 to){
  vec3 k=cross(from,to);
  return v+cross(k,v)+cross(k,cross(k,v))/(1.+dot(from,to));
}
vec2 photoOffset(vec2 id){
  return fract(sin(vec2(dot(id,vec2(127.1,311.7)),dot(id,vec2(269.5,183.3))))*43758.5453);
}
Surface photoPatch(sampler2D c,sampler2D n,vec2 uv,vec3 meanColor,vec2 dx,vec2 dy){
  vec2 skew=vec2(uv.x-uv.y*.577350269,uv.y*1.154700538);
  vec2 base=floor(skew),f=fract(skew),a,b,d;
  vec3 w;
  if(f.x+f.y<1.){a=base;b=base+vec2(1,0);d=base+vec2(0,1);w=vec3(1.-f.x-f.y,f.x,f.y);}
  else{a=base+vec2(1,1);b=base+vec2(0,1);d=base+vec2(1,0);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}
  w=pow(max(w,vec3(0.)),vec3(4.));w/=dot(w,vec3(1.));
  if(!stochastic)w=vec3(1,0,0);
  Surface o;o.c=vec3(0);o.n=vec3(0);o.r=0.;
  for(int i=0;i<3;i++){
    vec2 id=i==0?a:i==1?b:d;
    vec2 rnd=photoOffset(id);
    float angle=stochastic?floor(rnd.x*4.)*1.570796327:0.;
    mat2 R=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));
    vec2 q=R*uv+(stochastic?photoOffset(id+vec2(31,47)):vec2(0));
    vec4 nr=textureGrad(n,q,R*dx,R*dy);
    vec3 v=nr.xyz*2.-1.;
    v.xy=transpose(R)*v.xy;
    o.c+=textureGrad(c,q,R*dx,R*dy).rgb*w[i];
    o.n+=v*w[i];o.r+=nr.a*w[i];
  }
  float variance=sqrt(dot(w,w));
  o.c=clamp((o.c-meanColor)/variance+meanColor,0.,1.);
  o.n.xy*=.72/variance;o.n=normalize(o.n);
  return o;
}
Surface projectSurface(sampler2D c,sampler2D n,sampler2D mc,sampler2D mn,vec3 meanColor,vec3 g,vec3 w,vec3 p,vec3 px,vec3 py,bool isGround){
  vec3 s=mix(vec3(-1.),vec3(1.),step(vec3(0.),g));
  float repeats=1./(isGround?microMeters.x:microMeters.y);
  vec2 ux=vec2(p.y,s.x*p.z)*repeats,uy=vec2(p.x,-s.y*p.z)*repeats,uz=vec2(p.x,s.z*p.y)*repeats;
  vec2 xx=vec2(px.y,s.x*px.z)*repeats,xy=vec2(py.y,s.x*py.z)*repeats;
  vec2 yx=vec2(px.x,-s.y*px.z)*repeats,yy=vec2(py.x,-s.y*py.z)*repeats;
  vec2 zx=vec2(px.x,s.z*px.y)*repeats,zy=vec2(py.x,s.z*py.y)*repeats;
  Surface x=photoPatch(c,n,ux,meanColor,xx,xy),y=photoPatch(c,n,uy,meanColor,yx,yy),z=photoPatch(c,n,uz,meanColor,zx,zy);
  Surface o;
  o.c=x.c*w.x+y.c*w.y+z.c*w.z;o.r=x.r*w.x+y.r*w.y+z.r*w.z;
  o.n=normalize(
    faceRotate(vec3(s.x*x.n.z,x.n.x,s.x*x.n.y),vec3(s.x,0,0),g)*w.x+
    faceRotate(vec3(y.n.x,s.y*y.n.z,-s.y*y.n.y),vec3(0,s.y,0),g)*w.y+
    faceRotate(vec3(z.n.x,s.z*z.n.y,s.z*z.n.z),vec3(0,0,s.z),g)*w.z
  );
  {
    vec3 macroColor=textureGrad(mc,ux*.125,xx*.125,xy*.125).rgb*w.x+textureGrad(mc,uy*.125,yx*.125,yy*.125).rgb*w.y+textureGrad(mc,uz*.125,zx*.125,zy*.125).rgb*w.z;
    vec4 nx=textureGrad(mn,ux*.125,xx*.125,xy*.125),ny=textureGrad(mn,uy*.125,yx*.125,yy*.125),nz=textureGrad(mn,uz*.125,zx*.125,zy*.125);
    vec3 a=normalize(nx.xyz*2.-1.),b=normalize(ny.xyz*2.-1.),d=normalize(nz.xyz*2.-1.);
    vec3 macroNormal=normalize(faceRotate(vec3(s.x*a.z,a.x,s.x*a.y),vec3(s.x,0,0),g)*w.x+
      faceRotate(vec3(b.x,s.y*b.z,-s.y*b.y),vec3(0,s.y,0),g)*w.y+
      faceRotate(vec3(d.x,s.z*d.y,s.z*d.z),vec3(0,0,s.z),g)*w.z);
    float grain=dot(o.c,vec3(.2126,.7152,.0722))/max(.001,dot(meanColor,vec3(.2126,.7152,.0722)));
    o.c=macroColor*pow(clamp(grain,.65,1.5),.25);
    o.n=normalize(faceRotate(o.n,g,macroNormal));o.r=nx.a*w.x+ny.a*w.y+nz.a*w.z;
  }
  return o;
}
`;
