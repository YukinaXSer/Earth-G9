import { MeshStandardMaterial, DoubleSide } from 'three';

export const CAVE_TEXTURE_SETS = ['rock_face_03', 'rock_surface', 'rock_face_04', 'rock_ground_02'];
export const CAVE_REPEAT_METRES = 1.8;

const declarations = /* glsl */`
varying vec3 vCavePosition;
varying vec3 vCaveNormal;
varying float vCaveRoute;
varying float vCaveWallOnly;
varying float vCaveGranite;
uniform float caveRepeat;
uniform float caveNormalStrength;
uniform float caveRouteLength;
uniform float caveViewerBrightness;
uniform sampler2D caveColor0;
uniform sampler2D caveColor1;
uniform sampler2D caveColor2;
uniform sampler2D caveColor3;
uniform sampler2D caveNormal0;
uniform sampler2D caveNormal1;
uniform sampler2D caveNormal2;
uniform sampler2D caveNormal3;
uniform sampler2D caveRough0;
uniform sampler2D caveRough1;
uniform sampler2D caveRough2;
uniform sampler2D caveRough3;

vec3 caveSigns(vec3 n) { return step(vec3(0.0), n) * 2.0 - 1.0; }
vec3 caveGranitePosition(vec3 p) { return p * 0.231 + vec3(7.13, -3.71, 11.29); }
vec3 caveWeights(vec3 n) {
  vec3 geometric = normalize(cross(dFdx(vCavePosition), dFdy(vCavePosition)));
  vec3 w = pow(abs(n), vec3(2.0)) * pow(abs(geometric), vec3(4.0)) + 0.2 * pow(abs(geometric), vec3(8.0));
  return w / max(dot(w, vec3(1.0)), 0.0001);
}
vec3 caveSample(sampler2D map, vec3 p, vec3 n) {
  vec3 s = caveSigns(n), w = caveWeights(n);
  return texture2D(map, vec2(-p.z * s.x, p.y)).rgb * w.x
       + texture2D(map, vec2(p.x, -p.z * s.y)).rgb * w.y
       + texture2D(map, vec2(p.x * s.z, p.y)).rgb * w.z;
}
vec3 caveMappedNormal(sampler2D map, vec3 p, vec3 n) {
  vec3 s = caveSigns(n), w = caveWeights(n);
  vec3 x = texture2D(map, vec2(-p.z * s.x, p.y)).xyz * 2.0 - 1.0;
  vec3 y = texture2D(map, vec2(p.x, -p.z * s.y)).xyz * 2.0 - 1.0;
  vec3 z = texture2D(map, vec2(p.x * s.z, p.y)).xyz * 2.0 - 1.0;
  x.xy *= caveNormalStrength; y.xy *= caveNormalStrength; z.xy *= caveNormalStrength;
  // Whiteout in each signed projection basis: a flat map reproduces n exactly.
  vec3 nx = normalize(vec3(x.z * n.x, x.y + n.y, -x.x * s.x + n.z));
  vec3 ny = normalize(vec3(y.x + n.x, y.z * n.y, -y.y * s.y + n.z));
  vec3 nz = normalize(vec3(z.x * s.z + n.x, z.y + n.y, z.z * n.z));
  return normalize(nx * w.x + ny * w.y + nz * w.z);
}
`;

