import { Box3, DataTexture, FloatType, NearestFilter, MeshStandardMaterial, ShaderChunk, ShaderLib, Vector3, Vector4 } from 'three';
import { CAVE_TRIPLANAR_GLSL } from './cave-material.js';
import { nearestRoute } from './cave-space.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function nativeCaveFloorWeight({ depth, distance, wallDistance, heightDelta, normalY, noise = .5 }) {
  if (![depth, distance, wallDistance, heightDelta, normalY, noise].every(Number.isFinite)) throw new TypeError('Invalid native floor sample');
  const progress = Math.max(0, Math.min(1, (depth + .75) / 1.5));
  const edge = depth + (noise - .5) * .6 * 4 * progress * (1 - progress);
  return (1 - smooth(-.75, .75, edge)) * (1 - smooth(wallDistance + .4, wallDistance + .7, distance)) * (1 - smooth(.75, 1.25, Math.abs(heightDelta))) * smooth(.45, .78, normalY);
}

export function createNativeCaveWallProfile(route, radii) {
  if (!Array.isArray(route) || route.length < 2 || !Array.isArray(radii) || radii.length !== route.length || radii.some(r => !Array.isArray(r) || r.length < 4 || r.some(v => !Number.isFinite(v) || v <= 0))) throw new TypeError('Native floor dressing requires scanned wall profiles');
  let along = 0;
  const walls = route.map((point, i) => {
    if (i) along += Math.hypot(...point.map((value, j) => value - route[i - 1][j]));
    const offsets = radii[i].map((radius, j, ring) => radius * Math.cos(j * Math.PI * 2 / ring.length));
    return { along, x: point[0], z: point[2], right: Math.max(...offsets), left: -Math.min(...offsets) };
  });
  const segment = station => {
    let low = 0, high = walls.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (walls[mid].along <= station) low = mid; else high = mid; }
    const a = walls[low], b = walls[high], t = Math.max(0, Math.min(1, (station - a.along) / Math.max(1e-9, b.along - a.along)));
    return { a, b, t };
  };
  return {
    maximum: Math.max(...walls.flatMap(w => [w.left, w.right])),
    at(station, lateral) {
      if (![station, lateral].every(Number.isFinite)) throw new TypeError('Invalid wall profile sample');
      const { a, b, t } = segment(station), side = lateral < 0 ? 'left' : 'right';
      return a[side] * (1 - t) + b[side] * t;
    },
    atPoint(station, x, z, tangent) {
      const { a, b, t } = segment(station), cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
      return this.at(station, (x - cx) * tangent[2] - (z - cz) * tangent[0]);
    },
  };
}

