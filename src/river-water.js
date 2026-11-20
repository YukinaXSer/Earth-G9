import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { RIVER_LEVEL, riverX } from './data.js';

export function createRiverWater(geometry, normalMap, lowDetail = false) {
  geometry.translate(0, -RIVER_LEVEL, 0).rotateX(Math.PI / 2);
  const water = new Water(geometry, {
    waterNormals: normalMap,
    textureWidth: lowDetail ? 128 : 256, textureHeight: lowDetail ? 128 : 256,
    sunDirection: new THREE.Vector3(-24, 30, 12).normalize(),
    sunColor: '#fff0ce', waterColor: '#384f39', distortionScale: .6, fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = RIVER_LEVEL;
  const material = water.material;
  material.transparent = true;
  material.depthWrite = false;
  Object.assign(material.uniforms, {
    rain: { value: 0 }, environmentSampler: { value: null },
    sceneReflection: { value: 0 }, reflectionGain: { value: .85 },
  });
  material.vertexShader = 'attribute float waterDepth; varying float vWaterDepth; varying vec2 vRiverUv;\n' + material.vertexShader.replace('void main() {', 'void main() {\nvWaterDepth = waterDepth; vRiverUv = uv;');
  material.fragmentShader = `uniform float rain;
    uniform float sceneReflection;
    uniform float reflectionGain;
    uniform sampler2D environmentSampler;
    varying float vWaterDepth;
    varying vec2 vRiverUv;
    ` + material.fragmentShader
    .replace(/vec4 getNoise\([\s\S]*?(?=void sunLight)/, `vec4 getNoise(vec2 p) {
      vec2 uv = vec2(p.x - (24. + sin(p.y * .036) * 8.), p.y);
      vec2 current = vec2(0., time * .18);
      vec4 a = texture2D(normalSampler, (uv - current) * .16);
      vec4 b = texture2D(normalSampler, (uv - current * 1.17) * .27 + vec2(.37, .19));
      return (a + b) - 1.;
    }
    void rainNormal(inout vec3 n) {
      vec2 p = worldPosition.xz * 1.3;
      vec2 cell = floor(p);
      float seed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      vec2 delta = fract(p) - vec2(.25 + seed * .5, .75 - seed * .5);
      float age = fract(time * 1.3 + seed);
      float d = length(delta);
      float ring = exp(-pow((d - age * .7) * 40., 2.)) * (1. - age) * rain;
      n.xz += delta * ring * .18;
      n = normalize(n);
    }
    `)
    .replace('vec3( 1.5, 1.0, 1.5 )', 'vec3( 0.2, 1.0, 0.2 )')
    .replace('vec3 diffuseLight = vec3(0.0);', 'rainNormal(surfaceNormal);\nvec3 diffuseLight = vec3(0.0);')
    .replace('float rf0 = 0.3;', 'float rf0 = 0.02;')
    .replace('float theta =', `vec3 reflected = reflect(-eyeDirection, surfaceNormal);
      vec2 envUv = vec2(atan(reflected.z, reflected.x) / 6.2831853 + .5, asin(clamp(reflected.y, -1., 1.)) / 3.14159265 + .5);
      vec3 radiance = texture2D(environmentSampler, envUv).rgb;
      float luminance = dot(radiance, vec3(.2126, .7152, .0722));
      vec3 environmentReflection = radiance / (1. + luminance);
      reflectionSample = mix(environmentReflection, reflectionSample, sceneReflection) * reflectionGain;
      float theta =`)
    .replace(/vec3 albedo =[^;]+;/, `vec3 albedo = mix((scatter * .55 + diffuseLight * .08) * getShadowMask(), reflectionSample, reflectance)
      + specularLight * reflectance * .04 * getShadowMask();`)
    .replace('gl_FragColor = vec4( outgoingLight, alpha );', `float absorption = 1. - exp(-max(vWaterDepth, 0.) * mix(1.8, 2.4, rain));
      float shoreFade = smoothstep(0., .14, vWaterDepth);
      float meshEdge = 1. - smoothstep(.46, .5, abs(vRiverUv.x - .5));
      gl_FragColor = vec4(outgoingLight, mix(.2, .94, absorption) * shoreFade * meshEdge);`);
  const reflectScene = water.onBeforeRender;
  const reflectionCamera = new THREE.PerspectiveCamera();
  let lastReflection = -Infinity;
  water.onBeforeRender = (renderer, scene, camera) => {
    const eye = material.uniforms.eye.value;
    eye.setFromMatrixPosition(camera.matrixWorld);
    const nearRiver = Math.abs(eye.x - riverX(eye.z)) < (lowDetail ? 35 : 70);
    material.uniforms.sceneReflection.value = Number(nearRiver);
    const time = material.uniforms.time.value;
    if (nearRiver && (!lowDetail || time - lastReflection >= .2)) {
      if (camera.isPerspectiveCamera) {
        reflectionCamera.copy(camera, false);
        reflectionCamera.far = Math.min(camera.far, lowDetail ? 48 : 80);
        reflectionCamera.updateProjectionMatrix();
        reflectScene(renderer, scene, reflectionCamera);
      } else reflectScene(renderer, scene, camera);
      lastReflection = time;
    }
  };
  water.userData.reflectionMode = lowDetail ? 'local-planar-throttled' : 'local-planar';
  return water;
}