export function caveBlendWeights(t, normalY) {
  const smooth = (a, b, x) => { const q = Math.max(0, Math.min(1, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
  const interior = smooth(.04, .28, t), mountain = smooth(.72, .96, t), floor = smooth(.45, .78, normalY);
  return [(1 - interior) * (1 - floor), (interior - mountain) * (1 - floor), mountain * (1 - floor), floor];
}

export function caveDepthOcclusion(depth) {
  if (!Number.isFinite(depth)) throw new RangeError('Invalid cave depth');
  const t = Math.max(0, depth);
  return t < 4 ? 1 - .5 * t / 4 : .5 - .17 * Math.min(1, (t - 4) / 6);
}

export function createCaveMaterial(sets, { repeatMetres = CAVE_REPEAT_METRES, normalStrength = .65, routeLength = 105.37 } = {}) {
  if (!Number.isFinite(repeatMetres) || repeatMetres <= 0 || !Number.isFinite(normalStrength) || normalStrength < 0 || !Number.isFinite(routeLength) || routeLength <= 0) {
    throw new RangeError('Invalid cave texture scale or normal strength');
  }
  if (!Array.isArray(sets) || sets.length !== 4 || sets.some(s => !s?.color || !s?.normal || !s?.roughness)) {
    throw new TypeError('Cave material requires four complete photographed PBR sets');
  }
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
  material.name = 'Photographed cave triplanar';
  material.defaultAttributeValues = { ...material.defaultAttributeValues, caveWallOnly: [0], caveGranite: [0], caveShade: [1] };
  const viewerBrightness = { value: 1 };
  material.userData.viewerBrightness = viewerBrightness;
  material.onBeforeCompile = shader => {
    shader.uniforms.caveRepeat = { value: repeatMetres };
    shader.uniforms.caveNormalStrength = { value: normalStrength };
    shader.uniforms.caveRouteLength = { value: routeLength };
    shader.uniforms.caveViewerBrightness = viewerBrightness;
    sets.forEach((set, i) => {
      for (const [name, key] of [['Color', 'color'], ['Normal', 'normal'], ['Rough', 'roughness']]) {
        shader.uniforms['cave' + name + i] = { value: set[key] };
      }
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float caveShade;\nvarying float vCaveShade;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCaveShade = caveShade;')
      .replace('#include <common>', '#include <common>\nattribute float caveRoute;\nattribute float caveWallOnly;\nattribute float caveGranite;\nvarying vec3 vCavePosition;\nvarying vec3 vCaveNormal;\nvarying float vCaveRoute;\nvarying float vCaveWallOnly;\nvarying float vCaveGranite;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvCaveNormal = inverseTransformDirection(transformedNormal, viewMatrix);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCavePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCaveRoute = caveRoute;\nvCaveWallOnly = caveWallOnly;\nvCaveGranite = caveGranite;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCaveShade;')
      .replace('#include <common>', '#include <common>\n' + declarations)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 caveN = normalize(vCaveNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 caveP = vCavePosition / caveRepeat;
        float caveInterior = smoothstep(0.04, 0.28, vCaveRoute);
        float caveMountain = smoothstep(0.72, 0.96, vCaveRoute);
        float caveFloor = smoothstep(0.45, 0.78, caveN.y) * (1.0 - vCaveWallOnly) * (gl_FrontFacing ? 1.0 : 0.0);
        vec4 caveMix = vec4(1.0 - caveInterior, caveInterior - caveMountain, caveMountain, 0.0);
        caveMix *= 1.0 - caveFloor; caveMix.w = caveFloor;
        if (vCaveGranite > 0.5) caveMix = vec4(0.0, 0.0, 1.0, 0.0);
        vec3 caveAlbedo = vec3(0.0);
        if (caveMix.x > 0.0001) caveAlbedo += caveSample(caveColor0, caveP, caveN) * caveMix.x;
        if (caveMix.y > 0.0001) caveAlbedo += caveSample(caveColor1, caveP, caveN) * caveMix.y;
        if (caveMix.z > 0.0001) {
          vec3 graniteFine = caveSample(caveColor2, caveP, caveN);
          if (vCaveGranite > 0.5) {
            vec3 graniteMacro = caveSample(caveColor2, caveGranitePosition(caveP), caveN);
            graniteFine = mix(graniteFine, graniteMacro, 0.62 * vCaveGranite);
          }
          caveAlbedo += graniteFine * caveMix.z;
        }
        if (caveMix.w > 0.0001) caveAlbedo += caveSample(caveColor3, caveP, caveN) * caveMix.w;
        caveAlbedo = mix(caveAlbedo, vec3(dot(caveAlbedo, vec3(0.2126, 0.7152, 0.0722))), vCaveGranite);
        diffuseColor.rgb *= caveAlbedo;
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #ifdef USE_COLOR
          vec3 macroTint = clamp(vColor.rgb, vec3(0.3), vec3(0.85));
          macroTint = mix(macroTint, vec3(dot(macroTint, vec3(0.2126, 0.7152, 0.0722))), vCaveGranite);
          diffuseColor.rgb *= mix(vec3(0.7), macroTint, 0.45);
        #endif
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = 0.0;
        if (caveMix.x > 0.0001) roughnessFactor += caveSample(caveRough0, caveP, caveN).r * caveMix.x;
        if (caveMix.y > 0.0001) roughnessFactor += caveSample(caveRough1, caveP, caveN).r * caveMix.y;
        if (caveMix.z > 0.0001) {
          float graniteRough = caveSample(caveRough2, caveP, caveN).r;
          if (vCaveGranite > 0.5) graniteRough = mix(graniteRough, caveSample(caveRough2, caveGranitePosition(caveP), caveN).r, 0.62);
          roughnessFactor += graniteRough * caveMix.z;
        }
        if (caveMix.w > 0.0001) roughnessFactor += caveSample(caveRough3, caveP, caveN).r * caveMix.w;
        roughnessFactor *= roughness;
        roughnessFactor = clamp(roughnessFactor, 0.35, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        vec3 caveWorldNormal = vec3(0.0);
        if (caveMix.x > 0.0001) caveWorldNormal += caveMappedNormal(caveNormal0, caveP, caveN) * caveMix.x;
        if (caveMix.y > 0.0001) caveWorldNormal += caveMappedNormal(caveNormal1, caveP, caveN) * caveMix.y;
        if (caveMix.z > 0.0001) {
          vec3 graniteNormal = caveMappedNormal(caveNormal2, caveP, caveN);
          if (vCaveGranite > 0.5) graniteNormal = normalize(mix(graniteNormal, caveMappedNormal(caveNormal2, caveGranitePosition(caveP), caveN), 0.62));
          caveWorldNormal += graniteNormal * caveMix.z;
        }
        if (caveMix.w > 0.0001) caveWorldNormal += caveMappedNormal(caveNormal3, caveP, caveN) * caveMix.w;
        caveWorldNormal = normalize(caveWorldNormal);
        normal = normalize(mat3(viewMatrix) * caveWorldNormal);
      `)
      .replace('#include <opaque_fragment>', /* glsl */`
        float caveDepth = min(vCaveRoute, 1.0 - vCaveRoute) * caveRouteLength;
        float caveOcclusion = caveDepth < 4.0 ? 1.0 - 0.5 * max(0.0, caveDepth) / 4.0 : 0.5 - 0.17 * clamp((caveDepth - 4.0) / 6.0, 0.0, 1.0);
        caveOcclusion = mix(caveOcclusion, 1.0, vCaveWallOnly);
        outgoingLight *= min(1.0, caveOcclusion / max(0.25, caveViewerBrightness)) * vCaveShade;
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey = () => 'cave-triplanar-cliff-face';
  return material;
}