export async function createNativeCaveFloorPatch(cave, root, route, mouth, yieldFrame, radii) {
  if (!cave?.isMeshStandardMaterial || !root?.isObject3D || !Array.isArray(route) || route.length < 2 || !Array.isArray(mouth?.floorCenter) || !Array.isArray(mouth?.outward) || typeof yieldFrame !== 'function') throw new TypeError('Native floor dressing requires the cave material, scan, route and mouth');
  const probe = { ...ShaderLib.standard, uniforms: {} }; cave.onBeforeCompile(probe);
  const shared = {};
  for (const name of ['caveColor3', 'caveNormal3', 'caveRough3', 'caveRepeat', 'caveNormalStrength', 'caveRouteLength', 'caveViewerBrightness']) {
    if (!probe.uniforms[name]) throw new TypeError('Native floor dressing requires photographed cave-floor PBR');
    shared[name] = probe.uniforms[name];
  }
  const walls = createNativeCaveWallProfile(route, radii);
  const bounds = new Box3().setFromPoints(route.map(p => new Vector3(...p))).expandByScalar(walls.maximum + .7), spacing = .2;
  const width = Math.ceil((bounds.max.x - bounds.min.x) / spacing) + 1, height = Math.ceil((bounds.max.z - bounds.min.z) / spacing) + 1;
  const field = new Float32Array(width * height * 4), tint = new Float32Array(field.length), bins = new Map(), triangles = new Map();
  const routeLength = nearestRoute(route.at(-1)[0], route.at(-1)[2], route).along;
  const point = new Vector3(), normal = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3();
  const key = (x, z) => `${Math.floor(x)},${Math.floor(z)}`;
  let deadline = performance.now() + 4;
  const pause = async () => { if (performance.now() >= deadline) { await yieldFrame(); deadline = performance.now() + 4; } };
  root.updateWorldMatrix(true, true);
  const meshes = []; root.traverse(mesh => { if (mesh.isMesh && mesh.geometry.attributes.color) meshes.push(mesh); });
  for (const mesh of meshes) {
    const geometry = mesh.geometry, p = geometry.attributes.position, colors = geometry.attributes.color, normals = geometry.attributes.normal, shade = geometry.attributes.caveShade, station = geometry.attributes.caveRoute ?? geometry.attributes._cave_route, native = geometry.attributes._cave_native_floor, index = geometry.index;
    const samples = new Map(), used = new Set();
    for (let i = 0; i < p.count; i++) {
      normal.fromBufferAttribute(normals, i).transformDirection(mesh.matrixWorld);
      if (normal.y > .45) {
        point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        const value = { x: point.x, y: point.y, z: point.z, normal: normal.toArray(), station: station ? station.getX(i) * routeLength : nearestRoute(point.x, point.z, route).along, color: [colors.getX(i), colors.getY(i), colors.getZ(i), shade ? shade.getX(i) : 1] };
        samples.set(i, value);
      }
      await pause();
    }
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j), vertices = ids.map(id => samples.get(id));
      if (vertices.every(Boolean) && !(native && ids.some(id => native.getX(id) > .5))) {
        const [u, v, w] = vertices;
        a.set(u.x, u.y, u.z); b.set(v.x, v.y, v.z); c.set(w.x, w.y, w.z);
        if (b.sub(a).cross(c.sub(a)).normalize().y > .45) {
          for (const vertex of vertices) used.add(vertex);
          for (let x = Math.floor(Math.min(u.x, v.x, w.x)); x <= Math.floor(Math.max(u.x, v.x, w.x)); x++) for (let z = Math.floor(Math.min(u.z, v.z, w.z)); z <= Math.floor(Math.max(u.z, v.z, w.z)); z++) {
            const cell = `${x},${z}`; if (!triangles.has(cell)) triangles.set(cell, []); triangles.get(cell).push(vertices);
          }
        }
      }
      await pause();
    }
    for (const sample of used) { const cell = key(sample.x, sample.z); if (!bins.has(cell)) bins.set(cell, []); bins.get(cell).push(sample); }
  }
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const px = bounds.min.x + x * spacing, pz = bounds.min.z + z * spacing, near = nearestRoute(px, pz, route), offset = (z * width + x) * 4;
    const wall = walls.atPoint(near.along, px, pz, near.tangent);
    let color = [.7, .7, .7, 1], bestHeight = -Infinity, station = near.along, referenceNormal = [0, 1, 0];
    if (near.distance < wall + .8) {
      for (const [a, b, c] of triangles.get(key(px, pz)) ?? []) {
        const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(determinant) < 1e-9) continue;
        const u = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / determinant, v = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / determinant;
        const y = a.y * u + b.y * v + c.y * (1 - u - v);
        if (u >= 0 && v >= 0 && u + v <= 1 && Math.abs(y - near.height) < 1.25 && y > bestHeight) { color = a.color.map((value, i) => value * u + b.color[i] * v + c.color[i] * (1 - u - v)); referenceNormal = a.normal.map((value, i) => value * u + b.normal[i] * v + c.normal[i] * (1 - u - v)); station = a.station * u + b.station * v + c.station * (1 - u - v); bestHeight = y; }
      }
      if (!Number.isFinite(bestHeight)) {
        let distance = Infinity;
        const reach = Math.ceil(wall + .7);
        for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) for (const sample of bins.get(`${Math.floor(px) + dx},${Math.floor(pz) + dz}`) ?? []) {
          if (Math.abs(sample.y - near.height) > 1.25) continue;
          const d = (sample.x - px) ** 2 + (sample.z - pz) ** 2;
          if (d < distance) { distance = d; color = sample.color; station = sample.station; referenceNormal = sample.normal; }
        }
      }
    }
    normal.fromArray(referenceNormal).normalize();
    const packedNormal = Math.round((normal.x * .5 + .5) * 4095) * 4096 + Math.round((normal.z * .5 + .5) * 4095);
    field.set([station, near.distance - wall, near.height, packedNormal], offset); tint.set(color, offset); await pause();
  }
  const texture = values => { const map = new DataTexture(values, width, height); map.type = FloatType; map.minFilter = map.magFilter = NearestFilter; map.needsUpdate = true; return map; };
  Object.assign(shared, {
    nativeCaveField: { value: texture(field) }, nativeCaveTint: { value: texture(tint) },
    nativeCaveGrid: { value: new Vector4(bounds.min.x - spacing / 2, bounds.min.z - spacing / 2, width * spacing, height * spacing) },
    nativeCavePlane: { value: new Vector4(...mouth.outward, -new Vector3(...mouth.outward).dot(new Vector3(...mouth.floorCenter))) },
    nativeCaveLength: { value: routeLength }, nativeCaveColor: { value: cave.color }, nativeCaveRoughness: { value: cave.roughness },
  });
  const cache = new WeakMap(), originals = new WeakMap();
  const create = original => {
    if (originals.has(original)) return original;
    if (cache.has(original)) return cache.get(original);
    const material = original.isMeshStandardMaterial ? original.clone() : new MeshStandardMaterial();
    if (!original.isMeshStandardMaterial) for (const property of ['color', 'map', 'alphaMap', 'alphaTest', 'side', 'vertexColors', 'transparent', 'opacity', 'depthTest', 'depthWrite', 'clippingPlanes', 'clipShadows', 'toneMapped']) material[property] = original[property];
    material.envMapIntensity = cave.envMapIntensity;
    material.defaultAttributeValues = original.defaultAttributeValues;
    material.name = original.name + ' cave-floor rock';
    material.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile.call(material, shader, renderer); Object.assign(shader.uniforms, shared);
      shader.uniforms.nativeCaveEnvironment = { value: (original.envMapIntensity ?? 1) / Math.max(1e-6, cave.envMapIntensity) };
      shader.vertexShader = 'varying vec3 vCavePosition; varying vec3 vCaveNormal;\n' + shader.vertexShader
        .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvCaveNormal=inverseTransformDirection(transformedNormal,viewMatrix);')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCavePosition=(photoModelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = `
varying vec3 vCavePosition; varying vec3 vCaveNormal;
uniform sampler2D caveColor3; uniform sampler2D caveNormal3; uniform sampler2D caveRough3;
uniform sampler2D nativeCaveField; uniform sampler2D nativeCaveTint;
uniform float caveRepeat; uniform float caveNormalStrength; uniform float caveRouteLength; uniform float caveViewerBrightness;
uniform vec4 nativeCaveGrid; uniform vec4 nativeCavePlane; uniform float nativeCaveLength; uniform vec3 nativeCaveColor; uniform float nativeCaveRoughness;
uniform float nativeCaveEnvironment;
vec4 nativeCaveSample(sampler2D field,vec2 uv){
  ivec2 size=textureSize(field,0),limit=size-1;
  vec2 pixel=clamp(uv*vec2(size)-.5,vec2(0.),vec2(limit)),fraction=fract(pixel);
  ivec2 base=ivec2(floor(pixel));
  vec4 a=texelFetch(field,base,0),b=texelFetch(field,min(base+ivec2(1,0),limit),0);
  vec4 c=texelFetch(field,min(base+ivec2(0,1),limit),0),d=texelFetch(field,min(base+1,limit),0);
  return mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y);
}
vec3 nativeCaveDecodeNormal(float code){
  vec2 n=vec2(floor(code/4096.),mod(code,4096.))/4095.*2.-1.;
  return normalize(vec3(n.x,sqrt(max(0.,1.-dot(n,n))),n.y));
}
vec3 nativeCaveScanNormal(vec2 uv){
  ivec2 size=textureSize(nativeCaveField,0),limit=size-1;
  vec2 pixel=clamp(uv*vec2(size)-.5,vec2(0.),vec2(limit)),fraction=fract(pixel);
  ivec2 base=ivec2(floor(pixel));
  vec3 a=nativeCaveDecodeNormal(texelFetch(nativeCaveField,base,0).a),b=nativeCaveDecodeNormal(texelFetch(nativeCaveField,min(base+ivec2(1,0),limit),0).a);
  vec3 c=nativeCaveDecodeNormal(texelFetch(nativeCaveField,min(base+ivec2(0,1),limit),0).a),d=nativeCaveDecodeNormal(texelFetch(nativeCaveField,min(base+1,limit),0).a);
  return normalize(mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y));
}
${CAVE_TRIPLANAR_GLSL}
` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 rockUv=(vCavePosition.xz-nativeCaveGrid.xy)/nativeCaveGrid.zw;
        vec4 rockField=nativeCaveSample(nativeCaveField,rockUv),rockTint=nativeCaveSample(nativeCaveTint,rockUv);
        vec3 rockN=normalize(vCaveNormal)*(gl_FrontFacing?1.:-1.),rockP=vCavePosition/caveRepeat;
        float rockNoise=dot(texture2D(caveColor3,rockP.xz*.43).rgb,vec3(.2126,.7152,.0722));
        rockNoise=clamp((rockNoise-.3)*2.+.5,0.,1.);
        float rockDepth=dot(vec4(vCavePosition,1.),nativeCavePlane),rockProgress=clamp((rockDepth+.75)/1.5,0.,1.);
        float rockEdge=rockDepth+(rockNoise-.5)*.6*4.*rockProgress*(1.-rockProgress);
        float rockWeight=(1.-smoothstep(-.75,.75,rockEdge))*(1.-smoothstep(.4,.7,rockField.y))*(1.-smoothstep(.75,1.25,abs(vCavePosition.y-rockField.z)))*smoothstep(.45,.78,rockN.y);
        rockWeight*=step(0.,rockUv.x)*step(rockUv.x,1.)*step(0.,rockUv.y)*step(rockUv.y,1.);
        vec3 rockMaterialN=rockN;
        if(rockWeight>.0001){
          rockMaterialN=normalize(mix(rockN,nativeCaveScanNormal(rockUv),.85));
          vec3 rockColor=caveSample(caveColor3,rockP,rockMaterialN)*mix(vec3(.7),clamp(rockTint.rgb,vec3(.3),vec3(.85)),.45)*nativeCaveColor;
          diffuseColor.rgb=mix(diffuseColor.rgb,rockColor,rockWeight);
        }
      `).replace('#include <roughnessmap_fragment>\nroughnessFactor=clamp(photoSurface.r,.22,1.);', `#include <roughnessmap_fragment>
        roughnessFactor=clamp(photoSurface.r,.22,1.);
        if(rockWeight>.0001)roughnessFactor=mix(roughnessFactor,clamp(caveSample(caveRough3,rockP,rockMaterialN).r*nativeCaveRoughness,.35,1.),rockWeight);
      `).replace('normal=normalize(mat3(viewMatrix)*captureNormalToWorld*photoSurface.n);', 'normal=normalize(mat3(viewMatrix)*captureNormalToWorld*photoSurface.n);\nif(rockWeight>.0001)normal=normalize(mix(normal,normalize(mat3(viewMatrix)*caveMappedNormal(caveNormal3,rockP,rockMaterialN)),rockWeight));');
      if (original.isMeshLambertMaterial) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', ShaderChunk.lights_fragment_maps.replace('getIBLIrradiance( geometryNormal )', 'getIBLIrradiance( geometryNormal ) * rockWeight'));
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight-=(reflectedLight.directSpecular+reflectedLight.indirectSpecular)*(1.-rockWeight);\n#include <opaque_fragment>');
      } else if (original.isMeshBasicMaterial) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight=mix(diffuseColor.rgb,outgoingLight,rockWeight);\n#include <opaque_fragment>');
      else shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', ShaderChunk.lights_fragment_maps
        .replace('getIBLIrradiance( geometryNormal )', 'getIBLIrradiance( geometryNormal ) * mix(nativeCaveEnvironment,1.,rockWeight)')
        .replace('getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )', 'getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * mix(nativeCaveEnvironment,1.,rockWeight)'));
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float rockCaveDepth=min(rockField.x/nativeCaveLength,1.-rockField.x/nativeCaveLength)*caveRouteLength;
        float rockOcclusion=rockCaveDepth<4.?1.-.5*max(0.,rockCaveDepth)/4.:.5-.17*clamp((rockCaveDepth-4.)/6.,0.,1.);
        outgoingLight*=mix(1.,min(1.,rockOcclusion/max(.25,caveViewerBrightness))*rockTint.a,rockWeight);
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => original.customProgramCacheKey() + '-native-cave-floor-rock-' + original.type;
    originals.set(material, original); cache.set(original, material); return material;
  };
  return {
    uniforms: shared,
    apply(group) { let count = 0; group.traverse(mesh => { if (mesh.isMesh && ['native-mountain', 'native-mountain-far'].includes(mesh.name)) { mesh.material = Array.isArray(mesh.material) ? mesh.material.map(create) : create(mesh.material); count++; } }); return count; },
    restore(group) { group.traverse(mesh => { if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => originals.get(m) ?? m) : originals.get(mesh.material) ?? mesh.material; }); },
  };
}
